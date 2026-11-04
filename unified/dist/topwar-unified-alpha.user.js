// ==UserScript==
// @name         TopWar Unified Alpha
// @namespace    https://github.com/hiphop5782/topwar-inline-script
// @version      0.1.0
// @description  Modular TopWar UI inspector and validated TOP100 collector
// @match        https://h5.topwargame.com/*
// @match        https://h5v2.topwargame.com/*
// @match        https://*.topwargame.com/*
// @match        https://*.topwarapp.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  // src/core/event-bus.js
  var EventBus = class {
    #listeners = /* @__PURE__ */ new Map();
    on(type, listener) {
      const listeners = this.#listeners.get(type) || /* @__PURE__ */ new Set();
      listeners.add(listener);
      this.#listeners.set(type, listeners);
      return () => this.off(type, listener);
    }
    off(type, listener) {
      const listeners = this.#listeners.get(type);
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#listeners.delete(type);
    }
    emit(type, payload) {
      for (const listener of this.#listeners.get(type) || []) {
        try {
          listener(payload);
        } catch (error) {
          console.error("[TopWar Unified] event listener failed", type, error);
        }
      }
    }
    clear() {
      this.#listeners.clear();
    }
  };

  // src/core/logger.js
  var MAX_LOGS = 300;
  var Logger = class {
    #rows = [];
    #bus;
    constructor(bus) {
      this.#bus = bus;
    }
    get rows() {
      return [...this.#rows];
    }
    debug(message, details) {
      return this.#write("debug", message, details);
    }
    info(message, details) {
      return this.#write("info", message, details);
    }
    warn(message, details) {
      return this.#write("warn", message, details);
    }
    error(message, details) {
      return this.#write("error", message, details);
    }
    clear() {
      this.#rows = [];
      this.#bus?.emit("logs:changed", this.rows);
    }
    #write(level, message, details = null) {
      const row = {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        level,
        message: String(message),
        details
      };
      this.#rows.push(row);
      if (this.#rows.length > MAX_LOGS) this.#rows.splice(0, this.#rows.length - MAX_LOGS);
      const output = level === "debug" ? "debug" : level === "info" ? "info" : level;
      console[output](`[TopWar Unified] ${row.message}`, details ?? "");
      this.#bus?.emit("logs:changed", this.rows);
      return row;
    }
  };

  // src/core/errors.js
  var TopWarError = class extends Error {
    constructor(code, message, details = null, options = {}) {
      super(message, options);
      this.name = "TopWarError";
      this.code = code;
      this.details = details;
    }
  };
  function asTopWarError(error, fallbackCode = "UNKNOWN") {
    if (error instanceof TopWarError) return error;
    return new TopWarError(
      fallbackCode,
      error?.message || String(error),
      null,
      { cause: error }
    );
  }

  // src/core/task-runner.js
  var TaskRunner = class {
    #current = null;
    #bus;
    #logger;
    constructor({ bus, logger }) {
      this.#bus = bus;
      this.#logger = logger;
    }
    get state() {
      if (!this.#current) return { status: "idle", taskId: null, startedAt: null };
      return {
        status: this.#current.status,
        taskId: this.#current.taskId,
        startedAt: this.#current.startedAt
      };
    }
    async run(taskId, work) {
      if (this.#current) {
        throw new TopWarError(
          "TASK_BUSY",
          `다른 작업(${this.#current.taskId})이 실행 중입니다.`
        );
      }
      const controller = new AbortController();
      const task = {
        taskId,
        controller,
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "running"
      };
      this.#current = task;
      this.#bus.emit("task:changed", this.state);
      this.#logger.info(`작업 시작: ${taskId}`);
      try {
        const result = await work({
          signal: controller.signal,
          throwIfAborted() {
            if (controller.signal.aborted) {
              throw new TopWarError("TASK_ABORTED", `작업이 중지되었습니다: ${taskId}`);
            }
          }
        });
        task.status = "completed";
        this.#logger.info(`작업 완료: ${taskId}`);
        return result;
      } catch (error) {
        const normalized = controller.signal.aborted ? new TopWarError("TASK_ABORTED", `작업이 중지되었습니다: ${taskId}`, {
          reason: controller.signal.reason
        }, { cause: error }) : asTopWarError(error, "TASK_FAILED");
        task.status = normalized.code === "TASK_ABORTED" ? "aborted" : "failed";
        this.#logger[task.status === "aborted" ? "warn" : "error"](
          `작업 ${task.status}: ${taskId}`,
          { code: normalized.code, message: normalized.message, details: normalized.details }
        );
        throw normalized;
      } finally {
        this.#bus.emit("task:changed", { ...this.state, status: task.status });
        this.#current = null;
        this.#bus.emit("task:changed", this.state);
      }
    }
    stop(reason = "user") {
      if (!this.#current) return false;
      this.#logger.warn(`작업 중지 요청: ${this.#current.taskId}`, { reason });
      this.#current.controller.abort(reason);
      return true;
    }
  };

  // src/adapters/cocos-adapter.js
  var KNOWN_COMPONENTS = [
    "WorldServerListPanel",
    "WorldServerTheaterPanel",
    "WorldServerPowerRank",
    "WorldServerAlliancePowerRank"
  ];
  function cocos() {
    return globalThis.cc || null;
  }
  function componentName(component) {
    return String(
      component?.__classname__ || component?.constructor?.name || component?.name || "UnknownComponent"
    );
  }
  function isNodeActive(node) {
    return node?.active !== false && node?.activeInHierarchy !== false;
  }
  function nodeChildren(node) {
    return Array.isArray(node?.children) ? node.children : [];
  }
  function nodeComponents(node) {
    return Array.isArray(node?._components) ? node._components : [];
  }
  function ancestorByName(node, name, maxDepth = 12) {
    let current = node;
    for (let depth = 0; current && depth < maxDepth; depth++) {
      if (String(current.name || "") === name) return current;
      current = current.parent;
    }
    return null;
  }
  function abortError() {
    return new TopWarError("TASK_ABORTED", "작업이 중지되었습니다.");
  }
  function ownNodeText(node) {
    const values = [];
    for (const component of nodeComponents(node)) {
      for (const key of ["string", "_string", "text", "_text"]) {
        let value;
        try {
          value = component?.[key];
        } catch {
          continue;
        }
        if (typeof value === "string" && value.trim()) values.push(value.trim());
      }
    }
    return [...new Set(values)];
  }
  function nodePath(node, maxDepth = 12) {
    const parts = [];
    let current = node;
    for (let depth = 0; current && depth < maxDepth; depth++) {
      parts.unshift(String(current.name || "<unnamed>"));
      current = current.parent;
    }
    return parts.join("/");
  }
  function describeClickHandler(handler) {
    return {
      component: String(handler?.component || handler?._componentName || ""),
      handler: String(handler?.handler || handler?._handler || ""),
      customEventData: handler?.customEventData ?? handler?._customEventData ?? null,
      targetPath: handler?.target ? nodePath(handler.target) : null
    };
  }
  function extractServerMatches(rows) {
    const patterns = [
      /(?:전투\s*지역|battle\s*area|戦闘\s*地域|战斗\s*区域|warzone|전쟁\s*구역)\s*[s#]?\s*(\d+)/i,
      /(?:server|서버|サーバー|服务器)\s*[s#]?\s*(\d+)/i
    ];
    const matches = [];
    for (const row of rows || []) {
      const value = String(row?.text || "");
      const shortLabel = value.match(/^S\s*(\d+)$/i);
      if (shortLabel) {
        matches.push({ serverId: Number(shortLabel[1]), text: value, path: row?.path || "" });
      }
      for (const pattern of patterns) {
        const match = value.match(pattern);
        if (!match) continue;
        matches.push({ serverId: Number(match[1]), text: value, path: row?.path || "" });
      }
    }
    return matches;
  }
  var CocosAdapter = class {
    scene() {
      return cocos()?.director?.getScene?.() || null;
    }
    requireScene() {
      const scene = this.scene();
      if (!scene) {
        throw new TopWarError("GAME_SCENE_MISSING", "게임 Scene을 찾지 못했습니다.");
      }
      return scene;
    }
    walk(root = this.requireScene(), limit = 15e3) {
      const rows = [];
      const stack = [root];
      const visited = /* @__PURE__ */ new Set();
      while (stack.length && rows.length < limit) {
        const node = stack.pop();
        if (!node || visited.has(node)) continue;
        visited.add(node);
        rows.push(node);
        const children = nodeChildren(node);
        for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
      }
      return rows;
    }
    findComponents(name, { activeOnly = false } = {}) {
      const matches = [];
      for (const node of this.walk()) {
        if (activeOnly && !isNodeActive(node)) continue;
        for (const component of nodeComponents(node)) {
          if (componentName(component) === name) matches.push(component);
        }
        try {
          const direct = node.getComponent?.(name);
          if (direct && !matches.includes(direct)) matches.push(direct);
        } catch {
        }
      }
      return matches;
    }
    activeComponent(name) {
      return this.findComponents(name, { activeOnly: true }).find((component) => isNodeActive(component?.node)) || null;
    }
    visibleTexts(limit = 1e3, root = null) {
      const rows = [];
      for (const node of this.walk(root || this.requireScene())) {
        if (!isNodeActive(node)) continue;
        for (const text2 of ownNodeText(node)) {
          rows.push({ text: text2, path: nodePath(node) });
          if (rows.length >= limit) return rows;
        }
      }
      return rows;
    }
    detectServerContext(expectedServerId = null) {
      const target = Number(expectedServerId);
      const theater = this.activeComponent("WorldServerTheaterPanel");
      const scopedRoot = theater ? ancestorByName(theater.node, "UIFrameScreen") || theater.node : null;
      const matches = extractServerMatches(this.visibleTexts(1e3, scopedRoot));
      const uniqueIds = [...new Set(matches.map((row) => row.serverId).filter(Number.isFinite))];
      const exact = Number.isFinite(target) ? matches.find((row) => row.serverId === target) || null : null;
      return {
        expectedServerId: Number.isFinite(target) ? target : null,
        verified: !!theater && !!exact,
        scope: theater ? "WorldServerTheaterFrame" : "scene-unverified",
        exact,
        detectedServerIds: uniqueIds,
        matches
      };
    }
    rankComponent() {
      const personal = this.activeComponent("WorldServerPowerRank");
      const alliance = this.activeComponent("WorldServerAlliancePowerRank");
      if (personal && alliance) {
        throw new TopWarError(
          "RANK_PANEL_AMBIGUOUS",
          "개인 랭킹과 길드 랭킹이 동시에 활성 상태입니다."
        );
      }
      if (personal) return { kind: "players", component: personal };
      if (alliance) return { kind: "alliances", component: alliance };
      throw new TopWarError(
        "RANK_PANEL_MISSING",
        "활성화된 TOP100 개인/길드 랭킹 화면을 찾지 못했습니다."
      );
    }
    async openRank(kind, { signal, timeoutMs = 8e3 } = {}) {
      const personal = kind === "players";
      const targetName = personal ? "WorldServerPowerRank" : "WorldServerAlliancePowerRank";
      const methodName = personal ? "onClickPlayerRank" : "onClickAllianceRank";
      if (this.activeComponent("WorldServerPowerRank") || this.activeComponent("WorldServerAlliancePowerRank")) {
        throw new TopWarError("RANK_PANEL_ALREADY_OPEN", "다른 랭킹 화면이 이미 열려 있습니다.");
      }
      const theater = this.activeComponent("WorldServerTheaterPanel");
      if (!theater || typeof theater[methodName] !== "function") {
        throw new TopWarError(
          "RANK_OPEN_METHOD_MISSING",
          `${methodName} 메서드를 찾지 못했습니다.`
        );
      }
      theater[methodName]();
      return this.waitForComponent(targetName, { signal, timeoutMs, active: true });
    }
    async closeRank(kind, { signal, timeoutMs = 5e3 } = {}) {
      const name = kind === "players" ? "WorldServerPowerRank" : "WorldServerAlliancePowerRank";
      const rank = this.activeComponent(name);
      if (!rank) return { ok: true, alreadyClosed: true };
      const frame = ancestorByName(rank.node, "UIFrameScreen");
      let dialog = null;
      try {
        dialog = frame?.getComponent?.("DialogFrameComponent") || null;
      } catch {
        dialog = null;
      }
      if (!dialog) {
        dialog = nodeComponents(frame).find((component) => componentName(component) === "DialogFrameComponent") || null;
      }
      if (!dialog || typeof dialog.close !== "function") {
        throw new TopWarError("RANK_CLOSE_METHOD_MISSING", "랭킹 프레임의 close 메서드를 찾지 못했습니다.");
      }
      dialog.close();
      await this.waitForComponent(name, { signal, timeoutMs, active: false });
      return { ok: true, method: "DialogFrameComponent.close" };
    }
    async waitForRankRows(kind, requiredCount, { signal, timeoutMs = 2e4 } = {}) {
      const name = kind === "players" ? "WorldServerPowerRank" : "WorldServerAlliancePowerRank";
      const startedAt = Date.now();
      let lastCount = 0;
      while (Date.now() - startedAt < timeoutMs) {
        if (signal?.aborted) throw abortError();
        const component = this.activeComponent(name);
        const rows = component?._rankList;
        lastCount = Array.isArray(rows) ? rows.length : 0;
        if (component && lastCount >= requiredCount) {
          return { component, rows, count: lastCount, elapsedMs: Date.now() - startedAt };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new TopWarError(
        "RANK_DATA_TIMEOUT",
        `${kind === "players" ? "개인" : "길드"} 랭킹 데이터가 ${lastCount}/${requiredCount}에서 시간 초과되었습니다.`
      );
    }
    async waitForComponent(name, { signal, timeoutMs = 8e3, active = true } = {}) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (signal?.aborted) throw abortError();
        const component = this.activeComponent(name);
        if (active && component || !active && !component) {
          return { ok: true, component, elapsedMs: Date.now() - startedAt };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new TopWarError(
        "COMPONENT_WAIT_TIMEOUT",
        `${name} ${active ? "활성화" : "종료"}를 기다리다 시간 초과되었습니다.`
      );
    }
    snapshot() {
      const scene = this.requireScene();
      const nodes = this.walk(scene);
      const activeNodes = nodes.filter(isNodeActive);
      const components = [];
      const buttons = [];
      const texts = [];
      for (const node of activeNodes) {
        const path = nodePath(node);
        const ownTexts = ownNodeText(node);
        for (const text2 of ownTexts) texts.push({ text: text2, path });
        for (const component of nodeComponents(node)) {
          const name = componentName(component);
          components.push({ name, nodeName: String(node.name || ""), path });
          const clickEvents = component?.clickEvents;
          if (Array.isArray(clickEvents)) {
            buttons.push({
              nodeName: String(node.name || ""),
              path,
              text: ownTexts.join(" | "),
              handlers: clickEvents.map(describeClickHandler)
            });
          }
        }
      }
      const componentCounts = components.reduce((acc, row) => {
        acc[row.name] = (acc[row.name] || 0) + 1;
        return acc;
      }, {});
      const activeScreen = this.activeComponent("WorldServerPowerRank") ? "personal-rank" : this.activeComponent("WorldServerAlliancePowerRank") ? "alliance-rank" : this.activeComponent("WorldServerTheaterPanel") ? "theater" : this.activeComponent("WorldServerListPanel") ? "server-list" : "scene";
      return {
        schemaVersion: 1,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        url: location.href,
        scene: String(scene.name || ""),
        activeScreen,
        totals: {
          nodes: nodes.length,
          activeNodes: activeNodes.length,
          components: components.length,
          buttons: buttons.length,
          texts: texts.length
        },
        knownComponents: Object.fromEntries(
          KNOWN_COMPONENTS.map((name) => [name, {
            total: this.findComponents(name).length,
            active: this.findComponents(name, { activeOnly: true }).length
          }])
        ),
        serverContext: this.detectServerContext(),
        componentCounts,
        components,
        buttons,
        texts
      };
    }
  };

  // src/features/top100/repository.js
  var DB_NAME = "TOPWAR_UNIFIED_ALPHA";
  var DB_VERSION = 1;
  var STORE = "top100Sessions";
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }
  var Top100Repository = class {
    #dbPromise = null;
    #open() {
      if (this.#dbPromise) return this.#dbPromise;
      this.#dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "runId" });
            store.createIndex("updatedAt", "updatedAt");
            store.createIndex("serverId", "serverId");
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      });
      return this.#dbPromise;
    }
    async #store(mode) {
      const db = await this.#open();
      return db.transaction(STORE, mode).objectStore(STORE);
    }
    async save(session) {
      if (!session?.runId) {
        throw new TopWarError("SESSION_ID_MISSING", "TOP100 세션 ID가 없습니다.");
      }
      const value = { ...session, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const store = await this.#store("readwrite");
      await requestResult(store.put(value));
      return value;
    }
    async get(runId) {
      const store = await this.#store("readonly");
      return requestResult(store.get(String(runId)));
    }
    async list() {
      const store = await this.#store("readonly");
      const rows = await requestResult(store.getAll());
      return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }
    async remove(runId) {
      const store = await this.#store("readwrite");
      await requestResult(store.delete(String(runId)));
    }
  };

  // src/features/top100/uploader.js
  var SETTINGS_KEY = "TOPWAR_UNIFIED_DATAHUB_V1";
  function requestId(value) {
    return value || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  }
  var DataHubTop100Uploader = class {
    #token = "";
    configure({ baseUrl, scannerId, token }) {
      const publicSettings = {
        baseUrl: String(baseUrl || "https://datahub.progamer.info").replace(/\/+$/, ""),
        scannerId: String(scannerId || "").trim()
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(publicSettings));
      this.#token = String(token || "").trim();
      return this.status();
    }
    publicSettings() {
      try {
        return {
          baseUrl: "https://datahub.progamer.info",
          scannerId: "",
          ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
        };
      } catch {
        return { baseUrl: "https://datahub.progamer.info", scannerId: "" };
      }
    }
    status() {
      const settings = this.publicSettings();
      return {
        ...settings,
        tokenInMemory: !!this.#token,
        configured: !!(settings.baseUrl && settings.scannerId && this.#token)
      };
    }
    async uploadServer(payload, requestIdValue, options = {}) {
      return this.#post("/api/v1/top100/server", payload, requestId(requestIdValue), options);
    }
    async completeBatch({ batchId, expectedServers }, requestIdValue, options = {}) {
      return this.#post(
        "/api/v1/top100/complete",
        { batchId, expectedServers },
        requestId(requestIdValue),
        options
      );
    }
    async #post(path, payload, id, { signal } = {}) {
      const settings = this.status();
      if (!settings.configured) {
        throw new TopWarError(
          "DATAHUB_NOT_CONFIGURED",
          "DataHub 조사기 ID와 이번 세션의 Token을 입력하세요."
        );
      }
      const response = await fetch(`${settings.baseUrl}${path}`, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.#token}`,
          "X-Scanner-Id": settings.scannerId,
          "X-Request-Id": id
        },
        body: JSON.stringify(payload)
      });
      const text2 = await response.text();
      let body = null;
      try {
        body = text2 ? JSON.parse(text2) : null;
      } catch {
        body = text2;
      }
      if (!response.ok) {
        throw new TopWarError(
          "DATAHUB_HTTP_ERROR",
          `DataHub HTTP ${response.status}`,
          { status: response.status, path, response: body }
        );
      }
      return { ok: true, requestId: id, response: body };
    }
  };

  // src/features/top100/model.js
  function randomId(prefix) {
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${id}`;
  }
  function createTop100Session(serverId, serverContext) {
    const numericServerId = Number(serverId);
    const runId = randomId("top100-run");
    return {
      schemaVersion: 2,
      runId,
      batchId: runId,
      requestIds: {
        server: randomId("top100-server"),
        complete: randomId("top100-complete")
      },
      serverId: numericServerId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      serverContext,
      players: null,
      alliances: null,
      captures: {},
      validation: null,
      upload: {
        serverAcknowledged: false,
        completed: false,
        lastError: null
      }
    };
  }
  function buildTop100Payload(session) {
    const players = Array.isArray(session.players) ? session.players : [];
    const alliances = Array.isArray(session.alliances) ? session.alliances : [];
    const researchTime = Date.parse(session.updatedAt || session.createdAt) || Date.now();
    return {
      schemaVersion: 2,
      source: "topwar-unified-alpha",
      runId: session.runId,
      batchId: session.batchId,
      batchIndex: 1,
      batchTotal: 1,
      batchCompleted: true,
      serverId: Number(session.serverId),
      serverNumber: Number(session.serverId),
      server: Number(session.serverId),
      researchTime,
      exportedAt: new Date(researchTime).toISOString(),
      playerList: players,
      allianceList: alliances,
      summary: {
        players: players.length,
        alliances: alliances.length,
        uniquePlayers: new Set(players.map((row) => row.uid).filter(Boolean)).size,
        totalPlayerPower: players.reduce((sum, row) => sum + Number(row.cp || 0), 0),
        totalAlliancePower: alliances.reduce((sum, row) => sum + Number(row.cp || 0), 0)
      }
    };
  }

  // src/features/top100/row-mapper.js
  function safeRead(object, key) {
    try {
      return object?.[key];
    } catch {
      return void 0;
    }
  }
  function parseObject(value) {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return null;
    const text2 = value.trim();
    if (!text2.startsWith("{") && !text2.startsWith("[")) return null;
    try {
      const parsed = JSON.parse(text2);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  function first(sources, keys) {
    for (const source of sources) {
      if (!source) continue;
      for (const key of keys) {
        const value = safeRead(source, key);
        if (value !== void 0 && value !== null && value !== "") return value;
      }
    }
    return null;
  }
  function number(value) {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }
  function text(value) {
    return value === void 0 || value === null || value === "" ? null : String(value);
  }
  function boolean(value) {
    if (value === true || value === false) return value;
    if (Number(value) === 1) return true;
    if (Number(value) === 0) return false;
    return String(value).toLowerCase() === "true";
  }
  function playerSources(row) {
    const nested = ["player", "playerData", "role", "user"].map((key) => parseObject(safeRead(row, key))).filter(Boolean);
    return [parseObject(row) || {}, ...nested];
  }
  function playerDetail(row, sources) {
    const candidates = [
      first(sources, ["playerInfo"]),
      safeRead(row, "detail"),
      safeRead(row, "playerDetail"),
      safeRead(row, "userDetail"),
      safeRead(row, "roleDetail")
    ];
    for (const candidate of candidates) {
      const parsed = parseObject(candidate);
      if (parsed) return parsed;
    }
    return {};
  }
  function mapPlayerRow(row, index, fallbackServerId) {
    const sources = playerSources(row);
    const detail = playerDetail(row, sources);
    const onlineValue = first(sources, ["isOnline", "online"]);
    const cp = number(first(sources, ["power", "cp", "fightPower"]));
    const score = number(first(sources, ["val", "score", "value"]));
    const targetServer = Number(fallbackServerId);
    return {
      rank: number(first(sources, ["rank", "ranking"])) ?? index + 1,
      score,
      cp,
      power: cp,
      uid: text(first(sources, ["uid", "pid", "userId", "playerId", "roleId", "id"])),
      // 기존 RealPower/Java 매핑과 동일하게 랭킹이 열린 Theater 서버를 기준으로 한다.
      // 랭킹 행의 serverId는 이 화면의 소속 서버를 나타내는 신뢰 가능한 필드가 아니다.
      server: targetServer,
      serverNumber: targetServer,
      serverId: String(targetServer),
      level: number(first(sources, ["lv", "level"])),
      nickname: text(first([detail, ...sources], ["username", "userName", "nickname", "nickName"])),
      allianceId: text(first(sources, ["allianceId", "aid", "guildId"])),
      allianceTag: text(first(sources, ["allianceTag", "a_tag", "tag"])),
      allianceName: text(first(sources, ["allianceName", "guildName"])),
      lang: text(first(sources, ["lang", "language"])),
      lastLogin: number(first(sources, ["lastLoginTime", "lastLogin", "last_login"])),
      lastRequest: number(first(sources, ["lastOnlineTime", "lastRequest", "last_request"])),
      online: boolean(onlineValue),
      countryFlag: number(first([detail], ["nationalflag", "nationalFlag", "countryFlag"])),
      gender: number(first([detail], ["gender", "usergender", "userGender"])),
      profile: text(first([detail], ["avatarurl", "avatarUrl", "headimgurl", "headImgUrl"]))
    };
  }
  function mapAllianceRow(row, index, fallbackServerId) {
    const source = parseObject(row) || {};
    const cp = number(first([source], ["cp", "power", "fightPower", "score", "value"]));
    const targetServer = Number(fallbackServerId);
    return {
      rank: number(first([source], ["rank", "ranking"])) ?? index + 1,
      score: cp,
      cp,
      power: cp,
      aid: text(first([source], ["aid", "allianceId", "guildId", "id"])),
      allianceId: text(first([source], ["aid", "allianceId", "guildId", "id"])),
      tag: text(first([source], ["tag", "allianceTag", "a_tag"])),
      name: text(first([source], ["name", "allianceName", "guildName"])),
      leaderName: text(first([source], ["leader_name", "leaderName", "leader", "chiefName"])),
      memberCount: number(first([source], ["memberCount", "members", "num"])),
      server: targetServer,
      serverNumber: targetServer,
      serverId: String(targetServer)
    };
  }
  function fingerprintRows(rows, identity) {
    const values = rows.map(identity);
    return `${rows.length}:${values.join("|")}`;
  }

  // src/features/top100/validator.js
  function issue(code, message, details = null) {
    return { code, message, details };
  }
  function finitePositive(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }
  function validateTop100Session(session, options = {}) {
    const requiredPlayers = Number(options.requiredPlayers ?? 100);
    const requiredAlliances = Number(options.requiredAlliances ?? 10);
    const errors = [];
    const warnings = [];
    const players = Array.isArray(session?.players) ? session.players : [];
    const alliances = Array.isArray(session?.alliances) ? session.alliances : [];
    const targetServer = Number(session?.serverId);
    if (!session?.serverContext?.verified) {
      errors.push(issue("SERVER_UNVERIFIED", "화면에서 대상 서버를 확인하지 못했습니다."));
    }
    if (players.length < requiredPlayers) {
      errors.push(issue("PLAYERS_INCOMPLETE", `개인 랭킹이 ${players.length}/${requiredPlayers}개입니다.`));
    }
    if (alliances.length < requiredAlliances) {
      errors.push(issue("ALLIANCES_INCOMPLETE", `길드 랭킹이 ${alliances.length}/${requiredAlliances}개입니다.`));
    }
    const playerUids = players.map((row) => row.uid).filter(Boolean);
    const uniqueUids = new Set(playerUids);
    if (playerUids.length !== players.length) {
      errors.push(issue("PLAYER_UID_MISSING", `${players.length - playerUids.length}명의 UID가 없습니다.`));
    }
    if (uniqueUids.size !== playerUids.length) {
      errors.push(issue("PLAYER_UID_DUPLICATED", `${playerUids.length - uniqueUids.size}개의 UID가 중복됩니다.`));
    }
    const invalidPlayerPower = players.filter((row) => !finitePositive(row.cp));
    if (invalidPlayerPower.length) {
      errors.push(issue("PLAYER_POWER_INVALID", `${invalidPlayerPower.length}명의 CP가 비정상입니다.`));
    }
    const mismatchedPlayers = players.filter(
      (row) => finitePositive(row.server) && Number(row.server) !== targetServer
    );
    if (mismatchedPlayers.length) {
      errors.push(issue(
        "PLAYER_SERVER_MISMATCH",
        `${mismatchedPlayers.length}명의 정규화 서버가 Theater 대상 서버와 다릅니다.`,
        mismatchedPlayers.slice(0, 10).map((row) => ({ uid: row.uid, server: row.server }))
      ));
    }
    const playerRanks = players.map((row) => Number(row.rank)).filter(Number.isFinite);
    if (new Set(playerRanks).size !== playerRanks.length) {
      warnings.push(issue("PLAYER_RANK_DUPLICATED", "개인 랭킹 번호가 중복됩니다."));
    }
    const missingNames = players.filter((row) => !row.nickname).length;
    if (missingNames) warnings.push(issue("PLAYER_NAME_MISSING", `${missingNames}명의 닉네임이 없습니다.`));
    const allianceIds = alliances.map((row) => row.aid).filter(Boolean);
    if (allianceIds.length && new Set(allianceIds).size !== allianceIds.length) {
      errors.push(issue("ALLIANCE_ID_DUPLICATED", "길드 ID가 중복됩니다."));
    }
    const invalidAlliancePower = alliances.filter((row) => !finitePositive(row.cp));
    if (invalidAlliancePower.length) {
      warnings.push(issue("ALLIANCE_POWER_INVALID", `${invalidAlliancePower.length}개 길드의 CP가 비정상입니다.`));
    }
    return {
      ok: errors.length === 0,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      requirements: { players: requiredPlayers, alliances: requiredAlliances },
      metrics: {
        players: players.length,
        alliances: alliances.length,
        uniquePlayerUids: uniqueUids.size,
        invalidPlayerPower: invalidPlayerPower.length,
        mismatchedPlayers: mismatchedPlayers.length,
        missingNames
      },
      errors,
      warnings
    };
  }

  // src/features/top100/service.js
  function activeRows(component) {
    const rows = component?._rankList;
    if (!Array.isArray(rows)) {
      throw new TopWarError("RANK_DATA_MISSING", "활성 랭킹 화면의 _rankList가 배열이 아닙니다.");
    }
    return Array.from(rows);
  }
  var Top100Service = class {
    #adapter;
    #repository;
    #uploader;
    #logger;
    #session = null;
    constructor({ adapter, repository, uploader, logger }) {
      this.#adapter = adapter;
      this.#repository = repository;
      this.#uploader = uploader;
      this.#logger = logger;
    }
    get current() {
      return this.#session;
    }
    async start(serverId) {
      const target = Number(serverId);
      if (!Number.isInteger(target) || target <= 0) {
        throw new TopWarError("SERVER_ID_INVALID", "올바른 서버 번호를 입력하세요.");
      }
      if (!this.#adapter.activeComponent("WorldServerTheaterPanel")) {
        throw new TopWarError(
          "THEATER_PANEL_MISSING",
          "대상 서버의 전투 지역(Theater) 화면을 먼저 여세요."
        );
      }
      const context = this.#adapter.detectServerContext(target);
      if (!context.verified) {
        throw new TopWarError(
          "SERVER_UNVERIFIED",
          `현재 화면에서 ${target} 서버를 확인하지 못했습니다.`,
          context
        );
      }
      this.#session = await this.#repository.save(createTop100Session(target, context));
      this.#logger.info(`TOP100 세션 생성: ${target} 서버`, { runId: this.#session.runId });
      return this.#session;
    }
    async resume(runId) {
      const session = await this.#repository.get(runId);
      if (!session) throw new TopWarError("SESSION_NOT_FOUND", "저장된 TOP100 세션을 찾지 못했습니다.");
      this.#session = session;
      return session;
    }
    async captureActiveRank() {
      if (!this.#session) throw new TopWarError("SESSION_MISSING", "TOP100 세션을 먼저 시작하세요.");
      const context = this.#adapter.detectServerContext(this.#session.serverId);
      if (!context.verified) {
        throw new TopWarError(
          "SERVER_CONTEXT_CHANGED",
          "랭킹 캡처 중 대상 서버 확인에 실패했습니다. 업로드를 차단합니다.",
          context
        );
      }
      const { kind, component } = this.#adapter.rankComponent();
      const rows = activeRows(component);
      const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (kind === "players") {
        const mapped = rows.slice(0, 100).map((row, index) => mapPlayerRow(row, index, this.#session.serverId));
        this.#session.players = mapped;
        this.#session.captures.players = {
          capturedAt,
          receivedCount: rows.length,
          savedCount: mapped.length,
          fingerprint: fingerprintRows(mapped, (row) => `${row.rank}:${row.uid}:${row.cp}`)
        };
      } else {
        const mapped = rows.slice(0, 10).map((row, index) => mapAllianceRow(row, index, this.#session.serverId));
        this.#session.alliances = mapped;
        this.#session.captures.alliances = {
          capturedAt,
          receivedCount: rows.length,
          savedCount: mapped.length,
          fingerprint: fingerprintRows(mapped, (row) => `${row.rank}:${row.aid}:${row.cp}`)
        };
      }
      this.#session.serverContext = context;
      this.#session.validation = validateTop100Session(this.#session);
      this.#session = await this.#repository.save(this.#session);
      this.#logger.info(`${kind === "players" ? "개인" : "길드"} 랭킹 캡처`, {
        count: rows.length,
        fingerprint: this.#session.captures[kind].fingerprint
      });
      return { kind, session: this.#session };
    }
    async collectRanksAutomatically({ signal } = {}) {
      if (!this.#session) throw new TopWarError("SESSION_MISSING", "TOP100 세션을 먼저 시작하세요.");
      const steps = [
        { kind: "players", required: 100, label: "개인" },
        { kind: "alliances", required: 10, label: "길드" }
      ];
      for (const step of steps) {
        if (signal?.aborted) throw new TopWarError("TASK_ABORTED", "작업이 중지되었습니다.");
        this.#logger.info(`${step.label} 랭킹 자동 열기`);
        await this.#adapter.openRank(step.kind, { signal });
        try {
          const loaded = await this.#adapter.waitForRankRows(step.kind, step.required, { signal });
          this.#logger.info(`${step.label} 랭킹 데이터 로드`, {
            count: loaded.count,
            elapsedMs: loaded.elapsedMs
          });
          await this.captureActiveRank();
        } finally {
          await this.#adapter.closeRank(step.kind, { signal });
        }
      }
      return this.validate();
    }
    async validate(options = {}) {
      if (!this.#session) throw new TopWarError("SESSION_MISSING", "TOP100 세션을 먼저 시작하세요.");
      this.#session.serverContext = this.#adapter.detectServerContext(this.#session.serverId);
      this.#session.validation = validateTop100Session(this.#session, options);
      this.#session = await this.#repository.save(this.#session);
      return this.#session.validation;
    }
    async upload({ signal } = {}) {
      if (!this.#session) throw new TopWarError("SESSION_MISSING", "TOP100 세션을 먼저 시작하세요.");
      const validation = await this.validate();
      if (!validation.ok) {
        throw new TopWarError(
          "TOP100_VALIDATION_FAILED",
          "검증에 실패하여 DataHub 전송을 차단했습니다.",
          validation
        );
      }
      try {
        if (!this.#session.upload.serverAcknowledged) {
          const payload = buildTop100Payload(this.#session);
          const result = await this.#uploader.uploadServer(
            payload,
            this.#session.requestIds.server,
            { signal }
          );
          this.#session.upload.serverAcknowledged = true;
          this.#session.upload.serverResponse = result.response;
          this.#session.upload.serverAcknowledgedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.#session.upload.lastError = null;
          this.#session = await this.#repository.save(this.#session);
          this.#logger.info("TOP100 서버 데이터 ACK 수신", { serverId: this.#session.serverId });
        }
        if (!this.#session.upload.completed) {
          const result = await this.#uploader.completeBatch(
            { batchId: this.#session.batchId, expectedServers: 1 },
            this.#session.requestIds.complete,
            { signal }
          );
          this.#session.upload.completed = true;
          this.#session.upload.completeResponse = result.response;
          this.#session.upload.completedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.#session.upload.lastError = null;
          this.#session = await this.#repository.save(this.#session);
          this.#logger.info("TOP100 배치 완료 ACK 수신", { batchId: this.#session.batchId });
        }
        return this.#session.upload;
      } catch (error) {
        this.#session.upload.lastError = {
          at: (/* @__PURE__ */ new Date()).toISOString(),
          code: error?.code || "UPLOAD_FAILED",
          message: error?.message || String(error),
          details: error?.details || null
        };
        this.#session = await this.#repository.save(this.#session);
        throw error;
      }
    }
    payload() {
      if (!this.#session) throw new TopWarError("SESSION_MISSING", "TOP100 세션을 먼저 시작하세요.");
      return buildTop100Payload(this.#session);
    }
    async sessions() {
      return this.#repository.list();
    }
  };

  // src/core/download.js
  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }

  // src/app/styles.js
  var STYLES = `
#twu-alpha-root {
  position: fixed;
  top: 72px;
  right: 16px;
  z-index: 2147483647;
  width: 390px;
  max-height: calc(100vh - 88px);
  overflow: auto;
  color: #e5e7eb;
  background: rgba(15, 23, 42, .97);
  border: 1px solid #334155;
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .45);
  font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#twu-alpha-root * { box-sizing: border-box; }
#twu-alpha-root button, #twu-alpha-root input {
  font: inherit;
}
#twu-alpha-root button {
  border: 1px solid #475569;
  border-radius: 7px;
  padding: 7px 9px;
  color: #f8fafc;
  background: #1e293b;
  cursor: pointer;
}
#twu-alpha-root button:hover { background: #334155; }
#twu-alpha-root button:disabled { opacity: .45; cursor: not-allowed; }
#twu-alpha-root button[data-variant="primary"] { background: #2563eb; border-color: #3b82f6; }
#twu-alpha-root button[data-variant="danger"] { background: #991b1b; border-color: #dc2626; }
#twu-alpha-root input {
  min-width: 0;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid #475569;
  border-radius: 7px;
  color: #f8fafc;
  background: #0f172a;
}
#twu-alpha-root .twu-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #111827;
  border-bottom: 1px solid #334155;
}
#twu-alpha-root .twu-title { font-weight: 800; letter-spacing: .02em; }
#twu-alpha-root .twu-body { padding: 10px; display: grid; gap: 9px; }
#twu-alpha-root.twu-collapsed .twu-body { display: none; }
#twu-alpha-root .twu-section {
  padding: 10px;
  border: 1px solid #334155;
  border-radius: 9px;
  background: rgba(30, 41, 59, .55);
}
#twu-alpha-root .twu-section h3 { margin: 0 0 8px; font-size: 12px; color: #93c5fd; }
#twu-alpha-root .twu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#twu-alpha-root .twu-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
#twu-alpha-root .twu-field { display: grid; gap: 4px; margin-bottom: 6px; }
#twu-alpha-root .twu-field label { color: #94a3b8; }
#twu-alpha-root .twu-status { white-space: pre-wrap; word-break: break-word; color: #cbd5e1; }
#twu-alpha-root .twu-status[data-tone="error"] { color: #fca5a5; }
#twu-alpha-root .twu-status[data-tone="success"] { color: #86efac; }
#twu-alpha-root .twu-status[data-tone="warning"] { color: #fde68a; }
#twu-alpha-root .twu-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 7px; }
#twu-alpha-root .twu-metric { padding: 6px; border-radius: 6px; background: #0f172a; text-align: center; }
#twu-alpha-root .twu-metric strong { display: block; font-size: 15px; }
#twu-alpha-root .twu-logs { max-height: 130px; overflow: auto; display: grid; gap: 4px; }
#twu-alpha-root .twu-log { padding: 4px 6px; border-left: 2px solid #64748b; background: #0f172a; }
#twu-alpha-root .twu-log[data-level="error"] { border-color: #ef4444; }
#twu-alpha-root .twu-log[data-level="warn"] { border-color: #f59e0b; }
#twu-alpha-root .twu-log[data-level="info"] { border-color: #3b82f6; }
`;

  // src/app/panel.js
  function element(id) {
    return document.getElementById(id);
  }
  function formatError(error) {
    const code = error?.code ? `[${error.code}] ` : "";
    return `${code}${error?.message || String(error)}`;
  }
  var UnifiedPanel = class {
    #runtime;
    #root = null;
    #style = null;
    #abort = new AbortController();
    #lastInspection = null;
    constructor(runtime) {
      this.#runtime = runtime;
    }
    mount() {
      this.destroy();
      this.#abort = new AbortController();
      this.#style = document.createElement("style");
      this.#style.id = "twu-alpha-style";
      this.#style.textContent = STYLES;
      document.head.append(this.#style);
      this.#root = document.createElement("section");
      this.#root.id = "twu-alpha-root";
      this.#root.innerHTML = `
      <header class="twu-header">
        <div><span class="twu-title">TopWar Unified</span> <small>α 0.1</small></div>
        <div class="twu-grid">
          <button id="twu-stop" data-variant="danger" title="현재 작업 중지">중지</button>
          <button id="twu-collapse" title="Alt+Shift+T">접기</button>
        </div>
      </header>
      <div class="twu-body">
        <div class="twu-section">
          <h3>런타임</h3>
          <div id="twu-runtime-status" class="twu-status">준비</div>
        </div>

        <div class="twu-section">
          <h3>UI 탐색기</h3>
          <div class="twu-grid">
            <button id="twu-inspect">현재 UI 조사</button>
            <button id="twu-inspect-download" disabled>조사 JSON 저장</button>
          </div>
          <div id="twu-inspect-status" class="twu-status">아직 조사하지 않았습니다.</div>
        </div>

        <div class="twu-section">
          <h3>TOP100 안전 수집</h3>
          <div class="twu-field">
            <label for="twu-server-id">현재 열린 전투 지역 서버번호</label>
            <input id="twu-server-id" type="number" min="1" placeholder="예: 3223">
          </div>
          <div class="twu-grid">
            <button id="twu-session-start" data-variant="primary">세션 시작</button>
            <button id="twu-rank-capture">현재 랭킹 캡처</button>
            <button id="twu-ranks-auto" data-variant="primary">두 랭킹 자동 수집</button>
            <button id="twu-validate">검증</button>
            <button id="twu-export">JSON 저장</button>
          </div>
          <div id="twu-session-status" class="twu-status">Theater 화면에서 서버를 확인한 뒤 시작하세요.</div>
          <div class="twu-metrics">
            <div class="twu-metric"><strong id="twu-player-count">0</strong>개인</div>
            <div class="twu-metric"><strong id="twu-alliance-count">0</strong>길드</div>
            <div class="twu-metric"><strong id="twu-error-count">0</strong>오류</div>
          </div>
        </div>

        <div class="twu-section">
          <h3>DataHub</h3>
          <div class="twu-field"><label>Base URL</label><input id="twu-datahub-url"></div>
          <div class="twu-grid">
            <div class="twu-field"><label>조사기 ID</label><input id="twu-datahub-scanner"></div>
            <div class="twu-field"><label>Token (메모리에만 보관)</label><input id="twu-datahub-token" type="password"></div>
          </div>
          <div class="twu-grid">
            <button id="twu-datahub-config">설정 적용</button>
            <button id="twu-upload" data-variant="primary">검증 후 전송</button>
          </div>
          <div id="twu-upload-status" class="twu-status">미설정</div>
        </div>

        <div class="twu-section">
          <h3>실행 로그</h3>
          <div id="twu-logs" class="twu-logs"></div>
        </div>
      </div>
    `;
      (document.body || document.documentElement).append(this.#root);
      this.#bind();
      this.#fillSettings();
      this.render();
      return this;
    }
    destroy() {
      this.#abort.abort();
      this.#root?.remove();
      this.#style?.remove();
      this.#root = null;
      this.#style = null;
    }
    toggle() {
      this.#root?.classList.toggle("twu-collapsed");
      const button = element("twu-collapse");
      if (button) button.textContent = this.#root?.classList.contains("twu-collapsed") ? "펼치기" : "접기";
    }
    render() {
      if (!this.#root) return;
      const task = this.#runtime.tasks.state;
      const runtimeStatus = element("twu-runtime-status");
      runtimeStatus.textContent = task.status === "idle" ? "대기 중" : `${task.status} · ${task.taskId} · ${task.startedAt}`;
      element("twu-stop").disabled = task.status === "idle";
      const session = this.#runtime.top100.current;
      element("twu-player-count").textContent = String(session?.players?.length || 0);
      element("twu-alliance-count").textContent = String(session?.alliances?.length || 0);
      element("twu-error-count").textContent = String(session?.validation?.errors?.length || 0);
      const sessionStatus = element("twu-session-status");
      if (!session) {
        sessionStatus.textContent = "Theater 화면에서 서버를 확인한 뒤 시작하세요.";
        sessionStatus.dataset.tone = "";
      } else {
        const validation = session.validation;
        const state = validation?.ok ? "검증 통과" : validation ? `검증 실패: ${validation.errors.map((row) => row.code).join(", ") || "경고만 있음"}` : "수집 대기";
        sessionStatus.textContent = `${session.serverId} 서버 · ${state}
${session.runId}`;
        sessionStatus.dataset.tone = validation?.ok ? "success" : validation ? "error" : "warning";
      }
      const uploadStatus = element("twu-upload-status");
      const uploader = this.#runtime.uploader.status();
      const uploaded = session?.upload;
      uploadStatus.textContent = uploaded?.completed ? "서버 ACK 및 배치 완료 ACK 수신" : uploaded?.serverAcknowledged ? "서버 ACK 수신 · 배치 완료 재시도 필요" : uploader.configured ? `${uploader.scannerId} · Token 메모리 설정됨` : "조사기 ID와 Token을 설정하세요.";
      uploadStatus.dataset.tone = uploaded?.completed ? "success" : uploader.configured ? "warning" : "";
      this.#renderLogs();
    }
    #bind() {
      const signal = this.#abort.signal;
      const on = (id, event, listener) => element(id).addEventListener(event, listener, { signal });
      const run = async (taskId, work, statusId = "twu-runtime-status") => {
        try {
          await this.#runtime.tasks.run(taskId, work);
          const status = element(statusId);
          if (status) status.dataset.tone = "success";
        } catch (error) {
          const status = element(statusId);
          if (status) {
            status.textContent = formatError(error);
            status.dataset.tone = "error";
          }
        } finally {
          this.render();
        }
      };
      on("twu-collapse", "click", () => this.toggle());
      on("twu-stop", "click", () => this.#runtime.tasks.stop("panel"));
      on("twu-inspect", "click", () => run("ui-inspection", async () => {
        this.#lastInspection = this.#runtime.adapter.snapshot();
        const summary = this.#lastInspection.totals;
        const known = this.#lastInspection.knownComponents;
        element("twu-inspect-status").textContent = `화면 ${this.#lastInspection.activeScreen} · 노드 ${summary.nodes}, 컴포넌트 ${summary.components}, 버튼 ${summary.buttons}
` + Object.entries(known).map(([name, count]) => `${name}: ${count.active}/${count.total}`).join("\n");
        element("twu-inspect-download").disabled = false;
      }, "twu-inspect-status"));
      on("twu-inspect-download", "click", () => {
        if (this.#lastInspection) {
          const screen = this.#lastInspection.activeScreen || "scene";
          downloadJson(`topwar-ui-${screen}-${Date.now()}.json`, this.#lastInspection);
        }
      });
      on("twu-session-start", "click", () => run("top100-session-start", async () => {
        await this.#runtime.top100.start(element("twu-server-id").value);
      }, "twu-session-status"));
      on("twu-rank-capture", "click", () => run("top100-rank-capture", async () => {
        const result = await this.#runtime.top100.captureActiveRank();
        element("twu-session-status").textContent = `${result.kind === "players" ? "개인" : "길드"} 랭킹을 캡처했습니다.`;
      }, "twu-session-status"));
      on("twu-ranks-auto", "click", () => run("top100-ranks-auto", async ({ signal: signal2 }) => {
        const validation = await this.#runtime.top100.collectRanksAutomatically({ signal: signal2 });
        element("twu-session-status").textContent = validation.ok ? "개인·길드 랭킹 자동 수집 및 검증 완료" : validation.errors.map((row) => `[${row.code}] ${row.message}`).join("\n");
      }, "twu-session-status"));
      on("twu-validate", "click", () => run("top100-validation", async () => {
        const result = await this.#runtime.top100.validate();
        element("twu-session-status").textContent = result.ok ? "검증을 통과했습니다." : result.errors.map((row) => `[${row.code}] ${row.message}`).join("\n");
      }, "twu-session-status"));
      on("twu-export", "click", () => {
        try {
          const payload = this.#runtime.top100.payload();
          downloadJson(`top100-${payload.serverId}-${Date.now()}.json`, payload);
        } catch (error) {
          element("twu-session-status").textContent = formatError(error);
          element("twu-session-status").dataset.tone = "error";
        }
      });
      on("twu-datahub-config", "click", () => {
        this.#runtime.uploader.configure({
          baseUrl: element("twu-datahub-url").value,
          scannerId: element("twu-datahub-scanner").value,
          token: element("twu-datahub-token").value
        });
        element("twu-datahub-token").value = "";
        this.render();
      });
      on("twu-upload", "click", () => run("top100-upload", async ({ signal: signal2 }) => {
        await this.#runtime.top100.upload({ signal: signal2 });
      }, "twu-upload-status"));
      document.addEventListener("keydown", (event) => {
        if (event.altKey && event.shiftKey && event.code === "KeyT") {
          event.preventDefault();
          this.toggle();
        }
      }, { signal });
      this.#runtime.bus.on("task:changed", () => this.render());
      this.#runtime.bus.on("logs:changed", () => this.#renderLogs());
    }
    #fillSettings() {
      const settings = this.#runtime.uploader.publicSettings();
      element("twu-datahub-url").value = settings.baseUrl;
      element("twu-datahub-scanner").value = settings.scannerId;
    }
    #renderLogs() {
      const container = element("twu-logs");
      if (!container) return;
      const rows = this.#runtime.logger.rows.slice(-30).reverse();
      container.replaceChildren(...rows.map((row) => {
        const item = document.createElement("div");
        item.className = "twu-log";
        item.dataset.level = row.level;
        item.textContent = `${row.at.slice(11, 19)} ${row.message}`;
        item.title = row.details ? JSON.stringify(row.details, null, 2) : "";
        return item;
      }));
    }
  };

  // src/main.js
  function createRuntime() {
    const bus = new EventBus();
    const logger = new Logger(bus);
    const adapter = new CocosAdapter();
    const repository = new Top100Repository();
    const uploader = new DataHubTop100Uploader();
    const tasks = new TaskRunner({ bus, logger });
    const top100 = new Top100Service({ adapter, repository, uploader, logger });
    return {
      version: "0.1.0",
      bus,
      logger,
      adapter,
      repository,
      uploader,
      tasks,
      top100,
      validateTop100Session,
      panel: null,
      destroy() {
        tasks.stop("runtime-destroy");
        this.panel?.destroy();
        bus.clear();
        delete globalThis.TOPWAR_UNIFIED;
        delete globalThis.__TOPWAR_UNIFIED_ALPHA__;
      }
    };
  }
  function boot() {
    if (globalThis.__TOPWAR_UNIFIED_ALPHA__) {
      console.warn("[TopWar Unified] already installed");
      return globalThis.TOPWAR_UNIFIED;
    }
    globalThis.__TOPWAR_UNIFIED_ALPHA__ = true;
    const runtime = createRuntime();
    runtime.panel = new UnifiedPanel(runtime).mount();
    globalThis.TOPWAR_UNIFIED = runtime;
    runtime.logger.info("TopWar Unified Alpha 설치 완료", { version: runtime.version });
    return runtime;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
