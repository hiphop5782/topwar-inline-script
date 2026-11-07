/**
 * TopWar CQ26 Merit History Exporter v2.0.0
 *
 * Tampermonkey 없이 브라우저 DevTools Console 또는 Snippet에서 실행한다.
 * 작고 이동 가능한 내보내기 UI를 만든다.
 *
 * 사용:
 *   await CQ26MeritHistoryExporter.exportCurrent()
 *
 * 현재 하위 탭이 본 서버 공훈(type 3)이면 Google Sheets용 TSV를 복사하고,
 * 전체 서버 총 공훈(type 1)이면 날짜별 누적 히스토리 JSON을 다운로드한다.
 */

(() => {
  "use strict";

  const API_NAME = "CQ26MeritHistoryExporter";
  const OLD_API_NAME = "CQ26RankPanelInspector";
  const TARGET_PANEL = "CQ26MainRankPanel";
  const RANK_COMPONENT = "EniConquerorRankListComponent";
  const PERSON_NODE = "CQ26PresonRankNode";
  const TIME_ZONE = "Asia/Seoul";
  const HISTORY_KEY = "CQ26_ALL_SERVER_MERIT_HISTORY_V1";
  const HISTORY_DB_NAME = "CQ26_MERIT_HISTORY_DB";
  const HISTORY_DB_VERSION = 1;
  const HISTORY_STORE = "dailySnapshots";
  const UI_POSITION_KEY = "CQ26_MERIT_EXPORTER_UI_POSITION_V1";
  const UI_ID = "cq26-merit-exporter-ui";
  const STYLE_ID = `${UI_ID}-style`;
  const DATASET = "cq26-all-server-merit-history";
  const VIEW_TYPE = Object.freeze({
    ALL_SERVERS: 1,
    SECTOR_ROUND: 2,
    CURRENT_SERVER: 3
  });
  const runtime = {
    loading: false,
    stopRequested: false
  };

  try { window[API_NAME]?.destroy?.(); } catch {}
  try { window[OLD_API_NAME]?.destroy?.(); } catch {}
  document.getElementById("cq26-main-rank-panel-inspector")?.remove();
  document.getElementById("cq26-main-rank-panel-inspector-style")?.remove();

  function scene() {
    try { return window.cc?.director?.getScene?.() || null; } catch { return null; }
  }

  function componentName(component) {
    if (!component) return "";
    try {
      const name = window.cc?.js?.getClassName?.(component);
      if (name) return String(name);
    } catch {}
    return String(component.__classname__ || component.constructor?.name || component.name || "");
  }

  function isActive(node) {
    return !!node && node.active !== false && node.activeInHierarchy !== false;
  }

  function nodePath(node, maxDepth = 18) {
    const parts = [];
    let current = node;
    for (let depth = 0; current && depth < maxDepth; depth++) {
      parts.unshift(String(current.name || "<unnamed>"));
      current = current.parent;
    }
    return parts.join("/");
  }

  function walk(root, callback, limit = 5000) {
    const stack = root ? [root] : [];
    const visited = new Set();
    let count = 0;
    while (stack.length && count < limit) {
      const node = stack.pop();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      count++;
      callback(node);
      const children = node.children || [];
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
  }

  function componentsByName(root, wanted, activeOnly = false) {
    const rows = [];
    try {
      for (const component of root?.getComponentsInChildren?.(wanted) || []) {
        if (component && (!activeOnly || isActive(component.node))) rows.push(component);
      }
    } catch {}
    walk(root, node => {
      if (activeOnly && !isActive(node)) return;
      for (const component of node._components || []) {
        if (componentName(component) === wanted && !rows.includes(component)) rows.push(component);
      }
    });
    return rows;
  }

  function activePanel() {
    const root = scene();
    if (!root) throw new Error("게임 Cocos scene을 찾지 못했습니다.");
    const panel = componentsByName(root, TARGET_PANEL, true)[0] || null;
    if (!panel?.node) throw new Error("CQ26MainRankPanel을 열어주세요.");
    return panel;
  }

  function activePersonNode(panel) {
    const contentList = Array.isArray(panel?._contentList) ? panel._contentList : [];
    const selectedIndex = Number(panel?._selectIdx);
    if (selectedIndex !== 2) {
      throw new Error(`개인 공훈 랭킹 탭을 먼저 여세요. 현재 메인 탭 인덱스: ${selectedIndex}`);
    }
    const selected = contentList[selectedIndex];
    if (selected?.name === PERSON_NODE && isActive(selected)) return selected;
    const fallback = contentList.find(node => node?.name === PERSON_NODE && isActive(node));
    if (!fallback) throw new Error("활성 CQ26PresonRankNode를 찾지 못했습니다.");
    return fallback;
  }

  function rankComponent(personNode) {
    const candidates = componentsByName(personNode, RANK_COMPONENT, true)
      .filter(component => Array.isArray(component?.rankList));
    const component = candidates.sort((a, b) => b.rankList.length - a.rankList.length)[0] || null;
    if (!component) throw new Error("활성 공훈 rankList를 찾지 못했습니다.");
    if (!component.rankList.length) throw new Error("공훈 데이터가 아직 로드되지 않았습니다. 잠시 후 다시 실행하세요.");
    return component;
  }

  function findComponentOnNode(node, wanted) {
    return (node?._components || []).find(component => componentName(component) === wanted) || null;
  }

  function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && value !== "") ?? null;
  }

  function normalizeRankRow(raw) {
    const playerInfo = parseObject(firstValue(
      raw?.playerInfo,
      raw?.player?.playerInfo,
      raw?.userInfo,
      raw?.roleInfo
    ));
    return {
      rank: Number(firstValue(raw?.rank, raw?.ranking, raw?.no)) || null,
      nickname: String(firstValue(
        playerInfo.username,
        playerInfo.nickname,
        playerInfo.userName,
        raw?.username,
        raw?.nickname,
        raw?.playerName,
        raw?.name
      ) || ""),
      merit: Number(firstValue(
        raw?.score,
        raw?.merit,
        raw?.token,
        raw?.tokens,
        raw?.point,
        raw?.points,
        raw?.value,
        raw?.val
      )) || 0,
      uid: String(firstValue(raw?.uid, raw?.pid, raw?.playerId, raw?.userId, raw?.roleId) || ""),
      serverId: Number(firstValue(raw?.sid, raw?.serverId, raw?.server, raw?.worldId)) || null,
      level: Number(firstValue(playerInfo.level, raw?.level, raw?.lv)) || null,
      countryFlag: Number(firstValue(
        playerInfo.nationalflag,
        playerInfo.nationalFlag,
        raw?.nationalflag
      )) || null,
      gender: Number(firstValue(playerInfo.usergender, playerInfo.gender, raw?.gender)) || 0,
      headFrameId: Number(firstValue(raw?.headFrameId, raw?.frameId)) || 0
    };
  }

  function seoulDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function seoulDateTime(date = new Date()) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  }

  function inspectCurrent() {
    const panel = activePanel();
    const personNode = activePersonNode(panel);
    const rank = rankComponent(personNode);
    const personComponent = findComponentOnNode(personNode, PERSON_NODE);
    const request = rank.data || {};
    const requestParam = request.requestParam || {};
    const viewType = Number(requestParam.type ?? request.checkType);
    const round = Number(firstValue(
      requestParam.round,
      request.cellExtraData?.round,
      personComponent?._curRound
    )) || null;
    const totalRound = Number(personComponent?._totalRound) || null;
    const rows = rank.rankList.map(normalizeRankRow)
      .filter(row => row.rank !== null)
      .sort((a, b) => a.rank - b.rank);
    const viewName = viewType === VIEW_TYPE.CURRENT_SERVER
      ? "current-server"
      : viewType === VIEW_TYPE.ALL_SERVERS
        ? "all-servers"
        : viewType === VIEW_TYPE.SECTOR_ROUND
          ? "sector-round"
          : "unknown";
    return {
      target: TARGET_PANEL,
      viewType,
      viewName,
      requestId: Number(request.requestId) || null,
      round,
      totalRound,
      count: rows.length,
      panelPath: nodePath(panel.node),
      rankPath: nodePath(rank.node),
      rows
    };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function nextFrame() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 16);
    });
  }

  function assertNotStopped() {
    if (!runtime.stopRequested) return;
    const error = new Error("사용자가 데이터 불러오기를 중지했습니다.");
    error.code = "CQ26_EXPORT_STOPPED";
    throw error;
  }

  function activeScrollView(personNode, rank) {
    const candidates = [];
    const add = component => {
      const name = componentName(component);
      if (!component || !/ScrollView$/i.test(name) || !isActive(component.node) || candidates.includes(component)) return;
      candidates.push(component);
    };

    // 랭킹 컴포넌트가 붙은 scrollView 노드와 그 부모를 가장 먼저 조사한다.
    let node = rank?.node || null;
    for (let depth = 0; node && depth < 5; depth++, node = node.parent) {
      try { add(node.getComponent?.(window.cc?.ScrollView)); } catch {}
      try { add(node.getComponent?.("cc.ScrollView")); } catch {}
      for (const component of node._components || []) add(component);
    }

    for (const field of ["_scrollView", "scrollView", "_scroll", "scroll"]) add(rank?.[field]);
    for (const component of componentsByName(personNode, "cc.ScrollView", true)) add(component);

    const rankPath = nodePath(rank?.node);
    return candidates.sort((a, b) => {
      const score = component => {
        const path = nodePath(component?.node);
        let value = 0;
        if (component?.node === rank?.node) value += 1000;
        if (path === rankPath) value += 500;
        if (rankPath.startsWith(`${path}/`) || path.startsWith(`${rankPath}/`)) value += 200;
        if (/scrollview/i.test(String(component?.node?.name || ""))) value += 50;
        try {
          const max = component.getMaxScrollOffset?.();
          if (Math.abs(Number(max?.y || 0)) > 0) value += 20;
        } catch {}
        return value;
      };
      return score(b) - score(a);
    })[0] || null;
  }

  function dispatchBottomLoad(personNode, rank) {
    const scroll = activeScrollView(personNode, rank);
    const eventType = window.cc?.ScrollView?.EventType?.SCROLL_TO_BOTTOM || "scroll-to-bottom";
    try {
      // ScrollView가 실제 하단 도달 시 사용하는 동일한 이벤트 경로다.
      // 좌표를 움직이지 않으므로 화면이 튀지 않고 scrollEvents와 node 이벤트를 모두 실행한다.
      if (typeof scroll?._dispatchEvent === "function") {
        scroll._dispatchEvent(eventType);
        return { triggered: true, method: "dispatch" };
      }
    } catch {}

    try {
      const handlers = scroll?.scrollEvents;
      const emitEvents = window.cc?.Component?.EventHandler?.emitEvents;
      if (Array.isArray(handlers) && handlers.length && typeof emitEvents === "function") {
        emitEvents(handlers, scroll, eventType);
        scroll?.node?.emit?.(eventType, scroll);
        return { triggered: true, method: "handlers" };
      }
    } catch {}

    try {
      if (scroll?.node && typeof scroll.node.emit === "function") {
        scroll.node.emit(eventType, scroll);
        return { triggered: true, method: "node-event" };
      }
    } catch {}

    return { triggered: false, method: "none" };
  }

  async function triggerVisibleBottomLoad(personNode, rank, options = {}) {
    const scroll = activeScrollView(personNode, rank);
    const table = rank?._tableView || null;
    const duration = Math.max(0.02, Math.min(0.25, Number(options.duration ?? 0.06)));
    let moved = false;

    try {
      const max = scroll?.getMaxScrollOffset?.();
      if (max && typeof scroll?.scrollToOffset === "function") {
        scroll.stopAutoScroll?.();
        scroll.scrollToOffset({ x: Number(max.x || 0), y: Number(max.y || 0) }, duration, false);
        moved = true;
      } else if (typeof scroll?.scrollToBottom === "function") {
        // 새 데이터로 늘어난 높이만큼 짧게 따라붙어 연속 스크롤처럼 보이게 한다.
        scroll.stopAutoScroll?.();
        scroll.scrollToBottom(duration, false);
        moved = true;
      }
    } catch {}
    if (!moved) {
      for (const method of ["scrollToBottom", "scrollToEnd"]) {
        try {
          if (typeof table?.[method] === "function") {
            table[method](duration);
            moved = true;
            break;
          }
        } catch {}
      }
    }
    await sleep(Math.ceil(duration * 1000) + 20);
    await nextFrame();

    // 좌표 이동만으로 하단 콜백을 발생시키지 않는 Cocos 빌드가 있어 실제 이동 후 명시적으로 전달한다.
    if (moved) dispatchBottomLoad(personNode, rank);
    return {
      moved,
      hasScrollView: !!scroll,
      hasTableView: !!table,
      scrollPath: nodePath(scroll?.node)
    };
  }

  async function triggerOriginalBottomLoad(personNode, rank, force = false) {
    const scroll = activeScrollView(personNode, rank);
    const table = rank?._tableView || null;
    let moved = false;

    // 최초 구현에서 추가 로딩을 다시 발생시켰던 짧은 위/아래 이동을 그대로 유지한다.
    if (force && scroll) {
      try {
        const max = scroll.getMaxScrollOffset?.();
        if (max && typeof scroll.scrollToOffset === "function") {
          scroll.scrollToOffset({
            x: Number(max.x || 0),
            y: Math.max(0, Number(max.y || 0) - 24)
          }, 0, false);
          await nextFrame();
        }
      } catch {}
    }

    try {
      if (typeof scroll?.scrollToBottom === "function") {
        scroll.scrollToBottom(0, false);
        moved = true;
      }
    } catch {}
    if (!moved) {
      for (const method of ["scrollToBottom", "scrollToEnd"]) {
        try {
          if (typeof table?.[method] === "function") {
            table[method](0);
            moved = true;
            break;
          }
        } catch {}
      }
    }

    await nextFrame();
    await nextFrame();
    if (force) dispatchBottomLoad(personNode, rank);
    return { moved, forced: force, scrollPath: nodePath(scroll?.node) };
  }

  async function triggerPullPastBottom(personNode, rank, options = {}) {
    const scroll = activeScrollView(personNode, rank);
    const content = scroll?.content;
    if (!scroll || !content) return triggerOriginalBottomLoad(personNode, rank, true);

    const pullDistance = Math.max(24, Math.min(180, Number(options.pullDistance ?? 72)));
    const pullSteps = Math.max(2, Math.min(8, Number(options.pullSteps ?? 4)));
    let direction = 1;

    try {
      scroll.stopAutoScroll?.();
      const max = scroll.getMaxScrollOffset?.();
      if (max && typeof scroll.scrollToOffset === "function") {
        scroll.scrollToOffset({
          x: Number(max.x || 0),
          y: Math.max(0, Number(max.y || 0) - 32)
        }, 0, false);
        await nextFrame();
        const nearY = Number(content.position?.y ?? content.y ?? 0);
        scroll.scrollToBottom?.(0, false);
        await nextFrame();
        const bottomY = Number(content.position?.y ?? content.y ?? nearY);
        direction = Math.sign(bottomY - nearY) || 1;
      } else {
        scroll.scrollToBottom?.(0, false);
        await nextFrame();
      }
    } catch {}

    const stepY = direction * pullDistance / pullSteps;
    for (let index = 0; index < pullSteps; index++) {
      assertNotStopped();
      let moved = false;
      try {
        if (typeof scroll._moveContent === "function" && typeof window.cc?.v2 === "function") {
          scroll._moveContent(window.cc.v2(0, stepY), false);
          moved = true;
        }
      } catch {}
      if (!moved) {
        try {
          const x = Number(content.position?.x ?? content.x ?? 0);
          const y = Number(content.position?.y ?? content.y ?? 0) + stepY;
          if (typeof content.setPosition === "function") content.setPosition(x, y);
          else content.y = y;
          moved = true;
        } catch {}
      }
      try { scroll._dispatchEvent?.("scrolling"); } catch {}
      try { scroll.node?.emit?.("scrolling", scroll); } catch {}
      await nextFrame();
    }

    // 실제 휠 조작과 동일하게 경계 밖 상태에서 하단 이벤트와 휠 입력을 함께 전달한다.
    try { scroll._dispatchEvent?.("scroll-to-bottom"); } catch {}
    try { scroll.node?.emit?.("scroll-to-bottom", scroll); } catch {}
    await triggerWheelLoad(personNode, rank, {
      pulses: Number(options.wheelPulses ?? 2),
      deltaY: Number(options.wheelDelta ?? 360),
      intervalMs: 8
    });
    await sleep(25);

    // 휠을 놓았을 때 Cocos가 발생시키는 탄성 복귀와 종료 이벤트까지 재현한다.
    try {
      if (!scroll._startBounceBackIfNeeded?.()) scroll.scrollToBottom?.(0.06, false);
    } catch {
      try { scroll.scrollToBottom?.(0.06, false); } catch {}
    }
    await sleep(75);
    for (const eventType of ["bounce-bottom", "scroll-ended"]) {
      try { scroll._dispatchEvent?.(eventType); } catch {}
      try { scroll.node?.emit?.(eventType, scroll); } catch {}
    }
    await nextFrame();
    return {
      moved: true,
      pullDistance,
      pullSteps,
      direction,
      scrollPath: nodePath(scroll.node)
    };
  }

  function gameCanvas() {
    return window.cc?.game?.canvas
      || document.querySelector?.("#GameCanvas")
      || document.querySelector?.("canvas")
      || null;
  }

  function wheelPoint(canvas, node) {
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect) return { clientX: 0, clientY: 0 };
    let xRatio = 0.5;
    let yRatio = 0.52;
    try {
      const box = node?.getBoundingBoxToWorld?.();
      const visible = window.cc?.view?.getVisibleSize?.();
      if (box && Number(visible?.width) > 0 && Number(visible?.height) > 0) {
        xRatio = (Number(box.x || 0) + Number(box.width || 0) / 2) / Number(visible.width);
        yRatio = 1 - (Number(box.y || 0) + Number(box.height || 0) / 2) / Number(visible.height);
      }
    } catch {}
    return {
      clientX: rect.left + Math.max(0.05, Math.min(0.95, xRatio)) * rect.width,
      clientY: rect.top + Math.max(0.05, Math.min(0.95, yRatio)) * rect.height
    };
  }

  function cocosNodeWheel(scroll, rank, deltaY) {
    const cc = window.cc;
    const target = scroll?.content || rank?.node || scroll?.node;
    const MouseEvent = cc?.Event?.EventMouse || cc?.EventMouse;
    const eventType = cc?.Node?.EventType?.MOUSE_WHEEL || "mouse-wheel";
    if (!target || typeof MouseEvent !== "function") return false;
    try {
      const event = new MouseEvent(eventType, true);
      const box = target.getBoundingBoxToWorld?.() || scroll?.node?.getBoundingBoxToWorld?.();
      const worldX = Number(box?.x || 0) + Number(box?.width || 0) / 2;
      const worldY = Number(box?.y || 0) + Number(box?.height || 0) / 2;
      event.setLocation?.(worldX, worldY);
      event.setScrollData?.(0, -Math.max(1, Math.round(deltaY / 120)));
      event._button = 0;
      if (typeof target.dispatchEvent === "function") target.dispatchEvent(event);
      else target.emit?.(eventType, event);
      return true;
    } catch {
      return false;
    }
  }

  function inputManagerWheel(canvas, point, deltaY) {
    const cc = window.cc;
    const managers = [cc?.internal?.inputManager, cc?._inputManager, cc?.inputManager]
      .filter((value, index, values) => value && values.indexOf(value) === index);
    const manager = managers.find(value => typeof value?._mouseWheelHandler === "function");
    if (!manager || !canvas) return false;
    try {
      const event = {
        target: canvas,
        button: 0,
        clientX: point.clientX,
        clientY: point.clientY,
        pageX: point.clientX + Number(window.scrollX || 0),
        pageY: point.clientY + Number(window.scrollY || 0),
        deltaX: 0,
        deltaY,
        detail: Math.max(1, Math.round(deltaY / 120)),
        wheelDelta: -deltaY,
        wheelDeltaY: -deltaY,
        preventDefault() {},
        stopPropagation() {}
      };
      manager._mouseWheelHandler(event);
      return true;
    } catch {
      return false;
    }
  }

  async function triggerWheelLoad(personNode, rank, options = {}) {
    const canvas = gameCanvas();
    const Wheel = window.WheelEvent;
    const scroll = activeScrollView(personNode, rank);
    const point = wheelPoint(canvas, scroll?.node || rank?.node);
    const pulses = Math.max(1, Math.min(30, Number(options.pulses ?? 8)));
    const deltaY = Math.max(120, Math.min(4000, Number(options.deltaY ?? 1000)));
    const intervalMs = Math.max(4, Math.min(40, Number(options.intervalMs ?? 10)));

    let dispatched = 0;
    const routes = { cocosNode: 0, inputManager: 0, dom: 0 };
    for (let index = 0; index < pulses; index++) {
      assertNotStopped();
      let pulseSent = false;
      if (cocosNodeWheel(scroll, rank, deltaY)) {
        routes.cocosNode++;
        pulseSent = true;
      }
      if (inputManagerWheel(canvas, point, deltaY)) {
        routes.inputManager++;
        pulseSent = true;
      }
      // Cocos Creator 버전에 따라 wheel 또는 구형 mousewheel/DOMMouseScroll을 구독한다.
      for (const eventType of canvas?.dispatchEvent && typeof Wheel === "function"
        ? ["wheel", "mousewheel", "DOMMouseScroll"]
        : []) {
        try {
          const event = new Wheel(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: point.clientX,
            clientY: point.clientY,
            deltaX: 0,
            deltaY,
            deltaMode: 0
          });
          try { Object.defineProperty(event, "wheelDelta", { value: -deltaY }); } catch {}
          try { Object.defineProperty(event, "wheelDeltaY", { value: -deltaY }); } catch {}
          try { Object.defineProperty(event, "detail", { value: Math.max(1, Math.round(deltaY / 120)) }); } catch {}
          canvas.dispatchEvent(event);
          routes.dom++;
          pulseSent = true;
        } catch {}
      }
      if (pulseSent) dispatched++;
      if (index + 1 < pulses) await sleep(intervalMs);
    }
    await nextFrame();
    return { dispatched: dispatched > 0, pulses: dispatched, canvas: !!canvas, point, routes };
  }

  async function waitForRankGrowth(rank, beforeLength, options = {}) {
    const timeoutMs = Math.max(250, Number(options.timeoutMs || 1000));
    const settleMs = Math.max(30, Number(options.settleMs || 60));
    const startedAt = Date.now();
    let lastLength = Number(rank?.rankList?.length || 0);
    let lastChangeAt = startedAt;
    while (Date.now() - startedAt < timeoutMs) {
      assertNotStopped();
      await sleep(25);
      const length = Number(rank?.rankList?.length || 0);
      if (length !== lastLength) {
        lastLength = length;
        lastChangeAt = Date.now();
      }
      if (length > beforeLength && Date.now() - lastChangeAt >= settleMs) {
        return { grew: true, length, elapsedMs: Date.now() - startedAt };
      }
    }
    return {
      grew: Number(rank?.rankList?.length || 0) > beforeLength,
      length: Number(rank?.rankList?.length || 0),
      elapsedMs: Date.now() - startedAt
    };
  }

  function progressText(progress) {
    const speed = progress.elapsedMs > 0
      ? Math.round((progress.count - progress.startedCount) * 1000 / progress.elapsedMs)
      : 0;
    return `현재 확보 ${progress.count.toLocaleString()}명\n${speed.toLocaleString()}명/초 · 종료 확인 ${progress.stable}/${progress.stableTarget}`;
  }

  function reportStatus(options, message, tone = "normal") {
    try { options?.onStatus?.(message, tone); } catch {}
  }

  async function loadRankRowsUntilStable(options = {}) {
    const before = inspectCurrent();
    if (![VIEW_TYPE.CURRENT_SERVER, VIEW_TYPE.ALL_SERVERS].includes(before.viewType)) {
      if (before.viewType === VIEW_TYPE.SECTOR_ROUND) {
        throw new Error("해당 섹터 이번 라운드 공훈은 내보내기 제외 대상입니다.");
      }
      throw new Error(`지원하지 않는 공훈 view type입니다: ${before.viewType}`);
    }

    const panel = activePanel();
    const personNode = activePersonNode(panel);
    const rank = rankComponent(personNode);
    const isAllServers = before.viewType === VIEW_TYPE.ALL_SERVERS;
    const stableTarget = Math.max(1, Number(options.stableRounds ?? (isAllServers ? 3 : 2)));
    const maxIterations = Math.max(1, Number(options.maxIterations ?? (isAllServers ? 2500 : 200)));
    const minTimeoutMs = Math.max(250, Number(options.minPageTimeoutMs ?? (isAllServers ? 650 : 500)));
    const maxTimeoutMs = Math.max(minTimeoutMs, Number(options.maxPageTimeoutMs ?? (isAllServers ? 1800 : 1300)));
    const startedAt = Date.now();
    const startedCount = rank.rankList.length;
    let stable = 0;
    let iterations = 0;
    let growthEvents = 0;
    let averageResponseMs = isAllServers ? 350 : 250;
    let usedForcedRetry = false;

    runtime.stopRequested = false;
    while (stable < stableTarget && iterations < maxIterations) {
      assertNotStopped();
      if (!isActive(panel.node) || !isActive(personNode) || !isActive(rank.node)) {
        throw new Error("데이터를 불러오는 중 랭킹 패널 또는 선택 탭이 닫혔습니다.");
      }
      const currentView = Number(rank?.data?.requestParam?.type ?? rank?.data?.checkType);
      if (currentView !== before.viewType) {
        throw new Error("데이터를 불러오는 중 공훈 하위 탭이 변경되었습니다.");
      }

      iterations++;
      const beforeLength = rank.rankList.length;
      const adaptiveTimeoutMs = Math.max(
        minTimeoutMs,
        Math.min(maxTimeoutMs, Math.round(averageResponseMs * 2.4 + 180))
      );
      await triggerPullPastBottom(personNode, rank, {
        pullDistance: options.pullDistance ?? (isAllServers ? 76 : 60),
        pullSteps: options.pullSteps ?? 4
      });
      let growth = await waitForRankGrowth(rank, beforeLength, {
        timeoutMs: adaptiveTimeoutMs,
        settleMs: options.settleMs
      });
      if (!growth.grew) {
        usedForcedRetry = true;
        await triggerPullPastBottom(personNode, rank, {
          pullDistance: options.retryPullDistance ?? (isAllServers ? 120 : 88),
          pullSteps: options.retryPullSteps ?? 5
        });
        growth = await waitForRankGrowth(rank, beforeLength, {
          timeoutMs: Math.min(maxTimeoutMs, Math.max(minTimeoutMs, adaptiveTimeoutMs)),
          settleMs: options.settleMs
        });
      }

      if (growth.grew) {
        stable = 0;
        growthEvents++;
        averageResponseMs = Math.max(60, Math.round(averageResponseMs * 0.7 + growth.elapsedMs * 0.3));
      } else {
        stable++;
      }

      const progress = {
        viewType: before.viewType,
        count: rank.rankList.length,
        startedCount,
        stable,
        stableTarget,
        iterations,
        growthEvents,
        elapsedMs: Date.now() - startedAt
      };
      options.onProgress?.(progress);
      if (!options.onProgress && (growth.grew || stable === stableTarget)) {
        console.log(`[CQ26 Merit Exporter] ${progressText(progress).replace("\n", " · ")}`);
      }
      if (growth.grew) await sleep(isAllServers ? 10 : 5);
    }

    assertNotStopped();
    if (iterations >= maxIterations && stable < stableTarget) {
      throw new Error(`최대 반복 횟수 ${maxIterations}회에 도달했습니다. 현재 ${rank.rankList.length}명.`);
    }
    if (isAllServers && startedCount <= 30 && rank.rankList.length === startedCount) {
      throw new Error(
        `휠 입력 후에도 전체 랭킹이 ${startedCount}명에서 증가하지 않았습니다. `
        + "잘못된 30명 JSON은 저장하지 않았습니다."
      );
    }

    const result = {
      viewType: before.viewType,
      startedCount,
      finalCount: rank.rankList.length,
      addedCount: rank.rankList.length - startedCount,
      iterations,
      growthEvents,
      stableRounds: stable,
      loadMethod: usedForcedRetry ? "pull-past-bottom+retry" : "pull-past-bottom",
      elapsedMs: Date.now() - startedAt
    };
    console.log("[CQ26 Merit Exporter] 스크롤 데이터 불러오기 완료", result);
    return result;
  }

  function sheetCell(value, forceText = false) {
    let text = String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
    if (forceText && text) text = `'${text}`;
    else if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return text;
  }

  function buildCurrentServerSheet(options = {}) {
    const current = inspectCurrent();
    if (current.viewType !== VIEW_TYPE.CURRENT_SERVER) {
      throw new Error(`본 서버 공훈을 연 뒤 실행하세요. 현재 view: ${current.viewName} (type ${current.viewType})`);
    }
    const now = new Date();
    const date = seoulDate(now);
    const extractedAtKst = seoulDateTime(now);
    const includeHeader = options.includeHeader !== false;
    const lines = [];
    if (includeHeader) {
      lines.push(["날짜", "추출시각(KST)", "라운드", "등수", "닉네임", "획득토큰", "UID", "서버ID", "레벨", "국가코드"].join("\t"));
    }
    for (const row of current.rows) {
      lines.push([
        sheetCell(date),
        sheetCell(extractedAtKst),
        sheetCell(current.round),
        sheetCell(row.rank),
        sheetCell(row.nickname),
        sheetCell(row.merit),
        sheetCell(row.uid, true),
        sheetCell(row.serverId),
        sheetCell(row.level),
        sheetCell(row.countryFlag)
      ].join("\t"));
    }
    return {
      text: lines.join("\n"),
      date,
      extractedAtKst,
      round: current.round,
      rows: current.rows
    };
  }

  async function writeClipboard(text) {
    window.CQ26_MERIT_SHEET_TSV = text;
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;z-index:2147483647";
    document.documentElement.appendChild(area);
    area.focus({ preventScroll: true });
    area.setSelectionRange(0, text.length);
    let copied = false;
    try { copied = document.execCommand("copy"); } finally { area.remove(); }
    if (copied) return true;
    try {
      if (typeof copy === "function") {
        copy(text);
        return true;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    console.error("자동 복사에 실패했습니다.");
    console.log("대체 명령: copy(window.CQ26_MERIT_SHEET_TSV)");
    throw new Error("콘솔에 출력된 대체 복사 명령을 실행하세요.");
  }

  async function copyCurrentServerSheet(options = {}) {
    if (options.loadAll !== false) {
      const loaded = await loadRankRowsUntilStable(options);
      reportStatus(options, `${loaded.finalCount.toLocaleString()}명 불러오기 완료\nSheets 복사 중…`);
    }
    const output = buildCurrentServerSheet(options);
    await writeClipboard(output.text);
    reportStatus(options, `저장 완료 · ${output.rows.length.toLocaleString()}명\nGoogle Sheets용 복사`, "ok");
    console.log(
      `[CQ26 Merit Exporter] 본 서버 공훈 ${output.rows.length}행 복사 완료 · ${output.date} · 라운드 ${output.round}`
    );
    return output;
  }

  let historyDbPromise = null;
  let legacyMigrationPromise = null;

  function openHistoryDb() {
    if (historyDbPromise) return historyDbPromise;
    historyDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
          db.createObjectStore(HISTORY_STORE, { keyPath: "date" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("CQ26 히스토리 DB 열기 실패"));
      request.onblocked = () => reject(new Error("CQ26 히스토리 DB가 다른 탭에서 사용 중입니다."));
    });
    return historyDbPromise;
  }

  async function historyStoreOperation(mode, operation) {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(HISTORY_STORE, mode);
      const store = transaction.objectStore(HISTORY_STORE);
      let result;
      try {
        result = operation(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result?.result ?? result);
      transaction.onerror = () => reject(transaction.error || new Error("CQ26 히스토리 DB 작업 실패"));
      transaction.onabort = () => reject(transaction.error || new Error("CQ26 히스토리 DB 작업 중단"));
    });
  }

  function putDailySnapshotDirect(snapshot) {
    return historyStoreOperation("readwrite", store => store.put(snapshot));
  }

  function readDailySnapshotsDirect() {
    return historyStoreOperation("readonly", store => store.getAll());
  }

  function clearDailySnapshotsDirect() {
    return historyStoreOperation("readwrite", store => store.clear());
  }

  async function migrateLegacyHistory() {
    if (legacyMigrationPromise) return legacyMigrationPromise;
    legacyMigrationPromise = (async () => {
      let parsed = null;
      try { parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "null"); } catch {}
      if (parsed?.dataset === DATASET && parsed?.dates && typeof parsed.dates === "object") {
        for (const snapshot of Object.values(parsed.dates)) {
          if (snapshot?.date) await putDailySnapshotDirect(snapshot);
        }
        localStorage.removeItem(HISTORY_KEY);
      }
    })();
    return legacyMigrationPromise;
  }

  function buildHistory(snapshots) {
    const sorted = [...(snapshots || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return {
      schemaVersion: 2,
      dataset: DATASET,
      timezone: TIME_ZONE,
      updatedAt: sorted.at(-1)?.extractedAt || null,
      dates: Object.fromEntries(sorted.map(snapshot => [snapshot.date, snapshot]))
    };
  }

  async function readHistory() {
    await migrateLegacyHistory();
    return buildHistory(await readDailySnapshotsDirect());
  }

  async function captureAllServersDaily() {
    const current = inspectCurrent();
    if (current.viewType !== VIEW_TYPE.ALL_SERVERS) {
      throw new Error(`전체 서버 총 공훈을 연 뒤 실행하세요. 현재 view: ${current.viewName} (type ${current.viewType})`);
    }
    const now = new Date();
    const date = seoulDate(now);
    const extractedAt = now.toISOString();
    const extractedAtKst = seoulDateTime(now);
    const serverIds = [...new Set(current.rows.map(row => row.serverId).filter(Number.isFinite))]
      .sort((a, b) => a - b);
    const snapshot = {
      date,
      extractedAt,
      extractedAtKst,
      round: current.round,
      totalRound: current.totalRound,
      requestId: current.requestId,
      count: current.rows.length,
      serverCount: serverIds.length,
      serverIds,
      rankings: current.rows
    };
    await migrateLegacyHistory();
    await putDailySnapshotDirect(snapshot);
    console.log(
      `[CQ26 Merit Exporter] 전체 서버 총 공훈 ${date} 저장 · ${snapshot.count}명 · ${snapshot.serverCount}개 서버`,
      snapshot
    );
    return { snapshot };
  }

  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  async function downloadAllServersHistory(options = {}) {
    if (options.loadAll !== false) {
      const loaded = await loadRankRowsUntilStable(options);
      reportStatus(options, `${loaded.finalCount.toLocaleString()}명 불러오기 완료\n날짜 기록 저장 중…`);
    }
    const { snapshot } = await captureAllServersDaily();
    reportStatus(options, `IndexedDB 저장 · ${snapshot.count.toLocaleString()}명\nJSON 만드는 중…`);
    const dailyPayload = buildHistory([snapshot]);
    const filename = `cq26-all-server-merit-${snapshot.date}.json`;
    downloadJson(filename, dailyPayload);
    reportStatus(options, `저장 완료 · ${snapshot.count.toLocaleString()}명\n${snapshot.date} JSON`, "ok");
    console.log(`[CQ26 Merit Exporter] 홈페이지용 날짜 JSON 다운로드: ${filename}`);
    return { filename, history: dailyPayload, snapshot };
  }

  async function exportCurrent(options = {}) {
    const current = inspectCurrent();
    if (current.viewType === VIEW_TYPE.CURRENT_SERVER) {
      return copyCurrentServerSheet(options);
    }
    if (current.viewType === VIEW_TYPE.ALL_SERVERS) {
      return await downloadAllServersHistory(options);
    }
    if (current.viewType === VIEW_TYPE.SECTOR_ROUND) {
      throw new Error("해당 섹터 이번 라운드 공훈은 내보내기 제외 대상입니다.");
    }
    throw new Error(`지원하지 않는 공훈 view type입니다: ${current.viewType}`);
  }

  async function importHistory(value) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed?.dataset !== DATASET || !parsed?.dates || typeof parsed.dates !== "object") {
      throw new Error("CQ26 전체 서버 공훈 히스토리 JSON 형식이 아닙니다.");
    }
    await migrateLegacyHistory();
    for (const snapshot of Object.values(parsed.dates)) {
      if (snapshot?.date) await putDailySnapshotDirect(snapshot);
    }
    return readHistory();
  }

  async function clearHistory() {
    await clearDailySnapshotsDirect();
    localStorage.removeItem(HISTORY_KEY);
    console.warn("[CQ26 Merit Exporter] IndexedDB 전체 서버 공훈 히스토리를 초기화했습니다.");
    return true;
  }

  async function downloadStoredHistory() {
    const history = await readHistory();
    const dates = Object.keys(history.dates || {}).sort();
    if (!dates.length) throw new Error("저장된 전체 서버 공훈 히스토리가 없습니다.");
    const latestDate = dates[dates.length - 1];
    const filename = `cq26-all-server-merit-history-${latestDate}.json`;
    downloadJson(filename, history);
    return { filename, history, dates };
  }

  function setUiStatus(message, tone = "normal") {
    const status = document.querySelector(`#${UI_ID} .cq26-export-status`);
    if (!status) return;
    status.textContent = String(message || "");
    status.dataset.tone = tone;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${UI_ID}{position:fixed;right:10px;top:118px;width:214px;z-index:2147483647;
        color:#eaf2ff;background:#172238;border:1px solid #52698f;border-radius:8px;
        box-shadow:0 5px 18px #0008;font:11px/1.35 Arial,"Malgun Gothic",sans-serif;overflow:hidden}
      #${UI_ID} *{box-sizing:border-box}
      #${UI_ID} .cq26-export-head{height:30px;display:flex;align-items:center;justify-content:space-between;
        padding:0 7px 0 9px;background:#263a5d;font-weight:700;cursor:move;user-select:none;touch-action:none}
      #${UI_ID} .cq26-export-close{width:22px;height:22px;border:0;background:transparent;color:#dbe7ff;
        font-size:16px;line-height:20px;cursor:pointer;padding:0}
      #${UI_ID} .cq26-export-body{padding:7px}
      #${UI_ID} .cq26-export-status{min-height:30px;padding:5px 6px;margin-bottom:6px;border-radius:4px;
        color:#afbdd4;background:#0e1728;white-space:pre-wrap;word-break:break-word}
      #${UI_ID} .cq26-export-status[data-tone="ok"]{color:#8ef0ad}
      #${UI_ID} .cq26-export-status[data-tone="error"]{color:#ff9c9c}
      #${UI_ID} .cq26-export-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      #${UI_ID} .cq26-export-actions button{height:29px;padding:4px;border:1px solid #60779c;border-radius:4px;
        color:#eef3ff;background:#31486e;cursor:pointer;font:inherit}
      #${UI_ID} .cq26-export-actions button:hover{background:#405d8c}
      #${UI_ID} .cq26-export-current{background:#2e6b57!important}
    `;
    document.head.appendChild(style);
  }

  function savedUiPosition() {
    try {
      const value = JSON.parse(localStorage.getItem(UI_POSITION_KEY) || "null");
      if (Number.isFinite(value?.left) && Number.isFinite(value?.top)) return value;
    } catch {}
    return null;
  }

  function saveUiPosition(panel) {
    const rect = panel.getBoundingClientRect();
    try {
      localStorage.setItem(UI_POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    } catch {}
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    handle.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      handle.setPointerCapture?.(pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", event => {
      if (!dragging || event.pointerId !== pointerId) return;
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + event.clientX - startX))}px`;
      panel.style.top = `${Math.max(0, Math.min(maxTop, startTop + event.clientY - startY))}px`;
      panel.style.right = "auto";
    });
    const finish = event => {
      if (!dragging || (event?.pointerId != null && event.pointerId !== pointerId)) return;
      dragging = false;
      saveUiPosition(panel);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  async function runCurrentExport() {
    const current = inspectCurrent();
    const options = {
      onProgress: progress => setUiStatus(progressText(progress), "normal"),
      onStatus: (message, tone) => setUiStatus(message, tone)
    };
    if (current.viewType === VIEW_TYPE.CURRENT_SERVER) {
      const output = await copyCurrentServerSheet(options);
      setUiStatus(`저장 완료 · ${output.rows.length.toLocaleString()}명\nGoogle Sheets용 복사`, "ok");
      return output;
    }
    if (current.viewType === VIEW_TYPE.ALL_SERVERS) {
      const output = await downloadAllServersHistory(options);
      setUiStatus(`저장 완료 · ${output.snapshot.count.toLocaleString()}명\n${output.snapshot.date} JSON`, "ok");
      return output;
    }
    if (current.viewType === VIEW_TYPE.SECTOR_ROUND) {
      throw new Error("섹터 이번 라운드 공훈은 제외됩니다.");
    }
    throw new Error(`지원하지 않는 view type: ${current.viewType}`);
  }

  function showUi() {
    if (document.getElementById(UI_ID)) return document.getElementById(UI_ID);
    installStyle();
    const panel = document.createElement("section");
    panel.id = UI_ID;
    panel.innerHTML = `
      <div class="cq26-export-head">
        <span>SSC2 개인랭킹</span>
        <button class="cq26-export-close" type="button" title="닫기">×</button>
      </div>
      <div class="cq26-export-body">
        <div class="cq26-export-status">공훈 탭 선택 후 내보내기</div>
        <div class="cq26-export-actions">
          <button class="cq26-export-current" type="button">현재 내보내기</button>
          <button class="cq26-export-history" type="button">기록 JSON</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    const position = savedUiPosition();
    if (position) {
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, position.left))}px`;
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, position.top))}px`;
      panel.style.right = "auto";
    }
    makeDraggable(panel, panel.querySelector(".cq26-export-head"));
    panel.querySelector(".cq26-export-close").addEventListener("click", () => {
      if (runtime.loading) runtime.stopRequested = true;
      panel.remove();
    });
    const exportButton = panel.querySelector(".cq26-export-current");
    const historyButton = panel.querySelector(".cq26-export-history");
    exportButton.addEventListener("click", async () => {
      if (runtime.loading) {
        runtime.stopRequested = true;
        setUiStatus("안전하게 중지하는 중…", "normal");
        return;
      }
      runtime.loading = true;
      runtime.stopRequested = false;
      exportButton.textContent = "중지";
      historyButton.disabled = true;
      try {
        setUiStatus("처리 중…");
        await runCurrentExport();
      } catch (error) {
        const stopped = error?.code === "CQ26_EXPORT_STOPPED";
        setUiStatus(error?.message || String(error), stopped ? "normal" : "error");
        if (!stopped) console.error("[CQ26 Merit Exporter] 내보내기 실패", error);
      } finally {
        runtime.loading = false;
        runtime.stopRequested = false;
        exportButton.textContent = "현재 내보내기";
        historyButton.disabled = false;
      }
    });
    historyButton.addEventListener("click", async () => {
      try {
        const output = await downloadStoredHistory();
        const totalRows = Object.values(output.history.dates || {})
          .reduce((sum, snapshot) => sum + Number(snapshot?.count || snapshot?.rankings?.length || 0), 0);
        setUiStatus(
          `누적 저장 · ${totalRows.toLocaleString()}명\n${output.dates.length.toLocaleString()}일 기록 JSON`,
          "ok"
        );
      } catch (error) {
        setUiStatus(error?.message || String(error), "error");
      }
    });
    return panel;
  }

  function hideUi() {
    document.getElementById(UI_ID)?.remove();
  }

  function destroy() {
    hideUi();
    document.getElementById(STYLE_ID)?.remove();
    if (window[API_NAME] === api) delete window[API_NAME];
  }

  const api = {
    version: "2.0.0",
    inspect: inspectCurrent,
    loadAll: loadRankRowsUntilStable,
    stop: () => { runtime.stopRequested = true; },
    exportCurrent,
    buildCurrentServerSheet,
    copyCurrentServerSheet,
    captureAllServersDaily,
    downloadAllServersHistory,
    downloadStoredHistory,
    getHistory: readHistory,
    importHistory,
    clearHistory,
    show: showUi,
    hide: hideUi,
    destroy
  };

  window[API_NAME] = api;
  showUi();
  console.log("[CQ26 Merit Exporter] 작은 이동식 UI 설치 완료");
  console.log("현재 탭 자동 내보내기: await CQ26MeritHistoryExporter.exportCurrent()");
  console.log("본 서버 공훈 → Google Sheets 복사 / 전체 서버 총 공훈 → 날짜별 히스토리 JSON 다운로드");
})();
