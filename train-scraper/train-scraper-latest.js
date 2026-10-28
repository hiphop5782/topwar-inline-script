
(() => {
  "use strict";

  // =========================================================
  // CQ26 설원 열차 자동 조사기 v6
  // =========================================================

  const KEY = "CQ26_AUTO";
  const VERSION = "v6.0";

  const DB_NAME = "CQ26_Train_Collector";
  const STORE = "servers";
  const POS_KEY = "CQ26_AUTO_PANEL_POSITION";

  const POLL = 100;
  const STABLE = 500;
  const DETAIL_DELAY = 1500;
  const TIMEOUT = 120000;

  const N = {
    ICON: "IconConqueror2026",
    WARM: "CQ26WarmUpMain",
    TRANSPORT: "CQ26TransportMainPanel",
    LIST: "CQ26TrainListPop",
    DEFENSE: "CQ26TrainListItemAttackPop",
    DETAIL: "CQ26TrainListItemDetailPop"
  };

  // 기존 조사기 종료
  try {
    window[KEY]?.destroy?.();
  } catch (e) {
    console.warn("[CQ26] 이전 버전 종료:", e);
  }

  for (const id of [
    "CQ26_AUTO_V2_PANEL",
    "CQ26_AUTO_V3_PANEL",
    "CQ26_AUTO_V3_MINI",
    "CQ26_AUTO_V4_PANEL",
    "CQ26_AUTO_V4_MINI",
    "CQ26_AUTO_V5_PANEL",
    "CQ26_AUTO_V5_MINI",
    "CQ26_AUTO_V6_PANEL",
    "CQ26_AUTO_V6_MINI",
    "cq26-auto-panel"
  ]) {
    document.getElementById(id)?.remove();
  }

  const S = {
    running: false,
    paused: false,
    token: 0,
    db: null,
    known: new Set(),
    added: 0,
    skipped: 0,
    refreshed: 0,
    sid: "",
    phase: "준비",
    error: "",
    logs: [],
    collapsed: false,
    pos: { x: 20, y: 70 }
  };

  // =========================================================
  // 기본 도구
  // =========================================================

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function cname(c) {
    if (!c) return "";

    try {
      return (
        c.__classname__ ||
        cc.js?.getClassName?.(c) ||
        c.constructor?.name ||
        ""
      );
    } catch {
      return "";
    }
  }

  function comp(node, name) {
    if (!node) return null;

    return (node._components || []).find(
      c => cname(c) === name ||
           c.constructor?.name === name
    ) || null;
  }

  function active(node) {
    try {
      return !!node &&
        cc.isValid(node) &&
        node.activeInHierarchy;
    } catch {
      return false;
    }
  }

  function child(node, path) {
    if (!node) return null;

    return path.split("/").reduce(
      (cur, part) =>
        cur?.getChildByName?.(part) || null,
      node
    );
  }

  // 활성 노드만 제한적으로 탐색
  function find(name) {
    const scene = cc.director?.getScene?.();

    if (!scene) return null;

    const stack = [scene];
    let count = 0;

    while (stack.length && count++ < 14000) {
      const node = stack.pop();

      if (!active(node)) continue;

      if (node.name === name) {
        return node;
      }

      for (const c of node.children || []) {
        stack.push(c);
      }
    }

    return null;
  }

  function log(message) {
    const line =
      `[${new Date().toLocaleTimeString()}] ${message}`;

    S.logs.push(line);

    if (S.logs.length > 80) {
      S.logs.shift();
    }

    console.log("[CQ26]", message);
    render();
  }

  function phase(message) {
    S.phase = message;
    render();
  }

  function ensure(token) {
    if (!S.running || token !== S.token) {
      throw Error("CQ26_STOP");
    }
  }

  async function gate(token) {
    ensure(token);

    while (S.paused) {
      ensure(token);
      await sleep(POLL);
    }

    ensure(token);
  }

  async function delay(ms, label, token) {
    phase(label);

    let elapsed = 0;

    while (elapsed < ms) {
      await gate(token);

      const step = Math.min(
        POLL,
        ms - elapsed
      );

      await sleep(step);

      if (!S.paused) {
        elapsed += step;
      }
    }

    await gate(token);
  }

  // 조건이 연속 STABLE ms 유지될 때 통과.
  // 데이터 응답을 단순 시간으로 가정하지 않음.
  async function waitStable(
    probe,
    label,
    token,
    signature = x => x,
    timeout = TIMEOUT
  ) {
    phase(label);

    let first = 0;
    let previous = null;
    let elapsed = 0;

    while (true) {
      await gate(token);

      let value = null;

      try {
        value = probe();
      } catch {}

      if (value) {
        const key = signature(value);

        if (!first || key !== previous) {
          first = Date.now();
          previous = key;
        }

        if (Date.now() - first >= STABLE) {
          await gate(token);

          let latest = null;

          try {
            latest = probe();
          } catch {}

          if (
            latest &&
            signature(latest) === previous
          ) {
            return latest;
          }

          first = 0;
          previous = null;
        }
      } else {
        first = 0;
        previous = null;
      }

      if (elapsed >= timeout) {
        throw Error(
          "대기 초과: " + label
        );
      }

      await sleep(POLL);

      if (!S.paused) {
        elapsed += POLL;
      }
    }
  }

  function id(value) {
    if (value == null) return null;

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }

    const low = value.low ?? value._low;
    const high = value.high ?? value._high;

    if (
      typeof low === "number" &&
      typeof high === "number"
    ) {
      let n =
        (BigInt(high >>> 0) << 32n) |
        BigInt(low >>> 0);

      if (
        !(value.unsigned ?? value._unsigned) &&
        high < 0
      ) {
        n -= 1n << 64n;
      }

      return String(n);
    }

    return String(value);
  }

  function stamp() {
    return new Date()
      .toISOString()
      .replace(/[.:]/g, "-");
  }

  // =========================================================
  // Cocos 버튼 클릭
  // =========================================================

  function buttonInfo(node, method, ownerName) {
    if (!active(node)) return null;

    const b = comp(node, "cc.Button");

    if (
      !b ||
      b.enabled === false ||
      b.interactable === false
    ) {
      return null;
    }

    const events = (b.clickEvents || []).filter(e =>
      (e._handler || e.handler) === method &&
      e.target
    );

    if (events.length !== 1) {
      return null;
    }

    const e = events[0];
    const target = e.target;

    if (!target || !cc.isValid(target)) {
      return null;
    }

    const declared =
      e._componentName || e.component;

    let owner = (target._components || []).find(
      c =>
        cname(c) === declared &&
        typeof c[method] === "function"
    );

    // IconBase 같은 부모 클래스 등록 대응
    if (!owner) {
      const candidates =
        (target._components || []).filter(
          c => typeof c[method] === "function"
        );

      if (candidates.length === 1) {
        owner = candidates[0];
      }
    }

    if (!owner) return null;

    if (
      ownerName &&
      cname(owner) !== ownerName
    ) {
      return null;
    }

    return {
      node,
      owner,
      method,
      customData: e.customEventData
    };
  }

  function click(node, method, ownerName) {
    const info = buttonInfo(
      node,
      method,
      ownerName
    );

    if (!info) {
      throw Error(
        "버튼 실행 불가: " +
        (node?.name || "없음") +
        "." + method
      );
    }

    info.owner[method](
      null,
      info.customData
    );
  }

  async function waitButton(
    getter,
    method,
    label,
    token,
    ownerName = null
  ) {
    return waitStable(
      () => {
        const n = getter();

        return buttonInfo(
          n,
          method,
          ownerName
        ) ? n : null;
      },
      label,
      token
    );
  }

  // =========================================================
  // IndexedDB
  // =========================================================

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);

      req.onupgradeneeded = () => {
        if (
          !req.result.objectStoreNames.contains(STORE)
        ) {
          req.result.createObjectStore(
            STORE,
            { keyPath: "serverKey" }
          );
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () =>
        reject(Error("IndexedDB 연결 차단"));
    });
  }

  function loadKeys() {
    return new Promise((resolve, reject) => {
      const req = S.db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .getAllKeys();

      req.onsuccess = () =>
        resolve(req.result.map(String));

      req.onerror = () =>
        reject(req.error);
    });
  }

  function dbAdd(record) {
    return new Promise((resolve, reject) => {
      const tx = S.db.transaction(
        STORE,
        "readwrite"
      );

      const req = tx.objectStore(STORE).add(record);
      let duplicate = false;

      req.onerror = e => {
        if (req.error?.name === "ConstraintError") {
          duplicate = true;
          e.preventDefault();
          e.stopPropagation();
        }
      };

      tx.oncomplete = () => resolve(!duplicate);
      tx.onabort = () =>
        reject(tx.error || Error("DB 저장 실패"));
    });
  }

  function dbAll() {
    return new Promise((resolve, reject) => {
      const req = S.db
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .getAll();

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function download(data, filename) {
    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      {
        type: "application/json;charset=utf-8"
      }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      15000
    );
  }

  // =========================================================
  // 열차 목록
  // =========================================================

  function rows() {
    const list = find(N.LIST);
    if (!list) return [];

    const content = child(
      list,
      "New ScrollView/view/content"
    );

    if (!content) return [];

    const output = [];

    for (const node of content.children || []) {
      if (!active(node)) continue;

      const c = comp(node, "CQ26TrainListItem");
      const d = c?._data;

      if (d?.sid == null) continue;

      output.push({
        node,
        sid: String(d.sid),
        uuid: id(d.uuid)
      });
    }

    return output;
  }

  function listSignature(list) {
    return list
      .map(r => `${r.sid}:${r.uuid}`)
      .sort()
      .join("|");
  }

  function listReady() {
    const r = rows();

    return r.length
      ? listSignature(r)
      : null;
  }

  function currentRow(sid, uuid) {
    return rows().find(
      r =>
        r.sid === sid &&
        (!uuid || r.uuid === uuid)
    ) || null;
  }

  function attackButtonForRow(row) {
    if (!row) return null;

    // 목록 버튼은 CQ26TrainListItem.onClickAttack만 허용.
    // 다른 팝업의 실제 약탈 핸들러는 절대 호출하지 않음.
    const queue = [
      { node: row.node, depth: 0 }
    ];

    let scanned = 0;

    while (
      queue.length &&
      scanned++ < 100
    ) {
      const { node, depth } = queue.shift();

      if (!active(node)) continue;

      if (
        buttonInfo(
          node,
          "onClickAttack",
          "CQ26TrainListItem"
        )
      ) {
        return node;
      }

      if (depth < 5) {
        for (const c of node.children || []) {
          queue.push({
            node: c,
            depth: depth + 1
          });
        }
      }
    }

    return null;
  }

  // =========================================================
  // 상세창 닫기
  // =========================================================

  function closeDetail() {
    const popup = find(N.DETAIL);

    if (!popup) return false;

    let frame = popup;

    while (
      frame &&
      frame.name !== "UIFrameDialog2"
    ) {
      frame = frame.parent;
    }

    if (!frame) {
      throw Error(
        "상세정보 UIFrameDialog2 없음"
      );
    }

    // 버튼의 위치와 관계없이
    // DialogFrameComponent.close() 직접 실행
    const stack = [frame];
    let scanned = 0;

    while (
      stack.length &&
      scanned++ < 200
    ) {
      const n = stack.pop();

      if (!n || !cc.isValid(n)) continue;

      const dialog = (n._components || []).find(
        c =>
          cname(c) === "DialogFrameComponent" &&
          typeof c.close === "function"
      );

      if (dialog) {
        dialog.close();
        log("상세정보 창 close() 실행");
        return true;
      }

      for (const c of n.children || []) {
        stack.push(c);
      }
    }

    throw Error(
      "DialogFrameComponent.close() 미확인"
    );
  }

  // =========================================================
  // 상세 데이터 및 저장
  // =========================================================

  function detailData(sid, uuid) {
    const c = comp(
      find(N.DETAIL),
      N.DETAIL
    );

    const d = c?._data;

    if (!d) return null;

    if (String(d.sid) !== sid) {
      return null;
    }

    if (
      uuid &&
      id(d.uuid) !== uuid
    ) {
      return null;
    }

    if (
      !Array.isArray(d.selfArmyInfo) ||
      !d.selfArmyInfo.length
    ) {
      return null;
    }

    const expected = Number(d.uidNumber);

    if (
      Number.isFinite(expected) &&
      expected > 0 &&
      d.selfArmyInfo.length !== expected
    ) {
      return null;
    }

    return d;
  }

  function cleanPlayer(p) {
    const u = p?.userInfo || {};
    let info = null;

    try {
      info = JSON.parse(
        u.playerInfo || "{}"
      );
    } catch {}

    return {
      uid: id(u.uid),
      rank: p.rank ?? null,

      username:
        info?.username ??
        info?.name ??
        null,

      serverId:
        u.serverId ??
        info?.serverId ??
        null,

      power: id(u.power),
      powerNow: id(p.powerNow),
      powerAll: id(p.powerAll),

      frameId: u.frameId ?? null,

      instanceIdStr: id(
        p.instanceIdStr ??
        u.instanceIdStr
      ),

      armyType: p.armyType ?? null,
      marchNum: p.marchNum ?? null,
      firstHeroId:
        p.firstHeroInfo?.id ?? null,

      playerInfo:
        u.playerInfo ?? null
    };
  }

  async function saveServer(d) {
    const sid = String(d.sid);

    if (S.known.has(sid)) {
      S.skipped++;
      return false;
    }

    const record = {
      serverKey: sid,
      capturedAt: new Date().toISOString(),

      train: {
        sid: d.sid,
        uuid: id(d.uuid),
        specId: d.specId ?? null,
        percent: d.percent ?? null,
        uidNumber: d.uidNumber ?? null,
        lootNum: d.lootNum ?? null,
        myLootNum: d.myLootNum ?? null,
        endTime: id(d.endTime),
        serverFlag: d.serverFlag ?? null
      },

      collected: d.selfArmyInfo.length,
      players: d.selfArmyInfo.map(cleanPlayer)
    };

    const added = await dbAdd(record);

    S.known.add(sid);

    if (!added) {
      S.skipped++;
      return false;
    }

    S.added++;

    download(
      record,
      `CQ26-S${sid}-${stamp()}.json`
    );

    log(
      `S${sid} 저장 완료 · ${record.collected}명`
    );

    return true;
  }

  // =========================================================
  // 화면 전환
  // =========================================================

  async function clickEventIcon(token) {
    const icon = await waitButton(
      () => find(N.ICON),
      "onClick",
      "파란 이벤트 아이콘 준비",
      token
    );

    await gate(token);

    click(icon, "onClick");

    log("IconConqueror2026 클릭");
  }

  async function enterList(token) {
    await gate(token);

    const warm = find(N.WARM);
    const transport = find(N.TRANSPORT);

    // v6 핵심:
    // 기존 방어 팝업 노드가 남아 있더라도
    // 현재 이벤트 화면이 준비돼 있다면
    // 방어 팝업을 닫으려고 하지 않는다.

    // 이미 목록이 있고 다른 상위 이벤트 화면으로
    // 복귀한 상태가 아니라면 목록 재사용.
    if (
      find(N.LIST) &&
      !warm &&
      !find(N.DETAIL)
    ) {
      await waitStable(
        listReady,
        "기존 열차 목록 안정화",
        token
      );
      return;
    }

    // 이벤트/열차 화면이 아직 없고
    // 상세창이 열려 있으면 상세창만 닫음.
    if (
      find(N.DETAIL) &&
      !warm &&
      !transport
    ) {
      closeDetail();

      await waitStable(
        () => !find(N.DETAIL),
        "기존 상세창 종료 대기",
        token
      );
    }

    // 현재 이벤트 화면도 열차 화면도 없으면
    // 최초 아이콘으로 진입.
    if (
      !find(N.WARM) &&
      !find(N.TRANSPORT)
    ) {
      await clickEventIcon(token);

      await waitStable(
        () => find(N.WARM),
        "설원 이벤트 화면 안정화",
        token
      );
    }

    // 열차 화면이 아직 없다면 건물 b4 클릭
    if (!find(N.TRANSPORT)) {
      const tower = await waitButton(
        () => child(
          find(N.WARM),
          "mask/widget/bg/buildingLayer/b4/CQ26WarmUpMainTower"
        ),
        "onClickItem",
        "설원 열차 건물 준비",
        token
      );

      await gate(token);

      click(
        tower,
        "onClickItem",
        "CQ26WarmUpMainTower"
      );

      log("설원 열차 건물 클릭");

      await waitStable(
        () => find(N.TRANSPORT),
        "설원 열차 화면 안정화",
        token
      );
    }

    // 목록이 이전부터 존재하는 경우라도
    // 열차 화면에서 메뉴 버튼을 실제 클릭.
    const attackMenu = await waitButton(
      () => child(
        find(N.TRANSPORT),
        "content/CQ26TransportMainContent/bottomnode/New Layout/attackNode"
      ),
      "onClickAttack",
      "열차 약탈 목록 버튼 준비",
      token,
      "CQ26TransportMainContent"
    );

    await gate(token);

    click(
      attackMenu,
      "onClickAttack",
      "CQ26TransportMainContent"
    );

    log("열차 약탈 목록 열기");

    // 더 이상 !find(N.DEFENSE)를 요구하지 않음.
    // 목록 자체가 준비되는지만 확인.
    await waitStable(
      listReady,
      "열차 목록 데이터 안정화",
      token
    );

    log("열차 목록 준비 완료");
  }

  // =========================================================
  // 서버 하나 조사
  // =========================================================

  async function inspectServer(row, token) {
    const sid = row.sid;
    const uuid = row.uuid;

    S.sid = sid;
    render();

    log(`S${sid} 조사 시작`);

    // 클릭 시점의 실제 목록 행을 재탐색
    const listBtn = await waitStable(
      () => attackButtonForRow(
        currentRow(sid, uuid)
      ),
      `S${sid} 목록 약탈하기 버튼 준비`,
      token
    );

    await gate(token);

    const fresh = attackButtonForRow(
      currentRow(sid, uuid)
    );

    if (
      !fresh ||
      fresh !== listBtn
    ) {
      throw Error(
        `S${sid} 목록 버튼 변경`
      );
    }

    // 방어 정보 팝업을 여는 안전한 핸들러
    click(
      fresh,
      "onClickAttack",
      "CQ26TrainListItem"
    );

    log(`S${sid} 목록 약탈하기 클릭`);

    const defense = await waitStable(
      () => find(N.DEFENSE),
      `S${sid} 방어 팝업 로딩`,
      token
    );

    await waitButton(
      () => child(
        find(N.DEFENSE),
        "btns/btnDetail"
      ),
      "onClickDetail",
      `S${sid} 세부 사항 버튼 준비`,
      token,
      "CQ26TrainListItemAttackPop"
    );

    // 약탈하기 → 세부 사항 사이만 추가 1.5초
    await delay(
      DETAIL_DELAY,
      `S${sid} 방어 정보 추가 안정화`,
      token
    );

    
const detailBtn = await waitButton(
  () => {
    const popup = find(N.DEFENSE);
    if (!popup) return null;

    return child(
      popup,
      "btns/btnDetail"
    );
  },
  "onClickDetail",
  `S${sid} 세부 사항 최종 확인`,
  token,
  "CQ26TrainListItemAttackPop"
);

await gate(token);

// 클릭 직전에 활성 팝업의 버튼을 다시 확인
const latestDetailBtn = child(
  find(N.DEFENSE),
  "btns/btnDetail"
);

if (
  !buttonInfo(
    latestDetailBtn,
    "onClickDetail",
    "CQ26TrainListItemAttackPop"
  )
) {
  throw Error(`S${sid} 세부 사항 버튼 변경`);
}

click(
  latestDetailBtn,
  "onClickDetail",
  "CQ26TrainListItemAttackPop"
);

log(`S${sid} 세부 사항 클릭`);


    await gate(token);

    // 실제 약탈 버튼은 절대 실행하지 않음
    click(
      detailBtn,
      "onClickDetail",
      "CQ26TrainListItemAttackPop"
    );

    log(`S${sid} 세부 사항 클릭`);

    // 서버 데이터가 완성될 때까지 대기
    const d = await waitStable(
      () => detailData(sid, uuid),
      `S${sid} 탑승자 전체 데이터 로딩`,
      token,
      x =>
        `${x.sid}:${id(x.uuid)}:` +
        `${x.selfArmyInfo.length}`
    );

    await gate(token);

    await saveServer(d);

    // 상세정보 창 close() 직접 호출
    closeDetail();

    await waitStable(
      () => !find(N.DETAIL),
      `S${sid} 상세정보 창 닫힘 확인`,
      token
    );

    // 여기서 방어 팝업은 닫지 않는다.
    // 최초 이벤트 버튼을 호출하면
    // 설원 이벤트 화면으로 복귀한다.
    log(
      `S${sid} 최초 이벤트 버튼으로 복귀`
    );

    await clickEventIcon(token);

    // v5에서 실패했던 조건 제거:
    //
    // 잘못된 방식:
    // await waitStable(() => !find(N.DEFENSE))
    //
    // 새로운 방식:
    // 이벤트 화면이 실제 준비되면 진행.
    await waitStable(
      () => find(N.WARM),
      `S${sid} 설원 이벤트 화면 복귀`,
      token
    );

    log(
      `S${sid} 이벤트 화면 복귀 성공`
    );

    // 이벤트 → 열차 → 약탈 목록 재진입
    await enterList(token);

    S.sid = "";
    log(`S${sid} 조사 완료`);
  }

  // =========================================================
  // 새로고침
  // =========================================================

  async function refreshList(token) {
    const before = listReady();

    if (!before) {
      throw Error(
        "새로고침 전 목록 없음"
      );
    }

    const refreshBtn = await waitButton(
      () => child(
        find(N.LIST),
        "btnRefresh"
      ),
      "onClickRefresh",
      "열차 새로고침 버튼 준비",
      token,
      "CQ26TrainListPop"
    );

    await gate(token);

    click(
      refreshBtn,
      "onClickRefresh",
      "CQ26TrainListPop"
    );

    S.refreshed++;

    log(
      `열차 목록 새로고침 #${S.refreshed}`
    );

    // 기존 목록이 남아 있는 상태를
    // 신규 응답 완료로 오인하지 않음.
    await waitStable(
      () => {
        const now = listReady();

        return now && now !== before
          ? now
          : null;
      },
      "새로고침 결과 대기",
      token
    );

    log(
      "새로고침 목록 변경 확인"
    );
  }

  // =========================================================
  // 자동 반복
  // =========================================================

  async function run(token) {
    try {
      S.db = S.db || await openDB();

      S.known = new Set(
        await loadKeys()
      );

      log(
        `DB 기존 ${S.known.size}개 서버`
      );

      await enterList(token);

      while (true) {
        await gate(token);

        const stable = await waitStable(
          listReady,
          "현재 열차 목록 확인",
          token
        );

        const list = rows();

        if (
          listSignature(list) !== stable
        ) {
          continue;
        }

        const next = list.find(
          x => !S.known.has(x.sid)
        );

        if (next) {
          await inspectServer(
            next,
            token
          );
        } else {
          await refreshList(token);
        }
      }

    } catch (e) {
      if (
        e?.message !== "CQ26_STOP" &&
        token === S.token
      ) {
        S.error = e.message || String(e);
        S.running = false;
        S.paused = false;

        log(
          "자동 조사 정지: " + S.error
        );

        console.error(
          "[CQ26 AUTO]",
          e
        );

        phase("오류 정지");
      }
    }

    render();
  }

  function start() {
    if (S.running) {
      if (S.paused) {
        S.paused = false;
        log("자동 조사 재개");
      }
      return;
    }

    S.token++;
    S.running = true;
    S.paused = false;

    S.error = "";
    S.added = 0;
    S.skipped = 0;
    S.refreshed = 0;

    log("자동 조사 시작");

    run(S.token);
  }

  function pause() {
    if (!S.running) return;

    S.paused = !S.paused;

    log(
      S.paused
        ? "자동 조사 일시정지"
        : "자동 조사 재개"
    );
  }

  function stop() {
    S.token++;
    S.running = false;
    S.paused = false;

    phase("사용자 중지");
  }

  async function exportAll() {
    try {
      S.db = S.db || await openDB();

      const records = await dbAll();

      if (!records.length) {
        throw Error("저장된 서버 없음");
      }

      download({
        schemaVersion: 6,
        exportedAt: new Date().toISOString(),
        serverCount: records.length,
        totalPlayers: records.reduce(
          (sum, r) =>
            sum + (r.players?.length || 0),
          0
        ),
        servers: records
      },
      `CQ26-ALL-${records.length}-${stamp()}.json`);

      log(
        `전체 JSON 내보내기: ${records.length}개 서버`
      );

    } catch (e) {
      log(
        "내보내기 실패: " + e.message
      );
    }
  }

  async function reloadCount() {
    try {
      S.db = S.db || await openDB();

      S.known = new Set(
        await loadKeys()
      );

      log(
        `DB 서버 ${S.known.size}개`
      );
    } catch (e) {
      log(
        "DB 조회 오류: " + e.message
      );
    }
  }

  // =========================================================
  // UI 패널
  // =========================================================

  const panel = document.createElement("div");
  panel.id = "CQ26_AUTO_V6_PANEL";

  panel.style.cssText = `
    position:fixed;
    left:20px;
    top:70px;
    width:350px;
    max-width:calc(100vw - 10px);
    z-index:2147483647;
    background:#142033;
    color:white;
    border:1px solid #64748b;
    border-radius:12px;
    padding:12px;
    box-sizing:border-box;
    box-shadow:0 8px 30px #0009;
    font:12px/1.5 system-ui,Arial;
  `;

  panel.innerHTML = `
    <div id="cq26-handle" style="
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding-bottom:10px;
      cursor:grab;
      user-select:none;
      touch-action:none;
    ">
      <strong style="font-size:14px">
        ⠿ CQ26 자동 조사기 v6
      </strong>
      <button id="cq26-hide" style="
        background:#334155;
        color:white;
        border:0;
        border-radius:6px;
        padding:6px 10px;
        cursor:pointer;
      ">접기</button>
    </div>

    <div id="cq26-status" style="
      background:#1e293b;
      border-radius:8px;
      padding:10px;
      margin-bottom:10px;
      white-space:pre-line;
      line-height:1.75;
    "></div>

    <div id="cq26-actions" style="
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:7px;
      margin-bottom:10px;
    "></div>

    <div style="
      font-weight:bold;
      margin-bottom:5px;
    ">실행 로그</div>

    <pre id="cq26-log" style="
      background:#0f172a;
      color:#cbd5e1;
      height:145px;
      overflow:auto;
      overflow-wrap:anywhere;
      white-space:pre-wrap;
      margin:0;
      padding:9px;
      border-radius:8px;
      font:11px/1.5 monospace;
    "></pre>

    <div style="
      margin-top:8px;
      color:#94a3b8;
      font-size:11px;
    ">
      드래그 이동 · 접기 지원 ·
      세부 사항 전 1.5초 추가 대기
    </div>
  `;

  const mini = document.createElement("button");
  mini.id = "CQ26_AUTO_V6_MINI";

  mini.textContent = "CQ26 열기";

  mini.style.cssText = `
    position:fixed;
    left:20px;
    top:70px;
    z-index:2147483647;
    display:none;
    background:#2563eb;
    color:white;
    border:1px solid #93c5fd;
    border-radius:24px;
    padding:10px 15px;
    box-shadow:0 5px 20px #0008;
    cursor:grab;
    touch-action:none;
    user-select:none;
    font:bold 12px system-ui,Arial;
  `;

  document.body.append(panel, mini);

  // =========================================================
  // 드래그 위치
  // =========================================================

  function loadPosition() {
    try {
      const raw = localStorage.getItem(POS_KEY);

      if (!raw) return;

      const p = JSON.parse(raw);

      if (
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)
      ) {
        S.pos.x = p.x;
        S.pos.y = p.y;
      }
    } catch {}
  }

  function savePosition() {
    try {
      localStorage.setItem(
        POS_KEY,
        JSON.stringify(S.pos)
      );
    } catch {}
  }

  function applyPosition() {
    const width = S.collapsed
      ? mini.offsetWidth || 140
      : panel.offsetWidth || 350;

    S.pos.x = Math.max(
      0,
      Math.min(
        S.pos.x,
        Math.max(0, window.innerWidth - width)
      )
    );

    S.pos.y = Math.max(
      0,
      Math.min(
        S.pos.y,
        Math.max(0, window.innerHeight - 40)
      )
    );

    for (const el of [panel, mini]) {
      el.style.left = S.pos.x + "px";
      el.style.top = S.pos.y + "px";
    }
  }

  function collapse() {
    S.collapsed = true;

    panel.style.display = "none";
    mini.style.display = "block";

    applyPosition();
    render();
  }

  function expand() {
    S.collapsed = false;

    panel.style.display = "block";
    mini.style.display = "none";

    applyPosition();
    render();
  }

  function drag(handle, isMini = false) {
    let current = null;

    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;

      if (
        !isMini &&
        e.target.closest("button")
      ) {
        return;
      }

      current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: S.pos.x,
        y: S.pos.y,
        moved: false
      };

      handle.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    handle.addEventListener("pointermove", e => {
      if (
        !current ||
        current.pointerId !== e.pointerId
      ) {
        return;
      }

      const dx = e.clientX - current.startX;
      const dy = e.clientY - current.startY;

      if (
        Math.abs(dx) > 4 ||
        Math.abs(dy) > 4
      ) {
        current.moved = true;
      }

      S.pos.x = current.x + dx;
      S.pos.y = current.y + dy;

      applyPosition();
    });

    handle.addEventListener("pointerup", e => {
      if (
        !current ||
        current.pointerId !== e.pointerId
      ) {
        return;
      }

      const moved = current.moved;
      current = null;

      savePosition();

      if (isMini && !moved) {
        expand();
      }
    });

    handle.addEventListener("pointercancel", () => {
      current = null;
      savePosition();
    });
  }

  loadPosition();
  applyPosition();

  drag(
    panel.querySelector("#cq26-handle")
  );

  drag(mini, true);

  panel.querySelector("#cq26-hide").onclick =
    collapse;

  function addButton(
    text,
    action,
    color = "#334155"
  ) {
    const b = document.createElement("button");

    b.textContent = text;

    b.style.cssText = `
      background:${color};
      color:white;
      border:0;
      border-radius:7px;
      padding:10px 7px;
      font:bold 12px system-ui;
      cursor:pointer;
    `;

    b.onclick = action;

    panel.querySelector(
      "#cq26-actions"
    ).append(b);
  }

  addButton(
    "자동 조사 시작",
    start,
    "#2563eb"
  );

  addButton(
    "일시정지 / 재개",
    pause
  );

  addButton(
    "자동 조사 중지",
    stop,
    "#b91c1c"
  );

  addButton(
    "전체 JSON 내보내기",
    exportAll,
    "#047857"
  );

  addButton(
    "DB 서버 수 확인",
    reloadCount
  );

  function destroy() {
    stop();

    try {
      S.db?.close?.();
    } catch {}

    panel.remove();
    mini.remove();

    if (
      window[KEY]?.destroy === destroy
    ) {
      delete window[KEY];
    }
  }

  addButton(
    "패널 종료",
    destroy
  );

  function render() {
    const status =
      panel.querySelector("#cq26-status");

    const logBox =
      panel.querySelector("#cq26-log");

    const mode = !S.running
      ? "중지"
      : S.paused
        ? "일시정지"
        : "실행 중";

    if (status) {
      status.textContent =
        `상태: ${mode}\n` +
        `단계: ${S.phase}\n` +
        `현재 서버: ${S.sid ? "S" + S.sid : "-"}\n` +
        `DB 서버: ${S.known.size}개\n` +
        `신규 저장: ${S.added}개\n` +
        `중복 건너뜀: ${S.skipped}개\n` +
        `새로고침: ${S.refreshed}회\n` +
        `오류: ${S.error || "없음"}`;
    }

    if (logBox) {
      logBox.textContent =
        S.logs.slice(-12).join("\n");

      logBox.scrollTop =
        logBox.scrollHeight;
    }

    mini.textContent = S.running
      ? S.paused
        ? `CQ26 일시정지 (${S.known.size})`
        : `CQ26 조사 중 (${S.known.size})`
      : "CQ26 열기";
  }

  window[KEY] = {
    start,
    pause,
    stop,
    collapse,
    expand,
    destroy,
    exportAll,
    reloadCount,

    status() {
      return {
        version: VERSION,
        running: S.running,
        paused: S.paused,
        phase: S.phase,
        sid: S.sid,
        known: S.known.size,
        added: S.added,
        skipped: S.skipped,
        refreshed: S.refreshed,
        error: S.error,
        logs: S.logs.slice(-15)
      };
    },

    listRows() {
      return rows().map(r => ({
        sid: r.sid,
        uuid: r.uuid,
        known: S.known.has(r.sid),
        attackButtonReady:
          !!attackButtonForRow(r)
      }));
    }
  };

  render();

  log(
    `${VERSION} 설치 완료 · ` +
    `방어창 잔존 노드 무시 · ` +
    `딜레이 50% 단축`
  );

  reloadCount();

})();
