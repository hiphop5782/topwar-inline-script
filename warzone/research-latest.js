(async () => {
    "use strict";

    // =========================================================
    // TOPWAR CROSS PVP TOP100 - STANDALONE
    // =========================================================

    const CFG = {
        LIMIT: 100,
        UI_TIMEOUT: 20000,
        RANK_TIMEOUT: 45000,
        DETAIL_TIMEOUT: 12000,
        SCROLL_STEPS: 50,
        SCROLL_DELAY: 180,
        PLAYER_DELAY: 80,
        POLL_DELAY: 100
    };

    if (window.__CROSS100_RUNNING) {
        console.warn("[CROSS100] 이미 실행 중입니다.");
        return;
    }

    window.__CROSS100_RUNNING = true;

    // =========================================================
    // ID MAPPING
    // =========================================================

    const HERO = {
        169: "세라",
        170: "로어",
        174: "엘라",
        228: "듀크",

        234: "심소영",
        240: "시노페",
        241: "마가레타",
        239: "로피",
        232: "릴리아",
        237: "알비다",
        224: "라일라",

        338: "프란체스카",
        334: "제트",
        332: "비비안",
        333: "가누스",
        337: "하이드",
        336: "조앤 매튜어"
    };

    const MECHA = {
        1002: "사막 정찰자 E-100",
        1003: "질풍의 불꽃 Rx",
        1004: "파도 분쇄자 BW-3",
        1005: "파멸의 톱날 D-4",
        1006: "광휘의 기사 LP-4",
        1007: "블레이드 엔젤 BA-6"
    };

    const ARMY = {
        10101: "육군 101레벨",
        10103: "육군 103레벨",
        20101: "해군 101레벨",

        901103: "공격형 육군 오딘",
        902103: "방어형 육군 오딘",
        903103: "공격형 해군 오딘",
        904103: "방어형 해군 오딘",
        905103: "공격형 공군 오딘",
        906103: "방어형 공군 오딘",

        503431: "사막 정찰자 E-100 (육군)",

        503901: "질풍의 불꽃 Rx (육군)",
        504031: "질풍의 불꽃 Rx (해군)",
        504161: "질풍의 불꽃 Rx (공군)",

        504401: "파도 분쇄자 BW-3 (육군)",
        504531: "파도 분쇄자 BW-3 (해군)",

        505111: "파멸의 톱날 D-4 (육군)",

        506111: "광휘의 기사 LP-4 (육군)",
        506241: "광휘의 기사 LP-4 (해군)",
        506371: "광휘의 기사 LP-4 (공군)",

        507111: "블레이드 엔젤 BA-6 (육군)",
        507241: "블레이드 엔젤 BA-6 (해군)",
        507371: "블레이드 엔젤 BA-6 (공군)"
    };

    const heroName = id =>
        HERO[id] || `미확인 영웅(${id})`;

    const mechaName = id =>
        MECHA[id] || `미확인 메카(${id})`;

    const armyName = id =>
        ARMY[id] || `미확인 병력(${id})`;

    const formatTP = value => {
        const n = Number(value);
        return Number.isFinite(n)
            ? `${(n / 1000000).toFixed(1)}M`
            : "-";
    };

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    const log = (...args) =>
        console.log("[CROSS100]", ...args);

    const state = {
        running: true,
        stopped: false,
        reason: "",
        phase: "초기화",
        attempted: 0,
        completed: 0,
        currentRank: null,
        results: [],
        errors: [],
        startedAt: new Date().toISOString()
    };

    window.CROSS100_STATE = state;

    // =========================================================
    // CONTROL
    // =========================================================

    let successful = false;
    let saved = false;
    let rankingEstablished = false;
    let expectedDetail = false;
    let seenDetail = false;
    let intentionalClose = false;
    let detailNodeRef = null;
    let watchdog = null;
    let activeRequest = null;

    window.CROSS100_STOP = () => {
        state.stopped = true;
        state.reason = "사용자 중단 요청";
    };

    function abort(reason) {
        state.stopped = true;
        state.reason = reason;
        throw new Error(reason);
    }

    // =========================================================
    // COCOS UTILITIES
    // =========================================================

    function scene() {
        return cc.director.getScene();
    }

    function valid(node) {
        return !!node && cc.isValid(node);
    }

    function walk(root, fn) {
        if (!valid(root)) return null;

        const stack = [root];

        while (stack.length) {
            const node = stack.pop();

            if (!valid(node)) continue;

            const result = fn(node);

            if (result) return result;

            const children = node.children || [];

            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }

        return null;
    }

    function findNode(name, root = scene()) {
        return walk(root, node =>
            node.name === name &&
            node.activeInHierarchy
                ? node
                : null
        );
    }

    function comp(node, name) {
        return (node?._components || []).find(c =>
            c.__classname__ === name ||
            c.constructor?.name === name
        ) || null;
    }

    function ancestor(node, name) {
        while (node) {
            if (node.name === name) return node;
            node = node.parent;
        }
        return null;
    }

    function label(node, childName) {
        return node?.getChildByName(childName)
            ?.getComponent(cc.Label)?.string || "";
    }

    function findButton(handler, root = scene()) {
        return walk(root, node => {
            if (!node.activeInHierarchy) return null;

            const button = node.getComponent(cc.Button);

            if (
                !button ||
                button.interactable === false
            ) return null;

            const event = (button.clickEvents || [])
                .find(e =>
                    e.handler === handler &&
                    typeof e.emit === "function"
                );

            return event
                ? { node, button, event }
                : null;
        });
    }

    function emitButton(target) {
        if (!target) return false;
        target.event.emit([target.button]);
        return true;
    }

    function parseInfo(raw) {
        if (raw && typeof raw === "object") {
            return raw;
        }

        if (typeof raw === "string") {
            try {
                return JSON.parse(raw);
            } catch (_) {
                return {};
            }
        }

        return {};
    }

    function nameOf(data) {
        const info = parseInfo(data?.playerInfo);

        return String(
            info.username ||
            info.nickname ||
            data?.username ||
            ""
        );
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    // =========================================================
    // UI REFERENCES
    // =========================================================

    function getRanking() {
        const node = findNode("NCrossPVPMainPanel");
        return node
            ? comp(node, "NCrossPVPMainPanel")
            : null;
    }

    function getDetail() {
        const node = findNode(
            "NCrossArenaPvpConfigPanel"
        );

        return node
            ? comp(node, "NCrossArenaPvpConfigPanel")
            : null;
    }

    function getDaily() {
        return walk(scene(), node => {
            if (
                node.name !== "scrollview" ||
                !node.activeInHierarchy
            ) return null;

            const scroll = node.getComponent(
                cc.ScrollView
            );

            if (
                !scroll ||
                !ancestor(node, "openBuildingViewPrefab")
            ) return null;

            const content = node
                .getChildByName("view")
                ?.getChildByName("content");

            return content
                ? { scroll, content }
                : null;
        });
    }

    // =========================================================
    // STATE MONITORING
    // =========================================================

    function checkState() {
        if (state.stopped) {
            throw new Error(
                state.reason || "조사 중단"
            );
        }

        if (
            rankingEstablished &&
            !getRanking()
        ) {
            abort(
                "사용자가 크로스 랭킹 창을 닫거나 이동했습니다."
            );
        }

        if (
            expectedDetail &&
            seenDetail &&
            !intentionalClose &&
            !getDetail()
        ) {
            abort(
                "상세정보 조사 중 창이 닫혔습니다."
            );
        }

        if (
            expectedDetail &&
            seenDetail &&
            !intentionalClose &&
            detailNodeRef &&
            getDetail()?.node !== detailNodeRef
        ) {
            abort(
                "상세창이 다른 인스턴스로 변경되었습니다."
            );
        }
    }

    function startWatchdog() {
        watchdog = setInterval(() => {
            if (!state.running || state.stopped) {
                return;
            }

            try {
                checkState();
            } catch (e) {
                state.stopped = true;
                state.reason = String(e.message || e);
            }
        }, 100);
    }

    async function waitFor(
        fn,
        timeout,
        interval = CFG.POLL_DELAY
    ) {
        const deadline = Date.now() + timeout;

        while (Date.now() < deadline) {
            checkState();

            let result = null;

            try {
                result = fn();
            } catch (_) {
                // UI 갱신 중 일시적인 접근 오류
            }

            if (result) return result;

            await sleep(interval);
        }

        checkState();
        return null;
    }

    // =========================================================
    // ENTRY: BASE / WORLD MAP
    // =========================================================

    async function openRanking() {
        if (getRanking()) return;

        state.phase = "일일임무 진입";

        let daily = getDaily();

        if (!daily) {
            const button = findButton(
                "showDailyQuest"
            );

            if (!button) {
                abort(
                    "기지/월드맵에서 일일임무 버튼을 찾지 못했습니다."
                );
            }

            emitButton(button);

            daily = await waitFor(
                getDaily,
                CFG.UI_TIMEOUT
            );

            if (!daily) {
                abort("일일임무 진입 실패");
            }
        }

        state.phase = "크로스 전투 훈련 탐색";

        function findTrainingCell() {
            for (
                const node of daily.content.children || []
            ) {
                const title = label(
                    node,
                    "TitleLabel"
                );

                if (
                    !/크로스\s*전투\s*훈련/.test(title)
                ) continue;

                const cell = comp(
                    node,
                    "openBuildingViewCell"
                );

                if (
                    typeof cell?.jumpClick === "function"
                ) {
                    return cell;
                }
            }

            return null;
        }

        let target = findTrainingCell();

        for (
            let i = 0;
            !target && i < CFG.SCROLL_STEPS;
            i++
        ) {
            checkState();

            if (!getDaily()) {
                abort(
                    "일일임무 탐색 중 창이 닫혔습니다."
                );
            }

            daily.scroll.scrollToPercentVertical(
                Math.max(
                    0,
                    1 - (i + 1) / CFG.SCROLL_STEPS
                ),
                0.1
            );

            await sleep(CFG.SCROLL_DELAY);

            target = findTrainingCell();
        }

        if (!target) {
            abort(
                "크로스 전투 훈련 항목을 찾지 못했습니다."
            );
        }

        target.jumpClick();

        const panel = await waitFor(
            getRanking,
            CFG.UI_TIMEOUT
        );

        if (!panel) {
            abort("크로스 랭킹 화면 로딩 실패");
        }

        log("크로스 랭킹 진입 완료");
    }

    // =========================================================
    // WAIT FOR 100 RANKING ROWS
    // =========================================================

    async function waitRanks() {
        state.phase = "TOP100 데이터 로딩";

        let signature = "";
        let stable = 0;

        const ranks = await waitFor(() => {
            const panel = getRanking();

            if (!panel) return null;

            const top = panel._rankTopThreeList;
            const rest = panel._rankList;

            if (
                !Array.isArray(top) ||
                top.length !== 3 ||
                !Array.isArray(rest) ||
                rest.length !== 97
            ) {
                stable = 0;
                signature = "";
                return null;
            }

            const rows = [...top, ...rest];

            if (
                rows.some((r, i) =>
                    !r ||
                    !r.uid ||
                    !r.playerInfo ||
                    Number(r.score) !== i + 1
                )
            ) {
                return null;
            }

            if (
                new Set(
                    rows.map(r => String(r.uid))
                ).size !== 100
            ) {
                return null;
            }

            const current = rows
                .map(r => `${r.score}:${r.uid}`)
                .join("|");

            stable = current === signature
                ? stable + 1
                : 1;

            signature = current;

            return stable >= 3
                ? rows
                : null;

        }, CFG.RANK_TIMEOUT, 150);

        if (!ranks) {
            abort(
                "TOP100 랭킹 데이터 로딩 시간 초과"
            );
        }

        rankingEstablished = true;

        log("랭킹 100명 로딩 완료");

        return ranks;
    }

    // =========================================================
    // DETAIL COLLECTION
    // =========================================================

    function getRankCell() {
        const panel = getRanking();

        if (!panel) return null;

        return walk(panel.node, node => {
            const cell = comp(
                node,
                "NPVPMainCell"
            );

            return typeof cell?.btnClick === "function"
                ? cell
                : null;
        });
    }

    function getDetailCloseButton() {
        const detail = getDetail();

        if (!detail) return null;

        const frame = ancestor(
            detail.node,
            "UIFrameDialog2"
        );

        if (!frame) return null;

        const node = frame
            .getChildByName("BG")
            ?.getChildByName("HEADER")
            ?.getChildByName("CLOSE");

        const button = node?.getComponent(
            cc.Button
        );

        const event = button?.clickEvents?.find(e =>
            e.handler === "close" &&
            e.target === frame &&
            typeof e.emit === "function"
        );

        return event
            ? { button, event }
            : null;
    }

    async function closeDetail() {
        if (!getDetail()) {
            expectedDetail = false;
            seenDetail = false;
            detailNodeRef = null;
            return true;
        }

        const close = getDetailCloseButton();

        if (!close) return false;

        intentionalClose = true;

        try {
            close.event.emit([close.button]);

            const closed = await waitFor(
                () => !getDetail(),
                4000,
                80
            );

            return !!closed;
        } finally {
            intentionalClose = false;
            expectedDetail = false;
            seenDetail = false;
            detailNodeRef = null;
        }
    }

    function extractFormations(raw) {
        if (!raw) return [];

        const list = Array.isArray(raw)
            ? raw
            : Array.isArray(raw.formationList)
                ? raw.formationList
                : Array.isArray(raw.formations)
                    ? raw.formations
                    : [raw];

        return list.filter(Boolean).map(item => {
            const armyList =
                item.armyListNew ||
                item.armyList ||
                [];

            const heroList =
                item.heroList ||
                [];

            const armyById = {};
            let totalArmy = 0;

            for (const army of armyList) {
                const id = army.armyId;
                const count = Number(
                    army.armyNum || 0
                );

                if (
                    id == null ||
                    !Number.isFinite(count)
                ) continue;

                armyById[id] =
                    (armyById[id] || 0) + count;

                totalArmy += count;
            }

            return {
                formationId:
                    item.formationId ??
                    item.id ??
                    null,

                // 내부 데이터로만 보관.
                // 출력 및 TP 계산에는 사용하지 않음.
                power: item.power ?? null,

                careerId:
                    item.careerId ?? null,

                mechaId:
                    item.mechaId ?? null,

                formationV2:
                    item.formationV2 ?? null,

                totalArmy,
                armyById,
                armyList: clone(armyList),
                heroes: clone(heroList)
            };
        }).filter(f =>
            Array.isArray(f.armyList) &&
            f.armyList.length > 0 &&
            f.totalArmy > 0
        );
    }

    async function collectOne(data, rank) {
        checkState();

        if (getDetail()) {
            abort(
                "예상하지 못한 상세창이 열려 있습니다."
            );
        }

        const cell = getRankCell();

        if (!cell) {
            abort("랭킹 셀을 찾지 못했습니다.");
        }

        const original = cell._data;

        const uid = String(data.uid);
        const username = nameOf(data);

        state.phase = `${rank}위 상세 조사`;
        state.currentRank = rank;

        expectedDetail = true;
        seenDetail = false;
        detailNodeRef = null;

        activeRequest = {
            rank,
            uid,
            username
        };

        try {
            // playerInfo는 원본 JSON 문자열 유지
            cell._data = {
                ...(original || {}),
                ...data,
                uid: data.uid,
                playerInfo: data.playerInfo
            };

            // 게임 내부의 실제 상세조회 함수
            cell.btnClick();

            const response = await waitFor(() => {
                const detail = getDetail();

                if (!detail) return null;

                seenDetail = true;
                detailNodeRef = detail.node;

                const raw = detail._configData;

                if (!raw) return null;

                const detailInfo = parseInfo(
                    raw.playerInfo
                );

                const detailName = String(
                    detailInfo.username ||
                    raw.username ||
                    raw.nickname ||
                    ""
                );

                if (
                    detailName &&
                    username &&
                    detailName !== username
                ) {
                    abort(
                        `${rank}위 상세 대상 불일치: ` +
                        `${username} / ${detailName}`
                    );
                }

                const formations =
                    extractFormations(raw);

                if (!formations.length) {
                    return null;
                }

                return { formations };

            }, CFG.DETAIL_TIMEOUT, CFG.POLL_DELAY);

            if (!response) {
                abort(
                    `${rank}위 편성 데이터 수신 시간 초과`
                );
            }

            const formations = response.formations;

            const record = {
                rank,
                uid,
                serverId:
                    data.serverId ?? null,
                username,
                level:
                    data.lv ?? null,

                // 랭킹 화면에 표시되는 부대전투력(TP)
                rankingPower:
                    data.power ?? null,

                formations,
                totalArmy: formations.reduce(
                    (sum, f) => sum + f.totalArmy,
                    0
                ),
                collectedAt:
                    new Date().toISOString()
            };

            if (!(await closeDetail())) {
                abort(
                    `${rank}위 상세창 자동 닫기 실패`
                );
            }

            return record;

        } finally {
            if (valid(cell.node)) {
                cell._data = original;
            }

            activeRequest = null;
            expectedDetail = false;
            seenDetail = false;
            detailNodeRef = null;
        }
    }

    // =========================================================
    // MAPPED RESULT
    // =========================================================

    function mapResult(player) {
        return {
            rank: player.rank,
            uid: player.uid,
            username: player.username,
            serverId: player.serverId,

            TP: formatTP(player.rankingPower),
            totalArmy: player.totalArmy,

            formations: player.formations.map(f => ({
                formationId: f.formationId,
                mechaId: f.mechaId,
                mecha: mechaName(f.mechaId),

                heroes: f.heroes.map(h => ({
                    id: h.id,
                    name: heroName(h.id),
                    level: h.level,
                    star: h.star,
                    awakenLevel: h.awakenLevel
                })),

                army: Object.entries(
                    f.armyById || {}
                ).map(([id, count]) => ({
                    armyId: Number(id),
                    name: armyName(id),
                    count: Number(count)
                })),

                slots: f.armyList.map(a => ({
                    position: a.pos,
                    armyId: a.armyId,
                    name: armyName(a.armyId),
                    count: a.armyNum,
                    hp: a.hp
                })),

                totalArmy: f.totalArmy
            }))
        };
    }

    function buildMappedResults() {
        return state.results
            .map(mapResult)
            .sort((a, b) => a.rank - b.rank);
    }

    function buildTable() {
        return buildMappedResults().map(p => ({
            순위: p.rank,
            닉네임: p.username,
            서버: `S${p.serverId}`,
            "부대전투력(TP)": p.TP,

            영웅: p.formations
                .map(f =>
                    f.heroes
                        .map(h => h.name)
                        .join(" / ")
                )
                .join(" | "),

            메카: p.formations
                .map(f => f.mecha)
                .join(" | "),

            병력구성: p.formations
                .map(f =>
                    f.army
                        .map(a =>
                            `${a.name} ×${a.count}`
                        )
                        .join(", ")
                )
                .join(" | "),

            총병력: p.totalArmy
        }));
    }

    // =========================================================
    // PUBLIC RESULT FUNCTIONS
    // =========================================================

    window.CROSS100_LIST = () => {
        const rows = buildTable();

        console.table(rows);

        return rows;
    };

    window.CROSS100_SHOW = rank => {
        const player = buildMappedResults()
            .find(p => p.rank === Number(rank));

        if (!player) {
            console.warn(
                `[CROSS100] ${rank}위 수집 데이터 없음`
            );
            return null;
        }

        console.log(
            `${player.rank}위 ${player.username}`,
            player
        );

        for (const formation of player.formations) {
            console.log(
                "메카:",
                formation.mecha
            );

            console.log(
                "영웅:",
                formation.heroes
                    .map(h => h.name)
                    .join(" / ")
            );

            console.table(formation.slots);
        }

        return player;
    };

    // =========================================================
    // JSON DOWNLOAD
    // =========================================================

    function saveJSON() {
        if (saved) return;

        const mapped = buildMappedResults();

        const payload = {
            collectedAt:
                new Date().toISOString(),

            attempted: state.attempted,
            completed: state.completed,
            failed: state.errors.length,

            stopped: state.stopped,
            stopReason: state.reason || null,

            // 원본: 내부 power 필드 보존
            results: state.results,

            // 분석용: 이름 및 TP 매핑
            mappedResults: mapped,

            errors: state.errors
        };

        const json = JSON.stringify(
            payload,
            null,
            2
        );

        const blob = new Blob(
            [json],
            {
                type:
                    "application/json;charset=utf-8"
            }
        );

        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");

        a.href = url;
        a.download =
            "ncross-pvp-top100-" +
            Date.now() +
            ".json";

        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(
            () => URL.revokeObjectURL(url),
            5000
        );

        saved = true;

        window.CROSS100_MAPPED = mapped;

        log("JSON 저장 완료");
    }

    // =========================================================
    // CLOSE WINDOWS
    // =========================================================

    async function closeRanking() {
        const panel = getRanking();

        if (!panel) return true;

        const frame = ancestor(
            panel.node,
            "UIFrameScreen"
        );

        if (!frame) return false;

        const close = findButton(
            "close",
            frame
        );

        if (!close) return false;

        emitButton(close);

        return !!(await waitFor(
            () => !getRanking(),
            4000
        ));
    }

    async function closeDaily() {
        const daily = getDaily();
    
        // 이미 닫혀 있으면 정상 처리
        if (!daily) return true;
    
        // 일일임무 팝업 찾기
        let popup = ancestor(
            daily.content,
            "openBuildingViewPrefab"
        );
    
        if (!popup) {
            console.warn("[CROSS100] 일일임무 팝업 없음");
            return false;
        }
    
        // PopLayer 직전까지 탐색 범위 확장
        let root = popup;
    
        while (
            root.parent &&
            root.parent.name !== "PopLayer"
        ) {
            root = root.parent;
        }
    
        const candidates = [];
        const stack = [root];
    
        while (stack.length) {
            const node = stack.pop();
    
            if (!node || !cc.isValid(node)) continue;
    
            const button = node.getComponent(cc.Button);
    
            if (button && node.activeInHierarchy) {
                for (const event of button.clickEvents || []) {
                    if (
                        /^(close|closeClick|onClose|onClickClose|btnCloseClick)$/i
                            .test(event.handler || "") &&
                        typeof event.emit === "function"
                    ) {
                        candidates.push({
                            node,
                            button,
                            event
                        });
                    }
                }
            }
    
            stack.push(...(node.children || []));
        }
    
        // 엉뚱한 버튼을 누르지 않도록 확인
        if (candidates.length !== 1) {
            console.warn(
                "[CROSS100] 일일임무 닫기 버튼 식별 실패:",
                candidates.length
            );
    
            return false;
        }
    
        // 실제 게임 닫기 이벤트 실행
        const target = candidates[0];
    
        target.event.emit([target.button]);
    
        // 팝업이 실제로 닫혔는지 확인
        const closed = await waitFor(
            () => !getDaily(),
            5000
        );
    
        if (closed) {
            console.log("[CROSS100] 일일임무 창 닫기 완료");
        }
    
        return !!closed;
    }

    async function closeWindows() {
        state.phase = "창 정리";

        // 정상 종료 단계에서는 랭킹 창 닫기 허용
        rankingEstablished = false;

        if (!(await closeDetail())) {
            throw new Error(
                "상세창 닫기 실패"
            );
        }

        if (!(await closeRanking())) {
            throw new Error(
                "랭킹 창 닫기 실패"
            );
        }

        if (!(await closeDaily())) {
            throw new Error(
                "일일임무 창 닫기 실패"
            );
        }
    }

    // =========================================================
    // MAIN
    // =========================================================

    try {
        if (
            typeof cc === "undefined" ||
            !scene()
        ) {
            throw new Error(
                "게임이 준비되지 않았습니다."
            );
        }

        log("==================================");
        log("크로스 TOP100 자동 조사 시작");
        log("==================================");

        startWatchdog();

        await openRanking();

        const ranks = await waitRanks();

        state.phase = "상세 편성 수집";

        for (let i = 0; i < CFG.LIMIT; i++) {
            checkState();

            const rank = i + 1;
            const data = ranks[i];

            state.attempted++;

            try {
                const result = await collectOne(
                    data,
                    rank
                );

                state.results.push(result);
                state.completed++;

                log(
                    `[${state.completed}/100]`,
                    result.username,
                    formatTP(result.rankingPower),
                    `병력 ${result.totalArmy}`
                );

            } catch (e) {
                state.errors.push({
                    rank,
                    uid: String(data.uid),
                    username: nameOf(data),
                    error: String(
                        e.message || e
                    )
                });

                abort(
                    `${rank}위 조사 실패: ` +
                    String(e.message || e)
                );
            }

            await sleep(CFG.PLAYER_DELAY);
        }

        if (
            state.completed !== CFG.LIMIT ||
            state.errors.length > 0
        ) {
            throw new Error(
                "100명 수집 완료 검증 실패"
            );
        }

        // 100명 조사 결과 저장
        saveJSON();

        // 자동 조사 창 정리
        await closeWindows();

        successful = true;

    } catch (e) {
        state.stopped = true;

        state.reason =
            state.reason ||
            String(e.message || e);

        console.error(
            "[CROSS100] 조사 중단:",
            e
        );

        if (
            state.results.length > 0 &&
            !saved
        ) {
            try {
                saveJSON();
                log("부분 수집 결과 저장");
            } catch (saveError) {
                console.error(
                    "부분 저장 실패:",
                    saveError
                );
            }
        }

    } finally {
        if (watchdog) {
            clearInterval(watchdog);
        }

        state.running = false;
        state.phase = successful
            ? "완료"
            : "중단";

        state.finishedAt =
            new Date().toISOString();

        window.__CROSS100_RUNNING = false;
        window.CROSS100_MAPPED =
            buildMappedResults();

        log("최종 상태:", state);

        if (state.results.length > 0) {
            console.table(buildTable());
        }

        // 알림은 마지막에 한 번
        if (successful) {
            alert(
                "크로스 TOP100 조사 완료!\n\n" +
                "100명 편성 수집 완료\n" +
                "부대전투력(TP) 및 영웅·메카 매핑 완료\n" +
                "JSON 다운로드 완료\n" +
                "조사 창 정리 완료"
            );
        } else {
            alert(
                "크로스 TOP100 조사 중단\n\n" +
                state.reason +
                "\n\n수집: " +
                state.completed +
                "/100명\n" +
                "수집 데이터는 보존됩니다."
            );
        }
    }
})();
