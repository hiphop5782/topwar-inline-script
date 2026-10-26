// ==UserScript==
// @name         TopWar Cross PVP TOP100 Standalone UI
// @namespace    topwar-cross100-standalone
// @version      1.3.0
// @description  접이식 미니 UI + 종료 시 로컬 조사 결과 메모리 정리
// @match        https://h5.topwargame.com/*
// @match        https://h5v2.topwargame.com/*
// @match        https://*.topwargame.com/*
// @match        https://*.topwarapp.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    "use strict";

    const APP_ID = "cross100-standalone-app";
    const PANEL_ID = "cross100-standalone-panel";
    const STYLE_ID = "cross100-standalone-style";
    const DATAHUB_SETTINGS_KEY = "CROSS100_DATAHUB_SETTINGS_V1";
    const DATAHUB_BASE_URL = "https://datahub.progamer.info";
    const DATAHUB_ENDPOINT = "/api/v1/cross-pvp/top100";

    // 같은 코드를 다시 붙여넣어도 패널과 갱신 타이머가 중복되지 않는다.
    window[APP_ID]?.destroy?.();

    // 이전 인스턴스의 비동기 작업이 새 인스턴스 데이터를 지우지 않도록 구분한다.
    const OWNER_KEY = "__CROSS100_UI_OWNER";
    const RUN_OWNER_KEY = "__CROSS100_RUN_OWNER";
    const owner = Symbol("cross100-ui-owner");
    window[OWNER_KEY] = owner;

    let renderTimer = null;
    let runPromise = null;
    let activeState = null;
    let activeUploadController = null;
    let minimized = true;   // 기본: 화면을 가리지 않는 미니 상태 바
    let exitRequested = false;

    function ownsSession() {
        return window[OWNER_KEY] === owner;
    }

    function clearCollectedData() {
        // 수집 결과만 제거. DataHub 접속 설정(localStorage)은 유지한다.
        if (activeState) {
            if (Array.isArray(activeState.results)) activeState.results.length = 0;
            if (Array.isArray(activeState.errors)) activeState.errors.length = 0;
            activeState.githubUpload = null;
            activeState.completed = 0;
            activeState.attempted = 0;
            activeState.currentRank = null;
            activeState.finishedAt = null;
            activeState.startedAt = null;
            activeState.reason = "";
            activeState.phase = "종료";
        }

        // 이미 재주입된 새 인스턴스의 전역 변수는 건드리지 않는다.
        if (!ownsSession()) return;
        for (const key of [
            "CROSS100_STATE", "CROSS100_MAPPED",
            "CROSS100_LIST", "CROSS100_SHOW", "CROSS100_STOP",
            "CROSS100_DOWNLOAD_JSON", "CROSS100_DOWNLOAD_SHEET"
        ]) {
            delete window[key];
        }
    }

    function destroyApp() {
        if (exitRequested) return;
        exitRequested = true;

        if (window.__CROSS100_RUNNING && ownsSession()) {
            // 현재 조사를 멈춘 뒤 종료 후에도 다시 데이터가 생기지 않도록 처리한다.
            window.CROSS100_STOP?.();
            activeUploadController?.abort();
        }

        if (renderTimer !== null) {
            clearInterval(renderTimer);
            renderTimer = null;
        }
        document.getElementById(PANEL_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
        clearCollectedData();

        if (ownsSession()) {
            delete window[APP_ID];
            if (!window.__CROSS100_RUNNING) {
                delete window.__CROSS100_RUNNING;
                delete window[OWNER_KEY];
            }
        }
        // 조사 중 종료했다면 runCross100()의 finally에서 다시 정리한다.
    }

    function requireDataHubSettings() {
        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(DATAHUB_SETTINGS_KEY) || "{}");
        } catch {}

        const scannerId = prompt(
            "Cross TOP100 조사기 ID",
            String(saved.scannerId || "cross-pvp-01")
        );
        if (scannerId == null || !scannerId.trim()) {
            throw new Error("GitHub 업로드용 조사기 ID가 필요합니다.");
        }

        const key = prompt(
            "DataHub API 키",
            String(saved.key || "")
        );
        if (key == null || !key.trim()) {
            throw new Error("GitHub 업로드용 DataHub API 키가 필요합니다.");
        }

        const settings = {
            scannerId: scannerId.trim(),
            key: key.trim()
        };
        localStorage.setItem(DATAHUB_SETTINGS_KEY, JSON.stringify(settings));
        return settings;
    }

    function elapsedText(startedAt, finishedAt) {
        const start = Date.parse(startedAt || "");
        if (!Number.isFinite(start)) return "00:00";
        const end = Date.parse(finishedAt || "") || Date.now();
        const seconds = Math.max(0, Math.floor((end - start) / 1000));
        const minutes = Math.floor(seconds / 60);
        return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }

    function installStyle() {
        document.getElementById(STYLE_ID)?.remove();
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID}{position:fixed;right:10px;top:12px;z-index:2147483600;width:232px;max-width:calc(100vw - 20px);box-sizing:border-box;padding:9px;border:1px solid rgba(148,163,184,.4);border-radius:10px;background:rgba(15,23,42,.94);box-shadow:0 6px 20px rgba(0,0,0,.34);color:#e2e8f0;font-family:Arial,sans-serif;user-select:none;font-size:12px}
            #${PANEL_ID}.c100-min{width:181px;padding:6px 8px;border-radius:9px}
            #${PANEL_ID} .c100-head{display:flex;align-items:center;gap:5px;min-height:24px}
            #${PANEL_ID} .c100-title{flex:1;min-width:0;white-space:nowrap;font-size:12px;font-weight:700;color:#f8fafc}
            #${PANEL_ID} .c100-count-mini{font-size:11px;color:#93c5fd;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
            #${PANEL_ID} .c100-tools{display:flex;align-items:center;gap:3px}
            #${PANEL_ID} .c100-tools button{width:22px;height:22px;padding:0;font-size:14px;background:rgba(71,85,105,.65);border-radius:5px}
            #${PANEL_ID} .c100-tools .c100-close{background:rgba(153,27,27,.8)}
            #${PANEL_ID} .c100-content{margin-top:7px}
            #${PANEL_ID}.c100-min .c100-content{display:none}
            #${PANEL_ID} .c100-phase{font-size:11px;line-height:1.4;color:#cbd5e1;overflow-wrap:anywhere;margin-bottom:7px}
            #${PANEL_ID} .c100-track{height:5px;overflow:hidden;border-radius:999px;background:#334155}
            #${PANEL_ID} .c100-fill{height:100%;width:0;background:linear-gradient(90deg,#2563eb,#38bdf8);transition:width .2s ease}
            #${PANEL_ID} .c100-count{display:flex;justify-content:space-between;margin:5px 0 9px;color:#94a3b8;font-size:11px}
            #${PANEL_ID} .c100-stats{display:flex;justify-content:space-between;gap:4px;margin-bottom:9px;color:#94a3b8;font-size:10px}
            #${PANEL_ID} .c100-stats strong{font-size:11px;color:#f1f5f9}
            #${PANEL_ID} .c100-error{display:none;max-height:60px;overflow:auto;margin-bottom:8px;padding:5px;border-radius:5px;background:rgba(127,29,29,.34);color:#fecaca;font-size:10px;white-space:pre-wrap;overflow-wrap:anywhere}
            #${PANEL_ID} .c100-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
            #${PANEL_ID} .c100-done-actions{display:none;grid-template-columns:1fr 1fr;gap:6px}
            #${PANEL_ID} button{height:29px;border:0;border-radius:6px;color:#fff;font-size:11px;font-weight:700;cursor:pointer}
            #${PANEL_ID} button:disabled{cursor:not-allowed;opacity:.5}
            #${PANEL_ID} .c100-start{background:#2563eb}
            #${PANEL_ID} .c100-stop{background:#b91c1c}
            #${PANEL_ID} .c100-sheet{background:#15803d}
            #${PANEL_ID} .c100-json{background:#2563eb}
        `;
        document.head.appendChild(style);
    }

    function installPanel() {
        if (exitRequested || !ownsSession()) return;
        installStyle();
        document.getElementById(PANEL_ID)?.remove();

        const panel = document.createElement("section");
        panel.id = PANEL_ID;
        panel.classList.toggle("c100-min", minimized);
        panel.innerHTML = `
            <div class="c100-head">
                <span class="c100-title">Cross TOP100</span>
                <span class="c100-count-mini">0/100</span>
                <span class="c100-tools">
                    <button type="button" class="c100-toggle" title="상세 보기" aria-label="상세 보기" aria-expanded="false">▾</button>
                    <button type="button" class="c100-close" title="종료 및 수집 데이터 삭제" aria-label="종료 및 수집 데이터 삭제">×</button>
                </span>
            </div>
            <div class="c100-content">
                <div class="c100-phase">게임이 준비되면 조사를 시작하세요.</div>
                <div class="c100-track"><div class="c100-fill"></div></div>
                <div class="c100-count"><span class="c100-percent">0%</span><span class="c100-completed">0 / 100</span></div>
                <div class="c100-stats">
                    <span>순위 <strong class="c100-rank">-</strong></span>
                    <span>시간 <strong class="c100-time">00:00</strong></span>
                    <span>오류 <strong class="c100-errors">0</strong></span>
                </div>
                <div class="c100-error"></div>
                <div class="c100-actions"><button type="button" class="c100-start">조사 시작</button><button type="button" class="c100-stop" disabled>중지</button></div>
                <div class="c100-done-actions">
                    <button type="button" class="c100-sheet">CSV 저장</button>
                    <button type="button" class="c100-json">JSON 저장</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        panel.querySelector(".c100-toggle").addEventListener("click", () => {
            minimized = !minimized;
            renderPanel();
        });
        panel.querySelector(".c100-close").addEventListener("click", destroyApp);
        panel.querySelector(".c100-start").addEventListener("click", () => {
            if (exitRequested || runPromise || window.__CROSS100_RUNNING) return;
            runPromise = runCross100()
                .catch(error => console.error("[CROSS100 UI] 실행 실패", error))
                .finally(() => {
                    runPromise = null;
                    if (exitRequested) clearCollectedData();
                    else renderPanel();
                });
            renderPanel();
        });
        panel.querySelector(".c100-stop").addEventListener("click", () => {
            window.CROSS100_STOP?.();
            renderPanel();
        });
        panel.querySelector(".c100-sheet").addEventListener("click", () => {
            window.CROSS100_DOWNLOAD_SHEET?.();
        });
        panel.querySelector(".c100-json").addEventListener("click", () => {
            window.CROSS100_DOWNLOAD_JSON?.();
        });

        renderTimer = setInterval(renderPanel, 250);
        renderPanel();
    }

    function renderPanel() {
        if (exitRequested || !ownsSession()) return;
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;

        const state = window.CROSS100_STATE || {};
        const running = window.__CROSS100_RUNNING === true;
        const completed = Number(state.completed || 0);
        const total = 100;
        const percent = Math.min(100, Math.max(0, completed / total * 100));
        const error = state.reason || state.errors?.at?.(-1)?.error || "";

        panel.classList.toggle("c100-min", minimized);
        const toggle = panel.querySelector(".c100-toggle");
        toggle.textContent = minimized ? "▾" : "▴";
        toggle.title = minimized ? "상세 보기" : "최소화";
        toggle.setAttribute("aria-label", toggle.title);
        toggle.setAttribute("aria-expanded", String(!minimized));
        panel.querySelector(".c100-count-mini").textContent = `${completed}/100`;

        panel.querySelector(".c100-phase").textContent =
            !running && state.phase === "완료"
                ? state.githubUpload?.published
                    ? "업로드 완료 · CSV/JSON 저장 가능"
                    : "서버 접수 완료 · GitHub 게시 대기"
                : state.phase || "게임이 준비되면 조사를 시작하세요.";
        panel.querySelector(".c100-fill").style.width = `${percent}%`;
        panel.querySelector(".c100-percent").textContent = `${percent.toFixed(0)}%`;
        panel.querySelector(".c100-completed").textContent = `${completed} / ${total}`;
        panel.querySelector(".c100-rank").textContent = state.currentRank ? `${state.currentRank}위` : "-";
        panel.querySelector(".c100-time").textContent = elapsedText(state.startedAt, state.finishedAt);
        panel.querySelector(".c100-errors").textContent = String(state.errors?.length || 0);

        const errorBox = panel.querySelector(".c100-error");
        errorBox.textContent = error;
        errorBox.style.display = error && state.phase === "중단" ? "block" : "none";

        panel.querySelector(".c100-start").disabled = running;
        panel.querySelector(".c100-start").textContent = ["완료", "중단"].includes(state.phase) ? "다시 조사" : "조사 시작";
        panel.querySelector(".c100-stop").disabled = !running || state.stopped === true;

        const completedSuccessfully = !running && state.phase === "완료" &&
            completed === total && state.githubUpload?.accepted === true;
        panel.querySelector(".c100-actions").style.display = completedSuccessfully ? "none" : "grid";
        panel.querySelector(".c100-done-actions").style.display = completedSuccessfully ? "grid" : "none";
    }

    async function runCross100() {
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

    if (exitRequested || !ownsSession()) return;
    if (window.__CROSS100_RUNNING) {
        console.warn("[CROSS100] 이미 실행 중입니다.");
        return;
    }

    window.__CROSS100_RUNNING = true;
    window[RUN_OWNER_KEY] = owner;

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
        githubUpload: null,
        startedAt: new Date().toISOString()
    };

    activeState = state;
    if (!exitRequested && ownsSession()) window.CROSS100_STATE = state;

    // =========================================================
    // CONTROL
    // =========================================================

    let successful = false;
    let rankingEstablished = false;
    let expectedDetail = false;
    let seenDetail = false;
    let intentionalClose = false;
    let detailNodeRef = null;
    let watchdog = null;
    let activeRequest = null;
    let uploadSettings = null;

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
        if (exitRequested || !ownsSession()) {
            throw new Error("프로그램 종료로 조사를 중단했습니다.");
        }
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
        if (exitRequested) return [];
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
    // RESULT DOWNLOAD
    // =========================================================

    function buildDownloadPayload() {
        const mapped = buildMappedResults();

        return {
            version: 1,
            source: "cross-pvp-top100-standalone",
            collectedAt:
                state.finishedAt || new Date().toISOString(),

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
    }

    async function uploadRequired(settings) {
        checkState();
        state.phase = "GitHub 업로드 중";
        renderPanel();

        const requestId = crypto.randomUUID?.() ||
            `cross100-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const controller = new AbortController();
        activeUploadController = controller;
        try {
        const response = await fetch(
            `${DATAHUB_BASE_URL}${DATAHUB_ENDPOINT}`,
            {
                method: "POST",
                mode: "cors",
                cache: "no-store",
                credentials: "omit",
                signal: controller.signal,
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${settings.key}`,
                    "X-Scanner-Id": settings.scannerId,
                    "X-Request-Id": requestId
                },
                body: JSON.stringify(buildDownloadPayload())
            }
        );

        const text = await response.text();
        checkState();
        let body = null;
        try { body = text ? JSON.parse(text) : null; }
        catch { body = { raw: text }; }

        if (!response.ok || body?.ok === false) {
            throw new Error(
                `DataHub 업로드 실패 (HTTP ${response.status}): ` +
                String(body?.error || body?.message || text || "응답 없음").slice(0, 300)
            );
        }

        // 백엔드가 동기 발행하면 commit SHA를, 비동기 발행이면 202 Accepted와
        // cross-pvp-top100 데이터셋 접수 결과를 반환한다. DirtyRegistry가 디스크에
        // 영속화되므로 정상 접수된 비동기 응답도 GitHub 필수 배포 대기 상태로 인정한다.
        const published = body?.githubPublished === true ||
            body?.publishStatus === "PUBLISHED" ||
            typeof body?.githubCommitSha === "string" && body.githubCommitSha.length > 0;
        const queued = !published && (
            response.status === 202 ||
            body?.publishStatus === "QUEUED" ||
            (
                body?.ok === true &&
                body?.dataset === "cross-pvp-top100" &&
                Number(body?.accepted) >= 100
            )
        );

        if (!published && !queued) {
            throw new Error(
                "DataHub 응답에서 GitHub 커밋 완료 또는 영속 배포 대기열 등록을 확인하지 못했습니다."
            );
        }

        state.githubUpload = {
            accepted: true,
            published,
            queued,
            publishStatus: published ? "PUBLISHED" : "QUEUED",
            commitSha: body.githubCommitSha || null,
            publishedAt: body.publishedAt || new Date().toISOString(),
            requestId
        };
        state.phase = published
            ? "GitHub 업로드 완료"
            : "GitHub 업로드 예약 완료";
        renderPanel();
        return body;
        } finally {
            if (activeUploadController === controller) activeUploadController = null;
        }
    }

    function downloadBlob(content, type, filename) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function downloadJSON() {
        if (exitRequested) return;
        const payload = buildDownloadPayload();

        const json = JSON.stringify(
            payload,
            null,
            2
        );

        downloadBlob(
            json,
            "application/json;charset=utf-8",
            `ncross-pvp-top100-${Date.now()}.json`
        );

        log("JSON 저장 완료");
    }

    function csvCell(value) {
        const text = value == null ? "" : String(value);
        return `"${text.replaceAll('"', '""')}"`;
    }

    function downloadSheet() {
        if (exitRequested) return;
        const rows = buildMappedResults();
        if (!rows.length) {
            throw new Error("다운로드할 조사 결과가 없습니다.");
        }

        const header = [
            "순위", "UID", "닉네임", "서버", "부대전투력(TP)",
            "총병력", "영웅", "메카", "병력구성"
        ];

        const body = rows.map(player => [
            player.rank,
            player.uid,
            player.username,
            player.serverId,
            player.TP,
            player.totalArmy,
            player.formations
                .map(formation => formation.heroes.map(hero => hero.name).join(" / "))
                .join(" | "),
            player.formations
                .map(formation => formation.mecha)
                .join(" | "),
            player.formations
                .map(formation => formation.army
                    .map(army => `${army.name} ×${army.count}`)
                    .join(", "))
                .join(" | ")
        ]);

        // UTF-8 BOM을 붙여 Excel과 Google Sheets에서 한글이 깨지지 않게 한다.
        const csv = "\uFEFF" + [header, ...body]
            .map(row => row.map(csvCell).join(","))
            .join("\r\n");

        downloadBlob(
            csv,
            "text/csv;charset=utf-8",
            `ncross-pvp-top100-${Date.now()}.csv`
        );

        log("구글 스프레드시트용 CSV 저장 완료");
    }

    window.CROSS100_DOWNLOAD_JSON = downloadJSON;
    window.CROSS100_DOWNLOAD_SHEET = downloadSheet;

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

    function showResearchModal({
        success = false,
        title,
        message,
        completed = 0,
        total = 100
    } = {}) {
        // 기존 모달이 있다면 제거
        document.getElementById("cross100-modal-overlay")?.remove();
    
        const overlay = document.createElement("div");
        overlay.id = "cross100-modal-overlay";
    
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(5px);
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: Arial, sans-serif;
        `;
    
        const modal = document.createElement("div");
        modal.style.cssText = `
            width: min(420px, calc(100vw - 32px));
            box-sizing: border-box;
            padding: 28px;
            background: #1d2433;
            color: #f8fafc;
            border: 1px solid #3c465a;
            border-radius: 16px;
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
            text-align: center;
        `;
    
        const icon = document.createElement("div");
        icon.textContent = success ? "✓" : "!";
        icon.style.cssText = `
            width: 58px;
            height: 58px;
            margin: 0 auto 16px;
            border-radius: 50%;
            display: grid;
            place-items: center;
            background: ${success ? "#176c51" : "#784723"};
            color: white;
            font-size: 32px;
            font-weight: bold;
        `;
    
        const heading = document.createElement("h2");
        heading.textContent = title ||
            (success ? "TOP100 조사 완료" : "TOP100 조사 중단");
        heading.style.cssText = `
            margin: 0 0 12px;
            font-size: 22px;
            font-weight: 700;
        `;
    
        const description = document.createElement("p");
        description.textContent = message ||
            (success
                ? "크로스 전투 훈련 조사가 완료되었습니다."
                : "조사가 중단되었습니다.");
        description.style.cssText = `
            margin: 0 0 20px;
            color: #b8c2d3;
            font-size: 14px;
            line-height: 1.7;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        `;
    
        const progressLabel = document.createElement("div");
        progressLabel.style.cssText = `
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 13px;
            color: #cbd5e1;
        `;
    
        const labelText = document.createElement("span");
        labelText.textContent = "조사 완료";
    
        const countText = document.createElement("span");
        countText.textContent = `${completed} / ${total}`;
    
        progressLabel.append(labelText, countText);
    
        const progressTrack = document.createElement("div");
        progressTrack.style.cssText = `
            height: 9px;
            background: #374151;
            border-radius: 999px;
            overflow: hidden;
            margin-bottom: 24px;
        `;
    
        const progressFill = document.createElement("div");
        const percent = total > 0
            ? Math.min(100, Math.max(0, completed / total * 100))
            : 0;
    
        progressFill.style.cssText = `
            width: ${percent}%;
            height: 100%;
            background: ${success ? "#34d399" : "#f59e0b"};
            border-radius: 999px;
        `;
    
        progressTrack.appendChild(progressFill);
    
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "확인";
        button.style.cssText = `
            width: 100%;
            padding: 13px 16px;
            border: none;
            border-radius: 10px;
            background: #2563eb;
            color: white;
            font-size: 15px;
            font-weight: bold;
            cursor: pointer;
        `;
    
        function close() {
            document.removeEventListener("keydown", onKeyDown);
            overlay.remove();
        }
    
        function onKeyDown(event) {
            if (event.key === "Escape") close();
        }
    
        button.addEventListener("click", close);
        document.addEventListener("keydown", onKeyDown);
    
        modal.append(
            icon,
            heading,
            description,
            progressLabel,
            progressTrack,
            button
        );
    
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    
        button.focus();
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
        uploadSettings = requireDataHubSettings();

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

                checkState();
                state.results.push(result);
                state.completed++;

                log(
                    `[${state.completed}/100]`,
                    `TP ${formatTP(result.rankingPower)}`
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

        // 종료/중단 요청이 있으면 서버로 보내지 않는다.
        checkState();
        await uploadRequired(uploadSettings);

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

        uploadSettings = null;
        // 새 스크립트가 주입된 경우에도 이전 실행의 running 플래그만 정리한다.
        if (window[RUN_OWNER_KEY] === owner) {
            window.__CROSS100_RUNNING = false;
            delete window[RUN_OWNER_KEY];
        }
        if (exitRequested || !ownsSession()) {
            // 종료 도중 비동기 처리가 마무리돼도 데이터가 다시 남지 않도록 재정리.
            clearCollectedData();
            activeState = null;
            if (ownsSession()) {
                delete window.__CROSS100_RUNNING;
                delete window[OWNER_KEY];
            }
        } else {
            window.CROSS100_MAPPED = buildMappedResults();
            log("조사 종료:", {completed: state.completed, failed: state.errors.length, phase: state.phase});
            renderPanel();
        }
    }
    }

    window[APP_ID] = Object.freeze({
        start() {
            if (minimized) { minimized = false; renderPanel(); }
            document.querySelector(`#${PANEL_ID} .c100-start`)?.click();
        },
        stop() {
            window.CROSS100_STOP?.();
        },
        state() {
            return exitRequested ? null : window.CROSS100_STATE || null;
        },
        minimize() {
            minimized = true;
            renderPanel();
        },
        expand() {
            minimized = false;
            renderPanel();
        },
        destroy: destroyApp
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", installPanel, { once: true });
    } else {
        installPanel();
    }
})();
