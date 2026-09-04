// ==UserScript==
// @name         TopWar Unified Automation V2.14.9.2 - Live 901 Reward Capture
// @namespace    topwar-unified-automation-v2104-thief-share-ui-log-control
// @version      2.14.9.2
// @description  Unified TopWar map/thief/reward survey + RealPower ranking survey with UID-based map movement detection
// @match        https://h5.topwargame.com/*
// @match        https://h5v2.topwargame.com/*
// @match        https://*.topwargame.com/*
// @match        https://*.topwarapp.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* ============================================================================
 * TopWar DataHub client
 * - All scanners upload to the central Spring Boot server.
 * - Failed requests are retained in IndexedDB and retried before later uploads.
 * ========================================================================== */
(function installTopWarDataHubClient() {
  "use strict";

  if (window.TOPWAR_DATAHUB?.version) return;

  const SETTINGS_KEY = "TOPWAR_DATAHUB_SETTINGS_V1";
  const DB_NAME = "topwar-datahub-upload-queue";
  const DB_VERSION = 2;
  const STORE_NAME = "requests";
  const UID_SERVER_STORE_NAME = "uidServers";
  const DEFAULT_BASE_URL = "https://datahub.progamer.info";
  const ENDPOINTS = Object.freeze({
    cityRewards: "/api/v1/city-rewards/server",
    thieves: "/api/v1/thieves/detected",
    map: "/api/v1/map/server",
    top100: "/api/v1/top100/server",
    top100Complete: "/api/v1/top100/complete"
  });
  let requestChain = Promise.resolve();

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return {
        baseUrl: String(saved.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
        scannerId: String(saved.scannerId || "").trim(),
        key: String(saved.key || "").trim()
      };
    } catch {
      return { baseUrl: DEFAULT_BASE_URL, scannerId: "", key: "" };
    }
  }

  function configure(next = {}) {
    const current = readSettings();
    const settings = {
      baseUrl: String(next.baseUrl ?? current.baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, ""),
      scannerId: String(next.scannerId ?? current.scannerId ?? "").trim(),
      key: String(next.key ?? current.key ?? "").trim()
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

    // 콘솔이나 다른 기능에서 설정을 변경한 뒤, 패널의 오래된 값이 다시 저장되는 것을 막는다.
    const scannerIdInput = document.getElementById("tw26-datahub-scanner-id");
    const keyInput = document.getElementById("tw26-github-token");
    if (scannerIdInput && scannerIdInput.value !== settings.scannerId) {
      scannerIdInput.value = settings.scannerId;
    }
    if (keyInput && keyInput.value !== settings.key) {
      keyInput.value = settings.key;
    }

    window.dispatchEvent(new CustomEvent("topwar:datahub-settings-changed", {
      detail: {
        baseUrl: settings.baseUrl,
        scannerId: settings.scannerId,
        configured: !!(settings.scannerId && settings.key)
      }
    }));
    return status();
  }

  function promptConfigure() {
    const current = readSettings();
    const baseUrl = prompt("DataHub 주소", current.baseUrl || DEFAULT_BASE_URL);
    if (baseUrl == null) return false;
    const scannerId = prompt("조사기 ID (서버의 scanner-keys 이름)", current.scannerId || "city-01");
    if (scannerId == null) return false;
    const key = prompt("조사기 API 키", current.key || "");
    if (key == null) return false;
    configure({ baseUrl, scannerId, key });
    return true;
  }

  function requireSettings(interactive = true) {
    let settings = readSettings();
    if ((!settings.scannerId || !settings.key) && interactive) {
      promptConfigure();
      settings = readSettings();
    }
    if (!settings.baseUrl) throw new Error("DataHub 주소가 없습니다.");
    if (!settings.scannerId) throw new Error("DataHub 조사기 ID가 없습니다.");
    if (!settings.key) throw new Error("DataHub 조사기 API 키가 없습니다.");
    return settings;
  }

  function requestId() {
    return crypto.randomUUID?.() || `tw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openQueueDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "requestId" });
        }
        if (!db.objectStoreNames.contains(UID_SERVER_STORE_NAME)) {
          db.createObjectStore(UID_SERVER_STORE_NAME, { keyPath: "uid" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("DataHub queue DB open failed"));
    });
  }

  async function queuePut(row) {
    const db = await openQueueDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);

        // 같은 조사 단위의 실패 요청은 최신 스냅샷 하나만 남긴다.
        // 지도/Top100처럼 큰 payload가 통신 장애 중 계속 쌓여 브라우저 메모리를
        // 고갈시키는 것을 방지한다.
        if (row.queueKey) {
          const cursorRequest = store.openCursor();
          cursorRequest.onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) {
              store.put(row);
              return;
            }
            const existingQueueKey = cursor.value?.queueKey ||
              queueKeyFor(cursor.value?.type, cursor.value?.payload);
            if (existingQueueKey === row.queueKey && cursor.value?.requestId !== row.requestId) {
              cursor.delete();
            }
            cursor.continue();
          };
          cursorRequest.onerror = () => reject(cursorRequest.error);
        } else {
          store.put(row);
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function queueDelete(id) {
    const db = await openQueueDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function queueList(limit = 50) {
    const db = await openQueueDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const rows = [];
        const maximum = Math.max(1, Number(limit) || 50);
        const request = tx.objectStore(STORE_NAME).openCursor();
        request.onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor || rows.length >= maximum) {
            resolve(rows);
            return;
          }
          rows.push(cursor.value);
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async function queueCount() {
    const db = await openQueueDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).count();
        request.onsuccess = () => resolve(Number(request.result || 0));
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  function movementText(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  }

  function movementNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function movementUid(player) {
    return movementText(player?.uid ?? player?.pid ?? player?.userId ?? player?.playerId);
  }

  function movementSnapshot(player, fallbackServerId, observedAt) {
    const snapshot = {
      uid: movementUid(player),
      nickname: movementText(player?.nickname ?? player?.username ?? player?.name),
      server: movementNumber(player?.serverId ?? player?.server ?? fallbackServerId),
      rank: movementNumber(player?.rank),
      score: movementNumber(player?.score ?? player?.cp ?? player?.power),
      level: movementNumber(player?.level),
      allianceId: movementText(player?.allianceId ?? player?.aid),
      allianceTag: movementText(player?.allianceTag ?? player?.a_tag),
      allianceName: movementText(player?.allianceName ?? player?.a_name),
      observedAt
    };
    return Object.fromEntries(
      Object.entries(snapshot).filter(([, value]) => value !== null && value !== "")
    );
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  async function enrichMapPayloadWithUidMovements(payload) {
    const serverId = movementNumber(payload?.serverId ?? payload?.summary?.serverId);
    const players = Array.isArray(payload?.players) ? payload.players : [];
    if (!Number.isFinite(serverId) || !players.length) return payload;

    const detectedAt = String(payload?.exportedAt || new Date().toISOString());
    const db = await openQueueDb();
    const movementEvents = [];
    const eventKeys = new Set();

    try {
      const tx = db.transaction(UID_SERVER_STORE_NAME, "readwrite");
      const store = tx.objectStore(UID_SERVER_STORE_NAME);

      for (const player of players) {
        const uid = movementUid(player);
        if (!uid) continue;

        const current = movementSnapshot(player, serverId, detectedAt);
        const previous = await idbRequest(store.get(uid));
        const previousServer = movementNumber(previous?.server);
        const currentServer = movementNumber(current.server);

        // power/movement와 동일하게 동일 UID가 다른 서버에서 실제 관측된 경우만 기록한다.
        // 한 서버에서 보이지 않는다는 사실만으로는 OUT 또는 서버이동으로 판단하지 않는다.
        if (
          previous &&
          Number.isFinite(previousServer) &&
          Number.isFinite(currentServer) &&
          previousServer !== currentServer
        ) {
          const key = `${uid}|${previousServer}|${currentServer}`;
          if (!eventKeys.has(key)) {
            eventKeys.add(key);
            movementEvents.push({
              detectedAt,
              uid,
              nickname: current.nickname ?? previous.nickname ?? null,
              fromServer: previousServer,
              toServer: currentServer,
              from: Object.fromEntries(
                Object.entries(previous).filter(([key, value]) => key !== "lastSeenAt" && value != null && value !== "")
              ),
              to: current
            });
          }
        }

        store.put({
          ...previous,
          ...current,
          uid,
          server: currentServer,
          firstSeenAt: previous?.firstSeenAt || detectedAt,
          lastSeenAt: detectedAt
        });
      }

      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("UID movement transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("UID movement transaction aborted"));
      });
    } finally {
      db.close();
    }

    movementEvents.sort((a, b) =>
      Number(a.fromServer) - Number(b.fromServer) ||
      Number(a.toServer) - Number(b.toServer) ||
      String(a.uid).localeCompare(String(b.uid))
    );

    return {
      ...payload,
      movementTracking: {
        version: 1,
        mode: "uid-cross-server",
        detectedAt,
        eventCount: movementEvents.length
      },
      movementEvents,
      summary: {
        ...(payload?.summary || {}),
        movementEvents: movementEvents.length
      }
    };
  }

  function queueKeyFor(type, payload) {
    const serverId = Number(payload?.serverId);
    const batchId = String(payload?.batchId || "").trim();
    if (type === "map" && Number.isFinite(serverId)) return `map:${serverId}`;
    if (type === "cityRewards" && Number.isFinite(serverId)) return `cityRewards:${serverId}`;
    if (type === "thieves" && Number.isFinite(serverId)) return `thieves:${serverId}`;
    if (type === "top100" && batchId && Number.isFinite(serverId)) return `top100:${batchId}:${serverId}`;
    if (type === "top100Complete" && batchId) return `top100Complete:${batchId}`;
    return null;
  }

  async function sendRow(row, settings = requireSettings(false)) {
    const response = await fetch(`${settings.baseUrl}${row.endpoint}`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.key}`,
        "X-Scanner-Id": settings.scannerId,
        "X-Request-Id": row.requestId
      },
      body: JSON.stringify(row.payload)
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const error = new Error(`DataHub HTTP ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function flushQueuedInternal(limit = 50) {
    const settings = requireSettings(false);
    const rows = (await queueList(limit))
      .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0))
      .slice(0, Math.max(1, Number(limit) || 50));
    let sent = 0;
    for (const row of rows) {
      try {
        await sendRow(row, settings);
        await queueDelete(row.requestId);
        sent++;
      } catch (error) {
        const status = Number(error?.status);
        // payload 자체가 잘못된 요청은 다시 보내도 성공하지 않는다.
        // 영구 실패 행 하나가 전체 대기열을 영원히 막지 않도록 폐기한다.
        if ([400, 404, 413, 422].includes(status)) {
          await queueDelete(row.requestId);
          console.warn("[TopWar DataHub] permanent queued request discarded:", {
            status,
            type: row.type,
            queueKey: row.queueKey,
            requestId: row.requestId
          });
          continue;
        }
        if (status === 401 || status === 403) throw error;
        break;
      }
    }
    return { ok: true, queued: rows.length, sent };
  }

  function flushQueued(limit = 50) {
    const next = requestChain.catch(() => null).then(() => flushQueuedInternal(limit));
    requestChain = next;
    return next;
  }

  function upload(type, payload, options = {}) {
    const endpoint = ENDPOINTS[type];
    if (!endpoint) return Promise.reject(new Error(`Unknown DataHub dataset: ${type}`));
    const next = requestChain.catch(() => null).then(async () => {
      const settings = requireSettings(options.interactive !== false);
      if (options.flushFirst !== false) {
        try { await flushQueuedInternal(options.flushLimit ?? 20); }
        catch (error) { console.warn("[TopWar DataHub] pending flush failed:", error); }
      }
      const row = {
        requestId: options.requestId || requestId(),
        endpoint,
        type,
        queueKey: queueKeyFor(type, payload),
        payload,
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now()
      };
      try {
        const response = await sendRow(row, settings);
        return { ok: true, type, requestId: row.requestId, response };
      } catch (error) {
        if (![400, 401, 403, 404, 413, 422].includes(Number(error?.status))) {
          await queuePut({ ...row, error: error?.message || String(error) });
          return { ok: false, queued: true, type, requestId: row.requestId, error: error?.message || String(error) };
        }
        throw error;
      }
    });
    requestChain = next;
    return next;
  }

  async function status() {
    const settings = readSettings();
    let queued = null;
    try { queued = await queueCount(); } catch {}
    return {
      version: "1.1.0",
      baseUrl: settings.baseUrl,
      scannerId: settings.scannerId,
      configured: !!(settings.scannerId && settings.key),
      queued
    };
  }

  window.TOPWAR_DATAHUB = {
    version: "1.1.0",
    endpoints: ENDPOINTS,
    configure,
    promptConfigure,
    readSettings,
    status,
    flushQueued,
    upload,
    uploadCityRewards: payload => upload("cityRewards", payload),
    uploadThieves: payload => upload("thieves", payload),
    uploadMap: async payload => upload("map", await enrichMapPayloadWithUidMovements(payload)),
    uploadTop100: payload => upload("top100", payload),
    completeTop100: payload => upload("top100Complete", payload)
  };
})();

// Enriched player data patch: V1.5 - legacy fields preserved, raw 901/playerInfo retained.

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // V2.11.6 storage bootstrap
  // - GitHub PAT는 소스 코드/일반 설정 JSON과 분리하여 전용 localStorage 키에만 저장한다.
  // - 이전 버전 settings.token은 최초 1회 마이그레이션 후 제거한다.
  // - 이 스크립트가 만든 오래된 localStorage/sessionStorage만 최초 1회 정리한다.
  //   게임 자체 저장 데이터는 건드리지 않는다.
  // -----------------------------------------------------------------------
  const TOPWAR_GITHUB_TOKEN_STORAGE_KEY = "TOPWAR_GITHUB_TOKEN";
  const TOPWAR_GITHUB_SETTINGS_STORAGE_KEY = "TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS";
  const TOPWAR_STORAGE_CLEANUP_MARKER = "TOPWAR_STORAGE_CLEANUP_V2116_DONE";

  function readRawGithubToken() {
    try {
      return String(localStorage.getItem(TOPWAR_GITHUB_TOKEN_STORAGE_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function writeRawGithubToken(token) {
    const value = String(token ?? "").trim();
    try {
      if (value) localStorage.setItem(TOPWAR_GITHUB_TOKEN_STORAGE_KEY, value);
      else localStorage.removeItem(TOPWAR_GITHUB_TOKEN_STORAGE_KEY);
    } catch (error) {
      console.error("[TopWar GitHub] token localStorage 저장 실패:", error);
      return "";
    }
    return value;
  }

  function migrateLegacyGithubToken() {
    if (readRawGithubToken()) return readRawGithubToken();
    try {
      const legacy = JSON.parse(localStorage.getItem(TOPWAR_GITHUB_SETTINGS_STORAGE_KEY) || "{}");
      const token = String(legacy?.token || "").trim();
      if (token) writeRawGithubToken(token);
      return token;
    } catch {
      return "";
    }
  }

  function cleanupTopwarStorageOnce() {
    try {
      if (localStorage.getItem(TOPWAR_STORAGE_CLEANUP_MARKER) === "1") return false;

      const migratedToken = migrateLegacyGithubToken();
      const removed = [];
      const keep = new Set([
        TOPWAR_GITHUB_TOKEN_STORAGE_KEY,
        "TOPWAR_DATAHUB_SETTINGS_V1",
        TOPWAR_STORAGE_CLEANUP_MARKER
      ]);

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || keep.has(key)) continue;
        if (key.startsWith("TOPWAR_") || key.startsWith("topwar-")) {
          localStorage.removeItem(key);
          removed.push(key);
        }
      }

      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (!key) continue;
          if (key.startsWith("TOPWAR_") || key.startsWith("topwar-")) {
            sessionStorage.removeItem(key);
          }
        }
      } catch {}

      if (migratedToken) writeRawGithubToken(migratedToken);
      localStorage.setItem(TOPWAR_STORAGE_CLEANUP_MARKER, "1");
      console.log("[TopWar] V2.11.6 기존 스크립트 저장 데이터 최초 정리 완료", {
        removedCount: removed.length,
        tokenMigrated: !!migratedToken
      });
      return true;
    } catch (error) {
      console.warn("[TopWar] 기존 localStorage 정리 실패:", error);
      return false;
    }
  }

  cleanupTopwarStorageOnce();

  function installTopwarConsoleControl() {
    const INSTALL_KEY = "__TOPWAR_CONSOLE_CONTROL_V1__";
    const STORAGE_KEY = "TOPWAR_CONSOLE_CONTROL_SETTINGS";

    if (window[INSTALL_KEY]?.installed) return window[INSTALL_KEY];

    const original = {};
    for (const method of ["log", "info", "warn", "error", "debug", "table"]) {
      original[method] = typeof console?.[method] === "function"
        ? console[method].bind(console)
        : () => {};
    }

    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {}

    const control = {
      installed: true,
      storageKey: STORAGE_KEY,
      programLogs: saved.programLogs !== false,
      // false면 Cocos 비트맵 폰트 아틀라스 도배 경고만 숨긴다.
      gameFontWarnings: saved.gameFontWarnings === true,
      original,

      save() {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            programLogs: this.programLogs,
            gameFontWarnings: this.gameFontWarnings
          }));
        } catch {}
        return this.status();
      },

      status() {
        return {
          programLogs: !!this.programLogs,
          gameFontWarnings: !!this.gameFontWarnings
        };
      },

      setProgramLogsEnabled(enabled = true) {
        this.programLogs = !!enabled;
        return this.save();
      },

      setGameFontWarningsEnabled(enabled = true) {
        this.gameFontWarnings = !!enabled;
        return this.save();
      },

      isBitmapFontAtlasNoise(args) {
        const text = args.map(value => {
          if (typeof value === "string") return value;
          try { return JSON.stringify(value); } catch { return String(value); }
        }).join(" ");

        return text.includes("Can't find letter definition in texture atlas") &&
               text.includes("numBlack.png");
      },

      isTopwarProgramLog(args) {
        return args.some(value => {
          if (typeof value !== "string") return false;
          const text = value.replace(/^%c/, "");
          return text.includes("[TopWar") ||
                 text.includes("[TOPWAR") ||
                 text.includes("🚨 133 발견") ||
                 text.includes("🚨 도둑 발견");
        });
      },

      shouldSuppress(args) {
        if (!this.gameFontWarnings && this.isBitmapFontAtlasNoise(args)) return true;
        if (!this.programLogs && this.isTopwarProgramLog(args)) return true;
        return false;
      },

      table(...args) {
        if (!this.programLogs) return;
        this.original.table(...args);
      }
    };

    for (const method of ["log", "info", "warn", "error", "debug"]) {
      console[method] = (...args) => {
        if (control.shouldSuppress(args)) return;
        control.original[method](...args);
      };
    }

    window[INSTALL_KEY] = control;
    window.TOPWAR_LOG_CONTROL = control;
    return control;
  }

  const topwarLogControl = installTopwarConsoleControl();

  const VERSION = "2.13.3-datahub-settings-fix";
  const INSTALL_KEY = "__TOPWAR_UNIFIED_SCANNER_V23_AUTO_SHARE__";

  if (window[INSTALL_KEY]) {
    console.warn("[TopWar] V2.8 Clean already installed");
    return;
  }
  window[INSTALL_KEY] = true;

  const OriginalWebSocket = window.WebSocket;
  const originalSend = OriginalWebSocket?.prototype?.send;

  const state = {
    version: VERSION,
    sockets: [],
    recentPackets: [],
    recentOutgoing: [],
    // 901은 pointList 전체를 포함하므로 몇 개만 남겨도 매우 클 수 있다.
    // 보상은 playerMap을 1차 소스로 사용하므로 fallback 원본은 최근 2개만 유지한다.
    maxRecentPackets: 2,
    // 도둑 전용 버퍼. 일반 901 recentPackets / 도시보상 수집과 완전히 분리한다.
    // 901 수신 즉시 pointType=133만 경량 객체로 저장하므로 raw pointList를 붙잡지 않는다.
    thiefBuffer: {
      maxEvents: 512,
      events: [],
      nextEventId: 1,
      activeTargetServerId: null,
      stats: {
        pointList901Received: 0,
        thiefEventsCaptured: 0,
        thievesCaptured: 0,
        collectCalls: 0,
        thievesCollected: 0,
        uploadRequests: 0,
        uploadSuccess: 0,
        uploadFailure: 0,
        githubGetAttempts: 0,
        githubGetSuccess: 0,
        githubPutAttempts: 0,
        githubPutSuccess: 0,
        last901At: null,
        lastThiefCapturedAt: null,
        lastCollectedAt: null,
        lastUploadRequestedAt: null,
        lastUploadSuccessAt: null,
        lastUploadFailureAt: null,
        lastGithubGetAt: null,
        lastGithubPutAt: null,
        lastError: null,
        lastCaptured: null,
        lastCollected: null,
        lastUpload: null
      }
    },
    // 신규 유저가 폭증한 서버에서도 Map이 브라우저 메모리를 끝없이 점유하지 않게 한다.
    maxStoredPlayers: 2000,
    playerLimitReached: false,
    droppedPlayers: 0,
    maxStoredObjects: 3000,
    maxStoredObjectsPerType: 750,
    maxThiefQueue: 200,
    commandCount: new Map(),

    objectMap: new Map(),
    objectsByType: {},
    playerMap: new Map(),
    allianceMap: new Map(),
    allianceRepresentativeMap: new Map(),

    mapCtrlCache: null,
    worldObjectStores: null,

    watch133: {
      running: false,
      paused: false,
      pauseReason: null,
      pauseInfo: null,
      handledKeys: new Set(),
      sharedLocationKeys: new Set(),
      lastFound: null,
      sentMessages: []
    },

    thiefQueue: [],

    pendingThiefShares: [],
    pendingThiefObjectKeys: new Set(),
    sharedThiefObjectKeys: new Set(),
    resolvedThiefObjectKeys: new Set(),
    nextPendingThiefIndex: 1,

    pointTypeNames: {
      1: "유저 기지",
      2: "암흑 부대",
      4: "자원지",
      10: "발사대",
      12: "워해머-4K",
      13: "길드 보루",
      15: "유적(3레벨)",
      18: "난민",
      24: "자원 시설",
      38: "자원지",
      40: "길드 시설",
      53: "분노의 탑",
      74: "암흑 보루",
      82: "제국의 유물",
      133: "보물 탐사선"
    },

    debug: {
      log901: false,
      logDecodeError: false,
      logOutgoing: false,
      logWsAttach: true,
      logNodeSearch: false
    },

    connectionGuard: {
      enabled: true,
      disconnected: false,
      stopping: false,
      reason: null,
      detectedAt: null,
      lastHealthyAt: null,
      lastSocketOpenAt: null,
      lastSocketCloseAt: null,
      lastSocketErrorAt: null,
      lastCloseCode: null,
      lastCloseReason: null,
      consecutiveMoveFailures: 0,
      maxConsecutiveMoveFailures: 5,
      autoStopOnDisconnect: true,
      monitorIntervalMs: 1000,
      overlayKeywords: [
        "서버와의 연결이 실패했습니다",
        "서버 연결에 실패했습니다",
        "연결이 끊어졌습니다",
        "네트워크 연결이 불안정합니다",
        "connection to the server failed",
        "failed to connect to server",
        "server connection failed",
        "disconnected from server",
        "服务器连接失败",
        "与服务器连接失败",
        "サーバーとの接続に失敗しました"
      ]
    }
  };

  const api = {
    state,
    __topwarUnifiedScannerV23AutoShare: true
  };

  // GitHub PAT는 전용 localStorage 키에만 저장한다.
  // 일반 GitHub 설정 JSON에는 token 필드를 저장하지 않는다.
  const GITHUB_SETTINGS_STORAGE_KEY = TOPWAR_GITHUB_SETTINGS_STORAGE_KEY;
  let githubTokenValidationState = {
    checked: false,
    valid: false,
    login: null,
    checkedAt: null,
    error: null
  };
  let githubTokenEnsurePromise = null;

  function readGithubSettingsObject() {
    try {
      const value = JSON.parse(localStorage.getItem(GITHUB_SETTINGS_STORAGE_KEY) || "{}");
      if (!value || typeof value !== "object") return {};
      // 구버전 token 필드는 런타임에서 사용하지 않고 즉시 제거한다.
      if (Object.prototype.hasOwnProperty.call(value, "token")) {
        const legacyToken = String(value.token || "").trim();
        if (!readRawGithubToken() && legacyToken) writeRawGithubToken(legacyToken);
        delete value.token;
        localStorage.setItem(GITHUB_SETTINGS_STORAGE_KEY, JSON.stringify(value));
      }
      return value;
    } catch {
      return {};
    }
  }

  function getGithubToken() {
    return readRawGithubToken();
  }

  function setGithubToken(token) {
    githubTokenValidationState = {
      checked: false,
      valid: false,
      login: null,
      checkedAt: null,
      error: null
    };
    return writeRawGithubToken(token);
  }

  async function validateGithubToken(token = getGithubToken()) {
    const value = String(token ?? "").trim();
    if (!value) {
      return { ok: false, status: 0, reason: "empty token" };
    }

    try {
      const response = await fetch("https://api.github.com/user", {
        method: "GET",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${value}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        cache: "no-store"
      });
      const data = await response.json().catch(() => null);
      return {
        ok: response.ok,
        status: response.status,
        login: data?.login ?? null,
        reason: response.ok ? null : (data?.message || response.statusText || "validation failed")
      };
    } catch (error) {
      return {
        ok: false,
        status: -1,
        networkError: true,
        reason: error?.message || String(error)
      };
    }
  }

  async function validateAndSaveGithubToken(token) {
    const value = String(token ?? "").trim();
    const previousToken = getGithubToken();
    const result = await validateGithubToken(value);
    const definitelyInvalid = Number(result.status) === 401;

    githubTokenValidationState = {
      checked: true,
      valid: result.ok ? true : (definitelyInvalid ? false : null),
      login: result.login ?? null,
      checkedAt: new Date().toISOString(),
      error: result.ok ? null : result.reason
    };

    if (!result.ok) {
      // 401로 현재 저장 토큰 자체가 틀렸음이 확인된 경우에만 삭제한다.
      // 새 후보 토큰 검증 실패나 네트워크/일시 오류에서는 기존 저장 토큰을 보존한다.
      if (definitelyInvalid && value && value === previousToken) {
        writeRawGithubToken("");
      }
      return result;
    }

    writeRawGithubToken(value);
    return result;
  }

  async function ensureGithubToken(options = {}) {
    let settings = window.TOPWAR_DATAHUB?.readSettings?.() || {};
    if ((!settings.scannerId || !settings.key) && options.interactive !== false) {
      window.TOPWAR_DATAHUB?.promptConfigure?.();
      settings = window.TOPWAR_DATAHUB?.readSettings?.() || {};
    }
    return String(settings.key || "");
  }

  function githubTokenStatus() {
    const token = getGithubToken();
    return {
      configured: !!token,
      validated: githubTokenValidationState.checked ? githubTokenValidationState.valid : null,
      login: githubTokenValidationState.login,
      checkedAt: githubTokenValidationState.checkedAt,
      error: githubTokenValidationState.error,
      masked: token ? `${token.slice(0, 4)}...${token.slice(-4)}` : ""
    };
  }

  const previousTopwarApi = window.TOPWAR;
  if (previousTopwarApi && !previousTopwarApi.__topwarUnifiedScannerV23AutoShare) {
    console.warn("[TopWar] 기존 window.TOPWAR를 V2.3 Auto Share API로 교체합니다.", previousTopwarApi);
  }

  try {
    Object.defineProperty(window, "TOPWAR", {
      value: api,
      configurable: true,
      writable: true
    });
  } catch (e) {
    console.warn("[TopWar] window.TOPWAR defineProperty 실패. 직접 대입합니다.", e);
    window.TOPWAR = api;
  }

  function now() {
    return new Date().toISOString();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Number(ms) || 0));
  }

  function pushLimited(arr, item, limit = state.maxRecentPackets) {
    arr.push(item);
    while (arr.length > limit) arr.shift();
  }

  function incCommand(c) {
    const key = String(c);
    state.commandCount.set(key, (state.commandCount.get(key) || 0) + 1);
  }

  function getCommandCount(c) {
    return state.commandCount.get(String(c)) || 0;
  }

  function readU32BE(bytes, offset) {
    if (!bytes || bytes.length < offset + 4) return null;
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  function getU32BEBytes(value) {
    value = Number(value) >>> 0;
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  }

  function toBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  function toHex(bytes, limit = bytes?.length ?? 0) {
    if (!bytes) return "";
    return [...bytes.slice(0, limit)].map(v => v.toString(16).padStart(2, "0")).join(" ");
  }

  function parseMaybeJsonString(value) {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return value;
    try { return JSON.parse(text); } catch { return value; }
  }

  function deepParseJsonStrings(obj, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return obj;
    if (typeof obj === "string") {
      const parsed = parseMaybeJsonString(obj);
      return parsed === obj ? obj : deepParseJsonStrings(parsed, depth + 1, maxDepth);
    }
    if (Array.isArray(obj)) return obj.map(v => deepParseJsonStrings(v, depth + 1, maxDepth));
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = deepParseJsonStrings(v, depth + 1, maxDepth);
      return out;
    }
    return obj;
  }

  function scoreIncomingText(text) {
    let score = 0;
    if (!text) return -9999;
    if (text.includes("{")) score += 10;
    if (text.includes("}")) score += 10;
    if (text.includes(":")) score += 5;
    if (text.includes('"')) score += 5;
    if (text.includes('"s"')) score += 100;
    if (text.includes('"d"')) score += 100;
    if (text.includes('"t"')) score += 50;
    if (text.includes("pointList")) score += 400;
    if (text.includes("marchList")) score += 80;
    if (text.includes("playerInfo")) score += 120;
    if (text.includes("pointType")) score += 120;
    if (text.includes("pid")) score += 80;
    if (text.includes("power")) score += 50;
    if (text.includes("a_tag")) score += 70;
    if (text.includes("aid")) score += 50;
    try {
      const json = JSON.parse(text);
      score += 3000;
      if (json && typeof json === "object") {
        if ("s" in json) score += 300;
        if ("d" in json) score += 300;
        if ("t" in json) score += 100;
      }
    } catch {}
    score -= (text.match(/ /g) || []).length * 100;
    return score;
  }

  function deriveKeyBytesFromPrefix(bodyBytes, prefixText) {
    const prefix = new TextEncoder().encode(prefixText);
    if (bodyBytes.length < 4 || prefix.length < 4) return null;
    return [
      bodyBytes[0] ^ 1 ^ prefix[0],
      bodyBytes[1] ^ 1 ^ prefix[1],
      bodyBytes[2] ^ 1 ^ prefix[2],
      bodyBytes[3] ^ 1 ^ prefix[3]
    ];
  }

  function decodeIncomingTextCandidateByKeyBytes(bodyBytes, keyBytes, method) {
    const body = new Uint8Array(bodyBytes);
    for (let i = 0; i < body.length; i++) body[i] ^= keyBytes[i % 4];
    for (let i = 0; i < body.length; i++) body[i] ^= 1;

    const text = new TextDecoder("utf-8").decode(body).replace(/^\u0000+/, "");
    let json = null;
    let detail = null;
    let parsedDetail = null;
    let parseError = null;

    try {
      json = JSON.parse(text);
      if (typeof json.d === "string") {
        try { detail = JSON.parse(json.d); } catch { detail = json.d; }
      }
      parsedDetail = deepParseJsonStrings(detail);
    } catch (e) {
      parseError = e.message;
    }

    return {
      method,
      keyBytes,
      keyBytesHex: keyBytes.map(v => v.toString(16).padStart(2, "0")).join(" "),
      text,
      json,
      detail,
      parsedDetail,
      parseError,
      score: scoreIncomingText(text)
    };
  }

  function decodeTopwarIncomingBody(bodyBytes, seq) {
    const candidates = [];
    for (const prefix of ['{"s"', '\u0000{"s', '{"s":', '\u0000{"s"']) {
      const keyBytes = deriveKeyBytesFromPrefix(bodyBytes, prefix);
      if (!keyBytes) continue;
      const result = decodeIncomingTextCandidateByKeyBytes(bodyBytes, keyBytes, `prefix:${JSON.stringify(prefix)}`);
      candidates.push(result);
      if (result.json) return result;
    }

    const seqResult = decodeIncomingTextCandidateByKeyBytes(bodyBytes, getU32BEBytes(seq), "seq-u32be-repeat");
    candidates.push(seqResult);
    if (seqResult.json) return seqResult;

    const low = seq & 255;
    const high = (seq >>> 8) & 255;
    const variantKeys = [
      [0, 0, high, low],
      [0, 1, high ^ 1, low],
      [0, 1, high - 1, low],
      [0, 0, high ^ 1, low],
      [0, 0, high - 1, low]
    ].map(v => v.map(x => x & 255));

    for (const keyBytes of variantKeys) {
      const result = decodeIncomingTextCandidateByKeyBytes(bodyBytes, keyBytes, "variant");
      candidates.push(result);
      if (result.json) return result;
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return {
      decodeError: true,
      best: {
        method: best?.method,
        keyBytesHex: best?.keyBytesHex,
        score: best?.score,
        parseError: best?.parseError,
        textPreview: best?.text?.slice(0, 300)
      }
    };
  }

  function parseIncomingPacket(data) {
    const bytes = toBytes(data);
    if (!bytes) {
      if (typeof data === "string") {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        return { direction: "incoming", kind: "text", byteLength: data.length, text: data, json, c: json?.c, seq: json?.o, isDecoded: !!json };
      }
      return { direction: "incoming", kind: typeof data, isDecoded: false };
    }

    if (bytes.length < 12) return { direction: "incoming", kind: "binary-short", byteLength: bytes.length, hex: toHex(bytes), isDecoded: false };

    const c = readU32BE(bytes, 0);
    const seq = readU32BE(bytes, 4);
    const bodyLength = readU32BE(bytes, 8);
    const bodyBytes = bytes.slice(12);
    const decoded = decodeTopwarIncomingBody(bodyBytes, seq);

    return {
      direction: "incoming",
      kind: "binary",
      c,
      seq,
      key: `${c}:${seq}`,
      byteLength: bytes.byteLength,
      bodyLength,
      actualBodyLength: bodyBytes.length,
      isLengthMatched: bodyLength === bodyBytes.length,
      isDecoded: !!decoded?.json,
      decoded,
      decodeError: decoded?.decodeError ? decoded.best : null
    };
  }

  function parseOutgoingPacket(data) {
    const bytes = toBytes(data);
    if (!bytes || bytes.length < 12) return null;
    return {
      direction: "outgoing",
      c: readU32BE(bytes, 0),
      o: readU32BE(bytes, 4),
      bodyLength: readU32BE(bytes, 8),
      byteLength: bytes.length,
      headerHex: toHex(bytes.slice(0, 12))
    };
  }

  function parsePlayerInfo(value) {
    if (!value) return {};
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return {}; }
    }
    return value;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
  }

  // 원본 구조가 버전별로 달라져도 특정 키를 놓치지 않도록 exact key를 재귀 탐색한다.
  // 순환 참조 방지 + 깊이 제한을 둔다.
  function findFieldDeep(value, targetKey, maxDepth = 10) {
    const visited = new WeakSet();

    function walk(node, path, depth) {
      if (node == null || depth > maxDepth || typeof node !== "object") return null;
      if (visited.has(node)) return null;
      visited.add(node);

      if (Object.prototype.hasOwnProperty.call(node, targetKey)) {
        return { found: true, value: node[targetKey], path: `${path}.${targetKey}` };
      }

      for (const [key, child] of Object.entries(node)) {
        if (child == null || typeof child !== "object") continue;
        const found = walk(child, `${path}.${key}`, depth + 1);
        if (found) return found;
      }

      return null;
    }

    return walk(value, "point", 0);
  }

  // source의 필드를 target에 추가하되 이미 정의된 기존 필드는 절대 덮어쓰지 않는다.
  // 즉 기존 TOPWAR 필드의 의미는 그대로 유지하면서 새/미지 필드만 최상위에서도 접근 가능하게 한다.
  function mergeMissingTopLevel(target, ...sources) {
    for (const source of sources) {
      if (!isPlainObject(source)) continue;
      for (const [key, value] of Object.entries(source)) {
        if (!(key in target)) target[key] = value;
      }
    }
    return target;
  }

  function normalizeMapPoint(point, meta = {}) {
    const p = isPlainObject(point?.p) ? point.p : {};
    const r = isPlainObject(point?.r) ? point.r : {};
    const rawPlayerInfo = p.playerInfo ?? null;
    const parsedPlayerInfo = parsePlayerInfo(rawPlayerInfo);
    const playerInfo = isPlainObject(parsedPlayerInfo) ? parsedPlayerInfo : {};
    const pointType = point?.pointType ?? null;
    const rawServerId = point?.k ?? p.w ?? p.cMid;
    // 일부 901은 현재 조사 서버를 0으로 보낸다. 0은 실제 서버번호가 아니므로
    // 조사 루프가 전달한 서버번호를 사용해야 도시보상이 서버 불일치로 폐기되지 않는다.
    const serverId = Number(rawServerId) > 0 ? rawServerId : (meta.serverId ?? null);
    const x = point?.x ?? null;
    const y = point?.y ?? null;
    // 기존 p.pid -> p.uid 우선순위는 그대로 유지하고, 없는 경우에만 원본의 다른 UID 후보를 사용한다.
    const uidValue =
      p.pid ??
      p.uid ??
      playerInfo.pid ??
      playerInfo.uid ??
      playerInfo.userId ??
      playerInfo.userID ??
      point?.pid ??
      point?.uid ??
      null;
    const uid = uidValue != null ? String(uidValue) : null;
    const objectKey = point?.id != null ? `${serverId}:${pointType}:id:${point.id}` : `${serverId}:${pointType}:coord:${x}:${y}`;

    // 기존 V2.10.4 필드는 이름/우선순위/의미를 그대로 유지한다.
    const normalized = {
      objectKey,
      time: meta.time ?? null,
      c: meta.c ?? null,
      seq: meta.seq ?? null,
      pointType,
      pointTypeName: state.pointTypeNames[pointType] ?? `UNKNOWN_POINT_TYPE_${pointType}`,
      id: point?.id ?? null,
      serverId,
      x,
      y,
      v: point?.v ?? null,
      uid,
      username: playerInfo.username ?? playerInfo.nickname ?? p.username ?? p.nickname ?? null,
      nickname: playerInfo.nickname ?? playerInfo.username ?? null,
      level: p.level ?? p.sml ?? null,
      power: p.power ?? null,
      armyPower: p.armyPower ?? null,
      allianceId: p.aid != null ? String(p.aid) : null,
      allianceTag: p.a_tag ?? null,
      language: p.language ?? null,
      nationalflag: playerInfo.nationalflag ?? null,
      gender: playerInfo.gender ?? null,
      usergender: playerInfo.usergender ?? null,
      itemId: r.itemId ?? p.itemId ?? null,
      amount: r.amount ?? null,
      buildId: p.buildId ?? point?.buildId ?? null,
      owner: p.owner ?? point?.owner ?? null,
      resource: Object.keys(r).length ? r : null
    };

    // 원본 구조를 별도로 완전 보존한다.
    // playerInfo는 파싱된 객체, rawPlayerInfo는 서버에서 받은 원래 값이다.
    normalized.p = p;
    normalized.r = r;
    normalized.playerInfo = playerInfo;
    // rawPoint/rawPlayerInfo 원본 참조는 저장하지 않는다.
    // playerInfo/p/r의 필요한 파싱 결과만 남겨 대형 901 pointList 객체 그래프가 playerMap에 붙잡히지 않게 한다.
    normalized.rawPlayerInfo = null;
    normalized.rawPoint = null;

    // cityReward는 기존 예상 경로(playerInfo)를 최우선으로 사용한다.
    // 다만 실제 패킷 구조가 달라도 놓치지 않도록 p/point/r 및 재귀 탐색을 fallback으로 둔다.
    let cityRewardSource = null;

    if (hasOwn(playerInfo, "cityReward")) {
      cityRewardSource = { found: true, value: playerInfo.cityReward, path: "point.p.playerInfo.cityReward" };
    } else if (hasOwn(p, "cityReward")) {
      cityRewardSource = { found: true, value: p.cityReward, path: "point.p.cityReward" };
    } else if (hasOwn(point, "cityReward")) {
      cityRewardSource = { found: true, value: point.cityReward, path: "point.cityReward" };
    } else if (hasOwn(r, "cityReward")) {
      cityRewardSource = { found: true, value: r.cityReward, path: "point.r.cityReward" };
    } else {
      cityRewardSource = findFieldDeep(point, "cityReward", 10);
    }

    normalized.hasCityRewardField = !!cityRewardSource?.found;
    normalized.cityReward = normalized.hasCityRewardField ? cityRewardSource.value : undefined;
    normalized.cityRewardPath = cityRewardSource?.path ?? null;

    // 원본의 미지 필드는 편의상 최상위에도 추가한다.
    // 기존 normalized 필드와 충돌하는 이름은 기존 필드가 항상 우선한다.
    mergeMissingTopLevel(normalized, point, p, playerInfo, r);

    normalized.rawKeys = {
      pointKeys: Object.keys(point || {}),
      pKeys: Object.keys(p),
      playerInfoKeys: Object.keys(playerInfo),
      rKeys: Object.keys(r)
    };

    return normalized;
  }

  function completenessScore(v) {
    let score = 0;
    if (v.username) score += 10;
    if (v.power != null) score += 10;
    if (v.allianceId != null) score += 8;
    if (v.allianceTag) score += 8;
    if (v.x != null && v.y != null) score += 5;
    if (v.id != null || v.pointId != null) score += 3;
    return score;
  }

  function mergePlainObjects(base, incoming) {
    if (!isPlainObject(base) && !isPlainObject(incoming)) return {};
    return {
      ...(isPlainObject(base) ? base : {}),
      ...(isPlainObject(incoming) ? incoming : {})
    };
  }

  function upsertPlayer(obj) {
    if (!obj.uid) return false;

    const prev = state.playerMap.get(obj.uid);

    // 사후 검사만으로는 한 번의 대형 901에서 수천 명이 한꺼번에 들어오는 것을 막지 못한다.
    // 기존 유저 갱신은 허용하되 신규 UID는 저장 직전 2,000명에서 하드 차단한다.
    const maxStoredPlayers = Math.max(1, Number(state.maxStoredPlayers) || 2000);
    if (!prev && state.playerMap.size >= maxStoredPlayers) {
      state.playerLimitReached = true;
      state.droppedPlayers = Number(state.droppedPlayers || 0) + 1;
      return false;
    }

    // 기존 V2.10.4가 제공하던 필드는 그대로 명시적으로 유지한다.
    const legacyPlayer = {
      time: obj.time,
      c: obj.c,
      seq: obj.seq,
      uid: obj.uid,
      username: obj.username,
      nickname: obj.nickname,
      serverId: obj.serverId,
      x: obj.x,
      y: obj.y,
      pointId: obj.id,
      pointType: obj.pointType,
      level: obj.level,
      power: obj.power,
      armyPower: obj.armyPower,
      allianceId: obj.allianceId,
      allianceTag: obj.allianceTag,
      language: obj.language,
      nationalflag: obj.nationalflag,
      gender: obj.gender,
      usergender: obj.usergender
    };

    const useCurrentAsPrimary = !prev || completenessScore(legacyPlayer) >= completenessScore(prev);
    const primary = useCurrentAsPrimary ? obj : prev;
    const secondary = useCurrentAsPrimary ? prev : obj;

    // 모든 신규/원본 필드를 보존하되, 기존 완성도 판정으로 선택된 snapshot이 충돌 시 우선한다.
    const player = {
      ...(secondary || {}),
      ...(primary || {}),

      // 기존 공개 필드들은 기존 규칙을 그대로 적용한다.
      ...(useCurrentAsPrimary ? legacyPlayer : {
        time: prev.time,
        c: prev.c,
        seq: prev.seq,
        uid: prev.uid,
        username: prev.username,
        nickname: prev.nickname,
        serverId: prev.serverId,
        x: prev.x,
        y: prev.y,
        pointId: prev.pointId,
        pointType: prev.pointType,
        level: prev.level,
        power: prev.power,
        armyPower: prev.armyPower,
        allianceId: prev.allianceId,
        allianceTag: prev.allianceTag,
        language: prev.language,
        nationalflag: prev.nationalflag,
        gender: prev.gender,
        usergender: prev.usergender
      }),

      // 같은 유저를 여러 901에서 만났을 때 원본 중첩 정보는 누적 병합한다.
      p: mergePlainObjects(prev?.p, obj?.p),
      r: mergePlainObjects(prev?.r, obj?.r),
      playerInfo: mergePlainObjects(prev?.playerInfo, obj?.playerInfo),

      // 최신 원본 packet은 별도로 유지한다.
      rawPoint: null,
      rawPlayerInfo: null,

      firstSeenAt: prev?.firstSeenAt ?? prev?.time ?? obj.time ?? null,
      lastSeenAt: obj.time ?? prev?.lastSeenAt ?? prev?.time ?? null,
      seenCount: Number(prev?.seenCount || 0) + 1
    };

    // cityReward는 최신 관측에서 해당 필드가 실제로 존재한 경우 null까지 포함해 최신값으로 갱신한다.
    // TTL은 일반 lastSeenAt이 아니라 cityReward를 실제 확인한 시각으로 계산한다.
    if (obj?.hasCityRewardField === true) {
      player.hasCityRewardField = true;
      player.cityReward = obj.cityReward;
      player.cityRewardPath = obj.cityRewardPath ?? prev?.cityRewardPath ?? null;
      player.cityRewardSeenAt = obj.time ?? new Date().toISOString();
    } else if (prev?.hasCityRewardField === true) {
      player.hasCityRewardField = true;
      player.cityReward = prev.cityReward;
      player.cityRewardPath = prev.cityRewardPath ?? null;
      player.cityRewardSeenAt = prev.cityRewardSeenAt ?? prev.time ?? null;
    } else {
      player.hasCityRewardField = false;
      player.cityReward = undefined;
      player.cityRewardPath = null;
      player.cityRewardSeenAt = null;
    }

    // rawKeys 역시 누적된 최종 객체 기준으로 다시 만든다.
    player.rawKeys = {
      pointKeys: Array.from(new Set([...(prev?.rawKeys?.pointKeys || []), ...(obj?.rawKeys?.pointKeys || [])])),
      pKeys: Object.keys(player.p || {}),
      playerInfoKeys: Object.keys(player.playerInfo || {}),
      rKeys: Object.keys(player.r || {})
    };

    state.playerMap.set(obj.uid, player);
    if (state.playerMap.size >= maxStoredPlayers) {
      state.playerLimitReached = true;
    }

    if (obj.allianceId) {
      const prevAlliance = state.allianceMap.get(obj.allianceId);
      if (!prevAlliance) {
        state.allianceMap.set(obj.allianceId, {
          allianceId: obj.allianceId,
          allianceTag: obj.allianceTag,
          serverId: obj.serverId,
          playerCount: 1,
          samplePlayers: [{ uid: obj.uid, username: obj.username, x: obj.x, y: obj.y, power: obj.power }]
        });
      } else {
        prevAlliance.allianceTag = obj.allianceTag || prevAlliance.allianceTag;
        prevAlliance.serverId = prevAlliance.serverId ?? obj.serverId;
        prevAlliance.playerCount++;
        const exists = prevAlliance.samplePlayers.some(p => String(p.uid) === String(obj.uid));
        if (!exists && prevAlliance.samplePlayers.length < 5) {
          prevAlliance.samplePlayers.push({ uid: obj.uid, username: obj.username, x: obj.x, y: obj.y, power: obj.power });
        }
      }

      const prevRep = state.allianceRepresentativeMap.get(obj.allianceId);
      if (obj.x != null && obj.y != null && (!prevRep || Number(obj.power ?? 0) > Number(prevRep.power ?? 0))) {
        state.allianceRepresentativeMap.set(obj.allianceId, {
          allianceId: obj.allianceId,
          allianceTag: obj.allianceTag,
          serverId: obj.serverId,
          uid: obj.uid,
          username: obj.username,
          x: obj.x,
          y: obj.y,
          level: obj.level,
          power: obj.power,
          pointId: obj.id,
          foundAt: obj.time
        });
      }
    }

    return true;
  }

  function setBoundedMapValue(map, key, value, limit) {
    if (!(map instanceof Map)) return;
    const max = Math.max(1, Number(limit) || 1);
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > max) {
      const oldestKey = map.keys().next().value;
      if (oldestKey == null) break;
      map.delete(oldestKey);
    }
  }

  function collectPointList(pointList, meta = {}) {
    let addedObjectsRaw = 0;
    let addedPlayersRaw = 0;

    if (!Array.isArray(pointList)) {
      return {
        addedObjectsRaw,
        addedPlayersRaw,
        totalObjects: state.objectMap.size,
        totalPlayers: state.playerMap.size,
        totalAlliances: state.allianceMap.size,
        totalAllianceRepresentatives: state.allianceRepresentativeMap.size
      };
    }

    for (const point of pointList) {
      // 이 서버는 조사 루프에서 곧바로 폐기된다. 대형 901의 나머지 수만 건을
      // 정규화해 임시 객체를 계속 만드는 작업도 여기서 즉시 중단한다.
      if (state.playerLimitReached === true) break;
      const obj = normalizeMapPoint(point, meta);
      setBoundedMapValue(state.objectMap, obj.objectKey, obj, state.maxStoredObjects);
      addedObjectsRaw++;
      const typeKey = String(obj.pointType);
      state.objectsByType[typeKey] ??= new Map();
      setBoundedMapValue(state.objectsByType[typeKey], obj.objectKey, obj, state.maxStoredObjectsPerType);
      if (upsertPlayer(obj)) addedPlayersRaw++;
    }

    return {
      addedObjectsRaw,
      addedPlayersRaw,
      totalObjects: state.objectMap.size,
      totalPlayers: state.playerMap.size,
      totalAlliances: state.allianceMap.size,
      totalAllianceRepresentatives: state.allianceRepresentativeMap.size
    };
  }

  function ensureThiefBuffer() {
    const buffer = state.thiefBuffer ??= {
      maxEvents: 512,
      events: [],
      nextEventId: 1,
      activeTargetServerId: null,
      stats: {}
    };
    buffer.events ??= [];
    buffer.nextEventId = Number(buffer.nextEventId ?? 1);
    buffer.maxEvents = Math.max(32, Number(buffer.maxEvents ?? 512));
    buffer.stats ??= {};
    return buffer;
  }

  function capture901ThiefEvent(record, detail) {
    if (!Array.isArray(detail?.pointList)) return null;

    const buffer = ensureThiefBuffer();
    const stats = buffer.stats;
    stats.pointList901Received = Number(stats.pointList901Received || 0) + 1;
    stats.last901At = record?.time ?? now();

    const packetServerIdRaw = Number(detail?.k);
    const packetServerId = Number.isFinite(packetServerIdRaw) ? packetServerIdRaw : null;
    const activeTargetServerIdRaw = Number(buffer.activeTargetServerId);
    const scanServerId = Number.isFinite(activeTargetServerIdRaw) && activeTargetServerIdRaw > 0
      ? activeTargetServerIdRaw
      : null;
    const thieves = [];

    for (const point of detail.pointList) {
      if (Number(point?.pointType) !== 133) continue;

      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      // 중요:
      // detail.k는 패킷 메타값일 수 있으므로 point 자체의 서버 정보와 섞지 않는다.
      // point에 서버 정보가 실제로 있을 때만 저장하고, 없으면 수집 시 현재 조사 서버를 사용한다.
      const pointServerIdRaw = Number(point?.k ?? point?.p?.w ?? point?.p?.cMid);
      const pointServerId = Number.isFinite(pointServerIdRaw) ? pointServerIdRaw : null;
      const id = point?.id ?? null;

      thieves.push({
        serverId: pointServerId,
        x,
        y,
        id,
        pointType: 133
      });
    }

    // 도둑 전용 버퍼에는 133이 없는 일반 901 이벤트를 넣지 않는다.
    // 따라서 도시보상/일반 901 트래픽이 많아도 도둑 이벤트를 밀어내지 않는다.
    if (!thieves.length) return {
      stored: false,
      time: record?.time ?? now(),
      packetServerId,
      scanServerId,
      packetSeq: record?.packet?.seq ?? null,
      thiefCount: 0
    };

    const eventId = Number(buffer.nextEventId ?? 1);
    buffer.nextEventId = eventId + 1;

    const event = {
      id: eventId,
      stored: true,
      time: record?.time ?? now(),
      packetServerId,
      scanServerId,
      packetSeq: record?.packet?.seq ?? null,
      thiefCount: thieves.length,
      thieves
    };

    pushLimited(buffer.events, event, buffer.maxEvents);

    stats.thiefEventsCaptured = Number(stats.thiefEventsCaptured || 0) + 1;
    stats.thievesCaptured = Number(stats.thievesCaptured || 0) + thieves.length;
    stats.lastThiefCapturedAt = event.time;
    stats.lastCaptured = {
      eventId,
      packetServerId,
      scanServerId,
      packetSeq: event.packetSeq,
      thiefCount: thieves.length,
      thieves: thieves.map(v => ({ ...v }))
    };

    console.warn("[TopWar Thief Buffer] 133 수신:", stats.lastCaptured);
    return event;
  }

  function handleDecodedPacket(record) {
    const packet = record.packet;
    const detail = packet?.decoded?.parsedDetail ?? packet?.decoded?.detail ?? null;
    if (packet?.c === 901 && Array.isArray(detail?.pointList)) {
      // collectPointList가 playerMap/cityReward용 일반 데이터를 누적하기 전에/후와 관계없이
      // 도둑은 이 수신 시점에 별도의 경량 네트워크 이벤트로 반드시 보존한다.
      // recentPackets가 16개를 초과해 오래된 901이 밀려나도 133 탐지는 사라지지 않는다.
      const capturedThiefEvent = capture901ThiefEvent(record, detail);
      const integratedSurvey = state.ui?.serverSurvey;
      if (
        integratedSurvey?.running === true &&
        integratedSurvey?.integratedFinders === true &&
        Array.isArray(capturedThiefEvent?.thieves) &&
        capturedThiefEvent.thieves.length > 0 &&
        typeof window.TOPWAR?.uploadDetectedThieves === "function"
      ) {
        integratedSurvey.liveThiefKeys ??= new Set();
        const newThieves = capturedThiefEvent.thieves.filter(thief => {
          const key = `${Number(thief.serverId ?? integratedSurvey.current?.serverId)}|${thief.id ?? ""}|${thief.x}|${thief.y}`;
          if (integratedSurvey.liveThiefKeys.has(key)) return false;
          integratedSurvey.liveThiefKeys.add(key);
          return true;
        });
        if (newThieves.length) {
          const targetServerId = Number(integratedSurvey.current?.serverId ?? capturedThiefEvent.scanServerId ?? capturedThiefEvent.packetServerId);
          void window.TOPWAR.uploadDetectedThieves(targetServerId, newThieves, {
            detectedAt: new Date().toISOString(),
            newDetectedCount: newThieves.length,
            scanProgress: { mode: "map-survey-live", moveIndex: Number(state.fullScan?.moveIndex ?? 0), totalMoves: Number(state.fullScan?.totalMoves ?? 0) }
          }).then(upload => {
            integratedSurvey.lastLiveThiefUpload = upload;
            state.watch133.lastLiveThiefUpload = upload;
          }).catch(error => {
            integratedSurvey.lastLiveThiefUpload = { ok: false, error: error?.message || String(error) };
            console.error("[TopWar Integrated Survey] 도둑 즉시 DataHub 업로드 실패:", error);
          });
        }
      }

      const activeSurveyServerId = state.ui?.serverSurvey?.current?.serverId ??
        state.ui?.serverSurveyBatch?.current?.serverId ??
        range()?.k ?? null;
      const collectedServerId = Number(detail?.k) > 0 ? detail.k : activeSurveyServerId;
      record.collected = collectPointList(detail.pointList, {
        time: record.time,
        c: packet.c,
        seq: packet.seq,
        serverId: collectedServerId
      });

      // 지도+보상 조사에서는 901을 받은 바로 이 시점에 cityReward 원본을 별도 맵에 보존한다.
      // 서버 완료 시 playerMap/최근 2개 패킷을 다시 검색하는 경로에만 의존하면 중간에 본
      // 보상이 사라져 locations=[]로 업로드될 수 있다.
      const rewardSurvey = state.ui?.serverSurvey;
      if (rewardSurvey?.running === true && rewardSurvey?.includeRewards === true) {
        rewardSurvey.rewardMap ??= new Map();
        let capturedRewards = 0;
        for (const point of detail.pointList) {
          if (Number(point?.pointType) !== 1) continue;
          const normalized = normalizeMapPoint(point, {
            time: record.time,
            c: packet.c,
            seq: packet.seq,
            serverId: collectedServerId
          });
          const cityReward = normalized?.cityReward;
          if (cityReward === null || typeof cityReward !== "object" || Array.isArray(cityReward)) continue;
          const serverId = Number(normalized?.serverId) > 0
            ? Number(normalized.serverId)
            : Number(collectedServerId);
          if (!Number.isFinite(serverId) || serverId <= 0) continue;
          const row = {
            serverId,
            x: normalized.x ?? point?.x ?? null,
            y: normalized.y ?? point?.y ?? null,
            uid: normalized.uid != null ? String(normalized.uid) : null,
            username: normalized.username ?? normalized.nickname ?? null,
            level: normalized.level ?? null,
            allianceId: normalized.allianceId != null ? String(normalized.allianceId) : null,
            allianceTag: normalized.allianceTag ?? null,
            pointId: normalized.id ?? point?.id ?? null,
            cityReward,
            cityRewardSeenAt: record.time,
            foundAt: record.time
          };
          const instanceId = cityReward?.instanceId != null ? String(cityReward.instanceId) : null;
          const key = instanceId
            ? `${serverId}:instance:${instanceId}`
            : row.uid
              ? `${serverId}:uid:${row.uid}`
              : `${serverId}:coord:${row.x}:${row.y}`;
          if (!rewardSurvey.rewardMap.has(key)) capturedRewards++;
          rewardSurvey.rewardMap.set(key, row);
        }
        if (capturedRewards > 0) {
          console.log("[TopWar Integrated Survey] 901 도시보상 즉시 누적:", {
            serverId: collectedServerId,
            added: capturedRewards,
            total: rewardSurvey.rewardMap.size
          });
        }
      }
      if (state.debug.log901) console.log("[TopWar 901 collected]", {
        seq: packet.seq,
        pointList: detail.pointList.length,
        thiefEvents: state.thiefBuffer?.events?.length ?? 0,
        collected: record.collected
      });
    }
  }

  async function handleMessage(ws, event) {
    let data = event.data;
    if (data instanceof Blob) data = await data.arrayBuffer();
    const packet = parseIncomingPacket(data);
    if (packet?.c != null) incCommand(packet.c);
    const record = { type: "WS_MESSAGE", time: now(), url: ws.url, packet };
    if (packet.isDecoded) {
      handleDecodedPacket(record);
      // recentPackets는 도둑/cityReward fallback에서 901만 사용한다.
      // 다른 명령의 decoded payload까지 보관하면 큰 객체 그래프가 계속 살아남아 OOM을 유발한다.
      if (Number(packet.c) === 901) {
        pushLimited(state.recentPackets, record, state.maxRecentPackets);
      }
    } else if (packet.decodeError && state.debug.logDecodeError) {
      console.warn("[TopWar decodeError]", packet.decodeError);
    }
  }


  function getOpenTopwarSockets() {
    return (state.sockets || []).filter(ws => ws && ws.readyState === WebSocket.OPEN);
  }

  function normalizeConnectionText(value) {
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findConnectionFailureText() {
    const guard = state.connectionGuard;
    if (!guard?.enabled) return null;
    const keywords = (guard.overlayKeywords || []).map(normalizeConnectionText).filter(Boolean);
    const sources = [];

    try {
      const bodyText = normalizeConnectionText(document.body?.innerText || "");
      if (bodyText) sources.push({ source: "document.body", text: bodyText });
    } catch {}

    try {
      if (window.cc?.director) {
        const texts = [];
        (function walk(node, depth = 0) {
          if (!node || depth > 50 || texts.length > 500) return;
          try { const label = node.getComponent?.(cc.Label); if (label?.string) texts.push(String(label.string)); } catch {}
          try { const rich = node.getComponent?.(cc.RichText); if (rich?.string) texts.push(String(rich.string)); } catch {}
          for (const child of node.children || []) walk(child, depth + 1);
        })(cc.director.getScene());
        const cocosText = normalizeConnectionText(texts.join(" "));
        if (cocosText) sources.push({ source: "cocos-labels", text: cocosText });
      }
    } catch {}

    for (const source of sources) {
      const keyword = keywords.find(word => source.text.includes(word));
      if (keyword) return { source: source.source, keyword, textPreview: source.text.slice(0, 500) };
    }
    return null;
  }

  function markConnectionHealthy(info = null) {
    const guard = state.connectionGuard;
    if (!guard) return false;
    guard.lastHealthyAt = now();
    guard.consecutiveMoveFailures = 0;
    if (info) guard.lastHealthyInfo = info;
    return true;
  }

  function stopAllAutomationForConnectionFailure(reason, info = null) {
    const guard = state.connectionGuard;
    if (!guard?.enabled || guard.stopping) return false;
    guard.stopping = true;
    guard.disconnected = true;
    guard.reason = reason || "server connection failed";
    guard.detectedAt = now();
    guard.lastFailureInfo = info;

    state.watch133.running = false;
    state.watch133.paused = false;
    state.watch133.pauseReason = "connection failure";
    state.watch133.pauseInfo = info;

    state.fullScan ??= {};
    state.fullScan.stopRequested = true;
    state.fullScan.running = false;
    state.fullScan.phase = "connectionFailure";

    state.ui ??= {};
    state.ui.serverSurvey ??= {};
    state.ui.serverSurveyBatch ??= {};
    state.ui.serverSurvey.stopping = true;
    state.ui.serverSurveyBatch.stopping = true;
    state.ui.serverSurvey.current = { phase: "connectionFailure", reason: guard.reason };
    state.ui.serverSurveyBatch.current = { phase: "connectionFailure", reason: guard.reason };

    console.error("[TopWar] 서버 연결 실패 감지 - 모든 자동화 중지", { reason: guard.reason, info, detectedAt: guard.detectedAt });
    guard.stopping = false;
    return true;
  }

  function connectionGuardStatus() {
    const guard = state.connectionGuard || {};
    const status = {
      enabled: !!guard.enabled,
      disconnected: !!guard.disconnected,
      reason: guard.reason,
      detectedAt: guard.detectedAt,
      lastHealthyAt: guard.lastHealthyAt,
      lastSocketOpenAt: guard.lastSocketOpenAt,
      lastSocketCloseAt: guard.lastSocketCloseAt,
      lastSocketErrorAt: guard.lastSocketErrorAt,
      lastCloseCode: guard.lastCloseCode,
      lastCloseReason: guard.lastCloseReason,
      openSocketCount: getOpenTopwarSockets().length,
      totalSocketCount: state.sockets?.length ?? 0,
      consecutiveMoveFailures: guard.consecutiveMoveFailures ?? 0,
      maxConsecutiveMoveFailures: guard.maxConsecutiveMoveFailures ?? 5
    };
    console.log("[TopWar] connection guard status:", status);
    return status;
  }

  function resetConnectionGuard() {
    const guard = state.connectionGuard;
    if (!guard) return false;
    guard.disconnected = false;
    guard.stopping = false;
    guard.reason = null;
    guard.detectedAt = null;
    guard.consecutiveMoveFailures = 0;
    guard.lastHealthyAt = now();
    if (state.fullScan?.phase === "connectionFailure") state.fullScan.phase = "idle";
    if (state.fullScan) state.fullScan.stopRequested = false;
    if (state.ui?.serverSurvey) state.ui.serverSurvey.stopping = false;
    if (state.ui?.serverSurveyBatch) state.ui.serverSurveyBatch.stopping = false;
    console.warn("[TopWar] connection guard reset");
    return true;
  }

  function setConnectionGuardEnabled(enabled = true) {
    state.connectionGuard.enabled = !!enabled;
    return state.connectionGuard.enabled;
  }

  function noteMoveResultForConnectionGuard(result, context = null) {
    const guard = state.connectionGuard;
    if (!guard?.enabled) return;
    if (result?.ok) {
      markConnectionHealthy({ type: "move", context });
      return;
    }
    guard.consecutiveMoveFailures = Number(guard.consecutiveMoveFailures ?? 0) + 1;
    const maxFailures = Number(guard.maxConsecutiveMoveFailures ?? 5);
    const noOpenSocket = getOpenTopwarSockets().length === 0;
    if (guard.autoStopOnDisconnect !== false && (noOpenSocket || guard.consecutiveMoveFailures >= maxFailures)) {
      stopAllAutomationForConnectionFailure(
        noOpenSocket ? "all game sockets closed" : `map operation failed ${guard.consecutiveMoveFailures} times`,
        { context, result }
      );
    }
  }

  function startConnectionGuardMonitor() {
    if (state.connectionGuard.monitorTimer) return state.connectionGuard.monitorTimer;
    state.connectionGuard.monitorTimer = setInterval(() => {
      const guard = state.connectionGuard;
      if (!guard?.enabled || guard.disconnected) return;
      const failure = findConnectionFailureText();
      if (failure) stopAllAutomationForConnectionFailure("server connection failure popup detected", failure);
    }, Math.max(500, Number(state.connectionGuard.monitorIntervalMs ?? 1000)));
    return state.connectionGuard.monitorTimer;
  }

  function attachSocket(ws) {
    if (!ws || ws.__topwar_unified_v23_attached__) return;
    ws.__topwar_unified_v23_attached__ = true;
    state.sockets = (state.sockets || []).filter(socket =>
      socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    );
    state.sockets.push(ws);
    if (state.sockets.length > 10) state.sockets = state.sockets.slice(-10);

    ws.addEventListener("open", () => {
      state.connectionGuard.lastSocketOpenAt = now();
      markConnectionHealthy({ type: "socket-open", url: ws.url });
    });

    ws.addEventListener("message", event => {
      markConnectionHealthy({ type: "socket-message", url: ws.url });
      handleMessage(ws, event).catch(err => console.warn("[TopWar] message handling error:", err));
    });

    ws.addEventListener("close", event => {
      state.connectionGuard.lastSocketCloseAt = now();
      state.connectionGuard.lastCloseCode = event.code;
      state.connectionGuard.lastCloseReason = event.reason || null;
      setTimeout(() => {
        if (state.connectionGuard.enabled && getOpenTopwarSockets().length === 0 &&
            (state.watch133?.running || state.fullScan?.running || state.ui?.serverSurvey?.running || state.ui?.serverSurveyBatch?.running)) {
          stopAllAutomationForConnectionFailure("all game sockets closed", { url: ws.url, code: event.code, reason: event.reason, wasClean: event.wasClean });
        }
      }, 1200);
    });

    ws.addEventListener("error", () => {
      state.connectionGuard.lastSocketErrorAt = now();
      setTimeout(() => {
        if (state.connectionGuard.enabled && getOpenTopwarSockets().length === 0 &&
            (state.watch133?.running || state.fullScan?.running || state.ui?.serverSurvey?.running || state.ui?.serverSurveyBatch?.running)) {
          stopAllAutomationForConnectionFailure("game socket error", { url: ws.url, readyState: ws.readyState });
        }
      }, 1200);
    });

    if (state.debug.logWsAttach) console.log("[TopWar] WS attached:", ws.url);
  }

  if (OriginalWebSocket && originalSend) {
    OriginalWebSocket.prototype.send = function (data) {
      attachSocket(this);
      const packet = parseOutgoingPacket(data);
      if (packet) {
        const record = { type: "WS_SEND", time: now(), url: this.url, packet };
        pushLimited(state.recentOutgoing, record, 16);
        if (state.debug.logOutgoing) console.log("[TopWar OUT]", packet);
      }
      return originalSend.call(this, data);
    };

    function HookedWebSocket(...args) {
      const ws = new OriginalWebSocket(...args);
      attachSocket(ws);
      return ws;
    }

    HookedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Object.defineProperty(HookedWebSocket, k, { value: OriginalWebSocket[k] });
    window.WebSocket = HookedWebSocket;
  }

  function isValidMapController(c) {
    return !!(c && typeof c.getWorldMapDataInstance === "function" && typeof c.getWorldMapComponent === "function");
  }

  function findMapController() {
    if (isValidMapController(state.mapCtrlCache)) return state.mapCtrlCache;
    const candidates = [window.NWorldController, window.NWorldMapController, window.mapCtrl];
    for (const c of candidates) {
      if (isValidMapController(c)) {
        state.mapCtrlCache = c;
        window.mapCtrl = c;
        console.log("[TopWar] mapCtrl selected from global:", c);
        return c;
      }
    }
    return null;
  }

  function getMapCtrl() {
    return findMapController();
  }

  function getWorldMapComponent() {
    return getMapCtrl()?.getWorldMapComponent?.() || null;
  }

  function range() {
    return getMapCtrl()?.getWorldMapDataInstance?.()?.status?.viewport?.range ?? null;
  }

  async function waitFor901Stable(startCount, options = {}) {
    const timeout = Number(options.timeout ?? 1800);
    const interval = Number(options.interval ?? 30);
    const quietMs = Number(options.quietMs ?? 220);
    const minNewCount = Number(options.minNewCount ?? 1);
    const startedAt = Date.now();
    let lastCount = getCommandCount(901);
    let lastChangedAt = Date.now();
    let firstReceivedAt = null;

    while (Date.now() - startedAt < timeout) {
      const nowTime = Date.now();
      const count = getCommandCount(901);
      if (count !== lastCount) {
        lastCount = count;
        lastChangedAt = nowTime;
        if (count - startCount >= minNewCount && firstReceivedAt == null) firstReceivedAt = nowTime;
      }
      const newCount = count - startCount;
      if (newCount >= minNewCount && nowTime - lastChangedAt >= quietMs) {
        return { ok: true, startCount, endCount: count, newCount, waitedMs: nowTime - startedAt, firstReceivedAfterMs: firstReceivedAt ? firstReceivedAt - startedAt : null };
      }
      await sleep(interval);
    }

    return { ok: false, startCount, endCount: getCommandCount(901), newCount: getCommandCount(901) - startCount, waitedMs: Date.now() - startedAt };
  }

  function looksLikePoint(point) {
    return !!(point && typeof point === "object" && (point.pointType != null || (point.x != null && point.y != null) || point.p?.pid != null || point.p?.playerInfo != null || point.r?.itemId != null));
  }

  function findWorldMapObjectStores() {
    const wmc = getWorldMapComponent();
    if (!wmc) {
      console.error("[TopWar] worldMapComponent 없음");
      return [];
    }

    const results = [];
    const visited = new WeakSet();

    function looksLikePointObject(v) {
      if (looksLikePoint(v)) return true;
      let text = "";
      try { text = JSON.stringify(v).slice(0, 2000); } catch {}
      return text.includes("pointType") || text.includes("playerInfo") || text.includes("buildId") || text.includes("itemId") || text.includes("aid") || text.includes("a_tag");
    }

    function walk(obj, path = "wmc", depth = 0) {
      if (!obj || typeof obj !== "object" || depth > 5 || visited.has(obj)) return;
      visited.add(obj);
      if (Array.isArray(obj)) {
        const sample = obj.find(v => v && typeof v === "object") || obj[0];
        if (obj.length > 0 && looksLikePointObject(sample)) results.push({ path, type: "Array", size: obj.length, value: obj, sample });
        obj.slice(0, 5).forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
        return;
      }
      if (obj instanceof Map) {
        const values = [...obj.values()];
        const sample = values.find(v => v && typeof v === "object") || values[0];
        if (obj.size > 0 && looksLikePointObject(sample)) results.push({ path, type: "Map", size: obj.size, value: obj, sample });
        values.slice(0, 5).forEach((v, i) => walk(v, `${path}.<mapValue${i}>`, depth + 1));
        return;
      }
      for (const key of Object.keys(obj).slice(0, 80)) {
        let v;
        try { v = obj[key]; } catch { continue; }
        if (v && typeof v === "object") walk(v, `${path}.${key}`, depth + 1);
      }
    }

    walk(wmc);
    // Cocos 내부 객체를 state에 장기 보관하지 않는다. 직접 참조가 씬 전체를 붙잡아 OOM 원인이 된다.
    state.worldObjectStores = null;
    window.TOPWAR_LOG_CONTROL.table(results.map((r, i) => ({ i, path: r.path, type: r.type, size: r.size, sample: (() => { try { return JSON.stringify(r.sample).slice(0, 300); } catch { return String(r.sample).slice(0, 300); } })() })));
    return results;
  }

  function collectObjectsFromWorldMapCache() {
    const stores = findWorldMapObjectStores();
    const candidates = [];

    function valuesOfStore(store) {
      if (!store?.value) return [];
      if (Array.isArray(store.value)) return store.value;
      if (store.value instanceof Map) return [...store.value.values()];
      if (store.value && typeof store.value === "object") return Object.values(store.value);
      return [];
    }

    function unwrapPoint(v) {
      if (!v || typeof v !== "object") return null;
      if (looksLikePoint(v)) return v;
      for (const k of ["point", "data", "info", "_data", "raw"]) if (looksLikePoint(v[k])) return v[k];
      return null;
    }

    for (const store of stores) {
      for (const v of valuesOfStore(store)) {
        const point = unwrapPoint(v);
        if (point) candidates.push(point);
      }
    }

    const beforeObjects = state.objectMap.size;
    const beforePlayers = state.playerMap.size;
    collectPointList(candidates, { time: now(), c: "CACHE", seq: "CACHE" });
    return { source: "worldMapCache", candidates: candidates.length, gainedObjects: state.objectMap.size - beforeObjects, gainedPlayers: state.playerMap.size - beforePlayers, totalObjects: state.objectMap.size, totalPlayers: state.playerMap.size };
  }

  async function moveMapToStableUnified(x, y, options = {}) {
    const ctrl = getMapCtrl();
    const wmc = getWorldMapComponent();

    if (!ctrl || !wmc || typeof wmc.onFMessage_WorldMapSetTileView !== "function") {
      console.error("[TopWar] NWorldController 또는 onFMessage_WorldMapSetTileView 없음");
      return null;
    }

    const currentRange = ctrl.getWorldMapDataInstance()?.status?.viewport?.range;
    const serverId = options.serverId ?? options.s ?? currentRange?.k;
    const subMap = options.subMap ?? currentRange?.sub ?? 0;
    const scale = Number(options.scale ?? 0.27);
    const maxRetries = Number(options.maxRetries ?? 1);

    async function waitForTargetServer(timeoutMs = 3500) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const range = ctrl.getWorldMapDataInstance()?.status?.viewport?.range;
        if (String(range?.k ?? "") === String(serverId)) {
          return { ok: true, serverId: range?.k, waitedMs: Date.now() - startedAt };
        }
        await sleep(100);
      }
      const range = ctrl.getWorldMapDataInstance()?.status?.viewport?.range;
      return {
        ok: false,
        expectedServerId: serverId,
        actualServerId: range?.k ?? null,
        waitedMs: Date.now() - startedAt
      };
    }

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const before901 = getCommandCount(901);
      const beforeObjects = state.objectMap.size;
      const beforePlayers = state.playerMap.size;
      let error = null;

      try {
        wmc.onFMessage_WorldMapSetTileView({ data: { x, y, s: serverId, subMap, scale, noZoomChange: true } });
        await sleep(Number(options.afterMoveWait ?? 120));
        try {
          const r = ctrl.getWorldMapDataInstance()?.status?.viewport?.range;
          ctrl.resetMark?.(r?.k ?? serverId);
          ctrl.getWorldMapData?.(true, null);
        } catch (e) {
          console.warn("[TopWar] force getWorldMapData failed:", e);
        }
      } catch (e) {
        error = e;
        console.error("[TopWar] move error:", e);
      }

      const stable = await waitFor901Stable(before901, {
        timeout: Number(options.wait901Timeout ?? 1800),
        quietMs: Number(options.quietMs ?? 220),
        interval: Number(options.interval ?? 30),
        minNewCount: Number(options.minNewCount ?? 1)
      });
      const serverArrival = await waitForTargetServer(
        Number(options.serverTransitionTimeout ?? 3500)
      );

      let cacheCollected = null;
      if (!stable.ok && options.collectCache !== false) cacheCollected = collectObjectsFromWorldMapCache();

      const gainedObjects = state.objectMap.size - beforeObjects;
      const gainedPlayers = state.playerMap.size - beforePlayers;
      const ok = serverArrival.ok && (stable.ok || gainedObjects > 0 || gainedPlayers > 0);

      if (ok) {
        const successResult = {
          ok: true,
          source: stable.ok ? "network901" : "cache",
          x,
          y,
          serverId,
          subMap,
          scale,
          attempt,
          error,
          stable,
          serverArrival,
          cacheCollected,
          gainedObjects,
          gainedPlayers,
          totals: getSummary()
        };
        noteMoveResultForConnectionGuard(successResult, { x, y, serverId, attempt });
        return successResult;
      }

      if (attempt <= maxRetries) {
        console.warn("[TopWar] 목표 서버 이동/데이터 수신 실패, retry:", { x, y, attempt, stable, serverArrival, gainedObjects, gainedPlayers });
        await sleep(Number(options.retryDelay ?? 250));
      }
    }

    const actualServerId = ctrl.getWorldMapDataInstance()?.status?.viewport?.range?.k ?? null;
    const failResult = { ok: false, x, y, serverId, actualServerId, subMap, scale, reason: String(actualServerId ?? "") !== String(serverId) ? "target server transition not confirmed" : "no network 901 and no cache objects", totals: getSummary() };
    noteMoveResultForConnectionGuard(failResult, { x, y, serverId });
    return failResult;
  }

  function buildScanCoords(start, end, step, label) {
    start = Number(start);
    end = Number(end);
    step = Number(step);
    if (!Number.isFinite(start)) throw new Error(`${label} start invalid: ${start}`);
    if (!Number.isFinite(end)) throw new Error(`${label} end invalid: ${end}`);
    if (!Number.isFinite(step)) throw new Error(`${label} step invalid: ${step}`);
    if (step <= 0) throw new Error(`${label} step must be > 0: ${step}`);
    if (end < start) throw new Error(`${label} end < start: ${start} > ${end}`);

    const result = [];
    let v = start;
    let guard = 0;
    while (v <= end) {
      result.push(Math.round(v));
      v += step;
      if (++guard > 2000) throw new Error(`${label} coords too many. start=${start}, end=${end}, step=${step}`);
    }
    const roundedEnd = Math.round(end);
    if (result[result.length - 1] !== roundedEnd) result.push(roundedEnd);
    return result;
  }

  function normalizeStartCorner(value) {
    const raw = String(value ?? "top-left").trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
    const aliases = {
      tl: "top-left", lt: "top-left", "left-top": "top-left", "top-left": "top-left", "좌상": "top-left", "좌측상단": "top-left",
      tr: "top-right", rt: "top-right", "right-top": "top-right", "top-right": "top-right", "우상": "top-right", "우측상단": "top-right",
      bl: "bottom-left", lb: "bottom-left", "left-bottom": "bottom-left", "bottom-left": "bottom-left", "좌하": "bottom-left", "좌측하단": "bottom-left",
      br: "bottom-right", rb: "bottom-right", "right-bottom": "bottom-right", "bottom-right": "bottom-right", "우하": "bottom-right", "우측하단": "bottom-right"
    };
    return aliases[raw] || "top-left";
  }

  function buildScanPlan(xs, ys, options = {}) {
    const startCorner = normalizeStartCorner(options.startCorner ?? options.corner ?? options.origin);
    const snake = options.snake !== false;
    const startFromRight = startCorner.endsWith("right");
    const startFromBottom = startCorner.startsWith("bottom");
    const yOrder = startFromBottom ? [...ys].reverse() : [...ys];
    const baseXOrder = startFromRight ? [...xs].reverse() : [...xs];
    return yOrder.map((y, rowIndex) => ({
      rowIndex,
      y,
      xOrder: snake && rowIndex % 2 === 1 ? [...baseXOrder].reverse() : [...baseXOrder]
    }));
  }

  async function scanMapUnified(options = {}) {
    const ctrl = getMapCtrl();
    if (!ctrl) {
      console.error("[TopWar] NWorldController를 찾을 수 없습니다. 월드맵 화면에서 실행하세요.");
      return null;
    }

    const r = ctrl.getWorldMapDataInstance()?.status?.viewport?.range;
    const serverId = options.serverId ?? r?.k;
    const subMap = options.subMap ?? r?.sub ?? 0;
    const startX = options.startX ?? 0;
    const startY = options.startY ?? 0;
    const endX = options.endX ?? 815;
    const endY = options.endY ?? 950;
    const stepX = options.stepX ?? 45;
    const stepY = options.stepY ?? 30;
    const scale = options.scale ?? 0.27;

    let xs, ys;
    try {
      xs = buildScanCoords(startX, endX, stepX, "x");
      ys = buildScanCoords(startY, endY, stepY, "y");
    } catch (e) {
      console.error("[TopWar] 좌표 생성 실패:", e.message, { startX, startY, endX, endY, stepX, stepY });
      return null;
    }

    if (options.clearBeforeStart) clearCollected({ keepWatch: true });
    state.debug.log901 = !!options.log901;

    let count = 0;
    let failCount = 0;
    const total = xs.length * ys.length;
    const startedAt = Date.now();
    const scanPlan = buildScanPlan(xs, ys, { startCorner: options.startCorner ?? "top-left", snake: options.snake ?? true });

    console.log("[TopWar] unified scan start:", {
      serverId, subMap, startX, startY, endX, endY, stepX, stepY,
      xCount: xs.length, yCount: ys.length, total, scale,
      startCorner: normalizeStartCorner(options.startCorner ?? "top-left"),
      snake: options.snake !== false
    });

    for (const rowInfo of scanPlan) {
      const y = rowInfo.y;
      const xOrder = rowInfo.xOrder;
      for (const x of xOrder) {
        const result = await moveMapToStableUnified(x, y, {
          serverId, subMap, scale,
          afterMoveWait: options.afterMoveWait ?? 120,
          wait901Timeout: options.wait901Timeout ?? 1800,
          quietMs: options.quietMs ?? 220,
          interval: options.interval ?? 30,
          maxRetries: options.maxRetries ?? 1,
          retryDelay: options.retryDelay ?? 250,
          collectCache: options.collectCache ?? true
        });

        count++;
        if (!result?.ok) failCount++;
        const summary = getSummary();

        if (count % (options.logEvery ?? 20) === 0 || !result?.ok || result?.gainedObjects > 0 || result?.gainedPlayers > 0) {
          const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
          const remainSec = count > 0 ? Math.round((elapsedSec / count) * (total - count)) : null;
          console.log(`[TopWar] scan ${count}/${total}, coord=(${x},${y}), ok=${result?.ok}, source=${result?.source}, players=${summary.players}, alliances=${summary.alliances}, objects=${summary.objects}, reps=${summary.allianceRepresentatives}, gainedObj=${result?.gainedObjects ?? 0}, gainedPlayer=${result?.gainedPlayers ?? 0}, fail=${failCount}, elapsed=${elapsedSec}s, remain≈${remainSec}s`);
        }
      }
    }

    const finalSummary = { ...getSummary(), serverId, subMap, totalMoves: count, failCount, elapsedSec: Math.round((Date.now() - startedAt) / 1000) };
    console.log("[TopWar] unified scan done:", finalSummary);
    objectTypeSummary();
    if (options.autoExport) exportUnifiedMapData({ pretty: !!options.prettyExport });
    return { summary: finalSummary, players: players(), alliances: alliances(), allianceRepresentatives: allianceRepresentatives(), objects: objects() };
  }

  function players() { return [...state.playerMap.values()]; }
  function playerValues() { return state.playerMap.values(); }
  function alliances() { return [...state.allianceMap.values()]; }
  function objects() { return [...state.objectMap.values()]; }
  function allianceRepresentatives() { return [...state.allianceRepresentativeMap.values()].sort((a, b) => Number(b.power ?? 0) - Number(a.power ?? 0)); }

  function getSummary() {
    return {
      players: state.playerMap.size,
      maximumPlayers: state.maxStoredPlayers,
      playerLimitReached: state.playerLimitReached === true,
      droppedPlayers: Number(state.droppedPlayers || 0),
      alliances: state.allianceMap.size,
      objects: state.objectMap.size,
      allianceRepresentatives: state.allianceRepresentativeMap.size,
      pointTypeCount: Object.keys(state.objectsByType).length,
      thiefQueue: state.thiefQueue.length
    };
  }

  function objectTypeSummary() {
    const rows = Object.entries(state.objectsByType).map(([pointType, map]) => ({
      pointType: Number(pointType),
      pointTypeName: state.pointTypeNames[pointType] ?? state.pointTypeNames[Number(pointType)] ?? `UNKNOWN_POINT_TYPE_${pointType}`,
      count: map.size
    })).sort((a, b) => a.pointType - b.pointType);
    window.TOPWAR_LOG_CONTROL.table(rows);
    return rows;
  }

  function objectsByPointType(pointType, limit = 300) {
    const map = state.objectsByType[String(pointType)];
    const rows = map ? [...map.values()] : [];
    window.TOPWAR_LOG_CONTROL.table(rows.slice(0, limit).map((o, i) => ({
      i,
      pointType: o.pointType,
      pointTypeName: o.pointTypeName,
      id: o.id,
      serverId: o.serverId,
      x: o.x,
      y: o.y,
      uid: o.uid,
      username: o.username,
      level: o.level,
      power: o.power,
      allianceId: o.allianceId,
      allianceTag: o.allianceTag,
      itemId: o.itemId,
      amount: o.amount,
      buildId: o.buildId,
      owner: o.owner
    })));
    console.log(`[TopWar] pointType=${pointType}, count=${rows.length}`);
    return rows;
  }

  function getObjectsByTypeRaw(pointType) {
    const map = state.objectsByType[String(pointType)];
    return map ? [...map.values()] : [];
  }

  function playerTable(limit = 300) {
    const rows = players();
    window.TOPWAR_LOG_CONTROL.table(rows.slice(0, limit).map((p, i) => ({
      i,
      uid: p.uid,
      username: p.username,
      serverId: p.serverId,
      x: p.x,
      y: p.y,
      level: p.level,
      power: p.power,
      allianceId: p.allianceId,
      allianceTag: p.allianceTag,
      nationalflag: p.nationalflag,
      hasCityRewardField: p.hasCityRewardField === true,
      cityReward: p.cityReward == null ? p.cityReward : JSON.stringify(p.cityReward),
      playerInfoKeys: Object.keys(p.playerInfo || {}).length,
      seenCount: p.seenCount ?? 1
    })));
    console.log("[TopWar] players:", rows.length);
    return rows;
  }

  function allianceTable(limit = 300) {
    const rows = alliances();
    window.TOPWAR_LOG_CONTROL.table(rows.slice(0, limit).map((a, i) => ({
      i,
      allianceId: a.allianceId,
      allianceTag: a.allianceTag,
      serverId: a.serverId,
      playerCount: a.playerCount,
      sampleUid: a.samplePlayers?.[0]?.uid,
      sampleName: a.samplePlayers?.[0]?.username
    })));
    console.log("[TopWar] alliances:", rows.length);
    return rows;
  }

  function allianceRepresentativeTable(limit = 300) {
    const rows = allianceRepresentatives();
    window.TOPWAR_LOG_CONTROL.table(rows.slice(0, limit).map((r, i) => ({
      i,
      allianceId: r.allianceId,
      allianceTag: r.allianceTag,
      serverId: r.serverId,
      uid: r.uid,
      username: r.username,
      x: r.x,
      y: r.y,
      level: r.level,
      power: r.power
    })));
    console.log("[TopWar] alliance representatives:", rows.length);
    return rows;
  }

  function trimRuntimeMemory(options = {}) {
    const packetLimit = Math.max(4, Number(options.packetLimit ?? state.maxRecentPackets ?? 24));
    const outgoingLimit = Math.max(4, Number(options.outgoingLimit ?? 16));

    if (Array.isArray(state.recentPackets) && state.recentPackets.length > packetLimit) {
      state.recentPackets.splice(0, state.recentPackets.length - packetLimit);
    }
    if (Array.isArray(state.recentOutgoing) && state.recentOutgoing.length > outgoingLimit) {
      state.recentOutgoing.splice(0, state.recentOutgoing.length - outgoingLimit);
    }

    // worldObjectStores는 Cocos 객체 직접 참조를 절대 장기 보관하지 않는다.
    state.worldObjectStores = null;
    return {
      recentPackets: state.recentPackets?.length ?? 0,
      recentOutgoing: state.recentOutgoing?.length ?? 0,
      players: state.playerMap?.size ?? 0,
      objects: state.objectMap?.size ?? 0
    };
  }

  function clearCollected(options = {}) {
    state.objectMap = new Map();
    state.objectsByType = {};
    state.playerMap = new Map();
    state.playerLimitReached = false;
    state.droppedPlayers = 0;
    state.allianceMap = new Map();
    state.allianceRepresentativeMap = new Map();
    state.recentPackets = [];
    state.recentOutgoing = [];
    if (state.thiefBuffer) {
      state.thiefBuffer.events = [];
      state.thiefBuffer.nextEventId = 1;
      state.thiefBuffer.stats ??= {};
      state.thiefBuffer.stats.lastCollected = null;
    }
    state.commandCount = new Map();
    state.worldObjectStores = null;

    if (!options.keepWatch) {
      state.watch133.running = false;
      state.watch133.paused = false;
      state.watch133.pauseReason = null;
      state.watch133.pauseInfo = null;
      state.watch133.handledKeys = new Set();
      state.watch133.sharedLocationKeys = new Set();
      state.watch133.lastFound = null;
      state.watch133.sentMessages = [];
    }

    console.log("[TopWar] collected data cleared");
    return true;
  }

  function downloadJson(data, filename, pretty = false) {
    const blob = new Blob([pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportUnifiedMapData(options = {}) {
    const objectsByType = {};
    for (const [pointType, map] of Object.entries(state.objectsByType)) {
      objectsByType[pointType] = {
        pointType: Number(pointType),
        pointTypeName: state.pointTypeNames[pointType] ?? state.pointTypeNames[Number(pointType)] ?? `UNKNOWN_POINT_TYPE_${pointType}`,
        count: map.size,
        rows: [...map.values()]
      };
    }
    const data = {
      exportedAt: now(),
      summary: { ...getSummary(), pointTypes: objectTypeSummary() },
      players: players(),
      alliances: alliances(),
      allianceRepresentatives: allianceRepresentatives(),
      objects: objects(),
      objectsByType,
      thiefQueue: thiefQueue()
    };
    downloadJson(data, `topwar-unified-map-${data.summary.players}p-${data.summary.objects}o-${Date.now()}.json`, !!options.pretty);
    return data;
  }

  function exportPlayersOnly(options = {}) {
    const data = { exportedAt: now(), summary: { count: state.playerMap.size }, players: players() };
    downloadJson(data, `topwar-players-${data.summary.count}-${Date.now()}.json`, !!options.pretty);
    return data;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  function formatThiefClipboardMessage(obj) {
    const x = obj?.x ?? "?";
    const y = obj?.y ?? "?";
    return `${x}:${y}`;
  }

  async function enqueueThief(obj, options = {}) {
    const message = formatThiefClipboardMessage(obj);
    const key = obj?.objectKey ?? `${obj?.serverId ?? "?"}:${obj?.pointType ?? "?"}:${obj?.id ?? "?"}:${obj?.x ?? "?"}:${obj?.y ?? "?"}`;
    const item = {
      index: state.thiefQueue.length + 1,
      time: now(),
      key,
      message,
      copied: false,
      serverId: obj?.serverId ?? options.serverId ?? range()?.k ?? null,
      pointType: obj?.pointType ?? options.pointType ?? 133,
      pointTypeName: obj?.pointTypeName ?? null,
      x: obj?.x ?? null,
      y: obj?.y ?? null,
      id: obj?.id ?? null,
      object: obj
    };

    if (options.copyToClipboard !== false) item.copied = await copyText(message);
    state.thiefQueue.push(item);
    while (state.thiefQueue.length > Number(state.maxThiefQueue ?? 200)) state.thiefQueue.shift();
    state.watch133.lastFound = obj;
    state.watch133.sentMessages.push({ time: item.time, message, object: obj, action: "clipboard-and-queue" });
    while (state.watch133.sentMessages.length > 200) state.watch133.sentMessages.shift();

    // GitHub 업로드는 발견 건별로 수행하지 않는다.
    // multi-server 도둑찾기에서 한 서버의 전체 지도 스캔이 정상 완료된 뒤
    // 해당 서버의 현재 관측 결과를 data/thieves.json에 서버 단위로 교체한다.

    console.log("%c🚨 도둑 발견 - 좌표 복사 및 큐 저장", "font-size:30px;font-weight:900;color:white;background:#d32f2f;padding:12px 18px;border-radius:8px;");
    console.log(`%c[TopWar] ${message}`, "font-size:30px;font-weight:900;color:#d32f2f;background:#fff3cd;padding:10px 16px;border:3px solid #d32f2f;border-radius:6px;");
    window.TOPWAR_LOG_CONTROL.table([{ index: item.index, message: item.message, copied: item.copied, serverId: item.serverId, pointType: item.pointType, pointTypeName: item.pointTypeName, x: item.x, y: item.y, id: item.id, key: item.key }]);

    return { ok: true, action: "clipboard-and-queue", message, copied: item.copied, item };
  }

  async function notifyWatchedPoint(obj, options = {}) {
    return enqueueThief(obj, {
      ...options,
      copyToClipboard: options.copyToClipboard ?? true,
    });
  }

  function thiefQueue() { return state.thiefQueue; }

  function thiefQueueTable(limit = 100) {
    const rows = thiefQueue();
    window.TOPWAR_LOG_CONTROL.table(rows.slice(-limit).map((r, i) => ({
      i,
      index: r.index,
      time: r.time,
      message: r.message,
      copied: r.copied,
      serverId: r.serverId,
      pointType: r.pointType,
      pointTypeName: r.pointTypeName,
      x: r.x,
      y: r.y,
      id: r.id,
      key: r.key
    })));
    console.log("[TopWar] thiefQueue count:", rows.length);
    return rows;
  }

  function lastThief() { return thiefQueue().at(-1) ?? null; }

  async function copyLastThief() {
    const last = lastThief();
    if (!last) {
      console.warn("[TopWar] 복사할 도둑 좌표가 없습니다.");
      return false;
    }
    const ok = await copyText(last.message);
    console.log("[TopWar] last thief copied:", ok, last.message);
    return ok;
  }

  async function copyThiefAt(index) {
    const item = thiefQueue().find(x => Number(x.index) === Number(index));
    if (!item) {
      console.warn("[TopWar] 해당 index의 도둑 좌표가 없습니다:", index);
      return false;
    }
    const ok = await copyText(item.message);
    console.log("[TopWar] thief copied:", ok, item.message, item);
    return ok;
  }

  function clearThiefQueue() {
    state.thiefQueue = [];
    console.log("[TopWar] thiefQueue cleared");
    return true;
  }

  function resetThiefWatch() {
    state.thiefQueue = [];
    state.watch133.running = false;
    state.watch133.paused = false;
    state.watch133.pauseReason = null;
    state.watch133.pauseInfo = null;
    state.watch133.handledKeys = new Set();
    state.watch133.sharedLocationKeys = new Set();
    state.watch133.lastFound = null;
    state.watch133.sentMessages = [];
    console.log("[TopWar] thief watch reset");
    return true;
  }

  function stopWatch133() {
    state.watch133.running = false;
    state.watch133.paused = false;
    console.log("[TopWar] watch stopped");
    return true;
  }

  function pauseWatch133(reason = "manual pause", info = null) {
    state.watch133.paused = true;
    state.watch133.pauseReason = reason;
    state.watch133.pauseInfo = info;
    console.warn("[TopWar] watch paused:", { reason, info });
    return true;
  }

  function resumeWatch133() {
    state.watch133.paused = false;
    state.watch133.pauseReason = null;
    console.warn("[TopWar] watch resumed");
    return true;
  }

  function watch133Status() {
    const status = {
      running: !!state.watch133.running,
      paused: !!state.watch133.paused,
      pauseReason: state.watch133.pauseReason,
      pauseInfo: state.watch133.pauseInfo,
      lastFound: state.watch133.lastFound,
      queueLength: state.thiefQueue.length,
      handled: state.watch133.handledKeys?.size ?? 0,
      sharedLocations: state.watch133.sharedLocationKeys?.size ?? 0
    };
    console.log("[TopWar] watch133 status:", status);
    return status;
  }

  async function waitWhilePaused() {
    while (state.watch133.running && state.watch133.paused) await sleep(500);
  }

  function clickCanvasClient(clientX, clientY) {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      console.error("[TopWar] canvas를 찾을 수 없습니다.");
      return false;
    }

    function fireMouse(type, buttons = 1) {
      canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY,
        button: 0,
        buttons
      }));
    }

    function firePointer(type, buttons = 1) {
      try {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY,
          screenX: clientX,
          screenY: clientY,
          button: 0,
          buttons
        }));
      } catch {}
    }

    firePointer("pointermove", 0);
    fireMouse("mousemove", 0);
    firePointer("pointerdown", 1);
    fireMouse("mousedown", 1);
    firePointer("pointerup", 0);
    fireMouse("mouseup", 0);
    fireMouse("click", 0);
    return true;
  }

  function clickCanvasRatio(rx, ry) {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      console.error("[TopWar] canvas를 찾을 수 없습니다.");
      return false;
    }
    const rect = canvas.getBoundingClientRect();
    return clickCanvasClient(rect.left + rect.width * Number(rx), rect.top + rect.height * Number(ry));
  }

  function clickCanvasCenter() {
    return clickCanvasRatio(0.5, 0.5);
  }

  function findNodesByNameContains(namePart) {
    if (!window.cc?.director) {
      console.error("[TopWar] cc.director 없음");
      return [];
    }

    const scene = cc.director.getScene();
    const results = [];

    function walk(node, path = node.name, depth = 0) {
      if (!node || depth > 45) return;
      const nodeName = String(node.name || "");
      if (nodeName.includes(namePart)) {
        results.push({ node, nodeName, path, active: node.active, activeInHierarchy: node.activeInHierarchy });
      }
      for (const child of node.children || []) walk(child, `${path}/${child.name}`, depth + 1);
    }

    walk(scene);
    if (state.debug.logNodeSearch) {
      window.TOPWAR_LOG_CONTROL.table(results.map((r, i) => ({ i, nodeName: r.nodeName, active: r.active, activeInHierarchy: r.activeInHierarchy, path: r.path })));
    }
    return results;
  }

  function findActiveNodeByNameContains(namePart) {
    const results = findNodesByNameContains(namePart);
    return results.find(r => r.activeInHierarchy)?.node || results[0]?.node || null;
  }

  async function waitForNodeByNameContains(namePart, options = {}) {
    const timeout = Number(options.timeout ?? 4000);
    const interval = Number(options.interval ?? 100);
    const activeOnly = options.activeOnly !== false;
    const started = Date.now();

    while (Date.now() - started < timeout) {
      const list = findNodesByNameContains(namePart);
      const hit = activeOnly
        ? list.find(x => x.activeInHierarchy)?.node
        : list[0]?.node;
      if (hit) return { ok: true, node: hit, waitedMs: Date.now() - started, namePart };
      await sleep(interval);
    }

    return { ok: false, node: null, waitedMs: Date.now() - started, namePart, reason: "timeout" };
  }

  function getNodeTextDeep(node) {
    const texts = [];
    function walk(n, depth = 0) {
      if (!n || depth > 10) return;
      try {
        const label = n.getComponent?.(cc.Label);
        if (label?.string) texts.push(label.string);
      } catch {}
      try {
        const richText = n.getComponent?.(cc.RichText);
        if (richText?.string) texts.push(richText.string);
      } catch {}
      for (const child of n.children || []) walk(child, depth + 1);
    }
    walk(node);
    return texts.join(" ").trim();
  }

  function normalizeChatChannelText(text) {
    return String(text ?? "").replace(/\s+/g, "").replace(/[^\w가-힣]/g, "").toLowerCase();
  }

  function getNodeWorldPositionSafe(node) {
    try {
      if (node.convertToWorldSpaceAR) {
        const p = node.convertToWorldSpaceAR(cc.v2(0, 0));
        return { x: p.x, y: p.y };
      }
    } catch {}
    try {
      const p = node.getPosition();
      return { x: p.x, y: p.y };
    } catch {}
    return null;
  }

  function triggerCocosButtonSafe(node) {
    if (!node) {
      console.error("[TopWar] 클릭할 node가 없습니다.");
      return false;
    }

    try {
      const btn = node.getComponent(cc.Button);
      if (btn?.clickEvents?.length && cc.Component?.EventHandler?.emitEvents) {
        cc.Component.EventHandler.emitEvents(btn.clickEvents, { type: "click", target: node, currentTarget: node });
        console.log("[TopWar] cc.Button clickEvents emitted:", node.name);
        return true;
      }
    } catch (e) {
      console.warn("[TopWar] cc.Button clickEvents 실패:", e);
    }

    try {
      node.emit("click", { type: "click", target: node, currentTarget: node });
      console.log("[TopWar] node.emit('click'):", node.name);
      return true;
    } catch (e) {
      console.warn("[TopWar] node.emit click 실패:", e);
    }

    return false;
  }

  function listButtonsUnderNode(root, options = {}) {
    if (!root) return [];
    const maxDepth = Number(options.maxDepth ?? 35);
    const results = [];

    function walk(node, path = node.name, depth = 0) {
      if (!node || depth > maxDepth) return;
      let hasButton = false;
      const components = [];
      try {
        hasButton = !!node.getComponent(cc.Button);
        for (const c of node.getComponents(cc.Component) || []) components.push(c.constructor?.name || c.name || "Component");
      } catch {}

      if (node.activeInHierarchy && hasButton) {
        results.push({
          node,
          nodeName: node.name,
          path,
          text: getNodeTextDeep(node),
          normalizedText: normalizeChatChannelText(getNodeTextDeep(node)),
          worldPosition: getNodeWorldPositionSafe(node),
          components
        });
      }

      for (const child of node.children || []) walk(child, `${path}/${child.name}`, depth + 1);
    }

    walk(root);
    return results;
  }

  function findCrossTreasurePopup() {
    const popup = findActiveNodeByNameContains("NWorldMapCrossTreasure");
    if (!popup) console.warn("[TopWar] NWorldMapCrossTreasure 팝업을 찾지 못했습니다.");
    return popup;
  }

  function listCrossTreasureButtons() {
    const popup = findCrossTreasurePopup();
    if (!popup) return [];
    const results = listButtonsUnderNode(popup);
    window.TOPWAR_LOG_CONTROL.table(results.map((r, i) => ({
      i,
      nodeName: r.nodeName,
      text: r.text,
      wx: r.worldPosition?.x,
      wy: r.worldPosition?.y,
      path: r.path,
      components: r.components.join(", ")
    })));
    window.__TOPWAR_CROSS_TREASURE_BUTTONS__ = results;
    return results;
  }

  function clickCrossTreasureShareButton(index = 8) {
    const buttons = listCrossTreasureButtons();
    if (!buttons.length) return { ok: false, reason: "no buttons" };
    const target = buttons[Number(index)];
    if (!target) return { ok: false, reason: "share button index not found", index, count: buttons.length };
    const ok = triggerCocosButtonSafe(target.node);
    return {
      ok,
      target: {
        index: buttons.indexOf(target),
        nodeName: target.nodeName,
        text: target.text,
        path: target.path,
        worldPosition: target.worldPosition,
        components: target.components
      }
    };
  }

  function findNewChatListPanel() {
    const panel = findActiveNodeByNameContains("newChatListPanel");
    if (!panel) console.warn("[TopWar] newChatListPanel을 찾지 못했습니다.");
    return panel;
  }

  function listNewChatListPanelButtons() {
    const panel = findNewChatListPanel();
    if (!panel) return [];
    const results = listButtonsUnderNode(panel);
    window.TOPWAR_LOG_CONTROL.table(results.map((r, i) => ({
      i,
      nodeName: r.nodeName,
      text: r.text,
      normalizedText: r.normalizedText,
      wx: r.worldPosition?.x,
      wy: r.worldPosition?.y,
      path: r.path,
      components: r.components.join(", ")
    })));
    window.__TOPWAR_NEW_CHAT_LIST_BUTTONS__ = results;
    return results;
  }

  function resolveChatChannelKeywords(channel) {
    const key = normalizeChatChannelText(channel);
    const presets = {
      guild: ["길드", "guild", "alliance"],
      alliance: ["길드", "guild", "alliance"],
      길드: ["길드", "guild", "alliance"],
      world: ["월드", "world"],
      월드: ["월드", "world"],
      storm: ["폭풍전장채널", "폭풍전장", "폭풍", "storm", "battlefield"],
      battlefield: ["폭풍전장채널", "폭풍전장", "폭풍", "storm", "battlefield"],
      폭풍: ["폭풍전장채널", "폭풍전장", "폭풍"],
      폭풍전장: ["폭풍전장채널", "폭풍전장", "폭풍"],
      sector: ["섹터채널", "섹터", "sector"],
      섹터: ["섹터채널", "섹터", "sector"]
    };
    const raw = presets[key] || [String(channel)];
    return raw.map(x => normalizeChatChannelText(x));
  }

  function findNewChatListPanelButtonByText(channel = "길드") {
    const buttons = listNewChatListPanelButtons();
    const keywords = resolveChatChannelKeywords(channel);
    if (!buttons.length) return null;

    const exact = buttons.find(btn => keywords.some(k => btn.normalizedText === k));
    if (exact) {
      console.log("[TopWar] channel exact matched:", { channel, keywords, text: exact.text, path: exact.path });
      return exact;
    }

    const partial = buttons.find(btn => keywords.some(k => btn.normalizedText.includes(k) || k.includes(btn.normalizedText)));
    if (partial) {
      console.log("[TopWar] channel partial matched:", { channel, keywords, text: partial.text, path: partial.path });
      return partial;
    }

    console.warn("[TopWar] 채널 버튼을 텍스트로 찾지 못했습니다:", {
      channel,
      keywords,
      buttons: buttons.map(b => ({ text: b.text, normalizedText: b.normalizedText, path: b.path }))
    });
    return null;
  }

  function clickNewChatListPanelButton(channel = "길드") {
    const target = findNewChatListPanelButtonByText(channel);
    if (!target) return { ok: false, reason: "channel button text not found", channel };
    const ok = triggerCocosButtonSafe(target.node);
    return {
      ok,
      channel,
      target: {
        nodeName: target.nodeName,
        text: target.text,
        normalizedText: target.normalizedText,
        path: target.path,
        worldPosition: target.worldPosition,
        components: target.components
      }
    };
  }

  async function waitForCrossTreasurePopup(options = {}) {
    return waitForNodeByNameContains("NWorldMapCrossTreasure", { timeout: options.timeout ?? 5000, interval: options.interval ?? 100, activeOnly: true });
  }

  async function waitForNewChatListPanel(options = {}) {
    return waitForNodeByNameContains("newChatListPanel", { timeout: options.timeout ?? 5000, interval: options.interval ?? 100, activeOnly: true });
  }

  function getThiefLocationKey(obj, options = {}) {
    const serverId = obj?.serverId ?? options.serverId ?? range()?.k ?? "?";
    const x = obj?.x ?? "?";
    const y = obj?.y ?? "?";
    return `${serverId}:${x}:${y}`;
  }

  function getThiefTrackingKey(obj, options = {}) {
    const serverId = obj?.serverId ?? options.serverId ?? range()?.k ?? "?";
    const id = obj?.id;

    // 이동 중 좌표가 바뀌어도 동일한 월드 오브젝트로 추적하기 위해 ID를 우선 사용한다.
    if (id != null && String(id).trim() !== "") {
      return `${serverId}:id:${id}`;
    }

    // ID가 없는 예외 데이터만 좌표 기반으로 처리한다.
    return `${serverId}:coord:${obj?.x ?? "?"}:${obj?.y ?? "?"}`;
  }

  function ensurePendingThiefState() {
    state.pendingThiefShares ??= [];
    state.pendingThiefObjectKeys ??= new Set();
    state.sharedThiefObjectKeys ??= new Set();
    state.resolvedThiefObjectKeys ??= new Set();
    state.nextPendingThiefIndex ??= 1;
    return state.pendingThiefShares;
  }

  function pendingThiefShares() {
    ensurePendingThiefState();
    return state.pendingThiefShares;
  }

  function findPendingThiefByTrackingKey(trackingKey) {
    return pendingThiefShares().find(item =>
      item.trackingKey === trackingKey &&
      !["expired", "cancelled"].includes(item.status)
    );
  }

  async function scheduleThiefShare(obj, options = {}) {
    ensurePendingThiefState();

    const trackingKey = getThiefTrackingKey(obj, options);
    const existing = findPendingThiefByTrackingKey(trackingKey);
    const observedAtMs = Date.now();

    // 한 번 공유되었거나 만료 확인으로 종료된 동일 도둑은 다시 대기큐에 넣지 않는다.
    if (state.resolvedThiefObjectKeys.has(trackingKey)) {
      return { ok: true, skipped: true, reason: "already-resolved", trackingKey };
    }

    if (existing) {
      existing.lastSeenAt = new Date(observedAtMs).toISOString();
      existing.lastSeenAtMs = observedAtMs;
      existing.latestObject = obj;
      existing.x = obj?.x ?? existing.x;
      existing.y = obj?.y ?? existing.y;
      existing.id = obj?.id ?? existing.id;
      const oldLocationKey = existing.locationKey;
      existing.locationKey = getThiefLocationKey(obj, options);
      if (oldLocationKey !== existing.locationKey) {
        existing.moveCount = Number(existing.moveCount ?? 0) + 1;
        existing.lastMoveAt = existing.lastSeenAt;
        existing.locationChangedSinceShare = existing.locationKey !== existing.lastSharedLocationKey;
      }
      existing.previousX = existing.x;
      existing.previousY = existing.y;

      return { ok: true, duplicate: true, updated: true, trackingKey, item: existing };
    }

    const delayMs = Math.max(0, Number(options.shareDelayMs ?? 3 * 60 * 1000));
    const shareAtMs = observedAtMs + delayMs;
    const item = {
      pendingIndex: state.nextPendingThiefIndex++,
      trackingKey,
      locationKey: getThiefLocationKey(obj, options),
      status: "waiting",
      foundAt: new Date(observedAtMs).toISOString(),
      foundAtMs: observedAtMs,
      lastSeenAt: new Date(observedAtMs).toISOString(),
      lastSeenAtMs: observedAtMs,
      shareAt: new Date(shareAtMs).toISOString(),
      shareAtMs,
      delayMs,
      repeatShareIntervalMs: Math.max(1000, Number(options.repeatShareIntervalMs ?? 5 * 60 * 1000)),
      nextShareAtMs: shareAtMs,
      nextShareAt: new Date(shareAtMs).toISOString(),
      lastSharedAt: null,
      lastSharedAtMs: null,
      lastSharedLocationKey: null,
      locationChangedSinceShare: false,
      shareCount: 0,
      serverId: obj?.serverId ?? options.serverId ?? range()?.k ?? null,
      pointType: obj?.pointType ?? options.pointType ?? 133,
      id: obj?.id ?? null,
      x: obj?.x ?? null,
      y: obj?.y ?? null,
      previousX: obj?.x ?? null,
      previousY: obj?.y ?? null,
      moveCount: 0,
      latestObject: obj,
      shareOptions: { ...options }
    };

    state.pendingThiefShares.push(item);
    state.pendingThiefObjectKeys.add(trackingKey);

    const notifyResult = await notifyWatchedPoint(obj, {
      ...options,
      sendChat: false,
      copyToClipboard: options.copyToClipboard ?? true,
    });
    item.notifyResult = notifyResult;

    console.log("[TopWar] 도둑 지연 공유 예약:", {
      delayMs,
      delayMinutes: Math.round(delayMs / 60000),
      trackingKey,
      foundAt: item.foundAt,
      shareAt: item.shareAt,
      x: item.x,
      y: item.y,
      id: item.id
    });

    return { ok: true, scheduled: true, trackingKey, item, notifyResult };
  }

  function updatePendingThiefObservation(obj, options = {}) {
    ensurePendingThiefState();
    const trackingKey = getThiefTrackingKey(obj, options);
    const item = findPendingThiefByTrackingKey(trackingKey);
    if (!item) return null;

    const oldX = item.x;
    const oldY = item.y;
    const observedAtMs = Date.now();

    item.lastSeenAt = new Date(observedAtMs).toISOString();
    item.lastSeenAtMs = observedAtMs;
    item.latestObject = obj;
    item.x = obj?.x ?? item.x;
    item.y = obj?.y ?? item.y;
    item.id = obj?.id ?? item.id;
    item.locationKey = getThiefLocationKey(obj, options);

    if (oldX !== item.x || oldY !== item.y) {
      item.moveCount = Number(item.moveCount ?? 0) + 1;
      item.lastMoveAt = item.lastSeenAt;
      item.lastMove = { fromX: oldX, fromY: oldY, toX: item.x, toY: item.y };
      console.log("[TopWar] 예약 도둑 이동 감지 - 최신 좌표 갱신:", {
        trackingKey,
        from: `${oldX}:${oldY}`,
        to: `${item.x}:${item.y}`,
        moveCount: item.moveCount
      });
    }

    return item;
  }

  function removePendingThiefItem(item, status, reason = null) {
    ensurePendingThiefState();
    if (!item) return false;

    item.status = status;
    item.finishedAt = now();
    item.finishReason = reason;

    const index = state.pendingThiefShares.indexOf(item);
    if (index >= 0) state.pendingThiefShares.splice(index, 1);
    state.pendingThiefObjectKeys.delete(item.trackingKey);
    return index >= 0;
  }

  async function processDuePendingThief(item, options = {}) {
    if (!item || item.processing || item.status !== "waiting") return null;

    const nowMs = Date.now();
    if (nowMs < Number(item.shareAtMs)) return null;

    item.processing = true;
    item.status = "checking";
    item.processStartedAt = now();

    try {
      // 예약 시간이 된 경우에만 저장 좌표를 딱 한 번 다시 확인한다.
      // 기존 누적 캐시의 오래된 객체를 현재 존재하는 것으로 오인하지 않도록 검사 시작 시각을 기록한다.
      const checkStartedAtMs = Date.now();
      const moveResult = await moveMapToStableUnified(item.x, item.y, {
        serverId: item.serverId ?? options.serverId ?? range()?.k,
        subMap: options.subMap ?? item.shareOptions?.subMap ?? 0,
        scale: options.foundScale ?? item.shareOptions?.foundScale ?? 1,
        afterMoveWait: options.foundAfterMoveWait ?? 500,
        wait901Timeout: options.foundWait901Timeout ?? 2200,
        quietMs: options.foundQuietMs ?? 300,
        maxRetries: options.foundMaxRetries ?? 1,
        collectCache: true
      });

      const currentObjects = getObjectsByTypeRaw(item.pointType ?? 133);
      const latestObject = currentObjects.find(candidate => {
        const sameObject = getThiefTrackingKey(candidate, { serverId: item.serverId }) === item.trackingKey;
        const observedAtMs = Date.parse(candidate?.time ?? "");
        const freshlyObserved = Number.isFinite(observedAtMs) && observedAtMs >= checkStartedAtMs;
        return sameObject && freshlyObserved;
      });

      if (!latestObject) {
        state.resolvedThiefObjectKeys.add(item.trackingKey);
        removePendingThiefItem(item, "expired", "not-found-at-share-time");
        console.log("[TopWar] 예약 시간이 되었지만 도둑이 없어 대기큐에서 삭제:", {
          trackingKey: item.trackingKey,
          x: item.x,
          y: item.y,
          moveResult
        });
        return { ok: false, removed: true, reason: "not-found-at-share-time", item, moveResult };
      }

      const result = await handleFoundAutoShare(latestObject, {
        ...item.shareOptions,
        ...options,
        skipNotify: true,
        skipMoveToFound: true,
        copyToClipboard: false
      });

      const success = !!result?.shareResult?.ok;
      if (success) {
        const locationKey = getThiefLocationKey(latestObject, { serverId: item.serverId });
        state.sharedThiefObjectKeys.add(item.trackingKey);
        state.resolvedThiefObjectKeys.add(item.trackingKey);
        state.watch133.sharedLocationKeys.add(locationKey);
        removePendingThiefItem(item, "shared", "shared-once");
      } else {
        // 재시도하지 않고 큐에서 제거하며 동일 도둑은 다시 예약하지 않는다.
        state.resolvedThiefObjectKeys.add(item.trackingKey);
        removePendingThiefItem(item, "failed", "share-failed");
      }

      return { ok: success, removed: true, reason: success ? "shared-once" : "share-failed", item, result, moveResult };
    } finally {
      item.processing = false;
    }
  }

  async function processDuePendingThiefQueue(options = {}) {
    ensurePendingThiefState();
    const dueItems = [...state.pendingThiefShares].filter(item =>
      item?.status === "waiting" &&
      !item.processing &&
      Date.now() >= Number(item.shareAtMs)
    );

    const results = [];
    for (const item of dueItems) {
      const result = await processDuePendingThief(item, options);
      if (result) results.push(result);
    }
    return results;
  }

  function pendingThiefShareTable(limit = 100) {
    const rows = pendingThiefShares().slice(-limit).map(item => ({
      pendingIndex: item.pendingIndex,
      status: item.status,
      trackingKey: item.trackingKey,
      foundAt: item.foundAt,
      shareAt: item.shareAt,
      lastSeenAt: item.lastSeenAt,
      remainingSec: Math.max(0, Math.ceil((item.shareAtMs - Date.now()) / 1000)),
      shareCount: item.shareCount ?? 0,
      lastSharedAt: item.lastSharedAt,
      nextShareAt: item.nextShareAt,
      lastSharedLocationKey: item.lastSharedLocationKey,
      locationChangedSinceShare: !!item.locationChangedSinceShare,
      id: item.id,
      x: item.x,
      y: item.y,
      moveCount: item.moveCount
    }));
    window.TOPWAR_LOG_CONTROL.table(rows);
    return rows;
  }


  async function closeCrossTreasurePopup(options = {}) {
    const popupName = "NWorldMapCrossTreasure";
    const afterCloseWait = Number(options.afterCloseWait ?? 350);

    let popup = findCrossTreasurePopup();
    if (!popup) {
      return {
        ok: true,
        skipped: true,
        popupName,
        reason: "popup already closed"
      };
    }

    const attempts = [];

    // 1. 팝업 내부의 실제 닫기 버튼을 먼저 찾는다.
    try {
      const buttons = listButtonsUnderNode(popup);
      const closeTarget = buttons.find(button => {
        const value = normalizeChatChannelText(
          `${button.nodeName} ${button.text} ${button.path}`
        );

        return (
          value.includes("btnclose") ||
          value.includes("closebtn") ||
          value.includes("buttonclose") ||
          value.includes("close") ||
          value.includes("닫기") ||
          value.includes("취소")
        );
      });

      if (closeTarget) {
        const clicked = triggerCocosButtonSafe(closeTarget.node);
        attempts.push({
          method: "close-button",
          clicked,
          nodeName: closeTarget.nodeName,
          path: closeTarget.path
        });

        await sleep(afterCloseWait);

        if (!findCrossTreasurePopup()) {
          return {
            ok: true,
            popupName,
            method: "close-button",
            attempts
          };
        }
      }
    } catch (error) {
      attempts.push({
        method: "close-button",
        error: error?.message ?? String(error)
      });
    }

    // 2. 루트와 모든 자식 컴포넌트에서 닫기 계열 메서드를 찾는다.
    popup = findCrossTreasurePopup();

    if (popup) {
      const methodNames = [
        "close",
        "onClose",
        "onClickClose",
        "clickClose",
        "hide",
        "dismiss",
        "remove",
        "onBtnClose",
        "onClickBtnClose"
      ];

      const nodes = [];

      (function collect(node, depth = 0) {
        if (!node || depth > 30) return;
        nodes.push(node);
        for (const child of node.children || []) collect(child, depth + 1);
      })(popup);

      outer:
      for (const node of nodes) {
        for (const component of node._components || []) {
          for (const methodName of methodNames) {
            if (typeof component?.[methodName] !== "function") continue;

            try {
              component[methodName]();
              attempts.push({
                method: `component.${methodName}`,
                nodeName: node.name
              });

              await sleep(afterCloseWait);

              if (!findCrossTreasurePopup()) {
                return {
                  ok: true,
                  popupName,
                  method: `component.${methodName}`,
                  attempts
                };
              }
            } catch (error) {
              attempts.push({
                method: `component.${methodName}`,
                nodeName: node.name,
                error: error?.message ?? String(error)
              });
            }
          }
        }
      }
    }

    // 3. Cocos 이벤트 방식으로 닫기 이벤트를 전달한다.
    popup = findCrossTreasurePopup();

    if (popup) {
      for (const eventName of ["close", "hide", "dismiss"]) {
        try {
          popup.emit?.(eventName, {
            type: eventName,
            target: popup,
            currentTarget: popup
          });

          attempts.push({
            method: `node.emit(${eventName})`
          });

          await sleep(120);

          if (!findCrossTreasurePopup()) {
            return {
              ok: true,
              popupName,
              method: `node.emit(${eventName})`,
              attempts
            };
          }
        } catch (error) {
          attempts.push({
            method: `node.emit(${eventName})`,
            error: error?.message ?? String(error)
          });
        }
      }
    }

    // 4. 마지막 안전장치: 화면에 남은 도둑 상세창을 강제로 비활성화한다.
    popup = findCrossTreasurePopup();

    if (popup) {
      try {
        popup.active = false;
        attempts.push({
          method: "node.active=false"
        });

        await sleep(100);

        if (!findCrossTreasurePopup()) {
          return {
            ok: true,
            popupName,
            method: "node.active=false",
            forced: true,
            attempts
          };
        }
      } catch (error) {
        attempts.push({
          method: "node.active=false",
          error: error?.message ?? String(error)
        });
      }
    }

    return {
      ok: !findCrossTreasurePopup(),
      popupName,
      reason: "popup close failed",
      attempts
    };
  }

  async function shareCrossTreasureTo(channel = "월드", options = {}) {
    let shareResult = null;
    let waitPanel = null;
    let channelResult = null;
    let closeResult = null;
    let error = null;

    try {
      shareResult = clickCrossTreasureShareButton(options.shareButtonIndex ?? 8);
      console.log("[TopWar] cross treasure share button result:", shareResult);
      if (!shareResult?.ok) {
        return { ok: false, stage: "clickCrossTreasureShareButton", shareResult };
      }

      waitPanel = await waitForNewChatListPanel({
        timeout: options.newChatListPanelTimeout ?? 5000,
        interval: options.waitInterval ?? 100
      });
      if (!waitPanel.ok) {
        return { ok: false, stage: "waitNewChatListPanel", shareResult, waitPanel };
      }

      await sleep(options.afterShareClickWait ?? 200);
      channelResult = clickNewChatListPanelButton(channel);
      console.log("[TopWar] channel click result:", channelResult);

      if (channelResult?.ok) {
        await sleep(options.afterChannelClickWait ?? 350);
      }

      return {
        ok: !!channelResult?.ok,
        channel,
        shareResult,
        waitPanel,
        channelResult,
        closeResult
      };
    } catch (e) {
      error = e;
      console.error("[TopWar] cross treasure share error:", e);
      return {
        ok: false,
        stage: "exception",
        channel,
        shareResult,
        waitPanel,
        channelResult,
        error: e?.message ?? String(e),
        closeResult
      };
    } finally {
      // 공유 성공/실패 여부와 관계없이 도둑 팝업이 남아 있으면 정리한다.
      if (options.closePopupAfterShare !== false) {
        try {
          await sleep(options.beforePopupCloseWait ?? 200);
          closeResult = await closeCrossTreasurePopup({
            afterCloseWait: options.afterPopupCloseWait ?? 300
          });
          console.log("[TopWar] cross treasure popup cleanup result:", closeResult);
        } catch (closeError) {
          console.warn("[TopWar] cross treasure popup cleanup failed:", closeError);
        }
      }
    }
  }

  async function handleFoundAutoShare(obj, options = {}) {
    const message = `${obj?.x ?? "?"}:${obj?.y ?? "?"}`;

    console.log("%c🚨 133 발견 - 자동 공유 시퀀스 시작", "font-size:30px;font-weight:900;color:white;background:#d32f2f;padding:12px 18px;border-radius:8px;");
    console.log(`%c[TopWar] ${message}`, "font-size:32px;font-weight:900;color:#d32f2f;background:#fff3cd;padding:10px 16px;border:3px solid #d32f2f;border-radius:6px;");

    pauseWatch133("found-133-auto-share", { message, object: obj });

    let notifyResult = null;
    let moveResult = null;
    let centerClickOk = false;
    let crossWait = null;
    let shareResult = null;

    try {
      if (options.skipNotify !== true) {
        notifyResult = await notifyWatchedPoint(obj, {
          ...options,
          sendChat: false,
          copyToClipboard: options.copyToClipboard ?? true,
        });
      } else {
        notifyResult = { ok: true, skipped: true, reason: "already notified when scheduled" };
      }

      if (options.skipMoveToFound === true) {
        moveResult = { ok: true, skipped: true, reason: "already-verified-at-coordinate" };
      } else {
        moveResult = await moveMapToStableUnified(obj.x, obj.y, {
          serverId: options.serverId ?? obj.serverId ?? range()?.k,
          subMap: options.subMap ?? 0,
          scale: options.foundScale ?? 1,
          afterMoveWait: options.foundAfterMoveWait ?? 500,
          wait901Timeout: options.foundWait901Timeout ?? 2200,
          quietMs: options.foundQuietMs ?? 300,
          maxRetries: options.foundMaxRetries ?? 1,
          collectCache: true
        });

        await sleep(options.afterFoundMoveWait ?? 300);
      }
      centerClickOk = options.clickFoundCenter === false ? false : clickCanvasCenter();

      crossWait = await waitForCrossTreasurePopup({
        timeout: options.crossTreasureTimeout ?? 5000,
        interval: options.waitInterval ?? 100
      });

      if (crossWait.ok) {
        await sleep(options.afterCrossTreasureOpenWait ?? 200);
        shareResult = await shareCrossTreasureTo(options.shareChannel ?? "월드", {
          shareButtonIndex: options.shareButtonIndex ?? 8,
          newChatListPanelTimeout: options.newChatListPanelTimeout ?? 5000,
          waitInterval: options.waitInterval ?? 100,
          afterShareClickWait: options.afterShareClickWait ?? 200,
          afterChannelClickWait: options.afterChannelClickWait ?? 350,
          closePopupAfterShare: options.closePopupAfterShare ?? true,
          beforePopupCloseWait: options.beforePopupCloseWait ?? 200,
          afterPopupCloseWait: options.afterPopupCloseWait ?? 300
        });
      } else {
        shareResult = { ok: false, stage: "waitCrossTreasurePopup", crossWait };
      }

      const foundResult = {
        ok: !!shareResult?.ok,
        message,
        object: obj,
        notifyResult,
        moveResult,
        centerClickOk,
        crossWait,
        shareResult
      };

      console.log("[TopWar] auto share found result:", foundResult);
      return foundResult;
    } catch (error) {
      console.error("[TopWar] 도둑 자동 공유 처리 오류:", error);
      return {
        ok: false,
        message,
        object: obj,
        notifyResult,
        moveResult,
        centerClickOk,
        crossWait,
        shareResult,
        error: error?.message ?? String(error)
      };
    } finally {
      // UI 버튼으로 실행한 감시도 공유/팝업 처리 오류와 무관하게 반드시 재개한다.
      if (options.autoResumeAfterShare !== false && state.watch133.running) {
        resumeWatch133();
      }
    }
  }

  async function watchPointTypeAndNotify(options = {}) {
    if (state.connectionGuard?.disconnected) return { ok: false, stopped: true, reason: "connection guard disconnected" };
    const pointType = Number(options.pointType ?? 133);
    const serverId = options.serverId ?? range()?.k;
    const startX = Number(options.startX ?? 0);
    const startY = Number(options.startY ?? 0);
    const endX = Number(options.endX ?? 815);
    const endY = Number(options.endY ?? 950);
    const stepX = Number(options.stepX ?? 45);
    const stepY = Number(options.stepY ?? 30);
    const scale = Number(options.scale ?? 0.27);
    const loopDelay = Number(options.loopDelay ?? 3000);
    const stopAfterFound = options.stopAfterFound ?? false;
    const clearEachCycle = options.clearEachCycle ?? true;
    const maxCycles = options.maxCycles == null
      ? Infinity
      : Math.max(1, Number(options.maxCycles) || 1);

    if (!serverId) {
      console.error("[TopWar] serverId가 없습니다. TOPWAR.range().k를 확인하세요.");
      return null;
    }

    let xs, ys;
    try {
      xs = buildScanCoords(startX, endX, stepX, "x");
      ys = buildScanCoords(startY, endY, stepY, "y");
    } catch (e) {
      console.error("[TopWar] 좌표 생성 실패:", e.message);
      return null;
    }

    state.watch133.running = true;
    state.watch133.paused = false;
    state.watch133.pauseReason = null;
    state.watch133.pauseInfo = null;
    state.watch133.handledKeys ??= new Set();
    state.watch133.sharedLocationKeys ??= new Set();
    state.watch133.sentMessages ??= [];
    ensurePendingThiefState();

    const startCorner = options.startCorner ?? "top-left";
    const snake = options.snake !== false;
    const scanPlan = buildScanPlan(xs, ys, { startCorner, snake });

    console.log("[TopWar] auto-share watcher started:", {
      pointType, serverId, startX, startY, endX, endY, stepX, stepY,
      totalPerCycle: xs.length * ys.length,
      scale,
      startCorner,
      snake,
      action: "found -> schedule -> keep scanning -> check saved coordinate once when due -> share or remove"
    });

    let cycle = 0;

    while (state.watch133.running && cycle < maxCycles) {
      cycle++;
      if (clearEachCycle) clearCollected({ keepWatch: true });
      let scanCount = 0;
      console.log(`[TopWar] watch cycle ${cycle} start`);

      for (const rowInfo of scanPlan) {
        if (!state.watch133.running) break;
        const y = rowInfo.y;
        const xOrder = rowInfo.xOrder;

        for (const x of xOrder) {
          if (!state.watch133.running) break;
          await waitWhilePaused();
          if (!state.watch133.running) break;

          const result = await moveMapToStableUnified(x, y, {
            serverId,
            subMap: options.subMap ?? 0,
            scale,
            afterMoveWait: options.afterMoveWait ?? 120,
            wait901Timeout: options.wait901Timeout ?? 1800,
            quietMs: options.quietMs ?? 220,
            interval: options.interval ?? 30,
            maxRetries: options.maxRetries ?? 1,
            retryDelay: options.retryDelay ?? 250,
            collectCache: options.collectCache ?? true
          });

          scanCount++;

          const currentPlayers = Number(TOPWAR.summary?.()?.players ?? state.playerMap?.size ?? 0);
          const maxPlayersPerServer = Number(options.maxPlayersPerServer ?? 2000);
          if (Number.isFinite(maxPlayersPerServer) && maxPlayersPerServer > 0 &&
              currentPlayers >= maxPlayersPerServer) {
            console.warn(`[TopWar Player Guard] server=${serverId} players=${currentPlayers} - 도둑조사 폐기, 다음 서버로 이동`);
            clearHeavySurveyData({ packetLimit: 0, outgoingLimit: 0 });
            return {
              ok: false,
              stopped: false,
              completed: false,
              skipped: true,
              playerLimitExceeded: true,
              serverId,
              players: currentPlayers,
              maximumPlayers: maxPlayersPerServer,
              reason: `player limit exceeded: ${currentPlayers}/${maxPlayersPerServer}`
            };
          }

          const current = getObjectsByTypeRaw(pointType);
          const skipSharedLocations = options.skipSharedLocations ?? true;

          // 예약 시간이 지나기 전에는 좌표를 재방문하지 않는다.
          // 시간이 된 항목만 저장 좌표를 한 번 확인한 뒤 공유하거나 큐에서 삭제한다.
          const dueResults = await processDuePendingThiefQueue({ ...options, pointType, serverId });
          if (dueResults.length > 0) {
            console.log("[TopWar] delayed thief queue results:", dueResults);
            await waitWhilePaused();
          }

          const newlyFound = current.filter(o => {
            if (!o?.objectKey || state.watch133.handledKeys.has(o.objectKey)) return false;

            const trackingKey = getThiefTrackingKey(o, { serverId });
            if (state.pendingThiefObjectKeys.has(trackingKey)) return false;
            if (state.resolvedThiefObjectKeys.has(trackingKey)) return false;

            if (!skipSharedLocations) return true;
            return !state.watch133.sharedLocationKeys.has(getThiefLocationKey(o, { serverId }));
          });

          if (newlyFound.length > 0) {
            for (const obj of newlyFound) {
              state.watch133.handledKeys.add(obj.objectKey);
              const trackingKey = getThiefTrackingKey(obj, { serverId });
              const locationKey = getThiefLocationKey(obj, { serverId });
              const shareDelayMs = Math.max(0, Number(options.shareDelayMs ?? 3 * 60 * 1000));
              let foundResult;

              if (shareDelayMs === 0) {
                foundResult = await handleFoundAutoShare(obj, {
                  ...options,
                  pointType,
                  serverId,
                  shareDelayMs: 0
                });

                if (foundResult?.shareResult?.ok) {
                  state.sharedThiefObjectKeys.add(trackingKey);
                  state.resolvedThiefObjectKeys.add(trackingKey);
                  state.watch133.sharedLocationKeys.add(locationKey);
                } else {
                  // 즉시 공유 실패 시 다음 스캔에서 다시 시도할 수 있게 발견 처리만 되돌린다.
                  state.watch133.handledKeys.delete(obj.objectKey);
                }

                console.log("[TopWar] found immediate-share result:", {
                  ...foundResult,
                  trackingKey,
                  locationKey
                });
              } else {
                foundResult = await scheduleThiefShare(obj, {
                  ...options,
                  pointType,
                  serverId,
                  shareDelayMs
                });

                console.log("[TopWar] found delayed-share schedule result:", {
                  ...foundResult,
                  trackingKey,
                  locationKey,
                  shareDelayMs
                });
              }

              if (stopAfterFound) {
                state.watch133.running = false;
                return {
                  stopped: true,
                  reason: shareDelayMs === 0 ? "found-and-shared" : "found-and-scheduled",
                  cycle,
                  object: obj,
                  foundResult,
                  thiefQueue: thiefQueue()
                };
              }
            }
          }

          if (scanCount % Number(options.logEvery ?? 20) === 0 || newlyFound.length > 0 || !result?.ok) {
            console.log(`[TopWar] watch cycle=${cycle}, scan=${scanCount}/${xs.length * ys.length}, coord=(${x},${y}), ok=${result?.ok}, source=${result?.source}, type${pointType}=${current.length}, new=${newlyFound.length}, queue=${state.thiefQueue.length}`);
          }

          await sleep(Number(options.stepDelay ?? 0));
        }
      }

      console.log(`[TopWar] watch cycle ${cycle} done`, { handledTotal: state.watch133.handledKeys.size, queueLength: state.thiefQueue.length, lastFound: state.watch133.lastFound });
      if (!state.watch133.running) break;
      await sleep(loopDelay);
    }

    return {
      ok: state.watch133.running && cycle >= maxCycles,
      stopped: !state.watch133.running,
      completedCycles: cycle,
      cycle,
      handledTotal: state.watch133.handledKeys.size,
      queueLength: state.thiefQueue.length,
      lastFound: state.watch133.lastFound,
      thiefQueue: thiefQueue()
    };
  }

  function resetWatch133() { return resetThiefWatch(); }

  function help() {
    console.log(`
[TopWar Unified Automation V2.8 Clean]

133 감시 + 자동 공유:
await TOPWAR.watchPointTypeAndNotify({
  pointType: 133,
  serverId: 3223,
  startX: 50,
  startY: 50,
  endX: 750,
  endY: 875,
  stepX: 80,
  stepY: 75,
  scale: 0.27,
  copyToClipboard: true,
  stopAfterFound: false,
  clearEachCycle: true,
  logEvery: 1,
  startCorner: "top-left",
  snake: true,
  wait901Timeout: 2200,
  quietMs: 300,
  maxRetries: 1,
  foundScale: 1,
  shareButtonIndex: 8,
  shareChannel: "월드",
  autoResumeAfterShare: true,
  shareDelayMs: 3 * 60 * 1000,
  repeatShareIntervalMs: 5 * 60 * 1000,
  shareRetryDelayMs: 30 * 1000
})

공유 채널 변경:
shareChannel: "길드"
shareChannel: "월드"
shareChannel: "guild"
shareChannel: "world"

수동 테스트:
TOPWAR.listCrossTreasureButtons()
TOPWAR.clickCrossTreasureShareButton(8)
TOPWAR.listNewChatListPanelButtons()
TOPWAR.clickNewChatListPanelButton("월드")
await TOPWAR.shareCrossTreasureTo("월드", { shareButtonIndex: 8 })

감시 제어:
TOPWAR.pauseWatch133()
TOPWAR.resumeWatch133()
TOPWAR.stopWatch133()
TOPWAR.watch133Status()

큐:
TOPWAR.thiefQueueTable()
TOPWAR.lastThief()
await TOPWAR.copyLastThief()
TOPWAR.clearThiefQueue()
`);
  }

  Object.assign(api, {
    version: VERSION,
    help,
    sleep,
    getGithubToken,
    setGithubToken,
    validateGithubToken,
    validateAndSaveGithubToken,
    ensureGithubToken,
    githubTokenStatus,

    findMapController,
    mapCtrl: getMapCtrl,
    wmc: getWorldMapComponent,
    range,

    summary: getSummary,
    getCommandCount,
    recentPackets: () => state.recentPackets,
    recentOutgoing: () => state.recentOutgoing,
    byC: c => state.recentPackets.filter(r => Number(r.packet?.c) === Number(c)),

    waitFor901Stable,
    moveMapToStableUnified,
    scanMapUnified,
    buildScanCoords,
    buildScanPlan,
    normalizeStartCorner,

    findWorldMapObjectStores,
    collectObjectsFromWorldMapCache,

    players,
    playerValues,
    alliances,
    objects,
    allianceRepresentatives,
    playerTable,
    playerByUid: uid => state.playerMap.get(String(uid)) ?? null,
    playersWithCityReward: () => players().filter(player => {
      const reward = player?.cityReward ?? player?.playerInfo?.cityReward;
      if (reward === null || typeof reward !== "object" || Array.isArray(reward)) return false;
      const rawSeenAt = player?.cityRewardSeenAt ?? player?.time;
      const seenMs = typeof rawSeenAt === "number"
        ? (rawSeenAt < 1000000000000 ? rawSeenAt * 1000 : rawSeenAt)
        : Date.parse(String(rawSeenAt ?? ""));
      return Number.isFinite(seenMs) && Date.now() - seenMs < 40 * 60 * 1000;
    }),
    cityRewardDebug: () => players().map(player => ({
      uid: player?.uid ?? null,
      username: player?.username ?? null,
      serverId: player?.serverId ?? null,
      x: player?.x ?? null,
      y: player?.y ?? null,
      hasCityRewardField: player?.hasCityRewardField === true,
      cityRewardPath: player?.cityRewardPath ?? null,
      cityRewardType: player?.cityReward === null ? "null" : typeof player?.cityReward,
      cityReward: player?.cityReward,
      playerInfoKeys: Object.keys(player?.playerInfo || {}),
      pKeys: Object.keys(player?.p || {})
    })),
    allianceTable,
    objectTypeSummary,
    objectsByPointType,
    getObjectsByTypeRaw,
    allianceRepresentativeTable,

    clearCollected,
    trimRuntimeMemory,
    exportUnifiedMapData,
    exportPlayersOnly,

    copyText,
    formatThiefClipboardMessage,
    enqueueThief,
    notifyWatchedPoint,
    getThiefTrackingKey,
    scheduleThiefShare,
    updatePendingThiefObservation,
    processDuePendingThief,
    processDuePendingThiefQueue,
    pendingThiefShares,
    pendingThiefShareTable,

    thiefQueue,
    thiefQueueTable,
    lastThief,
    copyLastThief,
    copyThiefAt,
    clearThiefQueue,
    resetThiefWatch,

    pauseWatch133,
    resumeWatch133,
    stopWatch133,
    resetWatch133,
    watch133Status,

    clickCanvasClient,
    clickCanvasRatio,
    clickCanvasCenter,

    findNodesByNameContains,
    findActiveNodeByNameContains,
    waitForNodeByNameContains,
    getNodeTextDeep,
    normalizeChatChannelText,
    getNodeWorldPositionSafe,
    triggerCocosButtonSafe,

    findCrossTreasurePopup,
    listCrossTreasureButtons,
    clickCrossTreasureShareButton,
    waitForCrossTreasurePopup,

    findNewChatListPanel,
    listNewChatListPanelButtons,
    resolveChatChannelKeywords,
    findNewChatListPanelButtonByText,
    clickNewChatListPanelButton,
    waitForNewChatListPanel,

    getThiefLocationKey,
    closeCrossTreasurePopup,
    shareCrossTreasureTo,
    handleFoundAutoShare,
    watchPointTypeAndNotify,

    enable901Log(value = true) { state.debug.log901 = !!value; console.log("[TopWar] log901:", state.debug.log901); },
    enableDecodeErrorLog(value = true) { state.debug.logDecodeError = !!value; console.log("[TopWar] logDecodeError:", state.debug.logDecodeError); },
    enableOutgoingLog(value = true) { state.debug.logOutgoing = !!value; console.log("[TopWar] logOutgoing:", state.debug.logOutgoing); },
    enableWsAttachLog(value = true) { state.debug.logWsAttach = !!value; console.log("[TopWar] logWsAttach:", state.debug.logWsAttach); },
    enableNodeSearchLog(value = true) { state.debug.logNodeSearch = !!value; console.log("[TopWar] logNodeSearch:", state.debug.logNodeSearch); },
    logControl: topwarLogControl,
    logControlStatus() { return topwarLogControl.status(); },
    setProgramLogsEnabled(value = true) { return topwarLogControl.setProgramLogsEnabled(value); },
    setGameFontWarningsEnabled(value = true) { return topwarLogControl.setGameFontWarningsEnabled(value); },
    connectionGuardStatus,
    resetConnectionGuard,
    setConnectionGuardEnabled,
    stopAllAutomationForConnectionFailure,
    findConnectionFailureText,
    getOpenTopwarSockets,
    markConnectionHealthy
  });

  startConnectionGuardMonitor();
  setInterval(() => {
    try { trimRuntimeMemory(); } catch {}
  }, 30 * 1000);

  // localStorage 토큰 우선 사용. 401 인증 실패 또는 토큰 없음일 때만 입력 요청.
  setTimeout(() => {
    ensureGithubToken({ interactive: true }).catch(error => {
      console.warn("[TopWar GitHub] startup token 확인 실패:", error);
    });
  }, 0);

  console.log("%c[TopWar Unified Automation V2.8 Clean] core installed", "color:#00e676;font-weight:bold");
  console.log("[TopWar] 사용법: TOPWAR.help()");
})();

/* ---------------------------------------------------------------------------
 * TopWar Integrated Survey + Thief UI V2.6
 * - V2.3 core scanner 위에 붙는 단일 통합 모듈
 * - 기존 후속 패치들을 이 모듈 하나로 통합
 * - 서버번호 입력 UI
 * - 도둑찾기 ON/OFF
 * - 서버조사 ON/OFF
 * - 길드 상세 정보 수집
 * - 길드원 스크롤 수집
 * - 지도에 있는 유저만 최종 저장
 * - UID 기준 중복 제거
 * - 활동성 분석 필드/요약 추가
 * - 최종 JSON: players + alliances만 출력
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  if (!window.TOPWAR) {
    console.error("[TopWar V2.6] TOPWAR 객체가 없습니다.");
    return;
  }

  const TOPWAR = window.TOPWAR;
  const state = TOPWAR.state;
  const VERSION = "2.11.1-unified-finder";
  const PANEL_ID = "topwar-unified-control-panel-v26";
  const LEGACY_PANEL_IDS = [
    "topwar-thief-watch-panel",
    "topwar-unified-control-panel-v25"
  ];

  const POWER_SUFFIXES = [
    "", "K", "M", "B", "T",
    "aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh",
    "ii", "jj", "kk", "ll", "mm", "nn", "oo", "pp",
    "qq", "rr", "ss", "tt", "uu", "vv", "ww", "xx",
    "yy", "zz"
  ];

  function sleep(ms) {
    return TOPWAR.sleep
      ? TOPWAR.sleep(ms)
      : new Promise(resolve => setTimeout(resolve, Number(ms) || 0));
  }

  function empty(value) {
    return value == null || (typeof value === "string" && value.trim() === "");
  }

  function pick(...values) {
    for (const value of values) {
      if (!empty(value)) return value;
    }
    return null;
  }

  function put(object, key, value) {
    if (!empty(value)) object[key] = value;
  }

  function uidOf(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function currentServerId() {
    return TOPWAR.range?.()?.k ?? null;
  }

  function parseServerId(value) {
    const number = Number(String(value ?? "").trim());
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function parseServerIds(value) {
    if (Array.isArray(value)) {
      return [...new Set(value.map(parseServerId).filter(Boolean))];
    }

    const text = String(value ?? "").trim();

    if (!text) {
      const current = currentServerId();
      return current ? [current] : [];
    }

    const result = [];

    for (const part of text.split(/[\s,，、/|]+/)) {
      const serverId = parseServerId(part);
      if (serverId && !result.includes(serverId)) result.push(serverId);
    }

    return result;
  }

  // 입력칸이 비어 있을 때 현재 서버로 떨어지지 않고 GitHub 서버목록을 읽기 위한 엄격 파서입니다.
  // 기존 parseServerIds("")는 도둑찾기/수동 기능 호환을 위해 현재 서버를 반환하므로 UI 서버조사에는 쓰면 안 됩니다.
  function parseServerIdsStrict(value) {
    const values = Array.isArray(value)
      ? value
      : String(value ?? "").trim()
        ? String(value).split(/[\s,，、/|]+/)
        : [];

    return [...new Set(
      values
        .map(parseServerId)
        .filter(Boolean)
    )];
  }

  function normalizeText(text) {
    return String(text ?? "")
      .replace(/[：]/g, ":")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeToken(text) {
    return String(text ?? "")
      .replace(/\s+/g, "")
      .replace(/[^\w가-힣]/g, "")
      .toLowerCase();
  }

  function ensureState() {
    state.memberMap ??= new Map();
    state.allianceDetailMap ??= new Map();

    state.ui ??= {};
    state.ui.serverSurvey ??= {
      running: false,
      stopping: false,
      startedAt: null,
      finishedAt: null,
      current: null,
      result: null,
      error: null
    };

    state.ui.serverSurveyBatch ??= {
      running: false,
      stopping: false,
      startedAt: null,
      finishedAt: null,
      current: null,
      results: [],
      error: null
    };

    state.fullScan ??= {
      running: false,
      stopRequested: false,
      phase: "idle"
    };

    return state;
  }

  ensureState();

  // 서버 목록은 사용자가 미리 인기순으로 정렬한 servers-popular.json을 그대로 사용합니다.
  // 스크립트 내부에서는 인원수 기준 재정렬을 하지 않고, 파일에 적힌 순서를 조사 순서로 유지합니다.
  // 중요: @grant none을 유지해야 TopWar 페이지 컨텍스트의 window.NWorldController/WebSocket을 정상적으로 볼 수 있습니다.
  const REMOTE_SERVER_LIST_DEFAULT_URL = "https://cdn.jsdelivr.net/gh/hiphop5782/topwar-webutil-vite/src/assets/json/servers/servers-popular.json";
  const REMOTE_SERVER_LIST_FALLBACK_URLS = [
    REMOTE_SERVER_LIST_DEFAULT_URL,
    "https://cdn.jsdelivr.net/gh/hiphop5782/topwar-webutil-vite@main/src/assets/json/servers/servers-popular.json",
    "https://cdn.jsdelivr.net/gh/hiphop5782/topwar-webutil-vite@master/src/assets/json/servers/servers-popular.json",
    "https://raw.githubusercontent.com/hiphop5782/topwar-webutil-vite/main/src/assets/json/servers/servers-popular.json",
    "https://raw.githubusercontent.com/hiphop5782/topwar-webutil-vite/master/src/assets/json/servers/servers-popular.json"
  ];
  const REMOTE_SERVER_LIST_CACHE_KEY = "TOPWAR_REMOTE_POPULAR_SERVER_LIST_CACHE_V1";

  function addUniqueServerId(target, value) {
    const serverId = parseServerId(value);
    if (serverId && !target.includes(serverId)) target.push(serverId);
  }

  function extractServerIdsFromRemoteJson(value) {
    const result = [];
    const visited = new WeakSet();
    const idKeys = new Set([
      "serverId", "serverID", "server_id", "serverNo", "serverNO", "server_no",
      "sid", "server", "serverNumber", "server_number", "s"
    ]);
    const listKeys = new Set([
      "servers", "serverIds", "serverList", "list", "rows", "data", "items", "result", "results"
    ]);

    function walk(node, depth = 0, context = "root") {
      if (node == null || depth > 12) return;

      if (typeof node === "number" || typeof node === "string") {
        if (context === "array-number" || context === "known-id") addUniqueServerId(result, node);
        return;
      }

      if (typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        for (const item of node) {
          if (typeof item === "number" || typeof item === "string") {
            walk(item, depth + 1, "array-number");
          } else {
            walk(item, depth + 1, "array-item");
          }
        }
        return;
      }

      for (const [key, item] of Object.entries(node)) {
        if (/^\d+$/.test(key) && item && typeof item === "object") addUniqueServerId(result, key);
        if (idKeys.has(key)) addUniqueServerId(result, item);
      }

      for (const [key, item] of Object.entries(node)) {
        if (idKeys.has(key)) {
          walk(item, depth + 1, "known-id");
        } else if (listKeys.has(key) || Array.isArray(item) || (item && typeof item === "object")) {
          walk(item, depth + 1, listKeys.has(key) ? "list" : "object");
        }
      }
    }

    walk(value);
    return result;
  }

  function readCachedRemoteServerList() {
    try {
      const cached = JSON.parse(localStorage.getItem(REMOTE_SERVER_LIST_CACHE_KEY) || "null");
      if (!cached || !Array.isArray(cached.serverIds)) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function writeCachedRemoteServerList(value) {
    try {
      localStorage.setItem(REMOTE_SERVER_LIST_CACHE_KEY, JSON.stringify(value));
    } catch {}
    return value;
  }

  function decodeBase64Utf8(base64Text) {
    const binary = atob(String(base64Text || "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function parseRemoteServerResponse(data, url) {
    // GitHub Contents API 응답이면 content(base64)를 실제 JSON으로 변환합니다.
    if (data && typeof data === "object" && data.encoding === "base64" && typeof data.content === "string") {
      try {
        return JSON.parse(decodeBase64Utf8(data.content));
      } catch (error) {
        throw new Error(`GitHub API content decode failed: ${error?.message || error}`);
      }
    }

    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch (error) {
        throw new Error(`remote response is not JSON: ${url}`);
      }
    }

    return data;
  }

  function gmHttpGetText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest is not available. Tampermonkey @grant/@connect 권한을 확인하세요."));
        return;
      }

      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          "Accept": "application/json,text/plain,*/*"
        },
        timeout: 20000,
        onload: response => {
          const status = Number(response.status || 0);
          if (status < 200 || status >= 300) {
            reject(new Error(`GM HTTP ${status} ${response.statusText || ""}`.trim()));
            return;
          }
          resolve({
            text: response.responseText || "",
            contentType: String(response.responseHeaders || "")
          });
        },
        onerror: error => reject(new Error(`GM request error: ${error?.error || error?.message || "unknown"}`)),
        ontimeout: () => reject(new Error("GM request timeout")),
        onabort: () => reject(new Error("GM request aborted"))
      });
    });
  }

  async function fetchGetText(url, options = {}) {
    const headers = {
      "Accept": "application/json,text/plain,*/*"
    };
    // popular 파일이 비공개 저장소에 있거나 GitHub의 익명 요청 제한에 걸린
    // 경우에도 Contents API fallback을 사용할 수 있도록 공유 토큰을 적용한다.
    if (/^https:\/\/api\.github\.com\//i.test(url)) {
      const token = getGithubToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        headers["X-GitHub-Api-Version"] = "2022-11-28";
      }
    }
    const response = await fetch(url, {
      method: "GET",
      cache: options.force ? "no-store" : "default",
      mode: "cors",
      credentials: "omit",
      headers
    });

    if (!response.ok) throw new Error(`fetch HTTP ${response.status} ${response.statusText}`);

    return {
      text: await response.text(),
      contentType: response.headers?.get?.("content-type") || ""
    };
  }

  async function fetchRemoteServerJson(url, options = {}) {
    const finalUrl = options.force
      ? `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`
      : url;

    const preferGm = options.useGm !== false;
    const errors = [];

    async function tryParseWith(label, getter) {
      try {
        const { text, contentType } = await getter();
        if (!String(text || "").trim()) throw new Error(`${label} empty response`);

        let data;
        const trimmed = String(text).trim();
        if (contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
          data = JSON.parse(trimmed);
        } else {
          data = trimmed;
        }

        return parseRemoteServerResponse(data, url);
      } catch (error) {
        errors.push(`${label}: ${error?.message || error}`);
        return null;
      }
    }

    if (preferGm && typeof GM_xmlhttpRequest === "function") {
      const gmResult = await tryParseWith("GM_xmlhttpRequest", () => gmHttpGetText(finalUrl));
      if (gmResult) return gmResult;
    }

    const fetchResult = await tryParseWith("fetch", () => fetchGetText(finalUrl, options));
    if (fetchResult) return fetchResult;

    if (!preferGm && typeof GM_xmlhttpRequest === "function") {
      const gmResult = await tryParseWith("GM_xmlhttpRequest", () => gmHttpGetText(finalUrl));
      if (gmResult) return gmResult;
    }

    throw new Error(errors.join(" / ") || "remote request failed");
  }

  async function loadRemoteServerList(options = {}) {
    const maxAgeMs = Number(options.maxAgeMs ?? 5 * 60 * 1000);
    const cached = readCachedRemoteServerList();

    if (!options.force && cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) {
      console.log("[TopWar] GitHub 서버목록 캐시 사용:", cached);
      return { ...cached, ok: true, cached: true };
    }

    const urls = Array.isArray(options.urls) && options.urls.length
      ? options.urls
      : REMOTE_SERVER_LIST_FALLBACK_URLS;

    const errors = [];

    for (const url of urls) {
      try {
        const json = await fetchRemoteServerJson(url, options);
        const serverIds = extractServerIdsFromRemoteJson(json);

        if (!serverIds.length) {
          throw new Error("serverIds not found in remote JSON");
        }

        const data = {
          ok: true,
          source: "github-public-json",
          url,
          fetchedAt: nowIso(),
          count: serverIds.length,
          serverIds,
          raw: options.keepRaw === true ? json : undefined
        };

        writeCachedRemoteServerList(data);
        state.remoteServerList = data;
        console.log("[TopWar] GitHub 서버목록 로드 완료:", data);
        return data;
      } catch (error) {
        const row = { url, message: error?.message || String(error) };
        errors.push(row);
        if (options.debug !== false) console.warn("[TopWar] GitHub 서버목록 URL 실패:", row);
      }
    }

    if (cached?.serverIds?.length && options.allowCacheOnFail !== false) {
      const fallback = {
        ...cached,
        ok: true,
        cached: true,
        stale: true,
        errors
      };
      state.remoteServerList = fallback;
      console.warn("[TopWar] GitHub 서버목록 로드 실패 - 기존 캐시 사용:", fallback);
      return fallback;
    }

    const error = new Error(errors.map(e => `${e.url}: ${e.message}`).join(" / ") || "remote server list load failed");
    error.errors = errors;
    throw error;
  }

  async function loadRemoteServerIds(options = {}) {
    const result = await loadRemoteServerList(options);
    return result.serverIds || [];
  }

  function getCachedRemoteServerList() {
    return state.remoteServerList || readCachedRemoteServerList();
  }

  function remoteServerListStatus() {
    const cached = getCachedRemoteServerList();
    const status = {
      defaultUrl: REMOTE_SERVER_LIST_DEFAULT_URL,
      gmAvailable: typeof GM_xmlhttpRequest === "function",
      cached: !!cached,
      fetchedAt: cached?.fetchedAt ?? null,
      count: cached?.serverIds?.length ?? 0,
      serverIds: cached?.serverIds ?? []
    };
    console.log("[TopWar] GitHub 서버목록 상태:", status);
    return status;
  }

  function clearSurveyRuntimeData(options = {}) {
    // 서버별 조사 시작 전 데이터 완전 초기화.
    // 기존 clearCollected는 memberMap/allianceDetailMap까지 비우지 않으므로 별도로 정리한다.
    try {
      TOPWAR.clearCollected?.({ keepWatch: true });
    } catch (error) {
      console.warn("[TopWar V2.6] clearCollected failed:", error);
    }

    state.objectMap = new Map();
    state.objectsByType = {};
    state.playerMap = new Map();
    state.allianceMap = new Map();
    state.allianceRepresentativeMap = new Map();
    state.memberMap = new Map();
    state.allianceDetailMap = new Map();
    state.lastAllianceMainInfo = null;
    state.currentAllianceTarget = null;
    state.worldObjectStores = null;

    if (options.resetPackets !== false) {
      state.recentPackets = [];
      state.recentOutgoing = [];
      state.commandCount = new Map();
    }

    console.log("[TopWar V2.6] survey runtime data cleared");
    return true;
  }

  function sameServerId(a, b) {
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }

  function getPlayerServerId(player) {
    return player?.serverId ?? player?.worldId ?? player?.k ?? null;
  }

  function pruneRecentBuffers(options = {}) {
    const packetLimit = Number(options.packetLimit ?? 24);
    const outgoingLimit = Number(options.outgoingLimit ?? 16);

    if (Array.isArray(state.recentPackets) && state.recentPackets.length > packetLimit) {
      state.recentPackets.splice(0, state.recentPackets.length - packetLimit);
    }

    if (Array.isArray(state.recentOutgoing) && state.recentOutgoing.length > outgoingLimit) {
      state.recentOutgoing.splice(0, state.recentOutgoing.length - outgoingLimit);
    }

    return true;
  }

  function slimAllianceResultRow(row) {
    if (!row) return row;

    const real = row.collectWrap?.collectResult ?? row.collectWrap ?? {};

    return {
      index: row.index,
      ok: !!row.ok,
      count: row.count ?? real?.dataList?.length ?? real?.rawResult?.count ?? 0,
      merged: row.merged ?? real?.mergeResult?.merged ?? 0,
      skippedNotOnMap: row.skippedNotOnMap ?? real?.mergeResult?.skippedNotOnMap ?? 0,
      target: row.target
        ? {
            allianceId: row.target.allianceId,
            allianceTag: row.target.allianceTag,
            allianceName: row.target.allianceName,
            representativeUid: row.target.representativeUid,
            representativeName: row.target.representativeName,
            x: row.target.x,
            y: row.target.y,
            power: row.target.power
          }
        : null,
      reason: row.collectWrap?.reason ?? real?.reason ?? null
    };
  }

  function slimServerSurveyResult(result) {
    if (!result) return result;

    const data = result.data || null;

    return {
      ok: !!result.ok,
      stopped: !!result.stopped,
      reason: result.reason ?? null,
      serverId: result.serverId ?? data?.serverId ?? null,
      summary: result.summary ?? data?.summary ?? null,
      githubUpload: result.githubUpload ?? data?.githubUpload ?? null,
      errors: Array.isArray(result.errors)
        ? result.errors.map(error => ({
            serverId: error.serverId,
            index: error.index,
            reason: error.reason ?? error.result?.reason ?? null,
            target: error.target
              ? {
                  allianceId: error.target.allianceId,
                  allianceTag: error.target.allianceTag,
                  allianceName: error.target.allianceName,
                  x: error.target.x,
                  y: error.target.y
                }
              : null
          }))
        : [],
      allianceResults: Array.isArray(result.allianceResults)
        ? result.allianceResults.map(slimAllianceResultRow)
        : []
    };
  }

  function clearHeavySurveyData(options = {}) {
    state.objectMap = new Map();
    state.objectsByType = {};
    state.playerMap = new Map();
    state.playerLimitReached = false;
    state.droppedPlayers = 0;
    state.allianceMap = new Map();
    state.allianceRepresentativeMap = new Map();
    state.memberMap = new Map();
    state.allianceDetailMap = new Map();
    state.lastAllianceMainInfo = null;
    state.currentAllianceTarget = null;
    state.worldObjectStores = null;

    if (options.clearPackets !== false) {
      state.recentPackets = [];
      state.recentOutgoing = [];
      state.commandCount = new Map();
    } else {
      pruneRecentBuffers(options);
    }

    try {
      if (typeof window.gc === "function") window.gc();
    } catch {}

    console.log("[TopWar V2.7] heavy survey data cleared");
    return true;
  }

  function cleanupIntegratedSurveyResidue(options = {}) {
    const removedStorageKeys = [];
    const obsoleteExactKeys = new Set(["TOPWAR_GITHUB_SHA_CACHE_V293", "TOPWAR_FAST_COMPACT_HISTORY_QUEUE_V293", "TOPWAR_FAST_GLOBAL_USER_INDEX_V293"]);
    const obsoletePrefixes = ["TOPWAR_FAST_SERVER_USER_INDEX_V293:"];
    try {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key && (obsoleteExactKeys.has(key) || obsoletePrefixes.some(prefix => key.startsWith(prefix)))) {
          localStorage.removeItem(key);
          removedStorageKeys.push(key);
        }
      }
    } catch (error) { console.warn("[TopWar Integrated Survey] localStorage 잔존 데이터 정리 실패:", error); }
    try {
      if (localStorage.getItem("TOPWAR_SERVER_SURVEY_RESUME_V1")) sessionStorage.removeItem("TOPWAR_SERVER_SURVEY_RESUME_V1");
    } catch {}
    const thiefBuffer = state.thiefBuffer;
    if (thiefBuffer && options.keepLiveThiefEvents !== true) {
      thiefBuffer.events = [];
      thiefBuffer.activeTargetServerId = null;
      if (thiefBuffer.stats) { thiefBuffer.stats.lastCaptured = null; thiefBuffer.stats.lastCollected = null; }
    }
    if (Array.isArray(state.pendingThiefItems)) {
      state.pendingThiefItems = state.pendingThiefItems.filter(item => item && !["shared", "failed", "expired", "removed"].includes(String(item.status || "").toLowerCase()));
    }
    if (state.pendingThiefObjectKeys instanceof Set && !state.pendingThiefItems?.length) state.pendingThiefObjectKeys.clear();
    pruneRecentBuffers({ packetLimit: 0, outgoingLimit: 0 });
    state.commandCount = new Map();
    state.worldObjectStores = null;
    state.mapCtrlCache = null;
    console.log("[TopWar Integrated Survey] 잔존 데이터 정리 완료", { phase: options.phase ?? "unknown", removedStorageKeys: removedStorageKeys.length });
    return { ok: true, removedStorageKeys };
  }

  function shouldStopServerSurvey() {
    return (
      state.connectionGuard?.disconnected === true ||
      state.fullScan?.stopRequested === true ||
      state.ui?.serverSurvey?.stopping === true ||
      state.ui?.serverSurveyBatch?.stopping === true ||
      (state.ui?.serverSurvey?.running === false && state.fullScan?.phase === "stopping")
    );
  }

  function requestStopServerSurvey() {
    ensureState();

    state.fullScan.stopRequested = true;
    state.fullScan.running = false;
    state.fullScan.phase = "stopping";

    state.ui.serverSurvey.stopping = true;
    state.ui.serverSurveyBatch.stopping = true;

    console.warn("[TopWar V2.6] 서버조사 중지 요청");
    return true;
  }

  function decimalStringFromNumberLike(value) {
    if (value == null) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    if (!/[eE]/.test(raw)) {
      const number = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(number)) return raw;
      return Math.trunc(number).toString();
    }

    const match = raw.match(/^([+-]?)(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/);
    if (!match) return raw;

    const sign = match[1] === "-" ? "-" : "";
    const mantissa = match[2];
    const exponent = Number(match[3]);

    if (!Number.isFinite(exponent)) return raw;

    const [intPart = "0", fracPart = ""] = mantissa.split(".");
    const digits = (intPart + fracPart).replace(/^0+/, "") || "0";
    const shift = exponent - fracPart.length;

    if (shift >= 0) {
      return sign + digits + "0".repeat(shift);
    }

    const cut = digits.length + shift;
    if (cut > 0) return sign + digits.slice(0, cut);

    return "0";
  }

  function formatArmyPowerRaw(value) {
    const decimal = decimalStringFromNumberLike(value);
    if (decimal == null) return null;

    let text = String(decimal).replace(/,/g, "").trim();
    if (!text) return null;

    let sign = "";
    if (text.startsWith("-")) {
      sign = "-";
      text = text.slice(1);
    }

    text = text.split(".")[0];

    if (!/^\d+$/.test(text)) return String(value);

    return sign + text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function formatTopWarPower(value) {
    if (value == null) return null;

    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);

    if (number === 0) return "0";

    const sign = number < 0 ? "-" : "";
    let abs = Math.abs(number);
    let group = 0;

    while (abs >= 1000 && group < POWER_SUFFIXES.length - 1) {
      abs /= 1000;
      group++;
    }

    let text;
    if (abs >= 100) text = abs.toFixed(0);
    else if (abs >= 10) text = abs.toFixed(1);
    else text = abs.toFixed(2);

    if (text.includes(".")) text = text.replace(/\.?0+$/, "");

    return `${sign}${text}${POWER_SUFFIXES[group]}`;
  }

  function parseShortPowerToNumber(text) {
    const match = String(text ?? "")
      .replace(/,/g, "")
      .trim()
      .match(/^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]+)?$/);

    if (!match) return null;

    const number = Number(match[1]);
    if (!Number.isFinite(number)) return null;

    const suffix = String(match[2] ?? "").toLowerCase();
    const index = POWER_SUFFIXES.map(value => value.toLowerCase()).indexOf(suffix);

    if (index < 0) return null;

    return Math.round(number * Math.pow(1000, index));
  }

  Object.assign(TOPWAR, {
    formatArmyPowerRaw,
    formatTopWarPower,
    normalizeArmyPowerFields(value) {
      return {
        armyPower: formatArmyPowerRaw(value),
        armyPowerText: formatTopWarPower(value)
      };
    }
  });

  function getWorldPosition(node) {
    try {
      const point = node.convertToWorldSpaceAR(cc.v2(0, 0));
      return { x: point.x, y: point.y };
    } catch {}

    try {
      const point = node.getPosition();
      return { x: point.x, y: point.y };
    } catch {}

    return null;
  }

  function findNodeOne(namePart, options = {}) {
    if (!window.cc?.director) return null;

    const root = options.root || cc.director.getScene();
    const maxDepth = Number(options.maxDepth ?? 70);
    const results = [];

    (function walk(node, path = node?.name || "", depth = 0) {
      if (!node || depth > maxDepth) return;

      if (String(node.name || "").includes(namePart)) {
        results.push({
          node,
          path,
          active: node.active,
          activeInHierarchy: node.activeInHierarchy
        });
      }

      for (const child of node.children || []) {
        walk(child, `${path}/${child.name}`, depth + 1);
      }
    })(root);

    const found = options.activeOnly ?? false
      ? results.find(row => row.activeInHierarchy)
      : results.find(row => row.activeInHierarchy) || results[0];

    return found?.node ?? null;
  }

  async function waitNodeOne(namePart, options = {}) {
    const timeout = Number(options.timeout ?? 5000);
    const interval = Number(options.interval ?? 100);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      const node = findNodeOne(namePart, {
        activeOnly: options.activeOnly ?? true
      });

      if (node) {
        return {
          ok: true,
          node,
          namePart,
          waitedMs: Date.now() - startedAt
        };
      }

      if (shouldStopServerSurvey()) {
        return {
          ok: false,
          stopped: true,
          namePart,
          waitedMs: Date.now() - startedAt,
          reason: "manual stop"
        };
      }

      await sleep(interval);
    }

    return {
      ok: false,
      node: null,
      namePart,
      waitedMs: Date.now() - startedAt,
      reason: "timeout"
    };
  }

  function getNodeTextDeep(node, maxDepth = 12) {
    const texts = [];

    (function walk(current, depth = 0) {
      if (!current || depth > maxDepth) return;

      try {
        const label = current.getComponent?.(cc.Label);
        if (label?.string) texts.push(String(label.string));
      } catch {}

      try {
        const rich = current.getComponent?.(cc.RichText);
        if (rich?.string) texts.push(String(rich.string));
      } catch {}

      for (const child of current.children || []) {
        walk(child, depth + 1);
      }
    })(node);

    return texts.join(" ").trim();
  }

  function triggerCocosButtonSafe(node) {
    if (!node) return false;

    try {
      const button = node.getComponent?.(cc.Button);
      if (button?.clickEvents?.length && cc.Component?.EventHandler?.emitEvents) {
        cc.Component.EventHandler.emitEvents(button.clickEvents, {
          type: "click",
          target: node,
          currentTarget: node
        });
        return true;
      }
    } catch (error) {
      console.warn("[TopWar V2.6] cc.Button clickEvents 실패:", error);
    }

    try {
      node.emit("click", {
        type: "click",
        target: node,
        currentTarget: node
      });
      return true;
    } catch (error) {
      console.warn("[TopWar V2.6] node.emit click 실패:", error);
    }

    return false;
  }

  function listButtonsUnderNode(root, options = {}) {
    if (!root) return [];

    const rows = [];
    const maxDepth = Number(options.maxDepth ?? 40);

    (function walk(node, path = node.name, depth = 0) {
      if (!node || depth > maxDepth) return;

      let hasButton = false;
      const components = [];

      try {
        hasButton = !!node.getComponent?.(cc.Button);
        for (const component of node.getComponents?.(cc.Component) || []) {
          components.push(
            component.constructor?.name ||
            component.name ||
            component._name ||
            "Component"
          );
        }
      } catch {}

      if (node.activeInHierarchy && hasButton) {
        const text = getNodeTextDeep(node);
        rows.push({
          node,
          nodeName: node.name,
          path,
          text,
          normalizedText: normalizeToken(text),
          worldPosition: getWorldPosition(node),
          components
        });
      }

      for (const child of node.children || []) {
        walk(child, `${path}/${child.name}`, depth + 1);
      }
    })(root);

    return rows;
  }

  function clickButtonByTextIn(root, keywords, options = {}) {
    const buttons = options.buttons || listButtonsUnderNode(root, options);
    const keywordList = (Array.isArray(keywords) ? keywords : [keywords])
      .map(normalizeToken)
      .filter(Boolean);

    const exact = buttons.find(button =>
      keywordList.some(keyword => button.normalizedText === keyword)
    );

    const partial = exact || buttons.find(button =>
      keywordList.some(keyword =>
        button.normalizedText.includes(keyword) ||
        keyword.includes(button.normalizedText)
      )
    );

    if (!partial) {
      return {
        ok: false,
        reason: "button text not found",
        keywords,
        candidates: buttons.map(button => ({
          text: button.text,
          normalizedText: button.normalizedText,
          path: button.path
        }))
      };
    }

    return {
      ok: triggerCocosButtonSafe(partial.node),
      target: {
        nodeName: partial.nodeName,
        text: partial.text,
        normalizedText: partial.normalizedText,
        path: partial.path,
        worldPosition: partial.worldPosition,
        components: partial.components
      }
    };
  }

  Object.assign(TOPWAR, {
    findNodeOne,
    waitNodeOne,
    getNodeWorldPositionSafe: getWorldPosition,
    getNodeTextDeep,
    triggerCocosButtonSafe,
    listButtonsUnderNode
  });

  function findNWorldCityPopup() {
    return findNodeOne("NWorldCityPopup", { activeOnly: true });
  }

  function findPrefabPlayerInfoPanel() {
    return findNodeOne("prefabPlayerInfoPanel", { activeOnly: true });
  }

  function findAllianceMainOtherPopup() {
    return (
      findNodeOne("AllianceMainOtherPopup", { activeOnly: true }) ||
      findNodeOne("AllianceOtherPopup", { activeOnly: true })
    );
  }

  function listNWorldCityPopupButtons() {
    const popup = findNWorldCityPopup();
    if (!popup) return [];

    const buttons = listButtonsUnderNode(popup);

    for (const button of buttons) {
      const pathText = `${button.nodeName || ""} ${button.path || ""}`.toLowerCase();
      let score = 0;

      if (pathText.includes("profile")) score += 100;
      if (pathText.includes("avatar")) score += 100;
      if (pathText.includes("head")) score += 90;
      if (pathText.includes("headimg")) score += 120;
      if (pathText.includes("icon")) score += 40;
      if (!button.text) score += 30;
      if (button.text) score -= 40;
      if ((button.worldPosition?.x ?? 9999) < 500) score += 15;
      if ((button.worldPosition?.y ?? 0) > 350) score += 15;

      button.score = score;
    }

    buttons.sort((a, b) => b.score - a.score);
    window.__TOPWAR_NWORLD_CITY_POPUP_BUTTONS__ = buttons;

    return buttons;
  }

  async function clickProfileImageForBase(options = {}) {
    const buttons = listNWorldCityPopupButtons();
    const index = Number(options.profileButtonIndex ?? 1);
    const target = buttons[index];

    if (!target) {
      return {
        ok: false,
        reason: "profile button not found",
        index,
        count: buttons.length
      };
    }

    return {
      ok: triggerCocosButtonSafe(target.node),
      index,
      target
    };
  }

  function clickGuildViewButtonFromPlayerInfo() {
    const panel = findPrefabPlayerInfoPanel();

    if (!panel) {
      return {
        ok: false,
        reason: "prefabPlayerInfoPanel not found"
      };
    }

    return clickButtonByTextIn(panel, [
      "길드보기",
      "길드",
      "alliance",
      "guild",
      "viewalliance",
      "guildview"
    ]);
  }

  function getTextEntries(root) {
    const rows = [];

    (function walk(node, depth = 0) {
      if (!node || depth > 40) return;

      let text = null;

      try {
        const label = node.getComponent?.(cc.Label);
        if (label?.string && String(label.string).trim()) {
          text = String(label.string).trim();
        }
      } catch {}

      try {
        const rich = node.getComponent?.(cc.RichText);
        if (!text && rich?.string && String(rich.string).trim()) {
          text = String(rich.string).trim();
        }
      } catch {}

      if (!empty(text)) {
        const position = getWorldPosition(node);
        rows.push({
          nodeName: node.name,
          text: normalizeText(text),
          x: position?.x ?? 0,
          y: position?.y ?? 0
        });
      }

      for (const child of node.children || []) {
        walk(child, depth + 1);
      }
    })(root);

    return rows;
  }

  function groupByY(entries) {
    const tolerance = 8;

    const sorted = [...entries].sort((a, b) => {
      if (Math.abs(b.y - a.y) > tolerance) return b.y - a.y;
      return a.x - b.x;
    });

    const groups = [];

    for (const entry of sorted) {
      let group = groups.find(row => Math.abs(row.y - entry.y) <= tolerance);

      if (!group) {
        group = {
          y: entry.y,
          entries: []
        };
        groups.push(group);
      }

      group.entries.push(entry);
      group.y = (group.y + entry.y) / 2;
    }

    for (const group of groups) {
      group.entries.sort((a, b) => a.x - b.x);
      group.text = normalizeText(group.entries.map(entry => entry.text).join(" "));
    }

    return groups.sort((a, b) => b.y - a.y);
  }

  function valueAfterColon(text) {
    const normalized = normalizeText(text);
    const index = normalized.indexOf(":");
    return index < 0 ? null : normalizeText(normalized.slice(index + 1));
  }

  function numberFrom(text) {
    const match = String(text ?? "").match(/([0-9]+)/);
    return match ? Number(match[1]) : null;
  }

  function parsePowerText(text) {
    const match = normalizeText(text)
      .replace(/\s+/g, "")
      .match(/([0-9]+(?:\.[0-9]+)?)([a-zA-Z]+)?/);

    return match ? `${match[1]}${match[2] ?? ""}` : null;
  }

  function parseMemberText(text) {
    const match = String(text ?? "").match(/([0-9]+)\s*\/\s*([0-9]+)/);

    return match
      ? {
          current: Number(match[1]),
          max: Number(match[2]),
          text: `${match[1]}/${match[2]}`
        }
      : null;
  }

  function saveAllianceDetail(info) {
    ensureState();

    const keys = [];

    if (!empty(info.allianceId)) keys.push(`id:${String(info.allianceId)}`);
    if (!empty(info.allianceCode)) keys.push(`code:${String(info.allianceCode)}`);
    if (!empty(info.allianceTag)) keys.push(`tag:${String(info.allianceTag)}`);
    if (!empty(info.allianceName)) keys.push(`name:${String(info.allianceName)}`);

    if (!keys.length) return info;

    let previous = {};

    for (const key of keys) {
      const old = state.allianceDetailMap.get(key);
      if (old) {
        previous = old;
        break;
      }
    }

    const next = {
      ...previous,
      ...info
    };

    for (const key of [
      "allianceId",
      "allianceCode",
      "allianceTag",
      "allianceName",
      "allianceLeader",
      "allianceLevel",
      "alliancePower",
      "alliancePowerText",
      "allianceMemberCountShown",
      "allianceMemberMax",
      "allianceMemberText",
      "serverId"
    ]) {
      next[key] = pick(previous[key], info[key]);
    }

    for (const key of keys) {
      state.allianceDetailMap.set(key, next);
    }

    if (!empty(next.allianceId)) state.allianceDetailMap.set(`id:${String(next.allianceId)}`, next);
    if (!empty(next.allianceCode)) state.allianceDetailMap.set(`code:${String(next.allianceCode)}`, next);
    if (!empty(next.allianceTag)) state.allianceDetailMap.set(`tag:${String(next.allianceTag)}`, next);
    if (!empty(next.allianceName)) state.allianceDetailMap.set(`name:${String(next.allianceName)}`, next);

    state.lastAllianceMainInfo = next;

    return next;
  }

  function extractAllianceMainOtherPopupInfo(base = {}) {
    const popup = findAllianceMainOtherPopup();

    if (!popup) {
      return {
        ok: false,
        reason: "AllianceMainOtherPopup not found",
        info: {
          allianceId: base.allianceId != null ? String(base.allianceId) : null,
          allianceTag: base.allianceTag ?? null,
          allianceName: base.allianceName ?? null,
          serverId: base.serverId ?? currentServerId()
        }
      };
    }

    const rows = groupByY(getTextEntries(popup));
    const colonRows = rows
      .map(row => ({
        ...row,
        value: valueAfterColon(row.text)
      }))
      .filter(row => !empty(row.value));

    const info = {
      allianceId: base.allianceId != null ? String(base.allianceId) : null,
      allianceTag: base.allianceTag ?? null,
      allianceName: base.allianceName ?? null,
      serverId: base.serverId ?? currentServerId()
    };

    if (colonRows[0]) {
      const value = numberFrom(colonRows[0].value);
      if (value != null) info.allianceLevel = value;
    }

    if (colonRows[1]) info.allianceCode = colonRows[1].value;
    if (colonRows[2]) info.allianceName = colonRows[2].value;
    if (colonRows[3]) info.allianceLeader = colonRows[3].value;

    if (colonRows[4]) {
      const powerText = parsePowerText(colonRows[4].value);
      if (powerText) {
        info.alliancePowerText = powerText;
        const power = parseShortPowerToNumber(powerText);
        if (power != null) info.alliancePower = power;
      }
    }

    if (colonRows[5]) {
      const member = parseMemberText(colonRows[5].value);
      if (member) {
        info.allianceMemberCountShown = member.current;
        info.allianceMemberMax = member.max;
        info.allianceMemberText = member.text;
      }
    }

    const saved = saveAllianceDetail(info);

    console.log("[TopWar V2.6] alliance detail extracted:", saved);

    return {
      ok: true,
      popupName: popup.name,
      info: saved,
      rows: rows.map(row => row.text),
      colonRows: colonRows.map(row => row.text)
    };
  }

  function clickAllianceMemberButton() {
    const popup = findAllianceMainOtherPopup();

    if (!popup) {
      return {
        ok: false,
        reason: "AllianceMainOtherPopup not found"
      };
    }

    const captured = extractAllianceMainOtherPopupInfo(state.currentAllianceTarget || {});
    console.log("[TopWar V2.6] alliance detail captured before member click:", captured.info);

    return clickButtonByTextIn(popup, [
      "길드원",
      "멤버",
      "member",
      "members",
      "alliancemember",
      "alliancemembers",
      "guildmember",
      "guildmembers"
    ]);
  }

  function allianceDetailStatus() {
    const rows = [];
    const seen = new Set();

    for (const [key, detail] of (state.allianceDetailMap || new Map()).entries()) {
      const uniqueKey = detail.allianceId ?? detail.allianceCode ?? detail.allianceName ?? key;

      if (seen.has(uniqueKey)) continue;

      seen.add(uniqueKey);
      rows.push({ key, ...detail });
    }

    window.TOPWAR_LOG_CONTROL.table(rows.map((row, index) => ({
      index,
      key: row.key,
      allianceId: row.allianceId,
      allianceTag: row.allianceTag,
      allianceCode: row.allianceCode,
      allianceName: row.allianceName,
      leader: row.allianceLeader,
      level: row.allianceLevel,
      power: row.alliancePowerText,
      members: row.allianceMemberText
    })));

    return rows;
  }

  function getAllianceDetailsMap() {
    const map = new Map();

    for (const detail of (state.allianceDetailMap || new Map()).values()) {
      if (!detail) continue;

      if (!empty(detail.allianceId)) map.set(`id:${String(detail.allianceId)}`, detail);
      if (!empty(detail.allianceCode)) map.set(`code:${String(detail.allianceCode)}`, detail);
      if (!empty(detail.allianceTag)) map.set(`tag:${String(detail.allianceTag)}`, detail);
      if (!empty(detail.allianceName)) map.set(`name:${String(detail.allianceName)}`, detail);
    }

    return map;
  }

  function findDetailForAlliance(alliance, detailMap = getAllianceDetailsMap()) {
    return (
      (!empty(alliance.allianceId) && detailMap.get(`id:${String(alliance.allianceId)}`)) ||
      (!empty(alliance.allianceCode) && detailMap.get(`code:${String(alliance.allianceCode)}`)) ||
      (!empty(alliance.allianceTag) && detailMap.get(`tag:${String(alliance.allianceTag)}`)) ||
      (!empty(alliance.allianceName) && detailMap.get(`name:${String(alliance.allianceName)}`)) ||
      null
    );
  }

  Object.assign(TOPWAR, {
    findNWorldCityPopup,
    listNWorldCityPopupButtons,
    clickProfileImageForBase,
    findPrefabPlayerInfoPanel,
    clickGuildViewButtonFromPlayerInfo,
    findAllianceMainOtherPopup,
    clickAllianceMemberButton,
    extractAllianceMainOtherPopupInfo,
    extractAllianceInfoFromCurrentPopup: extractAllianceMainOtherPopupInfo,
    allianceDetailStatus
  });

  function getAllianceMemberRawDataList(options = {}) {
    const popup = findNodeOne("AllianceMemberPopup", { activeOnly: true });

    if (!popup) {
      return {
        ok: false,
        reason: "AllianceMemberPopup not found",
        dataList: []
      };
    }

    const candidates = [];

    for (let index = 0; index < (popup._components || []).length; index++) {
      const component = popup._components[index];

      for (const key of ["_dataList", "__dataList", "dataList", "rankList", "memberList", "_memberList"]) {
        const value = component?.[key];

        if (Array.isArray(value)) {
          candidates.push({
            index,
            key,
            component,
            dataList: value,
            score: value.length
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const first = candidates[0];

    if (!first) {
      return {
        ok: false,
        reason: "AllianceMemberPopup dataList not found",
        popup,
        componentKeys: (popup._components || []).map((component, index) => ({
          index,
          keys: component ? Object.keys(component).slice(0, 80) : []
        })),
        dataList: []
      };
    }

    return {
      ok: true,
      source: `AllianceMemberPopup._components[${first.index}].${first.key}`,
      popup,
      component: first.component,
      componentIndex: first.index,
      dataKey: first.key,
      count: first.dataList.length,
      dataList: first.dataList
    };
  }

  function normalizeAllianceMemberFromRaw(raw, alliance = {}) {
    const uid = uidOf(
      raw?.uid ??
      raw?.pid ??
      raw?.playerId ??
      raw?.userId ??
      raw?.roleId ??
      raw?.rid ??
      raw?.id
    );

    if (!uid) return null;

    let playerInfo = null;

    if (typeof raw.playerInfo === "string") {
      try {
        playerInfo = JSON.parse(raw.playerInfo);
      } catch {}
    } else if (raw.playerInfo && typeof raw.playerInfo === "object") {
      playerInfo = raw.playerInfo;
    }

    const heroIconKey = playerInfo
      ? Object.keys(playerInfo).find(key => key.startsWith("hero_"))
      : null;

    const username = pick(
      raw.name,
      raw.username,
      raw.userName,
      raw.nickname,
      raw.nickName,
      raw.playerName,
      raw.roleName,
      playerInfo?.nickname
    );

    return {
      uid,
      username,
      nickname: username,
      level: pick(raw.level, raw.lv, raw.userLevel, raw.roleLevel),
      power: pick(raw.power, raw.cp, raw.fight, raw.fightPower, raw.combatPower, raw.totalPower, raw.val),
      armyPower: raw.armyPower ?? null,
      rank: raw.rank ?? null,
      worldId: raw.worldId ?? null,
      serverId: pick(raw.worldId, alliance.serverId, alliance.worldId),
      headFrameId: raw.headFrameId ?? null,

      allianceId:
        alliance.allianceId != null ? String(alliance.allianceId) :
        raw.allianceId != null ? String(raw.allianceId) :
        raw.aid != null ? String(raw.aid) :
        null,

      allianceTag: pick(alliance.allianceTag, raw.allianceTag, raw.a_tag, raw.tag),
      allianceName: pick(alliance.allianceName, raw.allianceName, raw.a_name),
      allianceRole: pick(raw.role, raw.position, raw.memberRole, raw.duty, raw.job, raw.title, raw.rank),

      isOnline: pick(raw.isOnline, raw.online, raw.onlineState, raw.onlineStatus, raw.state),
      joinTime: raw.joinTime ?? null,
      lastShowTime: raw.lastShowTime ?? null,
      lastLogin: pick(
        raw.lastLogin,
        raw.lastLoginTime,
        raw.lastOnlineTime,
        raw.logoutTime,
        raw.offTime,
        raw.offlineTime,
        raw.loginTime,
        raw.lastShowTime
      ),

      nationalFlag: playerInfo?.nationalFlag ?? playerInfo?.nationalflag ?? null,
      gender: playerInfo?.gender ?? null,
      avatarUrl: playerInfo?.avatarUrl ?? null,
      heroIconKey,
      heroIcon: heroIconKey ? playerInfo?.[heroIconKey] : null,
      memberSource: "AllianceMemberPopup dataList"
    };
  }

  function mergeAllianceMemberRawDataList(dataList, alliance = {}) {
    if (!Array.isArray(dataList)) {
      return {
        ok: false,
        reason: "dataList is not array"
      };
    }

    ensureState();

    const last = state.lastAllianceMainInfo || {};
    const target = state.currentAllianceTarget || {};

    const enriched = {
      ...target,
      ...last,
      ...alliance,

      allianceId:
        alliance.allianceId != null ? String(alliance.allianceId) :
        last.allianceId != null ? String(last.allianceId) :
        target.allianceId != null ? String(target.allianceId) :
        null,

      allianceTag: pick(alliance.allianceTag, last.allianceTag, target.allianceTag),
      allianceCode: pick(alliance.allianceCode, last.allianceCode, target.allianceCode),
      allianceName: pick(alliance.allianceName, last.allianceName, target.allianceName),
      allianceLeader: pick(alliance.allianceLeader, last.allianceLeader),
      allianceLevel: pick(alliance.allianceLevel, last.allianceLevel),
      alliancePower: pick(alliance.alliancePower, last.alliancePower),
      alliancePowerText: pick(alliance.alliancePowerText, last.alliancePowerText),
      allianceMemberCountShown: pick(alliance.allianceMemberCountShown, last.allianceMemberCountShown),
      allianceMemberMax: pick(alliance.allianceMemberMax, last.allianceMemberMax),
      allianceMemberText: pick(alliance.allianceMemberText, last.allianceMemberText),
      serverId: pick(alliance.serverId, last.serverId, target.serverId, currentServerId())
    };

    saveAllianceDetail(enriched);

    const uniqueMembers = new Map();

    for (const raw of dataList) {
      const member = normalizeAllianceMemberFromRaw(raw, enriched);
      if (member?.uid) uniqueMembers.set(member.uid, member);
    }

    let merged = 0;
    let skippedNotOnMap = 0;

    const mergedMembers = [];
    const skippedMembers = [];

    for (const member of uniqueMembers.values()) {
      const previous = state.playerMap.get(member.uid);

      if (!previous || !(previous.x != null && previous.y != null || previous.source?.map)) {
        skippedNotOnMap++;
        skippedMembers.push({
          uid: member.uid,
          username: member.username,
          reason: "not found on map"
        });
        continue;
      }

      const armyValue = pick(previous.armyPower, member.armyPower);

      const next = {
        ...previous,

        uid: member.uid,
        username: pick(previous.username, member.username),
        nickname: pick(previous.nickname, member.nickname, member.username),

        level: pick(previous.level, member.level),
        power: pick(previous.power, member.power),

        armyPower: armyValue,
        armyPowerText: pick(previous.armyPowerText, formatTopWarPower(armyValue)),

        rank: pick(member.rank, previous.rank),
        worldId: pick(previous.worldId, member.worldId, member.serverId),
        serverId: pick(previous.serverId, member.serverId, member.worldId, enriched.serverId),
        headFrameId: pick(previous.headFrameId, member.headFrameId),

        allianceId:
          previous.allianceId != null ? String(previous.allianceId) :
          member.allianceId != null ? String(member.allianceId) :
          enriched.allianceId != null ? String(enriched.allianceId) :
          null,

        allianceTag: pick(previous.allianceTag, member.allianceTag, enriched.allianceTag),
        allianceName: pick(previous.allianceName, member.allianceName, enriched.allianceName),
        allianceRole: pick(member.allianceRole, member.rank, previous.allianceRole),

        isOnline: pick(member.isOnline, previous.isOnline),
        joinTime: pick(member.joinTime, previous.joinTime),
        lastShowTime: pick(member.lastShowTime, previous.lastShowTime),
        lastLogin: pick(member.lastLogin, member.lastShowTime, previous.lastLogin),

        nationalFlag: pick(previous.nationalFlag, previous.nationalflag, member.nationalFlag),
        gender: pick(previous.gender, member.gender),
        avatarUrl: pick(previous.avatarUrl, member.avatarUrl),
        heroIconKey: pick(previous.heroIconKey, member.heroIconKey),
        heroIcon: pick(previous.heroIcon, member.heroIcon),

        source: {
          ...(previous.source || {}),
          map: true,
          allianceMember: true
        }
      };

      // 런타임 playerMap은 원본/확장 정보를 보존하는 저장소다.
      // export 크기 최적화를 이유로 여기서 playerInfo/raw/rawKeys 등을 삭제하지 않는다.
      state.playerMap.set(member.uid, next);
      state.memberMap.set(member.uid, member);

      merged++;
      mergedMembers.push(next);
    }

    const result = {
      ok: true,
      rawCount: dataList.length,
      uniqueMemberCount: uniqueMembers.size,
      merged,
      inserted: 0,
      skippedNotOnMap,
      totalPlayers: state.playerMap.size,
      totalMembers: state.memberMap.size,
      allianceInfo: enriched,
      mergedMembers,
      skippedMembers
    };

    console.log("[TopWar V2.6] alliance members merged:", result);

    return result;
  }

  Object.assign(TOPWAR, {
    getAllianceMemberRawDataList,
    normalizeAllianceMemberFromRaw,
    mergeAllianceMemberRawDataList
  });

  async function dragCanvasRatio(fromX, fromY, toX, toY, options = {}) {
    const canvas = document.querySelector("canvas");
    if (!canvas) return false;

    const rect = canvas.getBoundingClientRect();

    const startX = rect.left + rect.width * Number(fromX);
    const startY = rect.top + rect.height * Number(fromY);
    const endX = rect.left + rect.width * Number(toX);
    const endY = rect.top + rect.height * Number(toY);

    const steps = Number(options.steps ?? 16);
    const stepDelay = Number(options.stepDelay ?? 18);

    function mouse(type, x, y, buttons = 0) {
      canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons
      }));
    }

    function pointer(type, x, y, buttons = 0) {
      try {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          button: 0,
          buttons
        }));
      } catch {}
    }

    pointer("pointermove", startX, startY, 0);
    mouse("mousemove", startX, startY, 0);

    pointer("pointerdown", startX, startY, 1);
    mouse("mousedown", startX, startY, 1);

    for (let index = 1; index <= steps; index++) {
      if (shouldStopServerSurvey()) break;

      const ratio = index / steps;
      const x = startX + (endX - startX) * ratio;
      const y = startY + (endY - startY) * ratio;

      pointer("pointermove", x, y, 1);
      mouse("mousemove", x, y, 1);

      await sleep(stepDelay);
    }

    pointer("pointerup", endX, endY, 0);
    mouse("mouseup", endX, endY, 0);
    mouse("click", endX, endY, 0);

    await interruptibleSleep(Number(options.afterDragWait ?? 500));

    return true;
  }

  async function interruptibleSleep(totalMs, stepMs = 100) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < totalMs) {
      if (shouldStopServerSurvey()) return false;

      await sleep(Math.min(stepMs, totalMs - (Date.now() - startedAt)));
    }

    return true;
  }

  async function collectAllianceMemberRawDataListByScroll(options = {}) {
    const maxRounds = Number(options.memberScrollMaxRounds ?? 150);
    const noChangeLimit = Number(options.memberScrollNoChangeLimit ?? 10);
    const scrollDelay = Number(options.memberScrollDelay ?? 700);

    const unique = new Map();
    const logs = [];

    function absorb(list) {
      let added = 0;

      for (const row of list || []) {
        const uid = uidOf(
          row?.uid ??
          row?.pid ??
          row?.playerId ??
          row?.userId ??
          row?.roleId ??
          row?.rid ??
          row?.id
        );

        if (!uid) continue;

        if (!unique.has(uid)) {
          unique.set(uid, row);
          added++;
        }
      }

      return added;
    }

    let noChangeCount = 0;

    for (let round = 1; round <= maxRounds; round++) {
      if (shouldStopServerSurvey()) {
        console.warn("[TopWar V2.6] 동맹원 스크롤 수집 중지됨", {
          round,
          unique: unique.size
        });
        break;
      }

      const before = unique.size;
      const current = getAllianceMemberRawDataList();
      const added = current.ok ? absorb(current.dataList) : 0;
      const after = unique.size;

      noChangeCount = after === before ? noChangeCount + 1 : 0;

      const log = {
        round,
        ok: current.ok,
        visibleCount: current.dataList?.length ?? 0,
        added,
        unique: after,
        noChangeCount,
        source: current.source,
        reason: current.reason
      };

      logs.push(log);

      console.log(`[TopWar V2.6] alliance member scroll ${round}/${maxRounds}`, log);

      if (!current.ok || noChangeCount >= noChangeLimit) break;

      await dragCanvasRatio(
        Number(options.memberScrollFromX ?? 0.50),
        Number(options.memberScrollFromY ?? 0.78),
        Number(options.memberScrollToX ?? 0.50),
        Number(options.memberScrollToY ?? 0.28),
        {
          steps: options.memberScrollSteps ?? 16,
          stepDelay: options.memberScrollStepDelay ?? 18,
          afterDragWait: 0
        }
      );

      const keepGoing = await interruptibleSleep(scrollDelay);
      if (!keepGoing) break;
    }

    const dataList = [...unique.values()];

    return {
      ok: dataList.length > 0,
      stopped: shouldStopServerSurvey(),
      source: "AllianceMemberPopup dataList + scroll",
      count: dataList.length,
      dataList,
      logs
    };
  }

  Object.assign(TOPWAR, {
    dragCanvasRatio,
    collectAllianceMemberRawDataListByScroll
  });

  async function closePopupByCloseMethod(popupName, options = {}) {
    const popup = findNodeOne(popupName, { activeOnly: true });

    if (!popup) {
      return {
        ok: true,
        skipped: true,
        popupName,
        reason: "popup not found"
      };
    }

    const components = popup._components || [];

    let componentIndex = options.componentIndex;

    if (componentIndex == null) {
      componentIndex = components.findIndex(component => typeof component?.close === "function");
    }

    const component = components[Number(componentIndex)];

    if (!component || typeof component.close !== "function") {
      return {
        ok: false,
        popupName,
        reason: "close method not found",
        components: components.map((item, index) => ({
          index,
          name: item?.constructor?.name || item?.name || item?._name || "unknown",
          hasClose: typeof item?.close === "function",
          keys: item ? Object.keys(item).slice(0, 60) : []
        }))
      };
    }

    component.close();

    await sleep(options.afterCloseWait ?? 700);

    return {
      ok: !findNodeOne(popupName, { activeOnly: true }),
      popupName,
      componentIndex: Number(componentIndex)
    };
  }

  async function recoverToMapAfterFailedCollect(options = {}) {
    const result = {
      ok: true,
      steps: []
    };

    async function close(name, index = null) {
      const closeResult = await closePopupByCloseMethod(name, {
        componentIndex: index,
        afterCloseWait: options.afterCloseWait ?? 500
      });

      result.steps.push({
        type: "closePopup",
        popupName: name,
        componentIndex: index,
        closeResult
      });

      return closeResult;
    }

    await close("AllianceMemberPopup", options.memberPopupCloseComponentIndex ?? 2);
    await close("AllianceMainOtherPopup");
    await close("AllianceOtherPopup");
    await close("prefabPlayerInfoPanel");
    await close("NWorldCityPopup");

    for (let index = 0; index < Number(options.recoverBackClickCount ?? 3); index++) {
      const clicked = TOPWAR.clickCanvasRatio(0.1, 0.9);

      await sleep(Number(options.recoverBackClickDelay ?? 600));

      result.steps.push({
        type: "backClick",
        index: index + 1,
        clicked
      });
    }

    return result;
  }

  Object.assign(TOPWAR, {
    closePopupByCloseMethod,
    recoverToMapAfterFailedCollect
  });

  async function clickBaseUntilCityPopup(options = {}) {
    const waitBefore = Number(options.waitBefore ?? 900);
    const clickDelay = Number(options.clickDelay ?? 350);
    const popupTimeout = Number(options.popupTimeout ?? 1200);
    const recenterEvery = Math.max(1, Number(options.recenterEvery ?? 3));
    const targetX = Number(options.targetX);
    const targetY = Number(options.targetY);
    const hasTarget = Number.isFinite(targetX) && Number.isFinite(targetY);

    await interruptibleSleep(waitBefore);

    const candidates = options.candidates ?? [
      [0.50, 0.50],
      [0.50, 0.53],
      [0.50, 0.56],
      [0.50, 0.60],
      [0.47, 0.50],
      [0.53, 0.50],
      [0.48, 0.55],
      [0.52, 0.55],
      [0.46, 0.58],
      [0.54, 0.58],
      [0.50, 0.47],
      [0.48, 0.48],
      [0.52, 0.48]
    ];

    const logs = [];

    const maximumRounds = Math.max(1, Number(options.rounds ?? 3));

    async function returnToTarget(reason, round, index) {
      if (!hasTarget) return { ok: false, skipped: true, reason: "target coordinates unavailable" };

      const recovery = await recoverToMapAfterFailedCollect({
        ...options,
        recoverBackClickCount: options.baseRetryBackClickCount ?? 2,
        recoverBackClickDelay: options.baseRetryBackClickDelay ?? 450,
        afterCloseWait: options.baseRetryCloseWait ?? 350
      });

      if (shouldStopServerSurvey()) {
        return { ok: false, stopped: true, reason: "manual stop", recovery };
      }

      const move = await TOPWAR.moveMapToStableUnified(targetX, targetY, {
        serverId: options.serverId ?? currentServerId(),
        subMap: options.subMap ?? 0,
        scale: options.openScale ?? 1,
        afterMoveWait: options.baseRetryAfterMoveWait ?? 500,
        wait901Timeout: options.wait901Timeout ?? 2200,
        quietMs: options.quietMs ?? 300,
        maxRetries: options.maxRetries ?? 1,
        collectCache: false
      });

      await interruptibleSleep(Number(options.baseRetrySettleDelay ?? 900));

      const entry = { type: "returnToTarget", reason, round, index, recovery, move };
      logs.push(entry);
      console.warn("[TopWar V2.14.1] 원하는 기지 메뉴가 열리지 않아 좌표로 복귀합니다.", entry);
      return { ok: move?.ok !== false, recovery, move };
    }

    for (let round = 1; round <= maximumRounds; round++) {
      for (let index = 0; index < candidates.length; index++) {
        if (shouldStopServerSurvey()) {
          return {
            ok: false,
            stopped: true,
            reason: "manual stop",
            logs
          };
        }

        const [rx, ry] = candidates[index];

        const clicked = TOPWAR.clickCanvasRatio(rx, ry);

        await interruptibleSleep(clickDelay);

        const wait = await waitNodeOne("NWorldCityPopup", {
          timeout: popupTimeout,
          interval: 100,
          activeOnly: true
        });

        const log = {
          round,
          index,
          rx,
          ry,
          clicked,
          popup: !!wait.ok
        };

        logs.push(log);

        if (wait.ok) {
          console.log("[TopWar V2.6] base selected:", log);

          return {
            ok: true,
            round,
            index,
            rx,
            ry,
            clicked,
            wait,
            logs
          };
        }

        const failedInRound = index + 1;
        const shouldRecenter = failedInRound % recenterEvery === 0;
        const hasMoreAttempts = round < maximumRounds || index + 1 < candidates.length;

        if (shouldRecenter && hasMoreAttempts) {
          const returned = await returnToTarget("NWorldCityPopup timeout", round, index);
          if (returned.stopped) {
            return {
              ok: false,
              stopped: true,
              reason: "manual stop during base click recovery",
              logs
            };
          }
        }
      }

      if (round < maximumRounds) {
        const returned = await returnToTarget("base click round exhausted", round, candidates.length - 1);
        if (returned.stopped) {
          return {
            ok: false,
            stopped: true,
            reason: "manual stop during base click recovery",
            logs
          };
        }
      }
    }

    console.warn("[TopWar V2.6] base select failed:", logs);

    return {
      ok: false,
      reason: "NWorldCityPopup not opened",
      logs
    };
  }

  TOPWAR.clickBaseUntilCityPopup = clickBaseUntilCityPopup;

  async function collectAllianceMembersFromBaseAt(x, y, options = {}) {
    const serverId = options.serverId ?? currentServerId();

    if (!serverId) {
      return {
        ok: false,
        reason: "serverId is required"
      };
    }

    const delay = {
      afterMove: Number(options.afterMoveDelay ?? 700),
      afterCenterClick: Number(options.afterCenterClickDelay ?? 900),
      afterProfileClick: Number(options.afterProfileClickDelay ?? 900),
      afterGuildViewClick: Number(options.afterGuildViewClickDelay ?? 1200),
      afterMemberClick: Number(options.afterMemberClickDelay ?? 1200),
      afterClose: Number(options.afterCloseDelay ?? 700)
    };

    const result = {
      ok: false,
      x,
      y,
      serverId,
      stages: {}
    };

    result.stages.move = await TOPWAR.moveMapToStableUnified(x, y, {
      serverId,
      subMap: options.subMap ?? 0,
      scale: options.openScale ?? 1,
      afterMoveWait: options.afterMoveWait ?? 500,
      wait901Timeout: options.wait901Timeout ?? 2200,
      quietMs: options.quietMs ?? 300,
      maxRetries: options.maxRetries ?? 1,
      collectCache: options.collectCache ?? true
    });

    if (shouldStopServerSurvey()) {
      result.stopped = true;
      result.reason = "manual stop after move";
      return result;
    }

    await interruptibleSleep(delay.afterMove);

    result.stages.baseClick = await clickBaseUntilCityPopup({
      targetX: x,
      targetY: y,
      serverId,
      subMap: options.subMap ?? 0,
      openScale: options.openScale ?? 1,
      waitBefore: options.beforeBaseClickDelay ?? 900,
      clickDelay: options.baseClickDelay ?? 350,
      popupTimeout: options.cityPopupClickTimeout ?? 1200,
      rounds: options.baseClickRounds ?? 3,
      recenterEvery: options.baseClickRecenterEvery ?? 3,
      candidates: options.baseClickCandidates
    });

    result.stages.waitCityPopup = result.stages.baseClick?.wait ?? {
      ok: false,
      reason: "base click failed"
    };

    await interruptibleSleep(delay.afterCenterClick);

    if (!result.stages.waitCityPopup.ok) {
      result.reason = "NWorldCityPopup timeout";
      return result;
    }

    result.stages.profileClick = await clickProfileImageForBase({
      profileButtonIndex: options.profileButtonIndex ?? 1
    });

    result.stages.waitPlayerInfo = await waitNodeOne("prefabPlayerInfoPanel", {
      timeout: options.playerInfoTimeout ?? 5000,
      interval: options.waitInterval ?? 100
    });

    await interruptibleSleep(delay.afterProfileClick);

    if (!result.stages.waitPlayerInfo.ok) {
      result.reason = "prefabPlayerInfoPanel timeout";
      return result;
    }

    result.stages.guildViewClick = clickGuildViewButtonFromPlayerInfo();

    result.stages.waitAllianceMain = await waitNodeOne("AllianceMainOtherPopup", {
      timeout: options.alliancePopupTimeout ?? 6000,
      interval: options.waitInterval ?? 100
    });

    await interruptibleSleep(delay.afterGuildViewClick);

    if (!result.stages.waitAllianceMain.ok) {
      result.reason = "AllianceMainOtherPopup timeout";
      return result;
    }

    result.stages.allianceInfo = extractAllianceMainOtherPopupInfo({
      allianceId: options.allianceId,
      allianceTag: options.allianceTag,
      allianceName: options.allianceName,
      serverId
    });

    const expectedAllianceId = options.allianceId != null
      ? String(options.allianceId)
      : null;
    const openedAllianceId = result.stages.allianceInfo?.allianceId != null
      ? String(result.stages.allianceInfo.allianceId)
      : null;

    if (expectedAllianceId && openedAllianceId && expectedAllianceId !== openedAllianceId) {
      result.reason = "different base/alliance popup opened";
      result.stages.targetValidation = {
        ok: false,
        expectedAllianceId,
        openedAllianceId,
        expectedAllianceTag: options.allianceTag ?? null,
        openedAllianceTag: result.stages.allianceInfo?.allianceTag ?? null
      };
      console.warn("[TopWar V2.14.1] 다른 오브젝트 또는 기지가 선택되어 다시 시도합니다.", result.stages.targetValidation);
      return result;
    }

    result.stages.targetValidation = {
      ok: true,
      expectedAllianceId,
      openedAllianceId
    };

    result.stages.memberButtonClick = clickAllianceMemberButton();

    result.stages.waitMemberPopup = await waitNodeOne("AllianceMemberPopup", {
      timeout: options.memberPopupTimeout ?? 7000,
      interval: options.waitInterval ?? 100
    });

    await interruptibleSleep(delay.afterMemberClick);

    if (!result.stages.waitMemberPopup.ok) {
      result.reason = "AllianceMemberPopup timeout";
      return result;
    }

    result.rawResult = await collectAllianceMemberRawDataListByScroll(options);

    if (!result.rawResult.ok) {
      result.reason = result.rawResult.reason ?? "scroll data collect failed";
      return result;
    }

    result.dataList = result.rawResult.dataList;

    if (options.merge !== false) {
      result.mergeResult = mergeAllianceMemberRawDataList(result.dataList, {
        allianceId: options.allianceId,
        allianceTag: options.allianceTag,
        allianceName: options.allianceName,
        serverId
      });
    }

    if (options.closeAfter !== false) {
      result.closeResult = await closePopupByCloseMethod("AllianceMemberPopup", {
        componentIndex: options.memberPopupCloseComponentIndex ?? 2,
        afterCloseWait: delay.afterClose
      });

      if (options.returnToMap !== false) {
        for (let index = 0; index < Number(options.backClickCount ?? 2); index++) {
          TOPWAR.clickCanvasRatio(0.1, 0.9);
          await interruptibleSleep(Number(options.backClickDelay ?? 700));
        }
      }
    }

    result.ok = true;

    console.log("[TopWar V2.6] collectAllianceMembersFromBaseAt done:", {
      ok: result.ok,
      count: result.dataList?.length ?? 0,
      merged: result.mergeResult?.merged,
      skippedNotOnMap: result.mergeResult?.skippedNotOnMap
    });

    return result;
  }

  async function collectAllianceMembersFromTarget(target, options = {}) {
    if (!target) {
      return {
        ok: false,
        reason: "target is required"
      };
    }

    state.currentAllianceTarget = {
      ...target,
      allianceId: target?.allianceId != null ? String(target.allianceId) : null,
      allianceTag: target?.allianceTag ?? null,
      allianceName: target?.allianceName ?? null,
      serverId: options.serverId ?? target?.serverId ?? currentServerId()
    };

    return collectAllianceMembersFromBaseAt(target.x, target.y, {
      ...options,
      serverId: target.serverId ?? options.serverId,
      allianceId: target.allianceId ?? options.allianceId,
      allianceTag: target.allianceTag ?? options.allianceTag,
      allianceName: target.allianceName ?? options.allianceName,
      scale: options.openScale ?? 1,
      openScale: options.openScale ?? 1
    });
  }

  async function collectAllianceMembersFromTargetWithRecovery(target, options = {}) {
    const maxAttempts = Number(options.collectRetry ?? 2);
    const attempts = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (shouldStopServerSurvey()) {
        return {
          ok: false,
          stopped: true,
          reason: "manual stop",
          target,
          attempts
        };
      }

      let collectResult;

      try {
        collectResult = await collectAllianceMembersFromTarget(target, {
          ...options,
          closeAfter: true,
          returnToMap: true
        });
      } catch (error) {
        collectResult = {
          ok: false,
          reason: "exception",
          message: error?.message,
          stack: error?.stack
        };
      }

      attempts.push({
        attempt,
        collectResult
      });

      if (collectResult?.ok) {
        return {
          ok: true,
          attempt,
          target,
          collectResult,
          attempts
        };
      }

      attempts[attempts.length - 1].recoveryResult = await recoverToMapAfterFailedCollect(options);

      await interruptibleSleep(Number(options.retryDelayAfterRecover ?? 1200));
    }

    return {
      ok: false,
      reason: "all attempts failed",
      target,
      attempts
    };
  }

  Object.assign(TOPWAR, {
    collectAllianceMembersFromBaseAt,
    collectAllianceMembersFromTarget,
    collectAllianceMembersFromTargetWithRecovery
  });

  function getAllianceCollectionTargets(options = {}) {
    const rows = typeof TOPWAR.allianceRepresentatives === "function"
      ? TOPWAR.allianceRepresentatives()
      : [];

    return rows
      .filter(row => row.allianceId && row.x != null && row.y != null)
      .map(row => ({
        allianceId: String(row.allianceId),
        allianceTag: row.allianceTag,
        allianceName: row.allianceName,
        serverId: row.serverId ?? options.serverId ?? currentServerId(),
        representativeUid: row.uid,
        representativeName: row.username,
        x: row.x,
        y: row.y,
        power: row.power,
        raw: row
      }));
  }

  function uniqueTargetsByAllianceId(targets) {
    const map = new Map();

    for (const target of targets || []) {
      if (!target?.allianceId || target.x == null || target.y == null) continue;

      const allianceId = String(target.allianceId);
      const previous = map.get(allianceId);

      if (!previous || Number(target.power ?? 0) > Number(previous.power ?? 0)) {
        map.set(allianceId, {
          ...target,
          allianceId
        });
      }
    }

    return [...map.values()].sort((a, b) => Number(b.power ?? 0) - Number(a.power ?? 0));
  }

  TOPWAR.getAllianceCollectionTargets = getAllianceCollectionTargets;

  function compactPlayerForExport(raw) {
    const uid = uidOf(raw?.uid);

    if (!uid || !(raw.x != null && raw.y != null || raw.source?.map)) {
      return null;
    }

    const out = { uid };

    put(out, "username", raw.username ?? raw.nickname);
    put(out, "nickname", raw.nickname ?? raw.username);

    put(out, "serverId", raw.serverId ?? raw.worldId);
    put(out, "worldId", raw.worldId ?? raw.serverId);

    put(out, "x", raw.x);
    put(out, "y", raw.y);
    put(out, "pointId", raw.pointId ?? raw.id);
    put(out, "pointType", raw.pointType);

    put(out, "level", raw.level);
    put(out, "power", raw.power);

    put(out, "armyPower", formatArmyPowerRaw(raw.armyPower));
    put(out, "armyPowerText", raw.armyPowerText ?? formatTopWarPower(raw.armyPower));

    put(out, "allianceId", raw.allianceId != null ? String(raw.allianceId) : null);
    put(out, "allianceTag", raw.allianceTag);
    put(out, "allianceName", raw.allianceName);
    put(out, "allianceRole", raw.allianceRole ?? raw.rank);

    put(out, "rank", raw.rank);
    put(out, "isOnline", raw.isOnline);
    put(out, "joinTime", raw.joinTime);
    put(out, "lastShowTime", raw.lastShowTime);
    put(out, "lastLogin", raw.lastLogin ?? raw.lastShowTime);

    put(out, "language", raw.language);
    put(out, "nationalflag", raw.nationalflag ?? raw.nationalFlag);
    put(out, "gender", raw.gender);
    put(out, "usergender", raw.usergender);

    put(out, "avatarUrl", raw.avatarUrl);
    put(out, "headFrameId", raw.headFrameId);
    put(out, "heroIcon", raw.heroIcon);

    out.source = { map: true };

    if (raw.source?.allianceMember) {
      out.source.allianceMember = true;
    }

    return out;
  }

  function mergeCompactPlayers(previous, next) {
    const uid = uidOf(previous?.uid ?? next?.uid);
    const out = { uid };

    for (const key of new Set([...Object.keys(previous || {}), ...Object.keys(next || {})])) {
      if (key === "uid" || key === "source") continue;
      out[key] = pick(next?.[key], previous?.[key]);
    }

    out.source = { map: true };

    if (previous?.source?.allianceMember || next?.source?.allianceMember) {
      out.source.allianceMember = true;
    }

    return out;
  }

  function normalizeTimeMs(value) {
    if (value == null) return null;

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value <= 0) return null;
      return value < 1000000000000 ? value * 1000 : value;
    }

    const text = String(value).trim();

    if (!text) return null;

    if (/^\d+$/.test(text)) {
      const number = Number(text);
      if (!Number.isFinite(number) || number <= 0) return null;
      return number < 1000000000000 ? number * 1000 : number;
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function hasHighRole(player) {
    const roleText = String(player.allianceRole ?? player.rank ?? "").toLowerCase();

    if (!roleText) return false;

    if (/leader|r5|r4|officer|president|길드장|맹주|간부|장로|관리/.test(roleText)) {
      return true;
    }

    const number = Number(roleText);
    return Number.isFinite(number) && number > 0 && number <= 4;
  }

  function recentLoginScore(player, reasons) {
    const timeMs = normalizeTimeMs(player.lastLogin ?? player.lastShowTime);
    if (!timeMs) return 0;

    const days = (Date.now() - timeMs) / 86400000;

    if (days <= 1) {
      reasons.push("recent_login_1d");
      return 25;
    }

    if (days <= 3) {
      reasons.push("recent_login_3d");
      return 20;
    }

    if (days <= 7) {
      reasons.push("recent_login_7d");
      return 10;
    }

    if (days > 14) {
      reasons.push("old_login_14d_plus");
    }

    return 0;
  }

  function daysBetweenMs(targetMs, baseMs) {
    if (!targetMs || !baseMs) return null;
    return (baseMs - targetMs) / 86400000;
  }

  function classifyUserStatus(player, exportedAtMs = Date.now()) {
    const reasons = [];
    let inactiveScore = 0;

    const isOnline =
      player.isOnline === true ||
      player.isOnline === 1 ||
      player.isOnline === "1" ||
      String(player.isOnline).toLowerCase() === "true";

    if (isOnline) {
      return {
        userStatus: "ACTIVE",
        inactiveScore: 0,
        inactiveReasons: ["online"],
        lastLoginDaysAgo: 0
      };
    }

    const timeMs = normalizeTimeMs(player.lastLogin ?? player.lastShowTime);
    const daysAgo = daysBetweenMs(timeMs, exportedAtMs);

    if (daysAgo == null || !Number.isFinite(daysAgo)) {
      reasons.push("lastLogin_unknown");

      if (player.source?.allianceMember) {
        reasons.push("alliance_member_confirmed");
        inactiveScore += 15;
      }

      return {
        userStatus: "UNKNOWN",
        inactiveScore,
        inactiveReasons: reasons,
        lastLoginDaysAgo: null
      };
    }

    const roundedDays = Number(Math.max(0, daysAgo).toFixed(2));

    if (daysAgo <= 1) {
      reasons.push("lastLoginWithin1Day");
      return {
        userStatus: "ACTIVE",
        inactiveScore: 0,
        inactiveReasons: reasons,
        lastLoginDaysAgo: roundedDays
      };
    }

    if (daysAgo <= 3) {
      reasons.push("lastLoginWithin3Days");
      return {
        userStatus: "RECENT",
        inactiveScore: 10,
        inactiveReasons: reasons,
        lastLoginDaysAgo: roundedDays
      };
    }

    if (daysAgo <= 7) {
      reasons.push("lastLoginWithin7Days");
      return {
        userStatus: "SLEEPY",
        inactiveScore: 35,
        inactiveReasons: reasons,
        lastLoginDaysAgo: roundedDays
      };
    }

    if (daysAgo > 30) {
      inactiveScore += 90;
      reasons.push("lastLoginOver30Days");
      return {
        userStatus: "QUIT_LIKELY",
        inactiveScore,
        inactiveReasons: reasons,
        lastLoginDaysAgo: roundedDays
      };
    }

    if (daysAgo > 14) {
      inactiveScore += 70;
      reasons.push("lastLoginOver14Days");

      if (!player.source?.allianceMember) {
        inactiveScore += 15;
        reasons.push("not_alliance_member_confirmed");
        return {
          userStatus: "QUIT_LIKELY",
          inactiveScore: Math.min(100, inactiveScore),
          inactiveReasons: reasons,
          lastLoginDaysAgo: roundedDays
        };
      }

      return {
        userStatus: "INACTIVE",
        inactiveScore: Math.min(100, inactiveScore),
        inactiveReasons: reasons,
        lastLoginDaysAgo: roundedDays
      };
    }

    reasons.push("lastLoginOver7Days");

    return {
      userStatus: "INACTIVE",
      inactiveScore: 55,
      inactiveReasons: reasons,
      lastLoginDaysAgo: roundedDays
    };
  }

  function buildServerActivitySummary(players, alliances) {
    const totalMapPlayers = players.length;

    const coreUsers = players.filter(player => player.activityGrade === "CORE").length;
    const activeGradeUsers = players.filter(player => player.activityGrade === "ACTIVE").length;
    const watchGradeUsers = players.filter(player => player.activityGrade === "WATCH").length;
    const lowGradeUsers = players.filter(player => player.activityGrade === "LOW").length;

    const statusCounts = {
      activeUsers: players.filter(player => player.userStatus === "ACTIVE").length,
      recentUsers: players.filter(player => player.userStatus === "RECENT").length,
      sleepyUsers: players.filter(player => player.userStatus === "SLEEPY").length,
      inactiveUsers: players.filter(player => player.userStatus === "INACTIVE").length,
      quitLikelyUsers: players.filter(player => player.userStatus === "QUIT_LIKELY").length,
      unknownStatusUsers: players.filter(player => player.userStatus === "UNKNOWN").length
    };

    const activeUsers = statusCounts.activeUsers + statusCounts.recentUsers + statusCounts.sleepyUsers;
    const activeUserRate = totalMapPlayers > 0 ? Number((activeUsers / totalMapPlayers).toFixed(6)) : 0;
    const quitLikelyRate = totalMapPlayers > 0 ? Number((statusCounts.quitLikelyUsers / totalMapPlayers).toFixed(6)) : 0;

    const serverPowerTotal = players.reduce((sum, player) => sum + Number(player.power ?? 0), 0);
    const activePowerTotal = players
      .filter(player => ["ACTIVE", "RECENT", "SLEEPY"].includes(player.userStatus))
      .reduce((sum, player) => sum + Number(player.power ?? 0), 0);
    const activePowerRate = serverPowerTotal > 0 ? Number((activePowerTotal / serverPowerTotal).toFixed(6)) : 0;

    const allianceActivitySummary = buildAllianceActivitySummary(alliances);

    const alliancePowerRows = alliances
      .map(alliance => ({
        alliance,
        power: Number(alliance.activitySummary?.totalPower ?? alliance.alliancePower ?? 0)
      }))
      .sort((a, b) => b.power - a.power);

    const topAlliancePowerRate = serverPowerTotal > 0 && alliancePowerRows[0]
      ? Number((alliancePowerRows[0].power / serverPowerTotal).toFixed(6))
      : 0;

    const top3Power = alliancePowerRows.slice(0, 3).reduce((sum, row) => sum + row.power, 0);
    const top3AlliancePowerRate = serverPowerTotal > 0 ? Number((top3Power / serverPowerTotal).toFixed(6)) : 0;

    let score = 0;
    const reasons = [];

    if (allianceActivitySummary.coreAllianceCount >= 3) {
      score += 25;
      reasons.push("coreAllianceCount>=3");
    } else if (allianceActivitySummary.coreAllianceCount >= 1) {
      score += 10;
      reasons.push("coreAllianceCount>=1");
    }

    if (allianceActivitySummary.activeAllianceCountForWar >= 5) {
      score += 25;
      reasons.push("activeAllianceCountForWar>=5");
    } else if (allianceActivitySummary.activeAllianceCountForWar >= 3) {
      score += 15;
      reasons.push("activeAllianceCountForWar>=3");
    } else if (allianceActivitySummary.activeAllianceCountForWar >= 1) {
      score += 7;
      reasons.push("activeAllianceCountForWar>=1");
    }

    if (activeUsers >= 150) {
      score += 20;
      reasons.push("activeUsers>=150");
    } else if (activeUsers >= 80) {
      score += 12;
      reasons.push("activeUsers>=80");
    } else if (activeUsers >= 40) {
      score += 6;
      reasons.push("activeUsers>=40");
    }

    const activeGradeTotal = coreUsers + activeGradeUsers;

    if (activeGradeTotal >= 80) {
      score += 15;
      reasons.push("corePlusActiveGradeUsers>=80");
    } else if (activeGradeTotal >= 40) {
      score += 8;
      reasons.push("corePlusActiveGradeUsers>=40");
    }

    if (activeUserRate >= 0.40) {
      score += 15;
      reasons.push("activeUserRate>=40%");
    } else if (activeUserRate >= 0.25) {
      score += 8;
      reasons.push("activeUserRate>=25%");
    }

    if (activePowerRate >= 0.65) {
      score += 15;
      reasons.push("activePowerRate>=65%");
    } else if (activePowerRate >= 0.45) {
      score += 8;
      reasons.push("activePowerRate>=45%");
    }

    if (quitLikelyRate >= 0.50) {
      score -= 20;
      reasons.push("quitLikelyRate>=50%");
    } else if (quitLikelyRate >= 0.35) {
      score -= 10;
      reasons.push("quitLikelyRate>=35%");
    }

    if (topAlliancePowerRate >= 0.60 && allianceActivitySummary.activeAllianceCountForWar <= 2) {
      score -= 10;
      reasons.push("power_concentrated_top1_alliance");
    }

    if (top3AlliancePowerRate >= 0.85 && allianceActivitySummary.activeAllianceCountForWar <= 3) {
      score -= 8;
      reasons.push("power_concentrated_top3_alliances");
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let grade = "DEAD";
    if (score >= 80) grade = "VERY_ACTIVE";
    else if (score >= 60) grade = "ACTIVE";
    else if (score >= 40) grade = "NORMAL";
    else if (score >= 20) grade = "QUIET";

    return {
      serverActivityGrade: grade,
      serverActivityScore: score,
      serverActivityReasons: reasons,

      totalMapPlayers,
      coreUsers,
      activeGradeUsers,
      watchGradeUsers,
      lowGradeUsers,

      ...statusCounts,

      activeUsers,
      activeUserRate,
      quitLikelyRate,

      activeAllianceCountForWar: allianceActivitySummary.activeAllianceCountForWar,
      meaningfulAllianceCount: allianceActivitySummary.meaningfulAllianceCount,

      coreAllianceCount: allianceActivitySummary.coreAllianceCount,
      activeAllianceCount: allianceActivitySummary.activeAllianceCount,
      watchAllianceCount: allianceActivitySummary.watchAllianceCount,
      lowAllianceCount: allianceActivitySummary.lowAllianceCount,
      insufficientAllianceCount: allianceActivitySummary.insufficientAllianceCount ?? 0,

      serverPowerTotal,
      activePowerTotal,
      activePowerRate,

      topAlliancePowerRate,
      top3AlliancePowerRate
    };
  }

  function buildActivityAnalytics(players, alliances) {
    const byAlliance = new Map();

    for (const player of players) {
      if (!player.allianceId) continue;

      const allianceId = String(player.allianceId);

      if (!byAlliance.has(allianceId)) {
        byAlliance.set(allianceId, []);
      }

      byAlliance.get(allianceId).push(player);
    }

    const allianceActivityMap = new Map();

    for (const [allianceId, members] of byAlliance.entries()) {
      const sorted = [...members].sort((a, b) => Number(b.power ?? 0) - Number(a.power ?? 0));
      const totalPower = sorted.reduce((sum, player) => sum + Number(player.power ?? 0), 0);

      let cumulativePower = 0;

      for (let index = 0; index < sorted.length; index++) {
        const player = sorted[index];
        const power = Number(player.power ?? 0);

        cumulativePower += power;

        const rank = index + 1;
        const percent = sorted.length ? rank / sorted.length : 1;
        const contribution = totalPower > 0 ? power / totalPower : 0;
        const cumulativeContribution = totalPower > 0 ? cumulativePower / totalPower : 0;

        const reasons = ["map_found"];
        let score = 30;

        player.powerRankInAlliance = rank;
        player.powerPercentileInAlliance = Number(percent.toFixed(4));
        player.powerContributionRate = Number(contribution.toFixed(6));
        player.cumulativePowerContributionRate = Number(cumulativeContribution.toFixed(6));

        if (percent <= 0.2) {
          score += 30;
          reasons.push("top_20_power");
        } else if (percent <= 0.5) {
          score += 15;
          reasons.push("top_50_power");
        }

        if (cumulativeContribution <= 0.8) {
          score += 25;
          reasons.push("cumulative_power_80");
        }

        if (player.isOnline === true || player.isOnline === 1 || player.isOnline === "1") {
          score += 30;
          reasons.push("online");
        }

        score += recentLoginScore(player, reasons);

        if (hasHighRole(player)) {
          score += 10;
          reasons.push("high_role");
        }

        if (player.source?.allianceMember) {
          score += 5;
          reasons.push("alliance_member_confirmed");
        }

        player.activityScore = score;
        player.activityReasons = reasons;

        if (score >= 80) player.activityGrade = "CORE";
        else if (score >= 50) player.activityGrade = "ACTIVE";
        else if (score >= 30) player.activityGrade = "WATCH";
        else player.activityGrade = "LOW";
      }

      const core = sorted.filter(player => player.activityGrade === "CORE");
      const active = sorted.filter(player => player.activityGrade === "ACTIVE");
      const watch = sorted.filter(player => player.activityGrade === "WATCH");
      const low = sorted.filter(player => player.activityGrade === "LOW");

      const activeUsers = sorted.filter(player => player.activityGrade === "CORE" || player.activityGrade === "ACTIVE");
      const corePowerSum = core.reduce((sum, player) => sum + Number(player.power ?? 0), 0);
      const activePowerSum = activeUsers.reduce((sum, player) => sum + Number(player.power ?? 0), 0);

      allianceActivityMap.set(allianceId, {
        collectedMapMemberCount: sorted.length,
        coreCount: core.length,
        activeCount: active.length,
        watchCount: watch.length,
        lowCount: low.length,
        activeTotalCount: activeUsers.length,
        totalPower,
        corePowerSum,
        activePowerSum,
        corePowerRate: totalPower > 0 ? Number((corePowerSum / totalPower).toFixed(6)) : 0,
        activePowerRate: totalPower > 0 ? Number((activePowerSum / totalPower).toFixed(6)) : 0,
        top20PowerCount: sorted.filter(player => player.powerPercentileInAlliance <= 0.2).length,
        cumulative80PowerCount: sorted.filter(player => player.cumulativePowerContributionRate <= 0.8).length
      });
    }

    for (const alliance of alliances) {
      const summary = allianceActivityMap.get(String(alliance.allianceId));

      if (!summary) continue;

      alliance.activitySummary = {
        ...summary,
        shownMemberCount: alliance.allianceMemberCountShown ?? null,
        shownMemberMax: alliance.allianceMemberMax ?? null
      };
    }

    return {
      criteria: {
        grade: {
          CORE: "activityScore >= 80",
          ACTIVE: "activityScore >= 50",
          WATCH: "activityScore >= 30",
          LOW: "activityScore < 30"
        },
        score: {
          map_found: 30,
          online: 30,
          recent_login_1d: 25,
          recent_login_3d: 20,
          recent_login_7d: 10,
          top_20_power: 30,
          top_50_power: 15,
          cumulative_power_80: 25,
          high_role: 10,
          alliance_member_confirmed: 5
        },
        note: "최종 대상은 지도에서 발견된 유저만 포함합니다. 길드원 목록에만 있는 유저는 보강용이며 최종 players에는 포함하지 않습니다."
      },
      allianceActivityMap
    };
  }

  function gradeAllianceActivity(alliance) {
    const summary = alliance.activitySummary || alliance;

    const coreCount = Number(summary.coreCount ?? 0);
    const activeCount = Number(summary.activeCount ?? 0);
    const memberCount = Number(alliance.memberCount ?? summary.collectedMapMemberCount ?? summary.memberCount ?? 0);

    const shownMemberCount = Number(
      summary.shownMemberCount ??
      alliance.allianceMemberCountShown ??
      0
    );

    const activePowerRate = Number(summary.activePowerRate ?? 0);
    const corePowerRate = Number(summary.corePowerRate ?? 0);
    const cumulative80PowerCount = Number(summary.cumulative80PowerCount ?? 0);

    const coverageRate = shownMemberCount > 0 ? memberCount / shownMemberCount : 1;

    let score = 0;
    const reasons = [`coverageRate=${Number((coverageRate * 100).toFixed(2))}%`];

    if (shownMemberCount >= 50 && coverageRate < 0.10) {
      return {
        activeAllianceGrade: "INSUFFICIENT",
        activeAllianceScore: 0,
        activeAllianceReasons: [
          ...reasons,
          "coverageRate<10%",
          "sample_too_small_for_alliance_grade"
        ],
        coverageRate: Number(coverageRate.toFixed(4))
      };
    }

    let maxGrade = "CORE";

    if (shownMemberCount >= 50 && coverageRate < 0.20) {
      maxGrade = "WATCH";
      reasons.push("coverageRate<20%, grade capped to WATCH");
    } else if (shownMemberCount >= 50 && coverageRate < 0.35) {
      maxGrade = "ACTIVE";
      reasons.push("coverageRate<35%, grade capped to ACTIVE");
    }

    if (coreCount >= 10) {
      score += 45;
      reasons.push("coreCount>=10");
    } else if (coreCount >= 5) {
      score += 32;
      reasons.push("coreCount>=5");
    } else if (coreCount >= 2) {
      score += 18;
      reasons.push("coreCount>=2");
    }

    if (activeCount >= 25) {
      score += 35;
      reasons.push("activeCount>=25");
    } else if (activeCount >= 15) {
      score += 26;
      reasons.push("activeCount>=15");
    } else if (activeCount >= 5) {
      score += 14;
      reasons.push("activeCount>=5");
    }

    if (memberCount >= 30) {
      score += 12;
      reasons.push("memberCount>=30");
    } else if (memberCount >= 10) {
      score += 7;
      reasons.push("memberCount>=10");
    }

    if (coverageRate >= 0.20) {
      if (activePowerRate >= 0.75 && coreCount >= 5) {
        score += 18;
        reasons.push("activePowerRate>=75% && coreCount>=5");
      } else if (activePowerRate >= 0.50 && memberCount >= 30) {
        score += 12;
        reasons.push("activePowerRate>=50% && memberCount>=30");
      }

      if (corePowerRate >= 0.50 && coreCount >= 3) {
        score += 8;
        reasons.push("corePowerRate>=50% && coreCount>=3");
      }
    } else {
      reasons.push("powerRate_ignored_due_to_low_coverage");
    }

    if (cumulative80PowerCount > 0 && cumulative80PowerCount <= 5 && coreCount < 5) {
      score -= 8;
      reasons.push("power_too_concentrated");
    }

    let grade = "LOW";

    if (
      coreCount >= 10 ||
      activeCount >= 25 ||
      (coverageRate >= 0.20 && activePowerRate >= 0.75 && coreCount >= 5) ||
      score >= 75
    ) {
      grade = "CORE";
    } else if (
      coreCount >= 5 ||
      activeCount >= 15 ||
      (coverageRate >= 0.20 && memberCount >= 30 && activePowerRate >= 0.50) ||
      score >= 50
    ) {
      grade = "ACTIVE";
    } else if (
      coreCount >= 2 ||
      activeCount >= 5 ||
      memberCount >= 10 ||
      score >= 25
    ) {
      grade = "WATCH";
    }

    const gradeOrder = {
      INSUFFICIENT: 0,
      LOW: 0,
      WATCH: 1,
      ACTIVE: 2,
      CORE: 3
    };

    if (gradeOrder[grade] > gradeOrder[maxGrade]) {
      grade = maxGrade;
    }

    return {
      activeAllianceGrade: grade,
      activeAllianceScore: Math.max(0, Math.min(100, Math.round(score))),
      activeAllianceReasons: reasons,
      coverageRate: Number(coverageRate.toFixed(4))
    };
  }

  function buildAllianceActivitySummary(alliances) {
    const summary = {
      coreAllianceCount: 0,
      activeAllianceCount: 0,
      watchAllianceCount: 0,
      lowAllianceCount: 0,
      insufficientAllianceCount: 0,
      activeAllianceCountForWar: 0,
      meaningfulAllianceCount: 0
    };

    for (const alliance of alliances || []) {
      const grade = alliance.activeAllianceGrade || "LOW";

      if (grade === "CORE") {
        summary.coreAllianceCount++;
        summary.activeAllianceCountForWar++;
        summary.meaningfulAllianceCount++;
      } else if (grade === "ACTIVE") {
        summary.activeAllianceCount++;
        summary.activeAllianceCountForWar++;
        summary.meaningfulAllianceCount++;
      } else if (grade === "WATCH") {
        summary.watchAllianceCount++;
        summary.meaningfulAllianceCount++;
      } else if (grade === "INSUFFICIENT") {
        summary.insufficientAllianceCount++;
      } else {
        summary.lowAllianceCount++;
      }
    }

    return summary;
  }

  function buildFinalLiteServerResult(options = {}) {
    const byUid = new Map();
    const targetServerId = options.serverId != null ? String(options.serverId) : null;

    for (const raw of TOPWAR.players?.() ?? []) {
      const rawServerId = getPlayerServerId(raw);

      // 여러 서버를 연속 조사할 때 이전 서버 유저가 섞이는 것을 차단한다.
      // 서버번호가 명시된 export에서는 해당 serverId의 유저만 최종 결과에 포함한다.
      if (targetServerId && !sameServerId(rawServerId, targetServerId)) {
        continue;
      }

      const player = compactPlayerForExport(raw);
      if (!player) continue;

      const previous = byUid.get(player.uid);
      byUid.set(player.uid, previous ? mergeCompactPlayers(previous, player) : player);
    }

    const players = [...byUid.values()].sort((a, b) =>
      Number(b.power ?? 0) - Number(a.power ?? 0) ||
      String(a.uid).localeCompare(String(b.uid))
    );

    if (options.rewriteStatePlayerMap !== false) {
      // 중요: export용 compact player로 런타임 playerMap을 통째로 교체하면
      // playerInfo/cityReward/p/rawPoint 등 901 원본 정보가 유실된다.
      // 따라서 compact 결과는 기존 enriched player에 파생 필드만 병합한다.
      const mergedPlayerMap = new Map(state.playerMap);

      for (const compactPlayer of players) {
        const key = String(compactPlayer.uid);
        const previous = mergedPlayerMap.get(key);

        mergedPlayerMap.set(key, previous ? {
          ...previous,
          ...compactPlayer,
          source: {
            ...(previous.source || {}),
            ...(compactPlayer.source || {})
          }
        } : compactPlayer);
      }

      state.playerMap = mergedPlayerMap;
    }

    const detailMap = getAllianceDetailsMap();
    const allianceMap = new Map();

    for (const player of players) {
      if (!player.allianceId && !player.allianceTag && !player.allianceName) continue;

      const key = !empty(player.allianceId)
        ? `id:${String(player.allianceId)}`
        : !empty(player.allianceTag)
          ? `tag:${String(player.allianceTag)}`
          : `name:${String(player.allianceName)}`;

      const previous = allianceMap.get(key) || {
        allianceId: player.allianceId ? String(player.allianceId) : null,
        allianceTag: player.allianceTag ?? null,
        allianceName: player.allianceName ?? null,
        serverId: player.serverId ?? null,
        memberUids: new Set()
      };

      previous.memberUids.add(String(player.uid));
      previous.allianceId = pick(previous.allianceId, player.allianceId);
      previous.allianceTag = pick(previous.allianceTag, player.allianceTag);
      previous.allianceName = pick(previous.allianceName, player.allianceName);
      previous.serverId = pick(previous.serverId, player.serverId);

      allianceMap.set(key, previous);
    }

    const alliances = [...allianceMap.values()].map(alliance => {
      const detail = findDetailForAlliance(alliance, detailMap) || {};
      const out = {
        memberCount: alliance.memberUids.size
      };

      put(out, "allianceId", pick(alliance.allianceId, detail.allianceId));
      put(out, "allianceTag", pick(alliance.allianceTag, detail.allianceTag));
      put(out, "allianceCode", detail.allianceCode);
      put(out, "allianceName", pick(alliance.allianceName, detail.allianceName));
      put(out, "allianceLeader", detail.allianceLeader);
      put(out, "allianceLevel", detail.allianceLevel);
      put(out, "alliancePower", detail.alliancePower);
      put(out, "alliancePowerText", detail.alliancePowerText);
      put(out, "allianceMemberCountShown", detail.allianceMemberCountShown);
      put(out, "allianceMemberMax", detail.allianceMemberMax);
      put(out, "allianceMemberText", detail.allianceMemberText);
      put(out, "serverId", pick(alliance.serverId, detail.serverId));

      return out;
    }).sort((a, b) =>
      Number(b.memberCount ?? 0) - Number(a.memberCount ?? 0) ||
      String(a.allianceId ?? a.allianceName ?? "").localeCompare(String(b.allianceId ?? b.allianceName ?? ""))
    );

    const activity = buildActivityAnalytics(players, alliances);

    const exportedAt = nowIso();
    const exportedAtMs = Date.parse(exportedAt);

    for (const player of players) {
      Object.assign(player, classifyUserStatus(player, exportedAtMs));
    }

    for (const alliance of alliances) {
      Object.assign(alliance, gradeAllianceActivity(alliance));
    }

    const allianceActivitySummary = buildAllianceActivitySummary(alliances);
    const serverActivitySummary = buildServerActivitySummary(players, alliances);

    const globalCore = players.filter(player => player.activityGrade === "CORE");
    const globalActive = players.filter(player => player.activityGrade === "ACTIVE");
    const globalWatch = players.filter(player => player.activityGrade === "WATCH");
    const globalLow = players.filter(player => player.activityGrade === "LOW");

    const data = {
      exportedAt,
      serverId: options.serverId ?? currentServerId(),

      summary: {
        players: players.length,
        mapPlayers: players.length,
        allianceMemberMergedPlayers: players.filter(player => player.source?.allianceMember).length,
        mapOnlyPlayers: players.filter(player => !player.source?.allianceMember).length,
        noAlliancePlayers: players.filter(player => !player.allianceId).length,
        alliances: alliances.length,
        allianceDetails: allianceDetailStatus().length,
        activity: {
          coreCount: globalCore.length,
          activeCount: globalActive.length,
          watchCount: globalWatch.length,
          lowCount: globalLow.length,
          activeTotalCount: globalCore.length + globalActive.length
        },
        allianceActivitySummary,
        serverActivity: {
          grade: serverActivitySummary.serverActivityGrade,
          score: serverActivitySummary.serverActivityScore,
          reasons: serverActivitySummary.serverActivityReasons
        },
        serverActivitySummary,
        userStatus: {
          activeUsers: serverActivitySummary.activeUsers,
          recentUsers: serverActivitySummary.recentUsers,
          sleepyUsers: serverActivitySummary.sleepyUsers,
          inactiveUsers: serverActivitySummary.inactiveUsers,
          quitLikelyUsers: serverActivitySummary.quitLikelyUsers,
          unknownStatusUsers: serverActivitySummary.unknownStatusUsers,
          activeUserRate: serverActivitySummary.activeUserRate,
          quitLikelyRate: serverActivitySummary.quitLikelyRate
        },
        activeAllianceCountForWar: allianceActivitySummary.activeAllianceCountForWar,
        meaningfulAllianceCount: allianceActivitySummary.meaningfulAllianceCount,
        excluded: "objects, objectsByType, allianceRepresentatives, member-only players"
      },

      activityCriteria: activity.criteria,
      serverActivityCriteria: {
        serverGrade: {
          VERY_ACTIVE: "serverActivityScore >= 80",
          ACTIVE: "serverActivityScore >= 60",
          NORMAL: "serverActivityScore >= 40",
          QUIET: "serverActivityScore >= 20",
          DEAD: "serverActivityScore < 20"
        },
        userStatus: {
          ACTIVE: "online or lastLogin <= 1 day",
          RECENT: "lastLogin <= 3 days",
          SLEEPY: "lastLogin <= 7 days",
          INACTIVE: "lastLogin > 7 days or > 14 days",
          QUIT_LIKELY: "lastLogin > 30 days or > 14 days and not allianceMember confirmed",
          UNKNOWN: "lastLogin missing"
        }
      },
      players,
      alliances
    };

    return data;
  }

  async function exportFinalLiteServerResult(options = {}) {
    const data = buildFinalLiteServerResult(options);

    if (options.copyJsonToClipboard) {
      await TOPWAR.copyText(JSON.stringify(data, null, options.pretty ? 2 : 0));
    }

    if (options.downloadJson !== false) {
      const blob = new Blob(
        [options.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)],
        { type: "application/json;charset=utf-8" }
      );

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = `topwar-server-${data.serverId}-activity-clean-${Date.now()}.json`;
      anchor.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    console.log("[TopWar V2.6] final export done:", data.summary);
    window.TOPWAR_LOG_CONTROL.table(data.alliances.map((alliance, index) => ({
      index,
      allianceId: alliance.allianceId,
      tag: alliance.allianceTag,
      code: alliance.allianceCode,
      name: alliance.allianceName,
      shown: alliance.allianceMemberText,
      mapMember: alliance.memberCount,
      core: alliance.activitySummary?.coreCount,
      active: alliance.activitySummary?.activeCount,
      activePowerRate: alliance.activitySummary?.activePowerRate,
      allianceGrade: alliance.activeAllianceGrade,
      allianceScore: alliance.activeAllianceScore
    })));

    return data;
  }

  function activityPlayerTable(limit = 300) {
    const data = buildFinalLiteServerResult({
      downloadJson: false,
      rewriteStatePlayerMap: false
    });

    const rows = data.players
      .slice()
      .sort((a, b) =>
        Number(b.activityScore ?? 0) - Number(a.activityScore ?? 0) ||
        Number(b.power ?? 0) - Number(a.power ?? 0)
      )
      .slice(0, limit);

    window.TOPWAR_LOG_CONTROL.table(rows.map((player, index) => ({
      index,
      uid: player.uid,
      username: player.username,
      allianceTag: player.allianceTag,
      allianceName: player.allianceName,
      power: player.power,
      rank: player.powerRankInAlliance,
      contribution: player.powerContributionRate,
      cumulative: player.cumulativePowerContributionRate,
      score: player.activityScore,
      grade: player.activityGrade,
      reasons: player.activityReasons?.join(",")
    })));

    return rows;
  }

  function allianceActivityTable(limit = 300) {
    const data = buildFinalLiteServerResult({
      downloadJson: false,
      rewriteStatePlayerMap: false
    });

    const rows = data.alliances.slice(0, limit);

    window.TOPWAR_LOG_CONTROL.table(rows.map((alliance, index) => ({
      index,
      allianceId: alliance.allianceId,
      tag: alliance.allianceTag,
      code: alliance.allianceCode,
      name: alliance.allianceName,
      shown: alliance.allianceMemberText,
      mapMember: alliance.memberCount,
      core: alliance.activitySummary?.coreCount,
      active: alliance.activitySummary?.activeCount,
      activeTotal: alliance.activitySummary?.activeTotalCount,
      watch: alliance.activitySummary?.watchCount,
      low: alliance.activitySummary?.lowCount,
      activePowerRate: alliance.activitySummary?.activePowerRate,
      corePowerRate: alliance.activitySummary?.corePowerRate,
      cumulative80PowerCount: alliance.activitySummary?.cumulative80PowerCount,
      allianceGrade: alliance.activeAllianceGrade,
      allianceScore: alliance.activeAllianceScore
    })));

    return rows;
  }

  Object.assign(TOPWAR, {
    buildFinalLiteServerResult,
    exportFinalLiteServerResult,
    activityPlayerTable,
    allianceActivityTable,
    classifyUserStatus,
    buildServerActivitySummary,
    gradeAllianceActivity,
    buildAllianceActivitySummary
  });

  async function scanMapUnifiedInterruptible(options = {}) {
    const controller = TOPWAR.mapCtrl?.();
    if (!controller) {
      console.error("[TopWar V2.6] NWorldController를 찾을 수 없습니다. 월드맵 화면에서 실행하세요.");
      return null;
    }

    const range = controller.getWorldMapDataInstance?.()?.status?.viewport?.range;
    const serverId = options.serverId ?? range?.k;
    const subMap = options.subMap ?? range?.sub ?? 0;

    let xs;
    let ys;

    try {
      xs = TOPWAR.buildScanCoords(options.startX ?? 50, options.endX ?? 750, options.stepX ?? 80, "x");
      ys = TOPWAR.buildScanCoords(options.startY ?? 50, options.endY ?? 875, options.stepY ?? 75, "y");
    } catch (error) {
      console.error("[TopWar V2.6] 좌표 생성 실패:", error.message);
      return null;
    }

    if (options.clearBeforeStart) {
      TOPWAR.clearCollected({ keepWatch: true });
    }

    const scanPlan = TOPWAR.buildScanPlan(xs, ys, {
      startCorner: options.startCorner ?? "top-left",
      snake: options.snake ?? true
    });

    const total = xs.length * ys.length;
    const startedAt = Date.now();

    let count = 0;
    let failCount = 0;

    for (const rowInfo of scanPlan) {
      for (const x of rowInfo.xOrder) {
        if (shouldStopServerSurvey()) {
          return {
            stopped: true,
            reason: "manual stop",
            summary: {
              ...TOPWAR.summary(),
              serverId,
              subMap,
              totalMoves: count,
              failCount,
              total,
              elapsedSec: Math.round((Date.now() - startedAt) / 1000)
            }
          };
        }

        const result = await TOPWAR.moveMapToStableUnified(x, rowInfo.y, {
          serverId,
          subMap,
          scale: options.scale ?? 0.27,
          afterMoveWait: options.afterMoveWait ?? 120,
          wait901Timeout: options.wait901Timeout ?? 2200,
          quietMs: options.quietMs ?? 300,
          interval: options.interval ?? 30,
          maxRetries: options.maxRetries ?? 1,
          retryDelay: options.retryDelay ?? 250,
          collectCache: options.collectCache ?? true
        });

        count++;

        if (!result?.ok) failCount++;

        const currentSummary = TOPWAR.summary();
        const currentPlayers = Number(currentSummary?.players ?? 0);
        const maxPlayersPerServer = Number(options.maxPlayersPerServer ?? 2000);

        if (Number.isFinite(maxPlayersPerServer) && maxPlayersPerServer > 0 &&
            currentPlayers >= maxPlayersPerServer) {
          const reason = `player limit exceeded: ${currentPlayers}/${maxPlayersPerServer}`;
          console.warn(`[TopWar Player Guard] server=${serverId} players=${currentPlayers} - 신서버로 판단, 현재 조사를 폐기하고 다음 서버로 이동`);

          clearHeavySurveyData({ packetLimit: 0, outgoingLimit: 0 });

          return {
            ok: false,
            stopped: false,
            skipped: true,
            playerLimitExceeded: true,
            reason,
            summary: {
              ...currentSummary,
              serverId,
              subMap,
              totalMoves: count,
              failCount,
              total,
              elapsedSec: Math.round((Date.now() - startedAt) / 1000),
              maximumPlayers: maxPlayersPerServer
            }
          };
        }

        if (count % Number(options.logEvery ?? 1) === 0 || !result?.ok) {
          const summary = TOPWAR.summary();
          const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
          const remainSec = count > 0 ? Math.round((elapsedSec / count) * (total - count)) : null;

          console.log(`[TopWar V2.6] scan ${count}/${total}, coord=(${x},${rowInfo.y}), ok=${result?.ok}, players=${summary.players}, alliances=${summary.alliances}, fail=${failCount}, elapsed=${elapsedSec}s, remain≈${remainSec}s`);
        }
      }
    }

    const summary = {
      ...TOPWAR.summary(),
      serverId,
      subMap,
      totalMoves: count,
      failCount,
      elapsedSec: Math.round((Date.now() - startedAt) / 1000)
    };

    console.log("[TopWar V2.6] interruptible scan done:", summary);

    return {
      summary,
      players: TOPWAR.players(),
      alliances: TOPWAR.alliances(),
      objects: TOPWAR.objects()
    };
  }

  function getDefaultSurveyOptions(serverId, options = {}) {
    return {
      serverId,

      // Top100을 제외한 지도 기반 조사에서 고유 플레이어 2,000명 초과 서버는 건너뜁니다.
      maxPlayersPerServer: 2000,

      startX: 50,
      startY: 50,
      endX: 750,
      endY: 875,

      stepX: 80,
      stepY: 75,
      scale: 0.27,

      wait901Timeout: 2200,
      quietMs: 300,
      maxRetries: 1,

      startCorner: "top-left",
      snake: true,
      logEvery: 1,

      openScale: 1,
      profileButtonIndex: 1,

      collectRetry: 2,
      retryDelayAfterRecover: 1200,

      closeAfter: true,
      returnToMap: true,

      memberPopupCloseComponentIndex: 2,
      afterCloseDelay: 700,

      backClickCount: 2,
      backClickDelay: 700,

      recoverBackClickCount: 3,
      recoverBackClickDelay: 600,

      memberScrollMaxRounds: 150,
      memberScrollNoChangeLimit: 10,
      memberScrollDelay: 700,
      memberScrollFromX: 0.50,
      memberScrollFromY: 0.78,
      memberScrollToX: 0.50,
      memberScrollToY: 0.28,
      memberScrollSteps: 16,
      memberScrollStepDelay: 18,

      betweenAllianceDelay: 1000,
      betweenServerDelay: 2000,

      // UI 서버조사 ON 상태에서는 OFF 전까지 반복 조사한다.
      repeatUntilStopped: true,
      repeatDelay: 60000,

      // 기본 조사 대상 동맹 수
      // UI에서 서버조사를 누르면 기본적으로 전투력 대표 기준 상위 5개 동맹만 조사합니다.
      // 전체 조사나 다른 개수는 콘솔에서 runServerSurvey({ serverId: 3223, limit: 원하는수 })로 변경 가능합니다.
      limit: 5,

      // 기본값: 로컬 JSON 다운로드는 하지 않고 GitHub 업로드만 수행합니다.
      // 필요 시 콘솔에서 runServerSurvey({ serverId: 3223, downloadJson: true })로 다운로드 가능.
      downloadJson: false,
      copyJsonToClipboard: false,
      pretty: true,

      // UID가 다른 서버에서 실제 발견된 경우의 이동 기록을 기본 활성화합니다.
      trackActualInOut: true,
      flushCompactHistoryAfterEachCycle: true,
      uploadUserMovementHistory: true,
      uploadUserLatestIndex: true,

      // 반복 조사 메모리 절약
      keepResultData: false,
      clearHeavyDataAfterExport: true,
      keepBatchHistory: 3,
      packetBufferLimit: 80,
      outgoingBufferLimit: 40,

      ...options,
      serverId
    };
  }

  async function runServerSurvey(serverIdOrOptions = {}) {
    if (state.connectionGuard?.disconnected) return { ok: false, stopped: true, reason: "connection guard disconnected" };
    const options = typeof serverIdOrOptions === "object"
      ? serverIdOrOptions
      : { serverId: serverIdOrOptions };

    const serverId = parseServerId(options.serverId ?? currentServerId());

    if (!serverId) {
      return {
        ok: false,
        reason: "serverId is required"
      };
    }

    ensureState();

    if (state.ui.serverSurvey.running) {
      return {
        ok: false,
        reason: "server survey already running"
      };
    }

    const surveyOptions = getDefaultSurveyOptions(serverId, options);
    cleanupIntegratedSurveyResidue({ phase: "server-start" });

    // 서버별 연속 조사에서 이전 서버 데이터가 섞이지 않도록 완전 초기화한다.
    // skipMapScan=true일 때는 사용자가 기존 수집 데이터를 재사용하려는 의도로 보고 초기화하지 않는다.
    if (surveyOptions.skipMapScan !== true && surveyOptions.clearBeforeStart !== false) {
      clearSurveyRuntimeData();
    }

    const result = {
      ok: false,
      serverId,
      stages: {},
      allianceResults: [],
      errors: []
    };

    state.ui.serverSurvey = {
      running: true,
      stopping: false,
      integratedFinders: surveyOptions.integratedFinders !== false,
      includeRewards: surveyOptions.includeRewards === true,
      liveThiefKeys: new Set(),
      rewardMap: new Map(),
      startedAt: nowIso(),
      finishedAt: null,
      current: {
        phase: "start",
        serverId
      },
      result: null,
      error: null
    };

    state.fullScan.running = true;
    state.fullScan.stopRequested = false;
    state.fullScan.phase = "serverSurvey";

    try {
      if (surveyOptions.skipMapScan !== true) {
        state.ui.serverSurvey.current = {
          phase: "mapScan",
          serverId
        };

        result.stages.mapScan = await scanMapUnifiedInterruptible({
          ...surveyOptions,
          serverId,
          clearBeforeStart: false
        });

        if (!result.stages.mapScan) {
          result.ok = false;
          result.stopped = true;
          result.reason = "map scan failed before collecting data";
          result.errors.push({
            stage: "mapScan",
            reason: "map scan returned null",
            message: "NWorldController를 찾지 못했거나 월드맵 데이터 수집을 시작하지 못했습니다. 빈 결과는 저장하지 않습니다."
          });
          console.error("[TopWar V2.9.6] 맵스캔 실패 - 빈 서버조사 결과를 만들지 않고 중단합니다.", result.errors.at(-1));
          return result;
        }

        if (result.stages.mapScan?.playerLimitExceeded === true) {
          result.ok = false;
          result.stopped = false;
          result.skipped = true;
          result.playerLimitExceeded = true;
          result.reason = result.stages.mapScan.reason;
          result.summary = result.stages.mapScan.summary;
          console.warn(`[TopWar Player Guard] server=${serverId} 지도조사 업로드 생략, 다음 서버로 이동`, result.summary);
          return result;
        }

        if (result.stages.mapScan?.stopped || shouldStopServerSurvey()) {
          result.stopped = true;
          result.reason = "manual stop during map scan";
          return result;
        }

        if (surveyOptions.includeRewards === true && typeof TOPWAR.collectRewardsFromRecent901 === "function") {
          try {
            const rewardMap = state.ui.serverSurvey.rewardMap instanceof Map ? state.ui.serverSurvey.rewardMap : new Map();
            state.ui.serverSurvey.rewardMap = rewardMap;
            result.stages.rewardCollect = rewardMap.size > 0
              ? { mode: "live-901", added: 0, total: rewardMap.size, locations: [...rewardMap.values()] }
              : TOPWAR.collectRewardsFromRecent901(serverId, rewardMap);
          } catch (error) {
            result.stages.rewardCollect = { ok: false, error: error?.message || String(error) };
            result.errors.push({ stage: "rewardCollect", message: error?.message || String(error) });
          }
        }
      } else {
        result.stages.mapScan = {
          skipped: true
        };
      }

      const targets = uniqueTargetsByAllianceId(getAllianceCollectionTargets({ serverId }));
      const selectedTargets = targets.slice(0, surveyOptions.limit != null ? Number(surveyOptions.limit) : targets.length);

      result.stages.targets = {
        rawCount: targets.length,
        uniqueCount: targets.length,
        selectedCount: selectedTargets.length,
        targets: selectedTargets
      };

      console.log("[TopWar V2.6] alliance representative targets:", result.stages.targets);

      for (let index = 0; index < selectedTargets.length; index++) {
        if (shouldStopServerSurvey()) {
          result.stopped = true;
          result.reason = "manual stop during alliance collect";
          break;
        }

        const target = selectedTargets[index];

        state.ui.serverSurvey.current = {
          phase: "allianceCollect",
          index: index + 1,
          total: selectedTargets.length,
          allianceId: target.allianceId,
          allianceTag: target.allianceTag,
          allianceName: target.allianceName,
          representativeName: target.representativeName,
          x: target.x,
          y: target.y
        };

        state.fullScan.phase = "allianceCollect";
        state.fullScan.currentAllianceIndex = index;
        state.fullScan.totalAlliances = selectedTargets.length;

        let collectWrap;

        try {
          collectWrap = await collectAllianceMembersFromTargetWithRecovery(target, surveyOptions);
        } catch (error) {
          collectWrap = {
            ok: false,
            reason: "exception",
            message: error?.message,
            stack: error?.stack
          };
        }

        const realResult = collectWrap?.collectResult ?? collectWrap;

        const row = {
          index,
          target,
          ok: !!collectWrap?.ok || !!realResult?.ok,
          count: realResult?.dataList?.length ?? realResult?.rawResult?.count ?? 0,
          merged: realResult?.mergeResult?.merged ?? 0,
          skippedNotOnMap: realResult?.mergeResult?.skippedNotOnMap ?? 0,
          collectWrap
        };

        result.allianceResults.push(row);

        if (!row.ok) {
          result.errors.push({
            index,
            target,
            reason: collectWrap?.reason ?? realResult?.reason,
            collectWrap
          });

          if (surveyOptions.stopOnFail) break;
        }

        await interruptibleSleep(Number(surveyOptions.betweenAllianceDelay ?? 1000));
      }

      if (!result.stopped && !state.connectionGuard?.disconnected) {
        state.ui.serverSurvey.current = {
          phase: "export",
          serverId
        };

        result.data = await exportFinalLiteServerResult({
          serverId,
          downloadJson: surveyOptions.downloadJson,
          copyJsonToClipboard: surveyOptions.copyJsonToClipboard,
          pretty: surveyOptions.pretty,
          rewriteStatePlayerMap: surveyOptions.rewriteStatePlayerMap ?? true
        });

        // GitHub 자동 업로드는 서버조사 내부에서 직접 처리한다.
        // UI가 지역 함수 runServerSurvey/exportFinalLiteServerResult를 타더라도 이 지점은 반드시 실행된다.
        if (
          result.data &&
          typeof TOPWAR.uploadSurveyResultToGithub === "function" &&
          surveyOptions.githubUpload !== false
        ) {
          try {
            result.data.githubUpload = await TOPWAR.uploadSurveyResultToGithub(result.data, {
              trackActualInOut: surveyOptions.trackActualInOut ?? true,
              uploadUserMovementHistory: surveyOptions.uploadUserMovementHistory ?? true,
              uploadUserLatestIndex: surveyOptions.uploadUserLatestIndex ?? true,
              ...(surveyOptions.github || {})
            });
            result.githubUpload = result.data.githubUpload;
            console.log("[TopWar DataHub] 지도 서버 업로드 완료:", { serverId, upload: result.githubUpload });
          } catch (error) {
            result.githubUpload = {
              ok: false,
              error: error?.message || String(error)
            };

            result.data.githubUpload = result.githubUpload;

            console.error("[TopWar V2.6] DataHub 지도 업로드 실패:", error);
          }
        }

        if (surveyOptions.includeRewards === true && typeof TOPWAR.uploadRewardServerResults === "function") {
          const rewardMap = state.ui.serverSurvey.rewardMap instanceof Map ? state.ui.serverSurvey.rewardMap : new Map();
          const locations = [...rewardMap.values()].sort((a, b) => Number(a?.x ?? 0) - Number(b?.x ?? 0) || Number(a?.y ?? 0) - Number(b?.y ?? 0));
          try {
            result.rewardUpload = await TOPWAR.uploadRewardServerResults({ ok: true, completed: true, serverId, scannedAt: nowIso(), count: locations.length, locations });
            state.ui.serverSurvey.lastRewardUpload = result.rewardUpload;
          } catch (error) {
            result.rewardUpload = { ok: false, serverId, error: error?.message || String(error) };
            state.ui.serverSurvey.lastRewardUpload = result.rewardUpload;
            result.errors.push({ stage: "rewardUpload", message: error?.message || String(error) });
          }
        }

        result.summary = result.data?.summary ?? null;
        result.ok = true;

        if (surveyOptions.keepResultData === false && result.data) {
          result.data = {
            exportedAt: result.data.exportedAt,
            serverId: result.data.serverId,
            summary: result.data.summary,
            githubUpload: result.data.githubUpload ?? result.githubUpload ?? null
          };
        }

        if (surveyOptions.clearHeavyDataAfterExport !== false) {
          clearHeavySurveyData({
            packetLimit: surveyOptions.packetBufferLimit,
            outgoingLimit: surveyOptions.outgoingBufferLimit
          });
        }
      }

      return result;
    } catch (error) {
      result.ok = false;
      result.reason = "exception";
      result.error = {
        message: error?.message,
        stack: error?.stack
      };

      state.ui.serverSurvey.error = result.error;

      return result;
    } finally {
      state.fullScan.running = false;
      state.fullScan.phase = result.stopped ? "stopped" : "done";

      state.ui.serverSurvey.running = false;
      state.ui.serverSurvey.stopping = false;
      state.ui.serverSurvey.finishedAt = nowIso();
      state.ui.serverSurvey.result = slimServerSurveyResult(result);
      state.ui.serverSurvey.liveThiefKeys?.clear?.();
      state.ui.serverSurvey.rewardMap?.clear?.();
      cleanupIntegratedSurveyResidue({ phase: "server-finished" });

      console.log("[TopWar V2.6] 서버조사 종료:", result.summary ?? result);
    }
  }

  async function runMultiServerSurvey(serverIdsOrOptions = {}) {
    if (state.connectionGuard?.disconnected) return { ok: false, stopped: true, reason: "connection guard disconnected" };
    const options = typeof serverIdsOrOptions === "object" && !Array.isArray(serverIdsOrOptions)
      ? serverIdsOrOptions
      : { serverIds: serverIdsOrOptions };

    let serverIds = parseServerIdsStrict(options.serverIds ?? options.servers ?? options.serverId);

    if (!serverIds.length) {
      serverIds = TOPWAR.getCachedRemoteServerList?.()?.serverIds ?? [];
    }

    if (!serverIds.length && options.useRemoteServerList !== false) {
      try {
        serverIds = await TOPWAR.loadRemoteServerIds?.({
          maxAgeMs: options.remoteServerListMaxAgeMs ?? 60 * 60 * 1000,
          debug: options.remoteServerListDebug ?? true
        }) ?? [];
      } catch (error) {
        console.error("[TopWar V2.10.5] popular 서버목록 로드 실패:", error);
      }
    }

    if (!serverIds.length) {
      return {
        ok: false,
        reason: "serverIds is required and popular server list is unavailable"
      };
    }

    ensureState();

    if (state.ui.serverSurvey.running || state.ui.serverSurveyBatch.running) {
      return {
        ok: false,
        reason: "server survey already running"
      };
    }

    const repeatUntilStopped = options.repeatUntilStopped === true;
    const repeatDelay = Number(options.repeatDelay ?? getDefaultSurveyOptions(serverIds[0], options).repeatDelay ?? 60000);

    const batch = {
      ok: false,
      repeated: repeatUntilStopped,
      serverIds,
      startedAt: nowIso(),
      finishedAt: null,
      cycles: [],
      results: [],
      stopped: false,
      errors: []
    };

    state.fullScan.stopRequested = false;
    state.fullScan.running = true;
    state.fullScan.phase = repeatUntilStopped ? "repeatSurvey" : "multiServerSurvey";

    state.ui.serverSurveyBatch = {
      running: true,
      stopping: false,
      startedAt: batch.startedAt,
      finishedAt: null,
      current: {
        phase: repeatUntilStopped ? "repeatStart" : "batchStart",
        cycle: 0,
        index: 0,
        total: serverIds.length,
        serverId: null,
        serverIds
      },
      results: [],
      cycles: [],
      error: null
    };

    try {
      let cycle = 0;

      while (true) {
        if (shouldStopServerSurvey()) {
          batch.stopped = true;
          batch.reason = "manual stop before cycle";
          break;
        }

        cycle++;
        const cycleResult = {
          cycle,
          startedAt: nowIso(),
          finishedAt: null,
          results: [],
          errors: [],
          stopped: false
        };

        state.ui.serverSurveyBatch.current = {
          phase: repeatUntilStopped ? "repeatCycle" : "batchCycle",
          cycle,
          index: 0,
          total: serverIds.length,
          serverId: null,
          serverIds
        };

        console.log(`[TopWar V2.7] 서버조사 cycle ${cycle} 시작:`, serverIds);

        for (let index = 0; index < serverIds.length; index++) {
          if (shouldStopServerSurvey()) {
            cycleResult.stopped = true;
            cycleResult.reason = "manual stop before server survey";
            break;
          }

          const serverId = serverIds[index];

          state.ui.serverSurveyBatch.current = {
            phase: "serverSurvey",
            cycle,
            index: index + 1,
            total: serverIds.length,
            serverId,
            serverIds
          };

          console.log(`[TopWar V2.7] 서버조사 cycle ${cycle}, ${index + 1}/${serverIds.length} 시작:`, serverId);

          const singleOptions = {
            ...options,
            serverId,
            serverIds: undefined,
            servers: undefined,
            repeatUntilStopped: false,
            downloadJson: options.downloadJson ?? false
          };

          let result;

          try {
            result = await runServerSurvey(singleOptions);
          } catch (error) {
            result = {
              ok: false,
              serverId,
              reason: "exception",
              error: {
                message: error?.message,
                stack: error?.stack
              }
            };
          }

          cycleResult.results.push(result);
          batch.results.push(result);
          state.ui.serverSurveyBatch.results = batch.results;

          if (!result?.ok) {
            const errorRow = {
              cycle,
              serverId,
              reason: result?.reason,
              result
            };

            cycleResult.errors.push(errorRow);
            batch.errors.push(errorRow);

            if (options.stopOnServerFail === true) break;
          }

          if (result?.stopped || shouldStopServerSurvey()) {
            cycleResult.stopped = true;
            cycleResult.reason = result?.reason ?? "manual stop after server survey";
            break;
          }

          if (index < serverIds.length - 1) {
            state.ui.serverSurveyBatch.current = {
              phase: "betweenServerDelay",
              cycle,
              index: index + 1,
              total: serverIds.length,
              serverId,
              nextServerId: serverIds[index + 1],
              serverIds
            };

            const keepGoing = await interruptibleSleep(Number(options.betweenServerDelay ?? 2000));
            if (!keepGoing || shouldStopServerSurvey()) {
              cycleResult.stopped = true;
              cycleResult.reason = "manual stop during between-server delay";
              break;
            }
          }
        }

        cycleResult.finishedAt = nowIso();
        batch.cycles.push(cycleResult);
        state.ui.serverSurveyBatch.cycles = batch.cycles;

        if (cycleResult.stopped || shouldStopServerSurvey()) {
          batch.stopped = true;
          batch.reason = cycleResult.reason ?? "manual stop after cycle";
          break;
        }

        if (!repeatUntilStopped) {
          break;
        }

        state.ui.serverSurveyBatch.current = {
          phase: "repeatDelay",
          cycle,
          total: serverIds.length,
          serverIds,
          nextCycle: cycle + 1,
          repeatDelay
        };

        console.log(`[TopWar V2.7] 다음 반복 조사까지 대기: ${repeatDelay}ms`);

        const keepGoing = await interruptibleSleep(repeatDelay);
        if (!keepGoing || shouldStopServerSurvey()) {
          batch.stopped = true;
          batch.reason = "manual stop during repeat delay";
          break;
        }
      }

      batch.ok = !batch.stopped && batch.errors.length === 0;
      batch.finishedAt = nowIso();

      console.log("[TopWar V2.7] 서버조사 종료:", {
        ok: batch.ok,
        repeated: batch.repeated,
        cycles: batch.cycles.length,
        totalServers: serverIds.length,
        totalResults: batch.results.length,
        stopped: batch.stopped,
        errors: batch.errors.length
      });

      return batch;
    } catch (error) {
      batch.ok = false;
      batch.reason = "exception";
      batch.error = {
        message: error?.message,
        stack: error?.stack
      };
      batch.finishedAt = nowIso();

      state.ui.serverSurveyBatch.error = batch.error;

      return batch;
    } finally {
      state.ui.serverSurveyBatch.running = false;
      state.ui.serverSurveyBatch.stopping = false;
      state.ui.serverSurveyBatch.finishedAt = nowIso();
      state.ui.serverSurveyBatch.result = batch;
      state.ui.serverSurveyBatch.current = {
        phase: batch.stopped ? "repeatStopped" : "repeatDone",
        cycles: batch.cycles.length,
        index: batch.results.length,
        total: serverIds.length,
        serverIds
      };

      state.fullScan.running = false;
      state.fullScan.phase = batch.stopped ? "stopped" : "done";
    }
  }

  function fullScanStatus() {
    const value = {
      fullScan: state.fullScan,
      serverSurvey: state.ui?.serverSurvey
    };

    console.log("[TopWar V2.6] fullScan status:", value);

    return value;
  }

  Object.assign(TOPWAR, {
    getDefaultSurveyOptions,
    scanMapUnifiedInterruptible,
    parseServerIds,
    loadRemoteServerList,
    loadRemoteServerIds,
    getCachedRemoteServerList,
    remoteServerListStatus,
    runServerSurvey,
    runMultiServerSurvey,
    runServerSurveyBatch: runMultiServerSurvey,
    runServerSurveyOptimized: runServerSurvey,
    runFullServerCompactScan: runServerSurvey,
    stopServerSurvey: requestStopServerSurvey,
    requestStopServerSurvey,
    shouldStopServerSurvey,
    clearSurveyRuntimeData,
    clearHeavySurveyData,
    cleanupIntegratedSurveyResidue,
    pruneRecentBuffers,
    slimServerSurveyResult,
    stopFullScan: requestStopServerSurvey,
    fullScanStatus
  });

  const THIEF_UI_SETTINGS_KEY = "TOPWAR_THIEF_SHARE_UI_SETTINGS";

  function loadThiefUiSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(THIEF_UI_SETTINGS_KEY) || "{}"); } catch {}

    const shareChannel = ["월드", "길드"].includes(saved.shareChannel)
      ? saved.shareChannel
      : "월드";
    const shareDelayMs = [0, 3 * 60 * 1000, 5 * 60 * 1000].includes(Number(saved.shareDelayMs))
      ? Number(saved.shareDelayMs)
      : 3 * 60 * 1000;

    return { shareChannel, shareDelayMs };
  }

  function saveThiefUiSettings(settings = {}) {
    const normalized = {
      shareChannel: settings.shareChannel === "길드" ? "길드" : "월드",
      shareDelayMs: [0, 3 * 60 * 1000, 5 * 60 * 1000].includes(Number(settings.shareDelayMs))
        ? Number(settings.shareDelayMs)
        : 3 * 60 * 1000
    };
    try { localStorage.setItem(THIEF_UI_SETTINGS_KEY, JSON.stringify(normalized)); } catch {}
    return normalized;
  }

  // 공유 채널/공유 시점 기능은 유지하되 UI에서는 노출하지 않는다.
  // 필요 시 콘솔에서 TOPWAR.setThiefShareSettings({ shareChannel: "월드", shareDelayMs: 180000 }) 사용.
  TOPWAR.getThiefShareSettings = loadThiefUiSettings;
  TOPWAR.setThiefShareSettings = saveThiefUiSettings;

  function getDefaultWatchOptions(serverId, overrides = {}) {
    const uiSettings = loadThiefUiSettings();
    return {
      pointType: 133,
      serverId,

      startX: 50,
      startY: 50,
      endX: 750,
      endY: 875,

      stepX: 80,
      stepY: 75,
      scale: 0.27,

      copyToClipboard: true,
      stopAfterFound: false,
      clearEachCycle: true,
      logEvery: 1,

      startCorner: "top-left",
      snake: true,

      wait901Timeout: 2200,
      quietMs: 300,
      maxRetries: 1,

      foundScale: 1,
      shareChannel: uiSettings.shareChannel,
      shareDelayMs: uiSettings.shareDelayMs,
      autoResumeAfterShare: true,
      closePopupAfterShare: true,
      beforePopupCloseWait: 200,
      afterPopupCloseWait: 300,
      skipSharedLocations: true,

      ...overrides,
      serverId
    };
  }

  function installUnifiedControlPanel() {
    ensureState();

    document.getElementById(PANEL_ID)?.remove();

    for (const id of LEGACY_PANEL_IDS) {
      if (id !== PANEL_ID) document.getElementById(id)?.remove();
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "top:min(80px,8vh)",
      "right:8px",
      "z-index:2147483647",
      "width:min(286px,calc(100vw - 52px))",
      "max-height:calc(100vh - 16px)",
      "font-family:Arial,'Malgun Gothic',sans-serif",
      "background:rgba(24,24,24,0.94)",
      "color:#fff",
      "border:1px solid rgba(255,255,255,0.12)",
      "border-radius:9px",
      "box-shadow:0 3px 12px rgba(0,0,0,0.28)",
      "overflow:visible",
      "box-sizing:border-box",
      "transition:transform 0.25s ease",
      "will-change:transform",
      "user-select:none"
    ].join(";");

    panel.innerHTML = `
      <div id="tw26-header" style="
        height:38px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:0 11px;
        background:rgba(0,0,0,0.28);
        cursor:pointer;
        font-size:13px;
        font-weight:700;
        border-bottom:1px solid rgba(255,255,255,0.08);
      ">
        <span>TOPWAR</span>
        <span id="tw26-fold" style="font-size:11px;color:#aaa;">접기</span>
      </div>

      <div id="tw26-body" style="padding:10px;max-height:calc(100vh - 70px);overflow-y:auto;overflow-x:hidden;box-sizing:border-box;">
        <input id="tw26-server" type="text" placeholder="서버번호 · 비우면 전체" style="
          width:100%;height:34px;box-sizing:border-box;border:1px solid rgba(255,255,255,0.16);
          border-radius:7px;padding:0 9px;background:rgba(0,0,0,0.32);color:#fff;font-size:13px;outline:none;
        " />

        <div id="tw26-server-order" style="
          display:flex;align-items:center;gap:10px;flex-wrap:wrap;
          margin-top:7px;padding:6px 8px;border-radius:7px;background:rgba(255,255,255,0.04);
          color:#bbb;font-size:11px;
        ">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="tw26-server-order" value="sequential">순서대로</label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="tw26-server-order" value="popular">인기순으로</label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="tw26-server-order" value="random">랜덤으로</label>
        </div>

        <div id="tw26-scan-actions" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px;">
          <button id="tw26-thief" style="height:38px;border:0;border-radius:7px;background:#3b3b3b;color:#eee;font-size:12px;font-weight:700;cursor:pointer;">보상탐색</button>
          <button id="tw26-survey" style="height:38px;border:0;border-radius:7px;background:#3b3b3b;color:#eee;font-size:12px;font-weight:700;cursor:pointer;">지도조사</button>
          <button id="tw26-survey-rewards" style="height:38px;border:0;border-radius:7px;background:#3b3b3b;color:#eee;font-size:11px;font-weight:700;cursor:pointer;">지도+보상</button>
        </div>

        <div id="tw26-status" style="
          margin-top:8px;padding:7px 9px;border-radius:7px;background:rgba(255,255,255,0.055);
          font-size:11px;line-height:1.5;color:#ccc;word-break:break-word;
        ">상태 확인 중...</div>

        <details id="tw26-advanced" style="margin-top:7px;">
          <summary style="cursor:pointer;color:#999;font-size:11px;padding:4px 2px;outline:none;">고급 설정</summary>
          <div style="margin-top:5px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.08);">
            <label style="display:block;font-size:11px;color:#999;margin-bottom:4px;">DataHub 조사기 ID</label>
            <input id="tw26-datahub-scanner-id" type="text" autocomplete="off" spellcheck="false" placeholder="예: city-01" style="
              width:100%;height:31px;box-sizing:border-box;border:1px solid rgba(255,255,255,0.15);
              border-radius:6px;padding:0 8px;background:rgba(0,0,0,0.3);color:#fff;font-size:11px;outline:none;
            " />
            <label style="display:block;font-size:11px;color:#999;margin:7px 0 4px;">DataHub API 키</label>
            <input id="tw26-github-token" type="password" autocomplete="off" spellcheck="false" placeholder="scanner-keys에 설정한 값" style="
              width:100%;height:31px;box-sizing:border-box;border:1px solid rgba(255,255,255,0.15);
              border-radius:6px;padding:0 8px;background:rgba(0,0,0,0.3);color:#fff;font-size:11px;outline:none;
            " />

            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:7px;">
              <button id="tw26-reset" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">진행 초기화</button>
              <button id="tw26-save" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">현재 저장</button>
              <button id="tw26-reconnect" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">연결 초기화</button>
              <button id="tw26-connection-status" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">연결 정보</button>
              <button id="tw26-program-logs" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">프로그램 로그</button>
              <button id="tw26-game-font-logs" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">폰트 경고</button>
              <button id="tw26-activity" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">활동표</button>
              <button id="tw26-alliance" style="height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;">동맹표</button>
              <button id="tw26-thief-upload-test" title="DataHub 설정을 저장하고 대기 중 요청을 다시 전송합니다" style="grid-column:1 / -1;height:31px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;background:#4a3f2b;color:#f2ddad;font-size:11px;font-weight:700;cursor:pointer;">DataHub 설정 저장 / 재전송</button>
            </div>

            <div id="tw26-detail-status" style="
              margin-top:7px;padding:7px;border-radius:6px;background:rgba(0,0,0,0.22);
              font-size:10px;line-height:1.45;color:#aaa;word-break:break-word;
            "></div>
          </div>
        </details>
      </div>
    `;

    const PANEL_RIGHT_GAP = 8;
    const PANEL_STORAGE_KEY = "topwar-unified-control-panel-open";

    const slideToggleButton = document.createElement("button");
    slideToggleButton.id = "tw26-slide-toggle";
    slideToggleButton.type = "button";
    slideToggleButton.style.cssText = [
      "position:absolute",
      "left:-30px",
      "top:12px",
      "width:30px",
      "height:44px",
      "padding:0",
      "border:1px solid rgba(255,255,255,0.3)",
      "border-right:0",
      "border-radius:7px 0 0 7px",
      "background:rgba(20,20,20,0.94)",
      "color:#fff",
      "font-size:14px",
      "font-weight:800",
      "line-height:44px",
      "text-align:center",
      "cursor:pointer",
      "box-shadow:-3px 3px 10px rgba(0,0,0,0.3)",
      "z-index:2"
    ].join(";");

    panel.appendChild(slideToggleButton);
    document.body.appendChild(panel);

    let panelOpened = false;

    try {
      panelOpened = localStorage.getItem(PANEL_STORAGE_KEY) === "true";
    } catch {}

    function updatePanelVisibility() {
      panel.style.transform = panelOpened
        ? "translateX(0)"
        : `translateX(calc(100% + ${PANEL_RIGHT_GAP}px))`;

      slideToggleButton.textContent = panelOpened ? "▶" : "◀";
      slideToggleButton.title = panelOpened ? "자동화 패널 숨기기" : "자동화 패널 열기";
      slideToggleButton.setAttribute("aria-label", slideToggleButton.title);
      slideToggleButton.setAttribute("aria-expanded", String(panelOpened));

      try {
        localStorage.setItem(PANEL_STORAGE_KEY, String(panelOpened));
      } catch {}
    }

    slideToggleButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      panelOpened = !panelOpened;
      updatePanelVisibility();
    });

    updatePanelVisibility();

    const header = panel.querySelector("#tw26-header");
    const body = panel.querySelector("#tw26-body");
    const fold = panel.querySelector("#tw26-fold");
    const serverInput = panel.querySelector("#tw26-server");
    const serverOrderInputs = [...panel.querySelectorAll('input[name="tw26-server-order"]')];
    const dataHubScannerIdInput = panel.querySelector("#tw26-datahub-scanner-id");
    const githubTokenInput = panel.querySelector("#tw26-github-token");
    const thiefButton = panel.querySelector("#tw26-thief");
    const surveyButton = panel.querySelector("#tw26-survey");
    const surveyRewardsButton = panel.querySelector("#tw26-survey-rewards");
    const status = panel.querySelector("#tw26-status");
    const detailStatus = panel.querySelector("#tw26-detail-status");
    const resetButton = panel.querySelector("#tw26-reset");
    const saveButton = panel.querySelector("#tw26-save");
    const reconnectButton = panel.querySelector("#tw26-reconnect");
    const connectionStatusButton = panel.querySelector("#tw26-connection-status");
    const programLogsButton = panel.querySelector("#tw26-program-logs");
    const gameFontLogsButton = panel.querySelector("#tw26-game-font-logs");
    const activityButton = panel.querySelector("#tw26-activity");
    const allianceButton = panel.querySelector("#tw26-alliance");
    const thiefUploadTestButton = panel.querySelector("#tw26-thief-upload-test");

    const initialThiefUiSettings = loadThiefUiSettings();
    const initialDataHubSettings = window.TOPWAR_DATAHUB?.readSettings?.() || {};
    dataHubScannerIdInput.value = initialDataHubSettings.scannerId || "";
    githubTokenInput.value = initialDataHubSettings.key || "";

    let folded = false;
    let serverListLoading = false;
    let lastServerListError = null;
    let thiefUploadTestRunning = false;
    let lastThiefUploadTest = null;

    const SERVER_ORDER_STORAGE_KEY = "TOPWAR_AUTOMATION_SERVER_ORDER";

    function normalizeServerOrderMode(value) {
      const mode = String(value || "").trim().toLowerCase();
      return ["sequential", "popular", "random"].includes(mode) ? mode : "popular";
    }

    function getServerOrderMode() {
      const checked = serverOrderInputs.find(input => input.checked)?.value;
      if (checked) return normalizeServerOrderMode(checked);
      try {
        return normalizeServerOrderMode(localStorage.getItem(SERVER_ORDER_STORAGE_KEY));
      } catch {
        return "popular";
      }
    }

    function setServerOrderMode(value) {
      const mode = normalizeServerOrderMode(value);
      for (const input of serverOrderInputs) input.checked = input.value === mode;
      try { localStorage.setItem(SERVER_ORDER_STORAGE_KEY, mode); } catch {}
      return mode;
    }

    function shuffleServerIds(serverIds) {
      const ids = parseServerIdsStrict(serverIds).slice();
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      return ids;
    }

    function applyServerOrder(serverIds, mode = getServerOrderMode()) {
      const ids = parseServerIdsStrict(serverIds);
      const normalizedMode = normalizeServerOrderMode(mode);

      if (normalizedMode === "sequential") {
        return ids.slice().sort((a, b) => Number(a) - Number(b));
      }

      if (normalizedMode === "random") {
        return shuffleServerIds(ids);
      }

      const popularIds = TOPWAR.getCachedRemoteServerList?.()?.serverIds ?? [];
      if (!popularIds.length) return ids.slice();

      const popularRank = new Map(
        popularIds.map((serverId, index) => [String(serverId), index])
      );

      return ids.slice().sort((a, b) => {
        const ar = popularRank.get(String(a));
        const br = popularRank.get(String(b));
        if (ar != null && br != null) return ar - br;
        if (ar != null) return -1;
        if (br != null) return 1;
        return Number(a) - Number(b);
      });
    }

    function inputServerId() {
      return parseServerIdsStrict(serverInput.value)[0] ?? null;
    }

    function explicitInputServerIds() {
      return parseServerIdsStrict(serverInput.value);
    }

    function displayServerIds() {
      const explicit = explicitInputServerIds();
      const base = explicit.length
        ? explicit
        : (TOPWAR.getCachedRemoteServerList?.()?.serverIds ?? []);
      const mode = getServerOrderMode();

      // 랜덤은 실행 시 한 번만 섞는다. 상태창을 다시 그릴 때마다 순서를 바꾸지 않는다.
      return mode === "random" ? base.slice() : applyServerOrder(base, mode);
    }

    async function ensureRemoteServerListLoaded() {
      const topwarApi = window.TOPWAR || TOPWAR;
      const cachedResult = topwarApi?.getCachedRemoteServerList?.() || null;
      const cached = cachedResult?.serverIds ?? [];
      const fetchedAtMs = Date.parse(cachedResult?.fetchedAt || "");
      const cacheFresh = cached.length && Number.isFinite(fetchedAtMs) &&
        Date.now() - fetchedAtMs < 60 * 60 * 1000;
      if (cacheFresh) return cached;

      const loader = topwarApi?.loadRemoteServerIds;
      if (typeof loader !== "function") return [];

      serverListLoading = true;
      lastServerListError = null;
      render();

      try {
        return await loader.call(topwarApi, {
          maxAgeMs: 60 * 60 * 1000,
          force: !!cached.length,
          debug: true
        });
      } catch (error) {
        lastServerListError = error?.message || String(error);
        console.error("[TopWar V2.12.1 UI] GitHub 서버목록 로드 실패:", error);
        return [];
      } finally {
        serverListLoading = false;
        render();
      }
    }

    async function resolveSurveyServerIds() {
      const explicit = explicitInputServerIds();
      const mode = getServerOrderMode();

      // 인기순은 직접 입력 목록이라도 popular 순위를 알아야 하므로 캐시를 준비한다.
      if (mode === "popular") {
        await ensureRemoteServerListLoaded();
      }

      let baseIds = explicit;
      if (!baseIds.length) {
        baseIds = await ensureRemoteServerListLoaded();
      }

      const ordered = applyServerOrder(baseIds, mode);
      console.log("[TopWar V2.12.1 UI] 서버 선택:", {
        mode,
        explicit: explicit.length > 0,
        count: ordered.length,
        first: ordered.slice(0, 20)
      });
      return ordered;
    }

    const initialServerOrderMode = (() => {
      try { return normalizeServerOrderMode(localStorage.getItem(SERVER_ORDER_STORAGE_KEY)); }
      catch { return "popular"; }
    })();
    setServerOrderMode(initialServerOrderMode);

    serverOrderInputs.forEach(input => {
      input.addEventListener("change", event => {
        event.stopPropagation();
        if (input.checked) {
          setServerOrderMode(input.value);
          render();
        }
      });
    });

    // UI/후속 add-on/RealPower에서 동일한 서버 선택 규칙을 재사용한다.
    TOPWAR.getAutomationServerOrderMode = getServerOrderMode;
    TOPWAR.setAutomationServerOrderMode = setServerOrderMode;
    TOPWAR.applyAutomationServerOrder = applyServerOrder;
    TOPWAR.resolveAutomationServerIds = resolveSurveyServerIds;

    async function runThiefShareWatchForServers(serverIds, overrides = {}) {
      const ids = parseServerIdsStrict(serverIds);
      if (!ids.length) return { ok: false, reason: "serverIds is required" };

      state.watch133.running = true;
      state.watch133.multiServer = {
        running: true,
        cycle: 0,
        serverIndex: 0,
        totalServers: ids.length,
        serverId: null,
        serverIds: ids.slice()
      };

      let cycle = 0;
      try {
        while (state.watch133.running) {
          cycle++;
          state.watch133.multiServer.cycle = cycle;

          for (let index = 0; index < ids.length; index++) {
            if (!state.watch133.running) break;

            const serverId = ids[index];
            state.watch133.multiServer = {
              ...state.watch133.multiServer,
              running: true,
              cycle,
              serverIndex: index + 1,
              totalServers: ids.length,
              serverId
            };

            const result = await TOPWAR.watchPointTypeAndNotify(
              getDefaultWatchOptions(serverId, {
                ...overrides,
                maxCycles: 1,
                loopDelay: 0
              })
            );

            // CityReward와 같은 방식으로 서버의 전체 스캔이 정상 완료된 시점에만 GitHub를 갱신한다.
            // 현재 서버에서 이번 스캔 중 관측된 pointType 133 전체를 스냅샷으로 사용하므로,
            // 해당 서버의 예전 결과는 교체되고 다른 서버 결과는 유지된다.
            if (
              result?.ok === true &&
              result?.stopped !== true &&
              overrides.githubUpload !== false &&
              typeof TOPWAR.uploadCompletedThiefServer === "function"
            ) {
              try {
                const observed = (TOPWAR.getObjectsByTypeRaw?.(133) || [])
                  .filter(obj => Number(obj?.serverId) === Number(serverId));

                const serverResult = typeof TOPWAR.buildCompletedThiefServerResult === "function"
                  ? TOPWAR.buildCompletedThiefServerResult(serverId, observed, {
                      ok: true,
                      completed: true,
                      cycle
                    })
                  : {
                      ok: true,
                      completed: true,
                      serverId,
                      cycle,
                      locations: observed
                    };

                const upload = await TOPWAR.uploadCompletedThiefServer(serverResult);
                state.watch133.lastGithubUpload = upload;
                console.log("[TopWar Thief GitHub] 서버 스캔 결과 업로드 완료:", upload);
              } catch (error) {
                state.watch133.lastGithubUpload = { ok: false, serverId, error: error?.message || String(error) };
                console.error("[TopWar Thief GitHub] 서버 스캔 결과 업로드 실패:", error);
              }
            }

            if (!state.watch133.running) break;
            if (result?.error) console.warn("[TopWar V2.10.5.1] 도둑찾기 서버 처리 오류:", { serverId, result });
            if (index < ids.length - 1) await TOPWAR.sleep?.(Number(overrides.betweenServerDelay ?? 500));
          }

          if (!state.watch133.running) break;
          await TOPWAR.sleep?.(Number(overrides.betweenCycleDelay ?? 1000));
        }
      } finally {
        if (state.watch133.multiServer) state.watch133.multiServer.running = false;
      }

      return { ok: true, stopped: true, cycle, serverIds: ids };
    }

    TOPWAR.watchPointTypeOnServers = runThiefShareWatchForServers;
    TOPWAR.runThiefShareWatchForServers = runThiefShareWatchForServers;


    // ---------------------------------------------------------------------
    // Unified Finder V2.11.5
    // - 지도는 서버당 한 번만 순회한다.
    // - 같은 901 수집 결과에서 pointType 133(도둑)과 cityReward를 동시에 모은다.
    // - 자동 월드/길드 공유 코드는 기존 watchPointTypeAndNotify 경로에 그대로 보존한다.
    // - 현재 통합 UI는 공유 경로를 호출하지 않고 GitHub 두 저장소만 갱신한다.
    // - 도둑은 발견 즉시 GitHub에 upsert하고, 서버 정상 완료 시 전체 스냅샷으로 최종 정리한다.
// - 정상 완료 + 0건은 유효한 스냅샷이므로 해당 서버의 과거 데이터가 제거된다.
    // - 중지/연결실패/전체 지도이동 실패 시 GitHub는 갱신하지 않는다.
    // ---------------------------------------------------------------------
    // 통합 탐색의 도둑 판정은 게임 내부 월드맵 캐시를 사용하지 않는다.
    // 매 좌표 이동 직전에 존재하던 recentPackets 객체를 기억하고,
    // 이동 뒤 새로 도착한 네트워크 901의 pointList에서 pointType 133만 추출한다.
    // 이렇게 해야 이미 사라졌지만 Cocos 월드맵 캐시에 남은 133이 재업로드되지 않는다.
    // 기존 GitHub 도둑 좌표가 어느 스캔 지점에서 확인되어야 하는지 계산한다.
    // 단순 x/y 범위 비교가 아니라 실제 scan grid의 가장 가까운 셀에 귀속시켜
    // snake 방향에서도 "지나온 영역"을 정확히 판정한다.
    function nearestUnifiedScanValue(value, values) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || !Array.isArray(values) || !values.length) return null;

      let nearest = Number(values[0]);
      let distance = Math.abs(numeric - nearest);
      for (let i = 1; i < values.length; i++) {
        const candidate = Number(values[i]);
        const nextDistance = Math.abs(numeric - candidate);
        if (nextDistance < distance) {
          nearest = candidate;
          distance = nextDistance;
        }
      }
      return nearest;
    }

    function unifiedScanCellKey(x, y) {
      return `${Number(x)}:${Number(y)}`;
    }

    function collectNetworkThievesFromNew901(targetServerId, eventMarker, destinationMap) {
      const output = destinationMap instanceof Map ? destinationMap : new Map();
      const marker = Math.max(1, Number(eventMarker ?? 1));
      let added = 0;
      let observed = 0;
      let eventCount = 0;

      // 도둑 탐색은 일반 recentPackets / cityReward 저장소를 전혀 보지 않는다.
      // thiefBuffer.events에는 pointType=133이 실제로 존재한 이벤트만 들어 있다.
      const thiefBuffer = state.thiefBuffer ??= { maxEvents: 512, events: [], nextEventId: 1, stats: {} };
      thiefBuffer.stats ??= {};

      for (const event of thiefBuffer.events || []) {
        if (Number(event?.id ?? 0) < marker) continue;

        // detail.k / point.p.w 같은 게임 내부 필드는 서버 판정에 사용하지 않는다.
        // 스캔이 이동을 요청할 때 기록한 activeTargetServerId를 이벤트에 고정해 사용한다.
        const scanServerId = event?.scanServerId == null ? null : Number(event.scanServerId);
        if (scanServerId != null && Number.isFinite(scanServerId) &&
            scanServerId !== Number(targetServerId)) {
          continue;
        }
        eventCount++;

        for (const point of event?.thieves || []) {
          const x = Number(point?.x);
          const y = Number(point?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

          observed++;
          const id = point?.id ?? null;
          const objectKey = id != null
            ? `${targetServerId}:133:id:${id}`
            : `${targetServerId}:133:coord:${x}:${y}`;

          const normalized = {
            objectKey,
            serverId: Number(targetServerId),
            x,
            y,
            id,
            pointType: 133,
            pointTypeName: "보물 탐사선",
            time: event?.time ?? nowIso(),
            source: "dedicated-thief-buffer",
            packetServerId: event?.packetServerId ?? null,
            scanServerId: event?.scanServerId ?? null,
            packetSeq: event?.packetSeq ?? null,
            networkEventId: event?.id ?? null
          };

          if (!output.has(objectKey)) added++;
          output.set(objectKey, normalized);
        }
      }

      const result = {
        added,
        observed,
        eventCount,
        total: output.size,
        marker,
        latestEventId: Number(thiefBuffer.nextEventId ?? 1) - 1,
        bufferedEvents: thiefBuffer.events?.length ?? 0,
        map: output
      };

      const stats = thiefBuffer.stats;
      stats.collectCalls = Number(stats.collectCalls || 0) + 1;
      stats.thievesCollected = Number(stats.thievesCollected || 0) + added;
      stats.lastCollectedAt = nowIso();
      stats.lastCollected = {
        targetServerId: Number(targetServerId),
        marker,
        added,
        observed,
        eventCount,
        total: output.size,
        bufferedEvents: thiefBuffer.events?.length ?? 0
      };

      if (added > 0 || observed > 0) {
        console.warn("[TopWar Thief Buffer] 스캔에서 133 회수:", stats.lastCollected);
      }

      return result;
    }

    async function scanUnifiedFinderServer(serverId, options = {}, meta = {}) {
      const targetServerId = Number(serverId);
      if (!Number.isFinite(targetServerId) || targetServerId <= 0) {
        return { ok: false, completed: false, serverId, reason: "invalid serverId" };
      }

      if (typeof TOPWAR.collectRewardsFromRecent901 !== "function") {
        return { ok: false, completed: false, serverId: targetServerId, reason: "cityReward collector not installed" };
      }

      if (typeof TOPWAR.moveMapToStableUnified !== "function") {
        return { ok: false, completed: false, serverId: targetServerId, reason: "moveMapToStableUnified not found" };
      }

      const controller = TOPWAR.mapCtrl?.();
      if (!controller) {
        return { ok: false, completed: false, serverId: targetServerId, reason: "NWorldController not found" };
      }

      const range = controller.getWorldMapDataInstance?.()?.status?.viewport?.range;
      const subMap = options.subMap ?? range?.sub ?? 0;
      const startX = Number(options.startX ?? 50);
      const startY = Number(options.startY ?? 50);
      const endX = Number(options.endX ?? 750);
      const endY = Number(options.endY ?? 875);
      const stepX = Number(options.stepX ?? 80);
      const stepY = Number(options.stepY ?? 75);
      const scale = Number(options.scale ?? 0.27);

      let xs, ys;
      try {
        xs = TOPWAR.buildScanCoords(startX, endX, stepX, "x");
        ys = TOPWAR.buildScanCoords(startY, endY, stepY, "y");
      } catch (error) {
        return { ok: false, completed: false, serverId: targetServerId, reason: error?.message || String(error) };
      }

      const plan = TOPWAR.buildScanPlan(xs, ys, {
        startCorner: options.startCorner ?? "top-left",
        snake: options.snake !== false
      });
      const totalMoves = plan.reduce((sum, row) => sum + row.xOrder.length, 0);
      const startedAt = nowIso();
      const startedMs = Date.now();
      const rewardMap = new Map();
      // 도둑은 objectMap/getObjectsByTypeRaw를 사용하지 않는다.
      // 오직 이번 스캔 중 새로 도착한 네트워크 901에서 확인된 133만 보관한다.
      const thiefMap = new Map();
      // 같은 서버를 훑는 동안 이미 즉시 업로드한 도둑은 중복 PUT하지 않는다.
      // 서버 전체 스캔 완료 시에는 아래와 별개로 authoritative snapshot 업로드를 다시 수행한다.
      const liveUploadedThiefKeys = new Set();
      // 실제 네트워크 901로 확인된 스캔 셀만 누적한다.
      // GitHub 즉시 업로드 시 이 셀들에 속하는 기존 좌표 중 이번 회차에서
      // 다시 관측되지 않은 도둑만 점진적으로 제거한다.
      const confirmedThiefScanCells = new Set();
      let lastThiefProgressUploadConfirmedCount = 0;
      let moveIndex = 0;
      let failCount = 0;

      // 서버가 바뀔 때 이전 서버의 도둑/플레이어/901 캐시가 섞이지 않게 초기화한다.
      TOPWAR.clearCollected({ keepWatch: true });
      const dedicatedThiefBuffer = state.thiefBuffer ??= {
        maxEvents: 512,
        events: [],
        nextEventId: 1,
        activeTargetServerId: null,
        stats: {}
      };
      dedicatedThiefBuffer.activeTargetServerId = targetServerId;
      dedicatedThiefBuffer.stats ??= {};
      dedicatedThiefBuffer.stats.lastScanServerId = targetServerId;
      dedicatedThiefBuffer.stats.lastScanStartedAt = nowIso();

      state.watch133.current = {
        phase: "unifiedScan",
        cycle: meta.cycle ?? null,
        serverId: targetServerId,
        serverIndex: meta.serverIndex ?? null,
        totalServers: meta.totalServers ?? null,
        moveIndex: 0,
        totalMoves,
        x: null,
        y: null,
        thiefCount: 0,
        rewardCount: 0,
        failCount: 0
      };

      console.log(`[TopWar Unified Finder] 서버 ${targetServerId} 스캔 시작: ${totalMoves} moves`);

      for (const row of plan) {
        for (const x of row.xOrder) {
          if (!state.watch133.running || state.connectionGuard?.disconnected) {
            return {
              ok: false,
              stopped: true,
              completed: false,
              serverId: targetServerId,
              reason: state.connectionGuard?.disconnected ? "connection guard disconnected" : "stopped",
              startedAt,
              finishedAt: nowIso(),
              totalMoves,
              moveIndex,
              failCount,
              thiefCount: thiefMap.size,
              rewardCount: rewardMap.size
            };
          }

          while (state.watch133.paused && state.watch133.running && !state.connectionGuard?.disconnected) {
            await sleep(100);
          }
          if (!state.watch133.running || state.connectionGuard?.disconnected) {
            return {
              ok: false,
              stopped: true,
              completed: false,
              serverId: targetServerId,
              reason: state.connectionGuard?.disconnected ? "connection guard disconnected" : "stopped",
              startedAt,
              finishedAt: nowIso(),
              totalMoves,
              moveIndex,
              failCount,
              thiefCount: thiefMap.size,
              rewardCount: rewardMap.size
            };
          }

          const y = row.y;
          // 이 좌표 이동 전에 다음 901 경량 이벤트 ID를 marker로 기억한다.
          // 아래 도둑 수집에서는 marker 이후 수신된 네트워크 901만 검사한다.
          // raw recentPackets(16개 제한)에 의존하지 않으므로 패킷 폭주 시에도 133이 유실되지 않는다.
          const thiefNetworkEventMarker = Number(state.thiefBuffer?.nextEventId ?? 1);
          let moveResult = null;
          try {
            moveResult = await TOPWAR.moveMapToStableUnified(x, y, {
              serverId: targetServerId,
              subMap,
              scale,
              afterMoveWait: options.afterMoveWait ?? 120,
              wait901Timeout: options.wait901Timeout ?? 2200,
              quietMs: options.quietMs ?? 300,
              interval: options.interval ?? 30,
              maxRetries: options.maxRetries ?? 1,
              retryDelay: options.retryDelay ?? 250,
              // cache fallback은 이동 성공 판정/cityReward 보조용으로만 허용한다.
              // 도둑은 위의 collectNetworkThievesFromNew901에서 네트워크 901만 사용한다.
              collectCache: options.collectCache ?? true
            });
          } catch (error) {
            console.error(`[TopWar Unified Finder] 이동 오류 server=${targetServerId} (${x},${y})`, error);
          }

          moveIndex++;
          if (!moveResult?.ok) failCount++;

          // WebSocket message 이벤트의 data가 Blob이면 handleMessage 내부에서
          // arrayBuffer 변환/패킷 파싱이 비동기로 끝난다. 지도 이동 Promise가 먼저
          // 완료되는 경우 즉시 버퍼를 읽으면 이번 901의 133을 놓치고, 다음 좌표의
          // marker가 그 이벤트 뒤로 이동해 영구 누락될 수 있다.
          // 마지막 901 이후 짧은 정착 시간을 주어 이번 이동에서 시작된 비동기
          // 디코딩이 버퍼에 반영된 다음 수집한다.
          await sleep(Math.max(0, Number(options.thiefCaptureSettleMs ?? 450)));

          const currentPlayers = Number(TOPWAR.summary?.()?.players ?? 0);
          const maxPlayersPerServer = Number(options.maxPlayersPerServer ?? 2000);
          if (Number.isFinite(maxPlayersPerServer) && maxPlayersPerServer > 0 &&
              currentPlayers >= maxPlayersPerServer) {
            const reason = `player limit exceeded: ${currentPlayers}/${maxPlayersPerServer}`;
            console.warn(`[TopWar Player Guard] server=${targetServerId} players=${currentPlayers} - 도둑/보상 통합조사 폐기, 다음 서버로 이동`);

            thiefMap.clear();
            rewardMap.clear();
            liveUploadedThiefKeys.clear();
            confirmedThiefScanCells.clear();
            dedicatedThiefBuffer.events = [];
            dedicatedThiefBuffer.activeTargetServerId = null;
            TOPWAR.clearHeavySurveyData?.({ packetLimit: 0, outgoingLimit: 0 });
            TOPWAR.clearCollected?.({ keepWatch: true });

            return {
              ok: true,
              stopped: false,
              completed: false,
              skipped: true,
              playerLimitExceeded: true,
              serverId: targetServerId,
              players: currentPlayers,
              maximumPlayers: maxPlayersPerServer,
              reason,
              startedAt,
              finishedAt: nowIso(),
              totalMoves,
              moveIndex,
              failCount,
              thiefCount: 0,
              rewardCount: 0
            };
          }

          // 도둑은 이번 이동 후 새로 수신한 네트워크 901에서만 수집한다.
          // moveMapToStableUnified의 worldMapCache fallback 결과는 도둑 판정에 절대 사용하지 않는다.
          const thiefCollect = collectNetworkThievesFromNew901(
            targetServerId,
            thiefNetworkEventMarker,
            thiefMap
          );

          // objectsByType[133]은 지나온 지역의 사라진 객체를 계속 보존할 수 있으므로
          // 다시 합치지 않는다. 이번 이동 이후 수신한 네트워크 901만 진실로 사용한다.
          thiefCollect.total = thiefMap.size;

          // 이 이동에서 실제 pointList를 가진 네트워크 901을 받았을 때만
          // 해당 scan cell을 "확인 완료"로 인정한다. cache fallback/실패 지점은
          // 기존 GitHub 좌표 삭제 범위에 절대 포함하지 않는다.
          if (moveResult?.source === "network901" || moveResult?.stable?.ok === true) {
            confirmedThiefScanCells.add(unifiedScanCellKey(x, y));
          }

          const thieves = [...thiefMap.values()];

          // 도둑은 서버 스캔 완료를 기다리지 않고 발견 즉시 GitHub에 upsert한다.
          // 여기서는 기존 서버 결과를 통째로 교체하지 않는다. 아직 방문하지 않은 구역의
          // 유효한 도둑을 지우면 안 되기 때문이다. 전체 교체는 서버 스캔 완료 시 한 번 더 한다.
          const newThieves = thieves.filter(obj => {
            const key = obj?.objectKey ??
              (obj?.id != null
                ? `${targetServerId}:id:${obj.id}`
                : `${targetServerId}:coord:${obj?.x}:${obj?.y}`);
            return !liveUploadedThiefKeys.has(key);
          });

          const confirmedSinceLastUpload =
            confirmedThiefScanCells.size - lastThiefProgressUploadConfirmedCount;
          const shouldUploadThiefProgress =
            newThieves.length > 0 || confirmedSinceLastUpload >= 10;

          if (shouldUploadThiefProgress && options.githubUpload !== false) {
            try {
              if (typeof TOPWAR.uploadDetectedThieves !== "function") {
                throw new Error("uploadDetectedThieves not installed");
              }

              // 새 도둑만 보내는 것이 아니라 "이번 회차에서 지금까지 실제로 확인된
              // 도둑 전체"를 함께 전달한다. 업로더는 confirmedScanCells에 속하는
              // 기존 GitHub 좌표 중 이 목록에 없는 행을 삭제하고 새 도둑을 upsert한다.
              const thiefStats = (state.thiefBuffer ??= { maxEvents: 512, events: [], nextEventId: 1, stats: {} }).stats ??= {};
              thiefStats.uploadRequests = Number(thiefStats.uploadRequests || 0) + 1;
              thiefStats.lastUploadRequestedAt = nowIso();
              thiefStats.lastUpload = {
                phase: "requested",
                mode: "live",
                serverId: targetServerId,
                detected: thieves.length,
                newDetected: newThieves.length,
                moveIndex,
                totalMoves
              };
              console.warn("[TopWar Thief Upload] GitHub 업로드 호출:", thiefStats.lastUpload);

              const liveUpload = await TOPWAR.uploadDetectedThieves(targetServerId, thieves, {
                cycle: meta.cycle ?? null,
                detectedAt: nowIso(),
                newDetectedCount: newThieves.length,
                scanProgress: {
                  moveIndex,
                  totalMoves,
                  scanXs: xs.slice(),
                  scanYs: ys.slice(),
                  confirmedScanCells: [...confirmedThiefScanCells]
                }
              });

              if (liveUpload?.ok) {
                lastThiefProgressUploadConfirmedCount = confirmedThiefScanCells.size;
                for (const obj of newThieves) {
                  const key = obj?.objectKey ??
                    (obj?.id != null
                      ? `${targetServerId}:id:${obj.id}`
                      : `${targetServerId}:coord:${obj?.x}:${obj?.y}`);
                  liveUploadedThiefKeys.add(key);
                }
              }

              state.watch133.lastGithubUpload = liveUpload;
              state.watch133.lastLiveThiefUpload = liveUpload;

              if (liveUpload?.ok) {
                thiefStats.uploadSuccess = Number(thiefStats.uploadSuccess || 0) + 1;
                thiefStats.lastUploadSuccessAt = nowIso();
                thiefStats.lastError = null;
              } else {
                thiefStats.uploadFailure = Number(thiefStats.uploadFailure || 0) + 1;
                thiefStats.lastUploadFailureAt = nowIso();
                thiefStats.lastError = liveUpload?.error || liveUpload?.reason || "unknown";
              }
              thiefStats.lastUpload = { ...thiefStats.lastUpload, phase: "finished", result: liveUpload };

              console.log("[TopWar Unified Finder] 도둑 즉시 GitHub 업로드:", {
                serverId: targetServerId,
                detected: newThieves.length,
                confirmedCells: confirmedThiefScanCells.size,
                removedMissing: liveUpload?.removedConfirmedMissing ?? 0,
                result: liveUpload
              });
            } catch (error) {
              const liveUpload = {
                ok: false,
                serverId: targetServerId,
                detected: newThieves.length,
                error: error?.message || String(error)
              };
              state.watch133.lastGithubUpload = liveUpload;
              state.watch133.lastLiveThiefUpload = liveUpload;
              const thiefStats = (state.thiefBuffer ??= { maxEvents: 512, events: [], nextEventId: 1, stats: {} }).stats ??= {};
              thiefStats.uploadFailure = Number(thiefStats.uploadFailure || 0) + 1;
              thiefStats.lastUploadFailureAt = nowIso();
              thiefStats.lastError = liveUpload.error;
              thiefStats.lastUpload = {
                phase: "failed",
                mode: "live",
                serverId: targetServerId,
                detected: newThieves.length,
                result: liveUpload
              };
              console.error("[TopWar Unified Finder] 도둑 즉시 DataHub 업로드 실패:", error);
            }
          }

          // 같은 901/playerMap에서 cityReward도 동시에 누적한다.
          let rewardCollect = { added: 0 };
          try {
            rewardCollect = TOPWAR.collectRewardsFromRecent901(targetServerId, rewardMap) || rewardCollect;
          } catch (error) {
            console.warn(`[TopWar Unified Finder] cityReward 수집 오류 server=${targetServerId}`, error);
          }

          state.watch133.current = {
            phase: "unifiedScan",
            cycle: meta.cycle ?? null,
            serverId: targetServerId,
            serverIndex: meta.serverIndex ?? null,
            totalServers: meta.totalServers ?? null,
            moveIndex,
            totalMoves,
            x,
            y,
            thiefCount: thieves.length,
            rewardCount: rewardMap.size,
            failCount
          };

          if (
            moveIndex % Math.max(1, Number(options.logEvery ?? 5)) === 0 ||
            Number(thiefCollect?.added ?? 0) > 0 ||
            Number(rewardCollect?.added ?? 0) > 0 ||
            !moveResult?.ok
          ) {
            console.log(
              `[TopWar Unified Finder] server=${targetServerId} scan=${moveIndex}/${totalMoves} ` +
              `coord=(${x},${y}) ok=${!!moveResult?.ok} thief=${thieves.length} thiefNew=${Number(thiefCollect?.added ?? 0)} ` +
              `reward=${rewardMap.size} rewardNew=${Number(rewardCollect?.added ?? 0)} fail=${failCount}`
            );
          }

          await sleep(Number(options.stepDelay ?? 0));
        }
      }

      const allMovesFailed = totalMoves > 0 && failCount >= totalMoves;
      const thieves = [...thiefMap.values()].sort((a, b) =>
        Number(a?.x ?? 0) - Number(b?.x ?? 0) || Number(a?.y ?? 0) - Number(b?.y ?? 0)
      );
      const rewards = [...rewardMap.values()].sort((a, b) =>
        Number(a?.x ?? 0) - Number(b?.x ?? 0) || Number(a?.y ?? 0) - Number(b?.y ?? 0)
      );

      const finishedAt = nowIso();
      const result = {
        ok: !allMovesFailed,
        stopped: false,
        completed: true,
        serverId: targetServerId,
        cycle: meta.cycle ?? null,
        startedAt,
        finishedAt,
        elapsedSec: Math.round((Date.now() - startedMs) / 1000),
        totalMoves,
        moveIndex,
        failCount,
        thiefCount: thieves.length,
        rewardCount: rewards.length,
        thieves,
        rewards,
        reason: allMovesFailed ? "all map moves failed" : null,
        thiefUpload: null,
        rewardUpload: null
      };

      state.watch133.current = {
        ...state.watch133.current,
        phase: allMovesFailed ? "scanFailed" : "uploading",
        moveIndex,
        totalMoves,
        thiefCount: thieves.length,
        rewardCount: rewards.length,
        failCount
      };

      // 스캔 자체가 유효하지 않으면 과거 GitHub 데이터를 절대 지우지 않는다.
      if (allMovesFailed || !state.watch133.running || state.connectionGuard?.disconnected) {
        result.ok = false;
        result.completed = !state.connectionGuard?.disconnected && state.watch133.running;
        result.stopped = !state.watch133.running || !!state.connectionGuard?.disconnected;
        result.reason = state.connectionGuard?.disconnected
          ? "connection guard disconnected"
          : !state.watch133.running
            ? "stopped before upload"
            : result.reason;
        state.watch133.lastUnifiedResult = result;
        return result;
      }

      if (options.githubUpload !== false) {
        const thiefServerResult = typeof TOPWAR.buildCompletedThiefServerResult === "function"
          ? TOPWAR.buildCompletedThiefServerResult(targetServerId, thieves, {
              ok: true,
              completed: true,
              cycle: meta.cycle ?? null
            })
          : {
              ok: true,
              completed: true,
              serverId: targetServerId,
              cycle: meta.cycle ?? null,
              count: thieves.length,
              locations: thieves
            };

        const rewardServerResult = {
          ok: true,
          completed: true,
          serverId: targetServerId,
          cycle: meta.cycle ?? null,
          scannedAt: finishedAt,
          count: rewards.length,
          locations: rewards
        };

        // 서로 다른 저장소이므로 한쪽 실패가 다른쪽 업로드를 막지 않게 독립 처리한다.
        try {
          if (typeof TOPWAR.uploadCompletedThiefServer !== "function") {
            throw new Error("uploadCompletedThiefServer not installed");
          }
          result.thiefUpload = await TOPWAR.uploadCompletedThiefServer(thiefServerResult);
          state.watch133.lastGithubUpload = result.thiefUpload;
        } catch (error) {
          result.thiefUpload = { ok: false, serverId: targetServerId, error: error?.message || String(error) };
          state.watch133.lastGithubUpload = result.thiefUpload;
          console.error("[TopWar Unified Finder] 도둑 DataHub 업로드 실패:", error);
        }

        try {
          if (typeof TOPWAR.uploadRewardServerResults !== "function") {
            throw new Error("uploadRewardServerResults not installed");
          }
          result.rewardUpload = await TOPWAR.uploadRewardServerResults(rewardServerResult);
          state.watch133.lastRewardGithubUpload = result.rewardUpload;
        } catch (error) {
          result.rewardUpload = { ok: false, serverId: targetServerId, error: error?.message || String(error) };
          state.watch133.lastRewardGithubUpload = result.rewardUpload;
          console.error("[TopWar Unified Finder] 도시보상 DataHub 업로드 실패:", error);
        }
      }

      state.watch133.current = {
        ...state.watch133.current,
        phase: "serverDone",
        thiefCount: thieves.length,
        rewardCount: rewards.length,
        thiefUploadOk: result.thiefUpload?.ok ?? null,
        rewardUploadOk: result.rewardUpload?.ok ?? null
      };
      state.watch133.lastUnifiedResult = result;

      console.log("[TopWar Unified Finder] 서버 완료:", {
        serverId: targetServerId,
        thief: thieves.length,
        reward: rewards.length,
        thiefUpload: result.thiefUpload,
        rewardUpload: result.rewardUpload
      });

      // 다음 서버로 넘어가기 전에 이번 서버의 큰 임시 컬렉션과 패킷 참조를 해제한다.
      thiefMap.clear();
      rewardMap.clear();
      liveUploadedThiefKeys.clear();
      confirmedThiefScanCells.clear();
      dedicatedThiefBuffer.events = [];
      dedicatedThiefBuffer.activeTargetServerId = null;
      if (dedicatedThiefBuffer.stats) {
        dedicatedThiefBuffer.stats.lastCaptured = null;
        dedicatedThiefBuffer.stats.lastCollected = null;
      }
      TOPWAR.clearCollected?.({ keepWatch: true });

      return result;
    }

    async function runUnifiedFinderForServers(serverIds, overrides = {}) {
      const ids = parseServerIdsStrict(serverIds);
      if (!ids.length) return { ok: false, reason: "serverIds is required" };
      if (state.ui.serverSurvey?.running || state.ui.serverSurveyBatch?.running) {
        return { ok: false, reason: "server survey is running" };
      }

      const requiredApis = [
        "buildScanCoords",
        "buildScanPlan",
        "moveMapToStableUnified",
        "clearCollected",
        "collectRewardsFromRecent901",
        "buildCompletedThiefServerResult",
        "uploadDetectedThieves",
        "uploadCompletedThiefServer",
        "uploadRewardServerResults"
      ];
      const missingApis = requiredApis.filter(name => typeof TOPWAR[name] !== "function");
      if (missingApis.length) {
        const reason = `필수 API 누락: ${missingApis.join(", ")}`;
        state.watch133.lastUnifiedError = reason;
        console.error("[TopWar Unified Finder] 실행 불가 -", reason);
        return { ok: false, fatal: true, reason, missingApis };
      }

      if (!TOPWAR.mapCtrl?.()) {
        const reason = "월드맵 컨트롤러를 찾지 못했습니다. 월드맵 화면에서 실행하세요.";
        state.watch133.lastUnifiedError = reason;
        return { ok: false, fatal: true, reason };
      }

      state.watch133.lastUnifiedError = null;
      state.watch133.running = true;
      state.watch133.paused = false;
      state.watch133.pauseReason = null;
      state.watch133.pauseInfo = null;
      state.watch133.multiServer = {
        running: true,
        mode: "thief+cityReward",
        cycle: 0,
        serverIndex: 0,
        totalServers: ids.length,
        serverId: null,
        serverIds: ids.slice()
      };

      let cycle = 0;
      const results = [];

      try {
        while (state.watch133.running) {
          cycle++;
          state.watch133.multiServer.cycle = cycle;

          for (let index = 0; index < ids.length; index++) {
            if (!state.watch133.running || state.connectionGuard?.disconnected) break;

            const serverId = ids[index];
            state.watch133.multiServer = {
              ...state.watch133.multiServer,
              running: true,
              mode: "thief+cityReward",
              cycle,
              serverIndex: index + 1,
              totalServers: ids.length,
              serverId
            };

            const result = await scanUnifiedFinderServer(serverId, {
              startX: overrides.startX ?? 50,
              startY: overrides.startY ?? 50,
              endX: overrides.endX ?? 750,
              endY: overrides.endY ?? 875,
              stepX: overrides.stepX ?? 80,
              stepY: overrides.stepY ?? 75,
              scale: overrides.scale ?? 0.27,
              startCorner: overrides.startCorner ?? "top-left",
              snake: overrides.snake !== false,
              wait901Timeout: overrides.wait901Timeout ?? 2200,
              quietMs: overrides.quietMs ?? 300,
              maxRetries: overrides.maxRetries ?? 1,
              betweenServerDelay: overrides.betweenServerDelay ?? 1000,
              githubUpload: overrides.githubUpload !== false,
              logEvery: overrides.logEvery ?? 5,
              collectCache: overrides.collectCache ?? true,
              stepDelay: overrides.stepDelay ?? 0
            }, {
              cycle,
              serverIndex: index + 1,
              totalServers: ids.length
            });

            results.push(result);

            if (result?.ok !== true && result?.completed === false && result?.stopped !== true) {
              state.watch133.lastUnifiedError = result?.reason || "통합 스캔 초기화 실패";
              console.error("[TopWar Unified Finder] 서버 스캔 시작 실패:", result);
              state.watch133.running = false;
              break;
            }

            if (result?.stopped || !state.watch133.running || state.connectionGuard?.disconnected) break;
            if (index < ids.length - 1) {
              await sleep(Number(overrides.betweenServerDelay ?? 1000));
            }
          }

          if (!state.watch133.running || state.connectionGuard?.disconnected) break;
          await sleep(Number(overrides.betweenCycleDelay ?? 1000));
        }
      } catch (error) {
        console.error("[TopWar Unified Finder] 반복 실행 오류:", error);
        state.watch133.lastUnifiedError = error?.message || String(error);
      } finally {
        if (state.watch133.multiServer) state.watch133.multiServer.running = false;
        state.watch133.current = {
          ...(state.watch133.current || {}),
          phase: state.connectionGuard?.disconnected ? "connectionFailure" : "stopped"
        };
      }

      const fatalReason = state.watch133.lastUnifiedError || null;
      return {
        ok: !state.connectionGuard?.disconnected && !fatalReason,
        stopped: true,
        cycle,
        serverIds: ids,
        results,
        reason: fatalReason
      };
    }

    TOPWAR.scanUnifiedFinderServer = scanUnifiedFinderServer;
    TOPWAR.runUnifiedFinderForServers = runUnifiedFinderForServers;

    function formatServerIdsForStatus(ids) {
      if (!ids?.length) return "-";
      if (ids.length <= 12) return ids.join(",");
      return `${ids.slice(0, 12).join(",")} 외 ${ids.length - 12}개`;
    }

    function setButton(button, running, label) {
      button.textContent = label;
      button.title = running ? "실행 중 · 클릭하면 중지" : "중지됨 · 클릭하면 실행";
      button.style.background = running ? "#247a4b" : "#3b3b3b";
    }

    function selectedThiefUiSettings() {
      return loadThiefUiSettings();
    }

    function shareDelayLabel(delayMs) {
      if (Number(delayMs) === 0) return "즉시";
      return `${Math.round(Number(delayMs) / 60000)}분 뒤`;
    }

    function setLogButton(button, enabled, label) {
      button.textContent = `${label} ${enabled ? "ON" : "OFF"}`;
      button.style.background = enabled ? "#3f654e" : "#333";
      button.style.color = enabled ? "#fff" : "#ddd";
    }

    function render() {
      ensureState();

      const watch = state.watch133 || {};
      const survey = state.ui.serverSurvey || {};
      const batch = state.ui.serverSurveyBatch || {};
      const surveyRunning = !!(survey.running || batch.running);
      const surveyStopping = !!(survey.stopping || batch.stopping);
      const topwarApiForRender = window.TOPWAR || TOPWAR;
      const queue = topwarApiForRender?.thiefQueue?.()?.length ?? state.thiefQueue?.length ?? 0;
      const current = survey.running ? (survey.current || {}) : (batch.current || survey.current || {});
      const lastSummary = survey.result?.summary ?? batch.results?.at?.(-1)?.summary ?? {};
      const activitySummary = lastSummary.activity ?? {};
      const connection = state.connectionGuard || {};
      const disconnected = !!connection.disconnected;
      const realPowerState = window.REALPOWER?.getState?.() || {};
      const realPowerProgress = realPowerState.progress || {};
      const realPowerRunning = realPowerState.running === true;
      const remoteServerList = topwarApiForRender?.getCachedRemoteServerList?.();
      const shownServerIds = displayServerIds();
      const usingRemoteServerList = !explicitInputServerIds().length;

      const thiefUiSettings = loadThiefUiSettings();
      const thiefBuffer = state.thiefBuffer || {};
      const thiefDiag = thiefBuffer.stats || {};
      const tokenStatus = TOPWAR.githubTokenStatus?.() ?? { configured: false };
      const logStatus = window.TOPWAR_LOG_CONTROL?.status?.() ?? { programLogs: true, gameFontWarnings: true };

      setButton(thiefButton, !!watch.running, "보상탐색");
      setButton(surveyButton, surveyRunning && survey.includeRewards !== true, "지도조사");
      setButton(surveyRewardsButton, surveyRunning && survey.includeRewards === true, "지도+보상");
      setLogButton(programLogsButton, !!logStatus.programLogs, "프로그램 로그");
      setLogButton(gameFontLogsButton, !!logStatus.gameFontWarnings, "게임 폰트경고");

      thiefButton.disabled = surveyRunning || realPowerRunning || disconnected;
      surveyButton.disabled = (!!watch.running && !surveyRunning) || realPowerRunning || disconnected;
      surveyRewardsButton.disabled = (!!watch.running && !surveyRunning) || realPowerRunning || disconnected;

      thiefButton.style.opacity = thiefButton.disabled ? "0.55" : "1";
      surveyButton.style.opacity = surveyButton.disabled ? "0.55" : "1";
      surveyRewardsButton.style.opacity = surveyRewardsButton.disabled ? "0.55" : "1";
      const anyAutomationRunning = !!(watch.running || surveyRunning || realPowerRunning || state.cityRewardFinder?.running);
      githubTokenInput.disabled = anyAutomationRunning || thiefUploadTestRunning;
      githubTokenInput.style.opacity = githubTokenInput.disabled ? "0.6" : "1";
      if (thiefUploadTestButton) {
        thiefUploadTestButton.disabled = anyAutomationRunning || thiefUploadTestRunning;
        thiefUploadTestButton.textContent = thiefUploadTestRunning ? "도둑 업로드 테스트 중..." : "도둑 업로드 테스트";
        thiefUploadTestButton.style.opacity = thiefUploadTestButton.disabled ? "0.55" : "1";
        thiefUploadTestButton.style.cursor = thiefUploadTestButton.disabled ? "default" : "pointer";
      }
      serverOrderInputs.forEach(input => {
        input.disabled = anyAutomationRunning;
        input.parentElement.style.opacity = input.disabled ? "0.55" : "1";
      });

      const thiefMulti = watch.multiServer || {};

      const runningLabel = watch.running
        ? `도둑 ${watch.current?.moveIndex ?? 0}/${watch.current?.totalMoves ?? "-"}`
        : surveyRunning
          ? `지도조사 ${current.index ?? "-"}/${current.total ?? "-"}`
          : realPowerRunning
            ? `Top100 ${realPowerProgress.currentIndex ?? 0}/${realPowerProgress.total ?? "-"}`
            : state.cityRewardFinder?.running
              ? "도시보상 스캔"
              : "대기";

      status.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span><b style="color:#eee">${runningLabel}</b>${current.serverId ? ` · ${current.serverId}` : ""}</span>
          <span style="white-space:nowrap;color:${disconnected ? "#ff7777" : "#8fd6a8"}">${disconnected ? "연결 오류" : "정상"}</span>
        </div>
        <div style="margin-top:2px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          서버 ${shownServerIds.length ? `${shownServerIds.length}개` : "-"} · ${getServerOrderMode() === "sequential" ? "순서대로" : getServerOrderMode() === "random" ? "랜덤" : "인기순"} · GitHub ${tokenStatus.configured ? "✓" : "미설정"} · 플레이어 ${state.playerMap?.size ?? 0}
        </div>
      `;

      if (detailStatus) {
        detailStatus.innerHTML = `
          대상 서버: <b>${formatServerIdsForStatus(shownServerIds)}</b><br>
          선택 기준: <b>${getServerOrderMode() === "sequential" ? "순서대로" : getServerOrderMode() === "random" ? "랜덤으로" : "인기순으로"}</b><br>
          서버목록: ${serverListLoading ? "읽는 중" : remoteServerList?.serverIds?.length ? `popular ${remoteServerList.serverIds.length}개` : usingRemoteServerList ? "popular 자동로드" : "직접입력"}${lastServerListError ? ` / 오류: ${lastServerListError}` : ""}<br>
          연결: ${disconnected ? "실패" : "정상"}${connection.reason ? ` / ${connection.reason}` : ""}<br>
          GitHub Token: ${tokenStatus.configured ? "설정됨" : "필요"}<br>
          보상탐색: ${watch.running ? "ON" : "OFF"} / 큐 ${queue} / 처리 ${watch.handledKeys?.size ?? 0}<br>
          진행: ${watch.current?.totalMoves ? `${watch.current?.moveIndex ?? 0}/${watch.current.totalMoves}` : "-"} / 도둑 ${watch.current?.thiefCount ?? watch.lastUnifiedResult?.thiefCount ?? 0} / 도시보상 ${watch.current?.rewardCount ?? watch.lastUnifiedResult?.rewardCount ?? 0}<br>
          도둑 버퍼: ${thiefBuffer.events?.length ?? 0}개 / 133수신 ${thiefDiag.thievesCaptured ?? 0} / 회수 ${thiefDiag.thievesCollected ?? 0}<br>
          도둑 업로드: 요청 ${thiefDiag.uploadRequests ?? 0} / 성공 ${thiefDiag.uploadSuccess ?? 0} / 실패 ${thiefDiag.uploadFailure ?? 0}<br>
          GitHub 요청: GET ${thiefDiag.githubGetSuccess ?? 0}/${thiefDiag.githubGetAttempts ?? 0} / PUT ${thiefDiag.githubPutSuccess ?? 0}/${thiefDiag.githubPutAttempts ?? 0}<br>
          도둑 GitHub: ${watch.lastGithubUpload?.ok === true ? "성공" : watch.lastGithubUpload?.ok === false ? `실패 (${watch.lastGithubUpload?.error || watch.lastGithubUpload?.reason || "unknown"})` : "-"}${thiefDiag.lastError ? ` / ${thiefDiag.lastError}` : ""}<br>
          업로드 테스트: ${thiefUploadTestRunning ? "진행 중" : lastThiefUploadTest?.ok === true ? `성공 (${lastThiefUploadTest.repo}/${lastThiefUploadTest.path})` : lastThiefUploadTest?.ok === false ? `실패 (${lastThiefUploadTest.error || lastThiefUploadTest.reason || lastThiefUploadTest.status || "unknown"})` : "-"}<br>
          지도조사: ${surveyRunning ? "ON" : "OFF"}${surveyStopping ? " / 중지 요청" : ""} / 단계 ${current.phase ?? state.fullScan?.phase ?? "-"}<br>
          Top100조사: ${realPowerRunning ? "ON" : "OFF"} / 단계 ${realPowerProgress?.phase ?? "-"}<br>
          플레이어 ${state.playerMap?.size ?? 0} / 동맹 ${state.allianceMap?.size ?? 0}<br>
          활동 CORE ${activitySummary.coreCount ?? "-"} / ACTIVE ${activitySummary.activeCount ?? "-"} / WATCH ${activitySummary.watchCount ?? "-"} / LOW ${activitySummary.lowCount ?? "-"}<br>
          서버활동 ${lastSummary.serverActivity?.grade ?? "-"} / 점수 ${lastSummary.serverActivity?.score ?? "-"}
        `;
      }
    }

    header.addEventListener("click", () => {
      folded = !folded;
      body.style.display = folded ? "none" : "block";
      fold.textContent = folded ? "펼치기" : "접기";
    });

    async function saveGithubTokenFromUi() {
      const scannerId = String(dataHubScannerIdInput.value || "").trim();
      const candidate = String(githubTokenInput.value || "").trim();
      if (!scannerId || !candidate) return false;
      window.TOPWAR_DATAHUB?.configure?.({
        baseUrl: "https://datahub.progamer.info",
        scannerId,
        key: candidate
      });
      render();
      return true;
    }

    // 실제 값이 변경된 경우에만 검증한다. 단순 focus/blur로는 재검증하지 않는다.
    githubTokenInput.addEventListener("change", event => {
      event.stopPropagation();
      void saveGithubTokenFromUi();
    });
    dataHubScannerIdInput.addEventListener("change", event => {
      event.stopPropagation();
      void saveGithubTokenFromUi();
    });

    programLogsButton.addEventListener("click", event => {
      event.stopPropagation();
      const control = window.TOPWAR_LOG_CONTROL;
      control?.setProgramLogsEnabled?.(!control.programLogs);
      render();
    });

    gameFontLogsButton.addEventListener("click", event => {
      event.stopPropagation();
      const control = window.TOPWAR_LOG_CONTROL;
      control?.setGameFontWarningsEnabled?.(!control.gameFontWarnings);
      render();
    });

    thiefButton.addEventListener("click", async event => {
      event.stopPropagation();

      if (state.watch133?.running) {
        TOPWAR.stopWatch133?.();
      } else {
        if (state.connectionGuard?.disconnected) { alert("서버 연결 실패 상태입니다. 게임 연결을 복구한 뒤 연결상태 초기화를 눌러주세요."); return; }
        if (state.ui.serverSurvey?.running || state.ui.serverSurveyBatch?.running) {
          alert("지도조사가 진행 중입니다. 먼저 지도조사를 OFF 하세요.");
          return;
        }
        if (window.REALPOWER?.getState?.()?.running === true) {
          alert("Top100조사가 진행 중입니다. 먼저 Top100조사를 OFF 하세요.");
          return;
        }

        const serverIds = await resolveSurveyServerIds();

        if (!serverIds.length) {
          alert(lastServerListError
            ? `popular 서버목록을 읽지 못했습니다. 직접 서버번호를 입력하세요.

${lastServerListError}`
            : "서버번호를 입력하거나 popular 서버목록을 확인하세요.");
          return;
        }

        const thiefUiSettings = selectedThiefUiSettings();

        runUnifiedFinderForServers(serverIds, { ...thiefUiSettings, githubUpload: true })
          .then(result => {
            console.log("[TopWar V2.11.1 UI] 도둑+도시보상 통합찾기 종료:", result);
            if (result?.ok === false && result?.reason) {
              console.error("[TopWar V2.11.1 UI] 통합찾기 실패 원인:", result.reason);
              alert(`도둑+도시보상 실행 실패\n\n${result.reason}`);
            }
            render();
          })
          .catch(error => {
            state.watch133.running = false;
            state.watch133.lastUnifiedError = error?.message || String(error);
            console.error("[TopWar V2.11.1 UI] 도둑+도시보상 통합찾기 오류:", error);
            alert(`도둑+도시보상 오류\n\n${error?.message || String(error)}`);
            render();
          });
      }

      render();
    });

    surveyButton.addEventListener("click", async event => {
      event.stopPropagation();
      saveGithubTokenFromUi();

      if (state.ui.serverSurvey?.running || state.ui.serverSurveyBatch?.running) {
        requestStopServerSurvey();
      } else {
        if (state.connectionGuard?.disconnected) { alert("서버 연결 실패 상태입니다. 게임 연결을 복구한 뒤 연결상태 초기화를 눌러주세요."); return; }
        if (state.watch133?.running) {
          alert("도둑+도시보상 통합찾기가 진행 중입니다. 먼저 OFF 하세요.");
          return;
        }
        if (window.REALPOWER?.getState?.()?.running === true) {
          alert("Top100조사가 진행 중입니다. 먼저 Top100조사를 OFF 하세요.");
          return;
        }

        const serverIds = await resolveSurveyServerIds();

        if (!serverIds.length) {
          alert(lastServerListError
            ? `GitHub 서버목록을 읽지 못했습니다. 직접 서버번호를 입력하세요.

${lastServerListError}`
            : "서버번호를 입력하거나 GitHub 서버목록을 확인하세요.");
          return;
        }

        const topwarApi = window.TOPWAR || TOPWAR;

        const surveyRunner =
          topwarApi?.runMultiServerSurvey ||
          runMultiServerSurvey;

        if (typeof surveyRunner !== "function") {
          console.error("[TopWar V2.7 UI] runMultiServerSurvey 함수를 찾지 못했습니다.", {
            windowTopwar: window.TOPWAR,
            localTopwar: TOPWAR
          });
          alert("서버조사 실행 함수를 찾지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.");
          return;
        }

        const includeRewards = surveyButton.dataset.includeRewards === "true";
        delete surveyButton.dataset.includeRewards;
        surveyRunner.call(topwarApi || null, {
          serverIds,
          includeRewards,
          integratedFinders: true,
          serverOrderMode: getServerOrderMode(),
          resumeFromSavedServer: false,
          repeatUntilStopped: true,
          popularFirst: false,
          resortByPopularityEachCycle: false,
          softResetAfterServer: false,
          // UI 자동실행은 실제 UID 서버이동 결과를 매 사이클마다 GitHub로 flush한다.
          trackActualInOut: true,
          flushCompactHistoryAfterEachCycle: true
        })
          .then(result => {
            console.log("[TopWar V2.7 UI] 반복 서버조사 종료:", result);
            if (result?.ok === false && !result?.stopped) {
              const firstError = result?.errors?.[0]?.result;
              const message = firstError?.error?.message || firstError?.reason || result?.reason || "알 수 없는 오류";
              alert(`지도조사 실패\n\n${message}`);
            }
            render();
          })
          .catch(error => {
            console.error("[TopWar V2.7 UI] 반복 서버조사 실패:", error);
            alert(`지도조사 오류\n\n${error?.message || String(error)}`);
            render();
          });
      }

      render();
    });

    surveyRewardsButton.addEventListener("click", event => {
      event.stopPropagation();
      if (!(state.ui.serverSurvey?.running || state.ui.serverSurveyBatch?.running)) {
        surveyButton.dataset.includeRewards = "true";
      }
      surveyButton.click();
    });

    resetButton.addEventListener("click", event => {
      event.stopPropagation();

      if (state.ui.serverSurvey?.running || state.ui.serverSurveyBatch?.running) {
        alert("지도조사를 먼저 OFF 한 뒤 진행 위치를 초기화하세요.");
        return;
      }

      if (confirm("보상탐색 큐와 저장된 지도조사 진행 위치를 초기화할까요?\n\n초기화하지 않으면 다음 실행 시 저장된 서버부터 이어서 조사합니다.")) {
        TOPWAR.clearThiefQueue?.();
        TOPWAR.clearServerSurveyResume?.();
        render();
      }
    });

    saveButton.addEventListener("click", async event => {
      event.stopPropagation();

      const topwarApi = window.TOPWAR || TOPWAR;
      const exporter = topwarApi?.exportFinalLiteServerResult || exportFinalLiteServerResult;

      if (typeof exporter !== "function") {
        alert("저장 함수를 찾지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.");
        return;
      }

      await exporter.call(topwarApi || null, {
        serverId: inputServerId(),
        downloadJson: true,
        copyJsonToClipboard: false,
        pretty: true,
        rewriteStatePlayerMap: true
      });

      render();
    });

    reconnectButton.addEventListener("click", event => {
      event.stopPropagation();
      const failure = TOPWAR.findConnectionFailureText?.();
      const openSockets = TOPWAR.getOpenTopwarSockets?.()?.length ?? 0;
      if (failure) { alert("게임 화면에 연결 실패 메시지가 아직 남아 있습니다. 재접속 또는 새로고침 후 다시 시도하세요."); return; }
      if (openSockets <= 0) { alert("열린 게임 WebSocket이 없습니다. 게임을 재접속하거나 페이지를 새로고침하세요."); return; }
      TOPWAR.resetConnectionGuard?.();
      render();
    });

    connectionStatusButton.addEventListener("click", event => {
      event.stopPropagation();
      TOPWAR.connectionGuardStatus?.();
      render();
    });

    activityButton.addEventListener("click", event => {
      event.stopPropagation();
      activityPlayerTable(300);
      render();
    });

    allianceButton.addEventListener("click", event => {
      event.stopPropagation();
      allianceActivityTable(300);
      render();
    });

    thiefUploadTestButton?.addEventListener("click", async event => {
      event.stopPropagation();

      const topwarApi = window.TOPWAR || TOPWAR;
      const anyAutomationRunning = !!(
        state.watch133?.running ||
        state.ui?.serverSurvey?.running ||
        state.ui?.serverSurveyBatch?.running ||
        window.REALPOWER?.getState?.()?.running === true ||
        state.cityRewardFinder?.running
      );

      if (anyAutomationRunning) {
        alert("조사가 진행 중일 때는 업로드 테스트를 실행하지 않습니다. 진행 중인 조사를 먼저 중지하세요.");
        return;
      }

      if (typeof topwarApi?.testThiefGithubWrite !== "function") {
        alert("도둑 업로드 테스트 함수를 찾지 못했습니다. 페이지를 새로고침해 주세요.");
        return;
      }

      thiefUploadTestRunning = true;
      lastThiefUploadTest = null;
      render();

      try {
        const saved = await saveGithubTokenFromUi();
        if (!saved) throw new Error("조사기 ID와 API 키를 모두 입력하세요.");
        const result = await window.TOPWAR_DATAHUB.flushQueued(100);
        lastThiefUploadTest = {
          ok: true,
          ...result,
          testedAt: new Date().toISOString()
        };
        const settings = window.TOPWAR_DATAHUB.readSettings();
        alert(`DataHub 설정 저장 완료\n\n주소: ${settings.baseUrl}\n조사기: ${settings.scannerId}\n재전송: ${result.sent ?? 0}건`);
      } catch (error) {
        lastThiefUploadTest = {
          ok: false,
          testedAt: new Date().toISOString(),
          error: error?.message || String(error)
        };
        console.error("[TopWar UI] DataHub 설정/재전송 오류:", error);
        alert(`DataHub 설정/재전송 오류\n\n${error?.message || String(error)}`);
      } finally {
        thiefUploadTestRunning = false;
        render();
      }
    });

    setInterval(render, 1000);
    render();

    // 패널 설치 직후 한 번 미리 읽어 둡니다. 실패해도 직접 입력 방식은 그대로 사용할 수 있습니다.
    setTimeout(() => {
      const topwarApi = window.TOPWAR || TOPWAR;
      topwarApi.loadRemoteServerIds?.({ maxAgeMs: 60 * 60 * 1000, debug: true })
        .then(() => render())
        .catch(error => {
          lastServerListError = error?.message || String(error);
          console.warn("[TopWar V2.9.1 UI] GitHub 서버목록 사전 로드 실패:", error?.errors || error);
          render();
        });
    }, 1200);

    console.log("[TopWar V2.6 UI] 통합 패널 설치 완료");
  }

  function bootUi() {
    if (document.body && TOPWAR.watchPointTypeAndNotify && TOPWAR.moveMapToStableUnified) {
      installUnifiedControlPanel();
      return;
    }

    let count = 0;

    const timer = setInterval(() => {
      count++;

      if (document.body && TOPWAR.watchPointTypeAndNotify && TOPWAR.moveMapToStableUnified) {
        clearInterval(timer);
        installUnifiedControlPanel();
      }

      if (count >= 80) {
        clearInterval(timer);
        console.error("[TopWar V2.6 UI] 통합 패널 설치 실패: TOPWAR 준비 시간 초과");
      }
    }, 500);
  }

  Object.assign(TOPWAR, {
    version: VERSION,
    __topwarCleanIntegratedV26: true,
    getDefaultWatchOptions,
    loadThiefUiSettings,
    saveThiefUiSettings,
    installUnifiedControlPanel
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootUi);
  } else {
    bootUi();
  }

  console.log("%c[TopWar Integrated Survey + UI V2.9.6] installed", "color:#00e676;font-weight:bold");
})();


/* ---------------------------------------------------------------------------
 * TopWar GitHub JSON Result Uploader
 * - 서버조사 JSON 결과를 GitHub 저장소에 자동 업로드
 * - 기존 스크립트 맨 마지막에 붙여 넣으세요.
 * - @grant none 유지 가능. GitHub token은 전용 localStorage 키에만 저장됩니다.
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  if (!window.TOPWAR) {
    console.error("[TopWar GitHub] TOPWAR 객체가 없습니다.");
    return;
  }

  const TOPWAR = window.TOPWAR;
  const STORAGE_KEY = "TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS";

  function getStoredSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const sharedToken = TOPWAR.getGithubToken?.() || "";
      if (sharedToken) settings.token = sharedToken;
      return settings;
    } catch {
      return { token: TOPWAR.getGithubToken?.() || "" };
    }
  }

  function saveStoredSettings(settings) {
    const token = String(settings?.token || TOPWAR.getGithubToken?.() || "").trim();
    if (settings?.token) TOPWAR.setGithubToken?.(settings.token);
    const { token: _discardToken, ...withoutToken } = settings || {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutToken));
    return { ...withoutToken, token };
  }

  function encodeGithubPath(path) {
    return String(path)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
  }

  function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";

    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }

    return btoa(binary);
  }

  function formatDateForPath(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const pad = n => String(n).padStart(2, "0");

    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate())
    ].join("-");
  }

  function formatTimestampForPath(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const pad = n => String(n).padStart(2, "0");

    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      "-",
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join("");
  }

  function buildGithubResultPath(data, options = {}) {
    const serverId = data?.serverId ?? options.serverId ?? TOPWAR.range?.()?.k ?? "unknown";
    const exportedAt = data?.exportedAt ?? new Date().toISOString();

    const date = formatDateForPath(exportedAt);
    const timestamp = formatTimestampForPath(exportedAt);

    const template =
      options.pathTemplate ||
      "topwar-results/server-{serverId}/{date}/topwar-server-{serverId}-{timestamp}.json";

    return template
      .replaceAll("{serverId}", String(serverId))
      .replaceAll("{date}", date)
      .replaceAll("{timestamp}", timestamp);
  }

  function buildGithubLatestPath(data, options = {}) {
    const serverId = data?.serverId ?? options.serverId ?? TOPWAR.range?.()?.k ?? "unknown";

    const template =
      options.latestPathTemplate ||
      "topwar-results/server-{serverId}/latest.json";

    return template.replaceAll("{serverId}", String(serverId));
  }

  async function githubRequest({ method, url, token, body }) {
    const res = await fetch(url, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const error = new Error(`[GitHub API ${res.status}] ${data?.message || res.statusText}`);
      error.status = res.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function uploadTextToGithubContents({
    token,
    owner,
    repo,
    branch = "main",
    path,
    content,
    message,
    knownSha = null
  }) {
    if (!token) throw new Error("GitHub token이 없습니다.");
    if (!owner) throw new Error("GitHub owner가 없습니다.");
    if (!repo) throw new Error("GitHub repo가 없습니다.");
    if (!path) throw new Error("GitHub 저장 path가 없습니다.");

    const encodedPath = encodeGithubPath(path);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;

    let sha = knownSha || null;

    if (!sha) {
      try {
        const current = await githubRequest({
          method: "GET",
          url: `${apiUrl}?ref=${encodeURIComponent(branch)}`,
          token
        });

        sha = current.sha;
      } catch (e) {
        if (!String(e.message).includes("404")) {
          throw e;
        }
      }
    }

    const body = {
      message,
      content: toBase64Utf8(content),
      branch
    };

    if (sha) {
      body.sha = sha;
    }

    try {
      return await githubRequest({ method: "PUT", url: apiUrl, token, body });
    } catch (error) {
      // 외부 갱신으로 SHA가 충돌한 경우에만 최신 SHA를 한 번 다시 읽는다.
      if (Number(error?.status) !== 409 || !sha) throw error;
      const current = await githubRequest({
        method: "GET",
        url: `${apiUrl}?ref=${encodeURIComponent(branch)}`,
        token
      });
      body.sha = current?.sha;
      return await githubRequest({ method: "PUT", url: apiUrl, token, body });
    }
  }

  async function uploadSurveyResultToGithub(data, options = {}) {
    if (state.watch133?.running === true) {
      return { ok: false, skipped: true, reason: "blocked during thief+cityReward finder" };
    }
    await TOPWAR.ensureGithubToken?.({ interactive: true });
    const settings = {
      ...getStoredSettings(),
      ...options
    };

    if (!settings.enabled) {
      console.log("[TopWar GitHub] 업로드 비활성화 상태입니다.");
      return {
        ok: false,
        skipped: true,
        reason: "github upload disabled"
      };
    }

    const path = buildGithubResultPath(data, settings);
    const content = settings.pretty === false
      ? JSON.stringify(data)
      : JSON.stringify(data, null, 2);

    const serverId = data?.serverId ?? settings.serverId ?? "unknown";
    const message = settings.message ||
      `Upload TopWar server ${serverId} result ${data?.exportedAt ?? new Date().toISOString()}`;

    const result = {
      ok: false,
      serverId,
      uploads: []
    };

    const mainUpload = await uploadTextToGithubContents({
      token: settings.token,
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch || "main",
      path,
      content,
      message
    });

    result.uploads.push({
      type: "history",
      path,
      htmlUrl: mainUpload?.content?.html_url ?? null,
      apiResult: mainUpload
    });

    if (settings.uploadLatest !== false) {
      const latestPath = buildGithubLatestPath(data, settings);

      const latestUpload = await uploadTextToGithubContents({
        token: settings.token,
        owner: settings.owner,
        repo: settings.repo,
        branch: settings.branch || "main",
        path: latestPath,
        content,
        message: `Update TopWar server ${serverId} latest result`
      });

      result.uploads.push({
        type: "latest",
        path: latestPath,
        htmlUrl: latestUpload?.content?.html_url ?? null,
        apiResult: latestUpload
      });
    }

    result.ok = true;

    console.log("[TopWar GitHub] 조사 결과 업로드 완료:", {
      serverId,
      uploads: result.uploads.map(x => ({
        type: x.type,
        path: x.path,
        htmlUrl: x.htmlUrl
      }))
    });

    return result;
  }

  async function configureGithubJsonUpload(settings = null) {
    const prev = getStoredSettings();

    if (!settings) {
      settings = {
        enabled: true,
        token: TOPWAR.getGithubToken?.() || prev.token || "",
        owner: prompt("GitHub owner / 계정명", prev.owner || "") || prev.owner || "",
        repo: prompt("GitHub repo / 저장소명", prev.repo || "") || prev.repo || "",
        branch: prompt("branch", prev.branch || "main") || prev.branch || "main",
        pathTemplate: prompt(
          "저장 경로 템플릿",
          prev.pathTemplate || "topwar-results/server-{serverId}/{date}/topwar-server-{serverId}-{timestamp}.json"
        ) || prev.pathTemplate || "topwar-results/server-{serverId}/{date}/topwar-server-{serverId}-{timestamp}.json",
        latestPathTemplate: prompt(
          "latest.json 경로 템플릿",
          prev.latestPathTemplate || "topwar-results/server-{serverId}/latest.json"
        ) || prev.latestPathTemplate || "topwar-results/server-{serverId}/latest.json",
        uploadLatest: true,
        pretty: true
      };
    } else {
      settings = {
        ...prev,
        ...settings,
        enabled: settings.enabled ?? true
      };
    }

    if (!settings.token) throw new Error("token이 필요합니다.");
    if (!settings.owner) throw new Error("owner가 필요합니다.");
    if (!settings.repo) throw new Error("repo가 필요합니다.");

    saveStoredSettings(settings);

    console.log("[TopWar GitHub] 설정 저장 완료:", {
      enabled: settings.enabled,
      owner: settings.owner,
      repo: settings.repo,
      branch: settings.branch,
      pathTemplate: settings.pathTemplate,
      latestPathTemplate: settings.latestPathTemplate,
      uploadLatest: settings.uploadLatest
    });

    return settings;
  }

  function disableGithubJsonUpload() {
    const settings = getStoredSettings();
    settings.enabled = false;
    saveStoredSettings(settings);
    console.warn("[TopWar GitHub] 자동 업로드 비활성화");
    return settings;
  }

  function githubJsonUploadStatus() {
    const settings = getStoredSettings();

    const safe = {
      ...settings,
      token: settings.token ? `${String(settings.token).slice(0, 8)}...` : ""
    };

    console.log("[TopWar GitHub] 설정:", safe);
    return safe;
  }

  Object.assign(TOPWAR, {
    configureGithubJsonUpload,
    disableGithubJsonUpload,
    githubJsonUploadStatus,
    uploadSurveyResultToGithub,
    uploadTextToGithubContents
  });


  console.log("[TopWar GitHub] JSON result uploader installed");
})();

/* ---------------------------------------------------------------------------
 * TopWar Thief GitHub Uploader V2
 * - GitHub token은 통합 설정의 단일 token을 사용한다.
 * - 저장소: hiphop5782/topwar-thief
 * - CityReward와 동일하게 하나의 data/thieves.json 파일을 사용한다.
 * - 서버 스캔이 정상 완료되면 해당 서버의 기존 locations만 현재 관측값으로 교체한다.
 * - 다른 서버의 locations는 그대로 유지한다.
 * ------------------------------------------------------------------------- */
(function installThiefGithubUploader() {
  "use strict";

  const TOPWAR = window.TOPWAR;
  if (!TOPWAR || TOPWAR.__thiefGithubUploaderInstalled) return;
  const state = TOPWAR.state;

  const GITHUB = Object.freeze({
    owner: "hiphop5782",
    repo: "topwar-thief",
    branch: "main",
    path: "data/thieves.json"
  });

  // 모든 서버가 같은 파일을 갱신하므로 서버별 체인이 아니라 단일 업로드 체인을 사용한다.
  // GET -> merge -> PUT 순서를 직렬화하여 서로 다른 서버의 갱신이 덮어쓰는 것을 방지한다.
  let uploadChain = Promise.resolve();

  // GitHub에 남아 있는 도둑 위치는 마지막 관측 시각 기준 20분까지만 유효하다.
  const THIEF_TTL_MS = 20 * 60 * 1000;

  function thiefTimestampMs(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return value < 1000000000000 ? value * 1000 : value;
    }
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }

  function isFreshThiefLocation(row, nowMs = Date.now()) {
    if (!row) return false;
    const seenMs = thiefTimestampMs(
      row.foundAt ?? row.lastSeenAt ?? row.time ?? row.observedAt ?? row.scannedAt
    );

    // 과거 호환 데이터처럼 시각 정보 자체가 없는 행은 TTL 판정이 불가능하므로 유지한다.
    if (seenMs == null) return true;
    return nowMs - seenMs < THIEF_TTL_MS;
  }

  function decodeBase64Utf8(base64) {
    const binary = atob(String(base64 ?? "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function thiefLocationKey(row) {
    const serverId = Number(row?.serverId);
    if (row?.id != null) return `${serverId}:id:${row.id}`;
    if (row?.pointId != null) return `${serverId}:point:${row.pointId}`;
    return `${serverId}:coord:${row?.x}:${row?.y}`;
  }

  function normalizeThiefLocation(obj, targetServerId, observedAt = null) {
    const serverId = Number(obj?.serverId ?? targetServerId);
    if (!Number.isFinite(serverId) || serverId !== Number(targetServerId)) return null;

    const x = obj?.x ?? null;
    const y = obj?.y ?? null;
    if (x == null || y == null) return null;

    return {
      serverId,
      x,
      y,
      id: obj?.id ?? obj?.pointId ?? null,
      pointType: Number(obj?.pointType ?? 133),
      foundAt: obj?.time ?? obj?.lastSeenAt ?? observedAt ?? new Date().toISOString()
    };
  }

  function encodeBase64Utf8(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function parseThiefGithubDataFromBody(body) {
    try {
      const parsed = JSON.parse(decodeBase64Utf8(body?.content || "") || "{}");

      if (Array.isArray(parsed?.locations)) {
        return {
          version: Number(parsed.version || 1),
          updatedAt: parsed.updatedAt ?? null,
          count: parsed.locations.length,
          locations: parsed.locations
        };
      }

      // 혹시 단일 파일에 과거 thieves 배열이 존재하면 locations로 호환 변환한다.
      if (Array.isArray(parsed?.thieves)) {
        return {
          version: 1,
          updatedAt: parsed.updatedAt ?? null,
          count: parsed.thieves.length,
          locations: parsed.thieves
        };
      }
    } catch {}

    return { version: 1, updatedAt: null, count: 0, locations: [] };
  }

  async function fetchThiefGithubSnapshot(token) {
    const encodedPath = GITHUB.path.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${encodedPath}?ref=${encodeURIComponent(GITHUB.branch)}`;
    const stats = (state.thiefBuffer ??= { maxEvents: 512, events: [], nextEventId: 1, stats: {} }).stats ??= {};
    stats.githubGetAttempts = Number(stats.githubGetAttempts || 0) + 1;
    stats.lastGithubGetAt = new Date().toISOString();

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
    } catch (error) {
      stats.lastError = `GitHub GET network: ${error?.message || String(error)}`;
      throw error;
    }

    if (response.status === 404) {
      stats.githubGetSuccess = Number(stats.githubGetSuccess || 0) + 1;
      return {
        sha: null,
        data: { version: 1, updatedAt: null, count: 0, locations: [] }
      };
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      stats.lastError = `[GitHub GET ${response.status}] ${body?.message || response.statusText}`;
      const error = new Error(stats.lastError);
      error.status = response.status;
      error.data = body;
      throw error;
    }

    stats.githubGetSuccess = Number(stats.githubGetSuccess || 0) + 1;
    stats.lastError = null;
    return {
      sha: body?.sha ?? null,
      data: parseThiefGithubDataFromBody(body)
    };
  }

  async function putThiefGithubSnapshot(token, data, sha, message) {
    const encodedPath = GITHUB.path.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${encodedPath}`;
    const payload = {
      message,
      content: encodeBase64Utf8(JSON.stringify(data, null, 2)),
      branch: GITHUB.branch
    };
    const stats = (state.thiefBuffer ??= { maxEvents: 512, events: [], nextEventId: 1, stats: {} }).stats ??= {};
    stats.githubPutAttempts = Number(stats.githubPutAttempts || 0) + 1;
    stats.lastGithubPutAt = new Date().toISOString();

    if (sha) payload.sha = sha;

    let response;
    try {
      response = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      stats.lastError = `GitHub PUT network: ${error?.message || String(error)}`;
      throw error;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      stats.lastError = `[GitHub PUT ${response.status}] ${body?.message || response.statusText}`;
      const error = new Error(stats.lastError);
      error.status = response.status;
      error.data = body;
      throw error;
    }

    stats.githubPutSuccess = Number(stats.githubPutSuccess || 0) + 1;
    stats.lastError = null;
    return body;
  }

  async function commitThiefGithubMutation(token, buildMergedData, message, options = {}) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 5));
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 반드시 content와 sha를 같은 GET 응답에서 가져온다.
      // 그래야 이 content를 병합한 결과를 정확히 그 sha에 대해 PUT할 수 있다.
      const snapshot = await fetchThiefGithubSnapshot(token);
      const merged = buildMergedData(snapshot.data);

      try {
        const upload = await putThiefGithubSnapshot(
          token,
          merged,
          snapshot.sha,
          `${message}${attempt > 1 ? ` (retry ${attempt}/${maxAttempts})` : ""}`
        );

        return {
          ok: true,
          attempt,
          merged,
          upload
        };
      } catch (error) {
        lastError = error;

        // 다른 탭/PC/스크립트가 같은 thieves.json을 먼저 갱신하면 SHA가 바뀌어 409가 발생한다.
        // 최신 content+sha를 다시 읽고, 그 최신 데이터 위에 다시 병합한 뒤 재시도한다.
        const retryableConflict =
          error?.status === 409 ||
          (error?.status === 422 && /sha|does not match|update/i.test(String(error?.message || "")));

        if (!retryableConflict || attempt >= maxAttempts) throw error;

        const delay = Math.min(1600, 120 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 120);
        console.warn(`[TopWar Thief GitHub] ${error.status} 충돌 - 최신 SHA 재조회 후 재시도 ${attempt}/${maxAttempts}`, {
          delay,
          message: error?.message,
          data: error?.data
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error("thief github mutation failed");
  }

  async function loadExistingGithubData(token) {
    return (await fetchThiefGithubSnapshot(token)).data;
  }

  function mergeCompletedServer(existingData, serverResult) {
    const serverId = Number(serverResult?.serverId);
    const nowMs = Date.now();

    // 1) 방금 조사가 끝난 서버의 직전 데이터는 전부 제거한다.
    // 2) 다른 서버 데이터도 마지막 관측 후 20분이 지난 행은 제거한다.
    const untouched = (existingData?.locations || [])
      .filter(row => Number(row?.serverId) !== serverId)
      .filter(row => isFreshThiefLocation(row, nowMs));

    // 이번 서버는 직전 데이터와 병합하지 않고 이번 전체 조사 결과로 완전히 교체한다.
    // 같은 좌표/오브젝트가 중복 관측된 경우 마지막 값 하나만 유지한다.
    const currentMap = new Map();
    for (const row of serverResult?.locations || []) {
      if (Number(row?.serverId) !== serverId) continue;
      if (!isFreshThiefLocation(row, nowMs)) continue;
      currentMap.set(thiefLocationKey(row), row);
    }

    const locations = [...untouched, ...currentMap.values()]
      .sort((a, b) =>
        Number(a?.serverId ?? 0) - Number(b?.serverId ?? 0) ||
        Number(a?.x ?? 0) - Number(b?.x ?? 0) ||
        Number(a?.y ?? 0) - Number(b?.y ?? 0)
      );

    return {
      version: 1,
      updatedAt: new Date(nowMs).toISOString(),
      count: locations.length,
      locations
    };
  }

  function mergeDetectedThieves(existingData, targetServerId, detectedRows, progress = null) {
    const serverId = Number(targetServerId);
    const nowMs = Date.now();
    const mergedMap = new Map();
    const detectedMap = new Map();

    for (const row of detectedRows || []) {
      if (Number(row?.serverId) !== serverId) continue;
      if (!isFreshThiefLocation(row, nowMs)) continue;
      detectedMap.set(thiefLocationKey(row), row);
    }

    const scanXs = Array.isArray(progress?.scanXs)
      ? progress.scanXs.map(Number).filter(Number.isFinite)
      : [];
    const scanYs = Array.isArray(progress?.scanYs)
      ? progress.scanYs.map(Number).filter(Number.isFinite)
      : [];
    const confirmedCells = new Set(
      Array.isArray(progress?.confirmedScanCells)
        ? progress.confirmedScanCells.map(String)
        : []
    );

    function nearestValue(value, values) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || !values.length) return null;
      let nearest = values[0];
      let distance = Math.abs(numeric - nearest);
      for (let i = 1; i < values.length; i++) {
        const nextDistance = Math.abs(numeric - values[i]);
        if (nextDistance < distance) {
          nearest = values[i];
          distance = nextDistance;
        }
      }
      return nearest;
    }

    function belongsToConfirmedCell(row) {
      if (Number(row?.serverId) !== serverId) return false;
      if (!scanXs.length || !scanYs.length || !confirmedCells.size) return false;
      const cellX = nearestValue(row?.x, scanXs);
      const cellY = nearestValue(row?.y, scanYs);
      if (cellX == null || cellY == null) return false;
      return confirmedCells.has(`${Number(cellX)}:${Number(cellY)}`);
    }

    let removedConfirmedMissing = 0;

    // 다른 서버와 아직 방문하지 않은 영역은 그대로 보존한다.
    // 현재 서버에서 실제 네트워크 901로 확인 완료된 셀에 속하는 기존 좌표만
    // 이번 회차 detectedMap과 대조해서 사라진 도둑을 점진적으로 제거한다.
    for (const row of existingData?.locations || []) {
      if (!isFreshThiefLocation(row, nowMs)) continue;

      const key = thiefLocationKey(row);
      if (belongsToConfirmedCell(row) && !detectedMap.has(key)) {
        removedConfirmedMissing++;
        continue;
      }

      mergedMap.set(key, row);
    }

    // 이번 회차에서 시작점부터 현재까지 실제 네트워크로 발견한 도둑은 모두 upsert한다.
    for (const [key, row] of detectedMap) {
      mergedMap.set(key, row);
    }

    const locations = [...mergedMap.values()].sort((a, b) =>
      Number(a?.serverId ?? 0) - Number(b?.serverId ?? 0) ||
      Number(a?.x ?? 0) - Number(b?.x ?? 0) ||
      Number(a?.y ?? 0) - Number(b?.y ?? 0)
    );

    return {
      version: 1,
      updatedAt: new Date(nowMs).toISOString(),
      count: locations.length,
      locations,
      removedConfirmedMissing
    };
  }

  async function uploadDetectedThievesNow(targetServerId, objects, meta = {}) {
    const serverId = Number(targetServerId);
    if (!Number.isFinite(serverId) || serverId <= 0) {
      return { ok: false, skipped: true, reason: "invalid serverId" };
    }

    const observedAt = meta.detectedAt ?? new Date().toISOString();
    const detected = (Array.isArray(objects) ? objects : [])
      .map(obj => normalizeThiefLocation(obj, serverId, observedAt))
      .filter(Boolean);

    const confirmedCellCount = Array.isArray(meta?.scanProgress?.confirmedScanCells)
      ? meta.scanProgress.confirmedScanCells.length
      : 0;

    if (!detected.length && confirmedCellCount === 0) {
      return { ok: true, skipped: true, serverId, detected: 0, reason: "no new thieves" };
    }

    const upload = await window.TOPWAR_DATAHUB.uploadThieves({
      version: 1,
      serverId,
      detectedAt: observedAt,
      count: detected.length,
      locations: detected,
      scanProgress: meta.scanProgress ?? null
    });

    return {
      ...upload,
      mode: "datahub-live-detection",
      serverId,
      detected: detected.length,
      newDetected: Number(meta?.newDetectedCount ?? 0),
      confirmedCells: Array.isArray(meta?.scanProgress?.confirmedScanCells)
        ? meta.scanProgress.confirmedScanCells.length
        : 0,
      moveIndex: Number(meta?.scanProgress?.moveIndex ?? 0),
      totalMoves: Number(meta?.scanProgress?.totalMoves ?? 0)
    };
  }

  function uploadDetectedThieves(targetServerId, objects, meta = {}) {
    // 전체 스냅샷 업로드와 동일한 단일 체인을 사용해서 GET -> merge -> PUT 경합을 막는다.
    const next = uploadChain
      .catch(() => null)
      .then(() => uploadDetectedThievesNow(targetServerId, objects, meta));

    uploadChain = next;
    return next;
  }

  async function uploadCompletedServerNow(serverResult) {
    if (!serverResult?.completed || !serverResult?.ok) {
      return { ok: false, skipped: true, reason: "server scan not completed" };
    }

    const serverId = Number(serverResult?.serverId);
    if (!Number.isFinite(serverId) || serverId <= 0) {
      return { ok: false, skipped: true, reason: "invalid serverId" };
    }

    const upload = await window.TOPWAR_DATAHUB.uploadThieves({
      version: 1,
      serverId,
      scannedAt: serverResult.scannedAt || new Date().toISOString(),
      count: Array.isArray(serverResult.locations) ? serverResult.locations.length : 0,
      locations: Array.isArray(serverResult.locations) ? serverResult.locations : []
    });

    return {
      ...upload,
      serverId,
      found: serverResult.locations?.length ?? 0
    };
  }

  function uploadCompletedThiefServer(serverResult) {
    const next = uploadChain
      .catch(() => null)
      .then(() => uploadCompletedServerNow(serverResult));

    uploadChain = next;
    return next;
  }

  function buildCompletedThiefServerResult(serverId, objects, meta = {}) {
    const observedAt = new Date().toISOString();
    const locations = (Array.isArray(objects) ? objects : [])
      .map(obj => normalizeThiefLocation(obj, serverId, observedAt))
      .filter(Boolean);

    return {
      ok: meta.ok !== false,
      completed: meta.completed !== false,
      serverId: Number(serverId),
      cycle: meta.cycle ?? null,
      scannedAt: observedAt,
      count: locations.length,
      locations
    };
  }


  function thiefDiagnostics() {
    const buffer = state.thiefBuffer || {};
    const stats = buffer.stats || {};
    const result = {
      version: TOPWAR.state?.version ?? null,
      github: {
        ...GITHUB,
        tokenConfigured: !!TOPWAR.getGithubToken?.()
      },
      buffer: {
        size: buffer.events?.length ?? 0,
        maxEvents: buffer.maxEvents ?? 0,
        nextEventId: buffer.nextEventId ?? 1,
        lastEvents: (buffer.events || []).slice(-5).map(event => ({
          id: event.id,
          time: event.time,
          packetServerId: event.packetServerId,
          scanServerId: event.scanServerId,
          packetSeq: event.packetSeq,
          thiefCount: event.thiefCount,
          thieves: event.thieves
        }))
      },
      stats: { ...stats },
      lastGithubUpload: state.watch133?.lastGithubUpload ?? null,
      lastLiveThiefUpload: state.watch133?.lastLiveThiefUpload ?? null,
      currentScan: state.watch133?.current ?? null
    };
    console.log("[TopWar Thief Diagnostics]", result);
    return result;
  }

  async function testThiefGithubAccess(options = {}) {
    await TOPWAR.ensureGithubToken?.({ interactive: options.interactive !== false });
    const token = TOPWAR.getGithubToken?.() || "";
    if (!token) return { ok: false, reason: "github token is not configured", ...GITHUB };

    try {
      const snapshot = await fetchThiefGithubSnapshot(token);
      const result = {
        ok: true,
        mode: "read-test",
        ...GITHUB,
        sha: snapshot.sha,
        count: snapshot.data?.locations?.length ?? 0,
        updatedAt: snapshot.data?.updatedAt ?? null
      };
      console.log("[TopWar Thief GitHub] GET 테스트 성공:", result);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        mode: "read-test",
        ...GITHUB,
        error: error?.message || String(error),
        status: error?.status ?? null
      };
      console.error("[TopWar Thief GitHub] GET 테스트 실패:", result);
      return result;
    }
  }

  async function testThiefGithubWrite(options = {}) {
    await TOPWAR.ensureGithubToken?.({ interactive: options.interactive !== false });
    const token = TOPWAR.getGithubToken?.() || "";
    if (!token) return { ok: false, reason: "github token is not configured", ...GITHUB };

    try {
      const snapshot = await fetchThiefGithubSnapshot(token);
      const data = {
        ...snapshot.data,
        version: Number(snapshot.data?.version || 1),
        updatedAt: new Date().toISOString(),
        count: Array.isArray(snapshot.data?.locations) ? snapshot.data.locations.length : 0,
        locations: Array.isArray(snapshot.data?.locations) ? snapshot.data.locations : []
      };
      const upload = await putThiefGithubSnapshot(
        token,
        data,
        snapshot.sha,
        `Verify thief uploader ${new Date().toISOString()}`
      );
      const result = {
        ok: true,
        mode: "write-test",
        ...GITHUB,
        count: data.locations.length,
        htmlUrl: upload?.content?.html_url ?? null
      };
      console.log("[TopWar Thief GitHub] PUT 테스트 성공:", result);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        mode: "write-test",
        ...GITHUB,
        error: error?.message || String(error),
        status: error?.status ?? null
      };
      console.error("[TopWar Thief GitHub] PUT 테스트 실패:", result);
      return result;
    }
  }

  Object.assign(TOPWAR, {
    __thiefGithubUploaderInstalled: true,
    buildCompletedThiefServerResult,
    uploadDetectedThieves,
    uploadCompletedThiefServer,
    thiefDiagnostics,
    testThiefGithubAccess,
    testThiefGithubWrite,
    thiefTtlMs: THIEF_TTL_MS,
    thiefGithubSettings: () => ({
      ...GITHUB,
      tokenConfigured: !!TOPWAR.getGithubToken?.()
    })
  });

  console.log("%c[TopWar Thief GitHub Uploader V2.2 Progressive] installed", "color:#ff8a80;font-weight:bold");
})();

/* ---------------------------------------------------------------------------
 * TopWar V2.8 Clean Runtime Integration
 * - 도둑 상세창의 현재 라운드 감지
 * - 서버별 1회 조사 → GitHub 업로드 → Soft Reset
 * - 반복 조사와 Soft Reset을 하나의 runMultiServerSurvey 래퍼로 통합
 * - 이전 Soft Reset Add-on / Each Server Hotfix는 포함하지 않음
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  const TOPWAR = window.TOPWAR;

  if (!TOPWAR) {
    console.error("[TopWar V2.8 Runtime] TOPWAR 객체가 없습니다.");
    return;
  }

  if (TOPWAR.__v28CleanRuntimeInstalled) {
    console.warn("[TopWar V2.8 Runtime] 이미 설치되어 있습니다.");
    return;
  }

  const state = TOPWAR.state;
  const originalRunMultiServerSurvey = TOPWAR.runMultiServerSurvey.bind(TOPWAR);
  const originalShareCrossTreasureTo = TOPWAR.shareCrossTreasureTo.bind(TOPWAR);

  function sleep(ms) {
    return TOPWAR.sleep(Math.max(0, Number(ms) || 0));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  const SERVER_POPULARITY_CACHE_KEY = "TOPWAR_SERVER_POPULARITY_CACHE_V1";
  const SERVER_SURVEY_RESUME_KEY = "TOPWAR_SERVER_SURVEY_RESUME_V1";

  // 재개 정보에는 서버 목록이나 실행 옵션 전체를 절대 저장하지 않습니다.
  // 현재 서버는 새로 불러온 서버 목록에서 다시 찾을 수 있으므로 작은 포인터만 있으면 충분합니다.
  function compactServerSurveyResume(value = {}) {
    const numberOrNull = input => {
      const number = Number(input);
      return Number.isFinite(number) ? number : null;
    };

    return {
      version: 2,
      status: value.status ? String(value.status) : "running",
      mode: value.mode ? String(value.mode) : null,
      cycle: numberOrNull(value.cycle),
      currentIndex: numberOrNull(value.currentIndex),
      currentServerId: numberOrNull(value.currentServerId ?? value.serverId),
      lastCompletedServerId: numberOrNull(value.lastCompletedServerId),
      lastCompletedAt: value.lastCompletedAt ? String(value.lastCompletedAt) : null,
      startedAt: value.startedAt ? String(value.startedAt) : null,
      updatedAt: nowIso()
    };
  }

  function parseServerSurveyResumeRaw(raw, storageName) {
    if (raw == null || raw === "") return null;

    try {
      const parsed = JSON.parse(raw);

      // 용량 부족 시 저장하는 최소 포인터 형식: "3223" 또는 3223
      if (typeof parsed === "string" || typeof parsed === "number") {
        const serverId = Number(parsed);
        return Number.isFinite(serverId) && serverId > 0
          ? { version: 2, status: "running", currentServerId: serverId, storage: storageName, minimal: true }
          : null;
      }

      if (!parsed || typeof parsed !== "object") return null;

      const compact = compactServerSurveyResume(parsed);
      compact.updatedAt = parsed.updatedAt ?? compact.updatedAt;
      compact.storage = storageName;
      return compact;
    } catch {
      const serverId = Number(String(raw).trim());
      return Number.isFinite(serverId) && serverId > 0
        ? { version: 2, status: "running", currentServerId: serverId, storage: storageName, minimal: true }
        : null;
    }
  }

  function readServerSurveyResume() {
    try {
      const localValue = parseServerSurveyResumeRaw(
        localStorage.getItem(SERVER_SURVEY_RESUME_KEY),
        "localStorage"
      );
      if (localValue) return localValue;
    } catch {}

    try {
      return parseServerSurveyResumeRaw(
        sessionStorage.getItem(SERVER_SURVEY_RESUME_KEY),
        "sessionStorage"
      );
    } catch {
      return null;
    }
  }

  function writeServerSurveyResume(value = {}) {
    const next = compactServerSurveyResume(value);
    const compactText = JSON.stringify(next);

    // 기존 버전이 저장한 큰 serverIds 배열을 먼저 제거한 뒤 작은 값으로 교체합니다.
    try {
      localStorage.removeItem(SERVER_SURVEY_RESUME_KEY);
      localStorage.setItem(SERVER_SURVEY_RESUME_KEY, compactText);
      try { sessionStorage.removeItem(SERVER_SURVEY_RESUME_KEY); } catch {}
      return { ...next, storage: "localStorage" };
    } catch (error) {
      // localStorage가 거의 가득 찬 경우 서버 번호 하나만이라도 남깁니다.
      try {
        const minimalServerId = Number(next.currentServerId);
        if (Number.isFinite(minimalServerId) && minimalServerId > 0) {
          localStorage.removeItem(SERVER_SURVEY_RESUME_KEY);
          localStorage.setItem(SERVER_SURVEY_RESUME_KEY, String(minimalServerId));
          console.warn("[TopWar V2.10.3] localStorage 용량 부족 - 현재 서버 번호만 최소 저장했습니다.", {
            currentServerId: minimalServerId,
            error: error?.message ?? String(error)
          });
          return { ...next, storage: "localStorage", minimal: true };
        }
      } catch {}

      // 최후 폴백입니다. 같은 탭을 새로고침하는 동안에는 재개 위치가 유지됩니다.
      try {
        sessionStorage.setItem(SERVER_SURVEY_RESUME_KEY, compactText);
        console.warn("[TopWar V2.10.3] localStorage 저장 실패 - sessionStorage에 재개 위치를 저장했습니다.", {
          currentServerId: next.currentServerId,
          error: error?.message ?? String(error)
        });
        return { ...next, storage: "sessionStorage", storageError: error?.message ?? String(error) };
      } catch (fallbackError) {
        console.error("[TopWar V2.10.3] 서버조사 재개 위치 저장 실패:", {
          localStorageError: error?.message ?? String(error),
          sessionStorageError: fallbackError?.message ?? String(fallbackError)
        });
        return { ...next, storage: null, storageError: fallbackError?.message ?? String(fallbackError) };
      }
    }
  }

  function clearServerSurveyResume() {
    try { localStorage.removeItem(SERVER_SURVEY_RESUME_KEY); } catch {}
    try { sessionStorage.removeItem(SERVER_SURVEY_RESUME_KEY); } catch {}
    console.warn("[TopWar V2.10.3] 저장된 서버조사 진행 위치를 초기화했습니다.");
    return true;
  }

  function serverSurveyResumeStatus() {
    const value = readServerSurveyResume();
    console.log("[TopWar V2.10.2] 서버조사 재개 상태:", value);
    return value;
  }

  function readServerPopularityCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(SERVER_POPULARITY_CACHE_KEY) || "null");
      if (!cached || typeof cached !== "object") return { version: 1, updatedAt: null, stats: {} };
      if (!cached.stats || typeof cached.stats !== "object") cached.stats = {};
      return cached;
    } catch {
      return { version: 1, updatedAt: null, stats: {} };
    }
  }

  function writeServerPopularityCache(cache) {
    const normalized = {
      version: 1,
      updatedAt: nowIso(),
      stats: cache?.stats && typeof cache.stats === "object" ? cache.stats : {}
    };

    try {
      localStorage.setItem(SERVER_POPULARITY_CACHE_KEY, JSON.stringify(normalized));
    } catch {}

    state.serverPopularity = normalized;
    return normalized;
  }

  function getServerPopularityCache() {
    return state.serverPopularity || readServerPopularityCache();
  }

  function extractSurveyPeopleCount(result) {
    const summary = result?.summary ?? result?.data?.summary ?? result?.result?.summary ?? null;
    const candidates = [
      summary?.players,
      summary?.mapPlayers,
      summary?.totalPlayers,
      result?.players,
      result?.count
    ];

    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }

    return null;
  }

  function updateServerPopularityFromSurvey(serverId, result, meta = {}) {
    const id = Number(serverId ?? result?.serverId ?? result?.data?.serverId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const peopleCount = extractSurveyPeopleCount(result);
    if (peopleCount == null) return null;

    const cache = readServerPopularityCache();
    cache.stats[String(id)] = {
      serverId: id,
      peopleCount,
      lastSurveyAt: nowIso(),
      cycle: meta.cycle ?? null,
      ok: !!result?.ok,
      serverActivityGrade: result?.summary?.serverActivity?.grade ?? result?.data?.summary?.serverActivity?.grade ?? null,
      serverActivityScore: result?.summary?.serverActivity?.score ?? result?.data?.summary?.serverActivity?.score ?? null
    };

    const saved = writeServerPopularityCache(cache);

    console.log("[TopWar V2.8] 서버 인기 기준 업데이트:", saved.stats[String(id)]);
    return saved.stats[String(id)];
  }

  function sortServerIdsByPopularity(serverIds, options = {}) {
    const ids = parseServerIds(serverIds);
    if (options.enabled === false || !ids.length) return ids;

    const cache = getServerPopularityCache();
    const stats = cache?.stats || {};
    const originalIndex = new Map(ids.map((id, index) => [String(id), index]));

    return ids.slice().sort((a, b) => {
      const sa = stats[String(a)] || null;
      const sb = stats[String(b)] || null;
      const hasA = sa?.peopleCount != null;
      const hasB = sb?.peopleCount != null;

      // 조사 이력이 있는 서버를 먼저 둔다. 둘 다 없으면 기존 순서를 유지한다.
      if (hasA !== hasB) return hasA ? -1 : 1;

      const countDiff = Number(sb?.peopleCount ?? -1) - Number(sa?.peopleCount ?? -1);
      if (countDiff) return countDiff;

      const timeDiff = Date.parse(sb?.lastSurveyAt || 0) - Date.parse(sa?.lastSurveyAt || 0);
      if (timeDiff) return timeDiff;

      return (originalIndex.get(String(a)) ?? 0) - (originalIndex.get(String(b)) ?? 0);
    });
  }

  function serverPopularityStatus(serverIds = null) {
    const cache = getServerPopularityCache();
    const ids = serverIds == null ? Object.keys(cache?.stats || {}).map(Number) : parseServerIds(serverIds);
    const rows = ids
      .map(serverId => cache?.stats?.[String(serverId)] || { serverId, peopleCount: null, lastSurveyAt: null })
      .sort((a, b) =>
        Number(b.peopleCount ?? -1) - Number(a.peopleCount ?? -1) ||
        Date.parse(b.lastSurveyAt || 0) - Date.parse(a.lastSurveyAt || 0) ||
        Number(a.serverId) - Number(b.serverId)
      );

    window.TOPWAR_LOG_CONTROL.table(rows.map((row, index) => ({
      rank: index + 1,
      serverId: row.serverId,
      peopleCount: row.peopleCount,
      lastSurveyAt: row.lastSurveyAt,
      cycle: row.cycle,
      grade: row.serverActivityGrade,
      score: row.serverActivityScore
    })));

    return { cache, rows };
  }

  function clearServerPopularityCache() {
    const empty = { version: 1, updatedAt: nowIso(), stats: {} };
    try {
      localStorage.removeItem(SERVER_POPULARITY_CACHE_KEY);
    } catch {}
    state.serverPopularity = empty;
    console.warn("[TopWar V2.8] 서버 인기 기준 캐시 초기화");
    return empty;
  }

  function normalizeToken(value) {
    return String(value ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, "")
      .replace(/[^\w가-힣一-龥ぁ-んァ-ン]/g, "")
      .toLowerCase();
  }

  function parseServerIds(value) {
    const values = Array.isArray(value)
      ? value
      : String(value ?? "").split(/[\s,，、/|]+/);

    return [...new Set(
      values
        .map(item => Number(String(item).trim()))
        .filter(item => Number.isFinite(item) && item > 0)
    )];
  }

  function shouldStop() {
    return !!(
      state.connectionGuard?.disconnected ||
      state.fullScan?.stopRequested ||
      state.ui?.serverSurvey?.stopping ||
      state.ui?.serverSurveyBatch?.stopping
    );
  }

  async function waitInterruptible(totalMs, intervalMs = 500) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < totalMs) {
      if (shouldStop()) return false;
      await sleep(Math.min(intervalMs, totalMs - (Date.now() - startedAt)));
    }

    return true;
  }

  /* -------------------------- 도둑 라운드 감지 -------------------------- */

  function collectCrossTreasureTextEntries() {
    const popup = TOPWAR.findCrossTreasurePopup?.();
    if (!popup) return [];

    const rows = [];

    (function walk(node, path = node.name, depth = 0) {
      if (!node || depth > 30) return;

      for (const componentType of ["Label", "RichText"]) {
        try {
          const component = node.getComponent?.(cc[componentType]);
          const text = String(component?.string ?? "")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          if (text) rows.push({ componentType, text, nodeName: node.name, path });
        } catch {}
      }

      for (const child of node.children || []) {
        walk(child, `${path}/${child.name}`, depth + 1);
      }
    })(popup);

    return rows;
  }

  function parseRoundText(text) {
    const patterns = [
      /(?:현재\s*)?(?:라운드|웨이브|단계)\s*[:：]?\s*(\d+)(?:\s*[/／]\s*(\d+))?/i,
      /(?:current\s*)?(?:round|wave|stage)\s*[:：]?\s*(\d+)(?:\s*[/／]\s*(\d+))?/i,
      /(?:第\s*)?(\d+)\s*(?:ラウンド|ウェーブ|段階)/i,
      /(?:第\s*)?(\d+)\s*(?:回合|轮|波|阶段)/i
    ];

    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      if (!match) continue;

      const currentRound = Number(match[1]);
      const totalRound = match[2] ? Number(match[2]) : null;

      if (!Number.isFinite(currentRound) || currentRound < 0 || currentRound > 999) continue;
      if (totalRound != null && (!Number.isFinite(totalRound) || totalRound < currentRound || totalRound > 999)) continue;

      return { currentRound, totalRound };
    }

    return null;
  }

  function detectCrossTreasureRound(options = {}) {
    const entries = collectCrossTreasureTextEntries();

    for (const entry of entries) {
      const parsed = parseRoundText(entry.text);
      if (!parsed) continue;

      const data = {
        ...parsed,
        roundText: entry.text,
        roundSource: "popup-text",
        roundDetectedAt: nowIso()
      };

      const lastThief = TOPWAR.lastThief?.();
      const foundObject = state.watch133?.lastFound;

      if (lastThief) {
        Object.assign(lastThief, data);
        if (lastThief.object) Object.assign(lastThief.object, data);
      }

      if (foundObject) Object.assign(foundObject, data);

      state.crossTreasureRound = { ...data, entry };

      console.log("[TopWar V2.8] 도둑 라운드 감지:", {
        ...data,
        x: lastThief?.x ?? foundObject?.x,
        y: lastThief?.y ?? foundObject?.y
      });

      return { ok: true, ...data, entry };
    }

    if (options.log !== false) {
      console.warn("[TopWar V2.8] 상세창에서 라운드 문구를 찾지 못했습니다.");
      window.TOPWAR_LOG_CONTROL.table(entries);
    }

    return { ok: false, reason: "round text not found", entries };
  }

  TOPWAR.shareCrossTreasureTo = async function shareCrossTreasureToWithRound(
    channel = "길드",
    options = {}
  ) {
    await sleep(options.roundReadDelay ?? 120);

    const roundResult = detectCrossTreasureRound({
      log: options.roundLog ?? false
    });

    const shareResult = await originalShareCrossTreasureTo(channel, options);

    return {
      ...shareResult,
      roundResult
    };
  };

  function crossTreasureRoundStatus() {
    const status = {
      popupOpen: !!TOPWAR.findCrossTreasurePopup?.(),
      lastRound: state.crossTreasureRound ?? null,
      lastThief: TOPWAR.lastThief?.() ?? null
    };

    console.log("[TopWar V2.8] round status:", status);
    return status;
  }

  /* ------------------------------ Soft Reset ----------------------------- */

  function getSceneButtons() {
    if (!window.cc?.director) return [];

    const scene = cc.director.getScene();
    const rows = TOPWAR.listButtonsUnderNode?.(scene, { maxDepth: 80 }) || [];

    return rows.map(row => ({
      ...row,
      normalized: normalizeToken(`${row.nodeName} ${row.path} ${row.text}`),
      x: row.worldPosition?.x ?? 0,
      y: row.worldPosition?.y ?? 0
    }));
  }

  function pickButton(scoreFunction, minimumScore = 80, debug = false) {
    const rows = getSceneButtons()
      .map(row => ({ ...row, score: scoreFunction(row) }))
      .sort((a, b) => b.score - a.score);

    if (debug) {
      window.TOPWAR_LOG_CONTROL.table(rows.slice(0, 20).map((row, index) => ({
        index,
        score: row.score,
        nodeName: row.nodeName,
        text: row.text,
        x: row.x,
        y: row.y,
        path: row.path
      })));
    }

    return {
      ok: !!rows.find(row => row.score >= minimumScore),
      target: rows.find(row => row.score >= minimumScore) || null,
      candidates: rows.slice(0, 10)
    };
  }

  function scoreBaseButton(row) {
    const value = row.normalized;
    let score = 0;

    if (value.includes("btnhome")) score += 180;
    if (value.includes("gohome")) score += 180;
    if (value.includes("returnbase")) score += 150;
    if (value.includes("backhome")) score += 150;
    if (value.includes("maincity")) score += 140;
    if (value.includes("home")) score += 100;
    if (value.includes("base")) score += 80;
    if (value.includes("city")) score += 50;
    if (value.includes("기지")) score += 100;
    if (value.includes("홈")) score += 70;

    if (value.includes("close") || value.includes("닫기")) score -= 200;
    if (value.includes("share") || value.includes("chat")) score -= 160;
    if (value.includes("alliance") || value.includes("guild")) score -= 100;
    if (value.includes("popup") || value.includes("panel")) score -= 40;

    return score;
  }

  function scoreWorldButton(row) {
    const value = row.normalized;
    let score = 0;

    if (value.includes("worldmap")) score += 190;
    if (value.includes("btnworld")) score += 170;
    if (value.includes("btnmap")) score += 150;
    if (value.includes("mapbtn")) score += 140;
    if (value.includes("nworld")) score += 130;
    if (value.includes("월드맵")) score += 180;
    if (value.includes("월드")) score += 110;
    if (value.includes("지도")) score += 90;
    if (value.includes("world")) score += 70;
    if (value.includes("map")) score += 60;

    if (value.includes("chat") || value.includes("worldchat")) score -= 240;
    if (value.includes("share")) score -= 160;
    if (value.includes("close") || value.includes("닫기")) score -= 180;
    if (value.includes("alliance") || value.includes("guild")) score -= 100;
    if (value.includes("popup") || value.includes("panel")) score -= 30;

    return score;
  }

  async function closeVisiblePopups(options = {}) {
    const closed = [];
    const maxRounds = Number(options.maxRounds ?? 4);

    for (let round = 0; round < maxRounds; round++) {
      const target = getSceneButtons()
        .map(row => {
          let score = 0;
          const value = row.normalized;

          if (value.includes("btnclose")) score += 220;
          if (value.includes("close")) score += 130;
          if (value.includes("닫기")) score += 130;
          if (value.includes("popup") || value.includes("poplayer")) score += 30;
          if (value.includes("share") || value.includes("favorite")) score -= 120;

          return { ...row, score };
        })
        .filter(row => row.score >= 120)
        .sort((a, b) => b.score - a.score)[0];

      if (!target) break;

      const clicked = TOPWAR.triggerCocosButtonSafe?.(target.node) ?? false;
      closed.push({ clicked, nodeName: target.nodeName, path: target.path });
      await sleep(options.delay ?? 250);
    }

    return { ok: true, closed };
  }

  function isWorldMapReady() {
    try {
      return !!(TOPWAR.mapCtrl?.() && TOPWAR.range?.()?.k != null);
    } catch {
      return false;
    }
  }

  async function waitWorldMapReady(options = {}) {
    const timeout = Number(options.timeout ?? 12000);
    const interval = Number(options.interval ?? 300);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      if (isWorldMapReady()) return { ok: true, waitedMs: Date.now() - startedAt };
      if (shouldStop()) return { ok: false, stopped: true, reason: "manual stop" };
      await sleep(interval);
    }

    return { ok: false, reason: "world map not ready", waitedMs: Date.now() - startedAt };
  }

  async function goBaseInterior(options = {}) {
    await closeVisiblePopups({
      maxRounds: options.closePopupRounds ?? 3,
      delay: options.closePopupDelay ?? 250
    });

    const picked = pickButton(scoreBaseButton, options.minScore ?? 80, !!options.debug);

    if (!picked.target) {
      return { ok: false, reason: "go base button not found", candidates: picked.candidates };
    }

    const clicked = TOPWAR.triggerCocosButtonSafe?.(picked.target.node) ?? false;
    await sleep(options.afterClickDelay ?? 2500);

    return {
      ok: clicked,
      target: {
        score: picked.target.score,
        nodeName: picked.target.nodeName,
        text: picked.target.text,
        path: picked.target.path
      }
    };
  }

  async function goWorldMapFromBase(options = {}) {
    const attempts = [];
    const maxAttempts = Math.max(1, Number(options.worldReturnAttempts ?? 3));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await closeVisiblePopups({
        maxRounds: options.closePopupRounds ?? 3,
        delay: options.closePopupDelay ?? 300
      });

      const picked = pickButton(scoreWorldButton, options.minScore ?? 80, !!options.debug);
      let clicked = false;

      if (picked.target) {
        clicked = TOPWAR.triggerCocosButtonSafe?.(picked.target.node) ?? false;
      } else {
        // 의미 기반 버튼을 찾지 못한 경우 기존 조사에서 사용하던 좌하단 전환 위치를 보조로 사용한다.
        clicked = TOPWAR.clickCanvasRatio?.(0.1, 0.9) ?? false;
      }

      // mapCtrl은 기지 화면에서도 잠시 살아 있을 수 있으므로 클릭 직후 판정하지 않는다.
      await sleep(Number(options.worldTransitionSettleMs ?? 2500));

      const waitResult = await waitWorldMapReady({
        timeout: options.waitWorldTimeout ?? 12000,
        interval: options.waitWorldInterval ?? 300
      });
      const worldButtonStillVisible = !!pickButton(scoreWorldButton, options.minScore ?? 80, false).target;
      const row = {
        attempt,
        clicked,
        waitResult,
        worldButtonStillVisible,
        target: picked.target ? {
          score: picked.target.score,
          nodeName: picked.target.nodeName,
          text: picked.target.text,
          path: picked.target.path
        } : null
      };
      attempts.push(row);

      // 월드맵 컨트롤러가 준비되고 기지의 '월드맵' 전환 버튼이 사라져야 성공이다.
      if (clicked && waitResult.ok && !worldButtonStillVisible) {
        await sleep(Number(options.afterWorldConfirmedDelay ?? 1200));
        return { ok: true, ...row, attempts };
      }

      await sleep(Number(options.worldReturnRetryDelay ?? 1000));
    }

    return { ok: false, reason: "world map transition not confirmed", attempts };
  }

  async function performSoftMemoryReset(options = {}) {
    console.warn("[TopWar V2.8] Soft Reset 시작");

    TOPWAR.clearHeavySurveyData?.({
      packetLimit: options.packetBufferLimit ?? 20,
      outgoingLimit: options.outgoingBufferLimit ?? 10
    });

    const toBase = await goBaseInterior(options);

    if (!toBase.ok) {
      return { ok: false, stage: "goBase", toBase };
    }

    if (!(await waitInterruptible(options.baseStayDelay ?? 8000))) {
      return { ok: false, stopped: true, stage: "baseStay", toBase };
    }

    TOPWAR.clearHeavySurveyData?.({
      packetLimit: options.packetBufferLimit ?? 20,
      outgoingLimit: options.outgoingBufferLimit ?? 10
    });

      const toWorld = await goWorldMapFromBase(options);

    if (!toWorld.ok) {
      return { ok: false, stage: "goWorld", toBase, toWorld };
    }

    if (!(await waitInterruptible(options.afterWorldDelay ?? 4000))) {
      return { ok: false, stopped: true, stage: "afterWorld", toBase, toWorld };
    }

    TOPWAR.clearHeavySurveyData?.({
      packetLimit: options.packetBufferLimit ?? 20,
      outgoingLimit: options.outgoingBufferLimit ?? 10
    });

    const result = { ok: !!toBase.ok && !!toWorld.ok, toBase, toWorld };
    console.warn("[TopWar V2.8] Soft Reset 종료:", result);
    return result;
  }

  /* -------------------------- 반복 서버조사 통합 ------------------------- */

  function slimSurveyResult(serverId, result) {
    const row = Array.isArray(result?.results) ? result.results[0] : result;

    return {
      ok: !!row?.ok,
      stopped: !!row?.stopped,
      reason: row?.reason ?? result?.reason ?? null,
      serverId: row?.serverId ?? row?.data?.serverId ?? serverId,
      summary: row?.summary ?? row?.data?.summary ?? null,
      githubUpload: row?.githubUpload ?? row?.data?.githubUpload ?? null
    };
  }

  async function runOneServer(serverId, options) {
    if (shouldStop()) {
      return { ok: false, stopped: true, reason: "manual stop before server", serverId };
    }

    // 원본 함수의 중복 실행 방지 검사에 걸리지 않도록 호출 직전에만 해제합니다.
    if (state.ui?.serverSurveyBatch) {
      state.ui.serverSurveyBatch.running = false;
    }

    if (state.fullScan) {
      state.fullScan.running = false;
    }

    state.ui ??= {};
    state.ui.serverSurveyBatch ??= {};
    state.ui.serverSurveyBatch.current = {
      ...(state.ui.serverSurveyBatch.current || {}),
      phase: "serverTransition",
      serverId
    };

    // serverId를 조사 결과의 라벨로만 사용하지 않고 실제 월드맵 이동을 먼저 확정한다.
    const transition = await TOPWAR.moveMapToStableUnified(
      Number(options.serverTransitionX ?? 400),
      Number(options.serverTransitionY ?? 450),
      {
        serverId,
        subMap: options.subMap ?? 0,
        scale: options.scale ?? 0.27,
        afterMoveWait: options.serverTransitionAfterMoveWait ?? 400,
        wait901Timeout: options.serverTransition901Timeout ?? 3500,
        serverTransitionTimeout: options.serverTransitionTimeout ?? 5000,
        quietMs: options.quietMs ?? 300,
        maxRetries: options.serverTransitionRetries ?? 2,
        collectCache: false
      }
    );

    const actualServerId = TOPWAR.range?.()?.k ?? null;
    if (!transition?.ok || String(actualServerId ?? "") !== String(serverId)) {
      const reason = `목표 서버 이동 실패: expected=${serverId}, actual=${actualServerId ?? "unknown"}`;
      console.error("[TopWar V2.14.3]", reason, transition);
      return {
        ok: false,
        stopped: false,
        serverId,
        actualServerId,
        reason,
        transition
      };
    }

    console.log("[TopWar V2.14.3] 지도 서버 이동 확인:", {
      serverId,
      actualServerId
    });

    const result = await originalRunMultiServerSurvey({
      ...options,
      serverIds: [serverId],
      serverId,
      repeatUntilStopped: false,
      downloadJson: options.downloadJson ?? false,
      copyJsonToClipboard: options.copyJsonToClipboard ?? false,
      keepResultData: options.keepResultData ?? false,
      clearHeavyDataAfterExport: options.clearHeavyDataAfterExport ?? true,
      keepBatchHistory: 1,
      packetBufferLimit: options.packetBufferLimit ?? 20,
      outgoingBufferLimit: options.outgoingBufferLimit ?? 10
    });

    return slimSurveyResult(serverId, result);
  }

  TOPWAR.runMultiServerSurvey = async function runMultiServerSurveyClean(options = {}) {
    const normalizedOptions = Array.isArray(options)
      ? { serverIds: options }
      : { ...options };

    if (normalizedOptions.repeatUntilStopped !== true) {
      return originalRunMultiServerSurvey(normalizedOptions);
    }

    const rawServerIds =
      normalizedOptions.serverIds ??
      normalizedOptions.servers ??
      normalizedOptions.serverId;

    let serverIds = parseServerIds(rawServerIds);

    // 서버번호를 명시하지 않으면 기본적으로 GitHub 서버목록을 먼저 사용합니다.
    // 이전 버전은 useRemoteServerList:true 옵션이 있어야만 원격 목록을 읽어서 콘솔 실행 시 현재 서버 1개로 떨어지는 문제가 있었습니다.
    if (!serverIds.length && normalizedOptions.useRemoteServerList !== false) {
      try {
        serverIds = await TOPWAR.loadRemoteServerIds?.({
          force: normalizedOptions.forceRemoteServerList === true,
          maxAgeMs: normalizedOptions.remoteServerListMaxAgeMs ?? 60 * 60 * 1000,
          urls: normalizedOptions.remoteServerListUrls,
          debug: normalizedOptions.remoteServerListDebug ?? true
        }) ?? [];
      } catch (error) {
        console.error("[TopWar V2.9.1] GitHub 서버목록 로드 실패:", error?.errors || error);
      }
    }

    if (!serverIds.length) {
      return { ok: false, reason: "serverIds is required and popular server list is unavailable" };
    }

    state.fullScan ??= {};
    state.ui ??= {};
    state.ui.serverSurveyBatch ??= {};

    state.fullScan.stopRequested = false;
    state.ui.serverSurveyBatch.stopping = false;

    const popularFirst = normalizedOptions.popularFirst === true;
    const originalServerIds = serverIds.slice();
    serverIds = sortServerIdsByPopularity(serverIds, { enabled: popularFirst });

    if (popularFirst && serverIds.join(",") !== originalServerIds.join(",")) {
      console.log("[TopWar V2.8] 인기 서버 우선 정렬 적용:", {
        before: originalServerIds,
        after: serverIds,
        basis: "previous survey summary.players"
      });
    }

    const savedResume = normalizedOptions.resumeFromSavedServer === false
      ? null
      : readServerSurveyResume();
    const savedServerId = savedResume?.currentServerId ?? savedResume?.serverId ?? null;
    const savedIndex = savedServerId == null
      ? -1
      : serverIds.findIndex(serverId => String(serverId) === String(savedServerId));
    const firstCycleStartIndex = savedIndex >= 0 ? savedIndex : 0;

    if (savedIndex >= 0) {
      console.log("[TopWar V2.10.3] 저장된 서버부터 조사를 재개합니다:", {
        currentServerId: serverIds[firstCycleStartIndex],
        index: firstCycleStartIndex + 1,
        total: serverIds.length,
        savedAt: savedResume?.updatedAt ?? null
      });
    }

    const session = {
      ok: false,
      mode: "v2.9.4-popular-list-order",
      popularFirst,
      popularityBasis: popularFirst ? "previous survey summary.players" : "remote servers-popular.json order",
      originalServerIds,
      serverIds,
      resumed: savedIndex >= 0,
      resumedFromServerId: savedIndex >= 0 ? serverIds[firstCycleStartIndex] : null,
      firstCycleStartIndex,
      startedAt: nowIso(),
      finishedAt: null,
      stopped: false,
      reason: null,
      cycles: [],
      errors: []
    };

    const repeatDelay = Number(normalizedOptions.repeatDelay ?? 60000);
    const keepBatchHistory = Math.max(1, Number(normalizedOptions.keepBatchHistory ?? 1));
    let cycle = 0;

    while (!shouldStop()) {
      cycle++;

      if (popularFirst && normalizedOptions.resortByPopularityEachCycle !== false) {
        const beforeSort = serverIds.slice();
        serverIds = sortServerIdsByPopularity(serverIds, { enabled: true });
        session.serverIds = serverIds;

        if (serverIds.join(",") !== beforeSort.join(",")) {
          console.log(`[TopWar V2.8] cycle ${cycle} 인기 서버 순서 갱신:`, {
            before: beforeSort,
            after: serverIds
          });
        }
      }

      const cycleStartIndex = cycle === 1 ? firstCycleStartIndex : 0;
      const cycleResult = {
        cycle,
        startedAt: nowIso(),
        finishedAt: null,
        serverIds: serverIds.slice(),
        startIndex: cycleStartIndex,
        startServerId: serverIds[cycleStartIndex] ?? null,
        results: [],
        stopped: false,
        reason: null
      };

      for (let index = cycleStartIndex; index < serverIds.length; index++) {
        const serverId = serverIds[index];

        if (shouldStop()) {
          cycleResult.stopped = true;
          cycleResult.reason = "manual stop before server";
          break;
        }

        state.ui.serverSurveyBatch.current = {
          phase: "serverSurvey",
          mode: session.mode,
          cycle,
          index: index + 1,
          total: serverIds.length,
          serverId,
          serverIds
        };

        writeServerSurveyResume({
          status: "running",
          mode: session.mode,
          cycle,
          currentIndex: index,
          currentServerId: serverId,
          startedAt: session.startedAt
        });

        let row;

        try {
          row = await runOneServer(serverId, normalizedOptions);
        } catch (error) {
          row = {
            ok: false,
            serverId,
            reason: "exception",
            error: error?.message ?? String(error)
          };
        }

        cycleResult.results.push(row);
        updateServerPopularityFromSurvey(serverId, row, { cycle });

        if (!row.ok) {
          session.errors.push({ cycle, serverId, reason: row.reason });
          if (session.errors.length > 20) session.errors.shift();

          if (normalizedOptions.stopOnFail === true) {
            cycleResult.stopped = true;
            cycleResult.reason = `server ${serverId} failed`;
            break;
          }
        }

        if (row.stopped || shouldStop()) {
          cycleResult.stopped = true;
          cycleResult.reason = row.reason ?? "manual stop after server";
          break;
        }

        state.ui.serverSurveyBatch.running = true;
        state.fullScan.running = true;
        state.fullScan.phase = normalizedOptions.softResetAfterServer === true
          ? "softReset"
          : "betweenServers";
        state.ui.serverSurveyBatch.current = {
          phase: normalizedOptions.softResetAfterServer === true
            ? "softReset"
            : "betweenServers",
          mode: session.mode,
          cycle,
          index: index + 1,
          total: serverIds.length,
          serverId,
          serverIds
        };

        // 기지 내부 왕복은 서버 변경에 필요하지 않고 화면 전환 실패의 원인이었다.
        // 기본 조사에서는 월드맵 상태를 유지한 채 다음 서버로 직접 이동한다.
        // 메모리 진단이 필요한 수동 실행에서만 softResetAfterServer:true로 활성화한다.
        if (normalizedOptions.softResetAfterServer === true) {
          row.softReset = await performSoftMemoryReset({
            debug: !!normalizedOptions.softResetDebug,
            baseStayDelay: normalizedOptions.baseStayDelay ?? 8000,
            afterWorldDelay: normalizedOptions.afterWorldDelay ?? 4000,
            packetBufferLimit: normalizedOptions.packetBufferLimit ?? 20,
            outgoingBufferLimit: normalizedOptions.outgoingBufferLimit ?? 10
          });

          if (!row.softReset?.ok) {
            const reason = `서버 ${serverId} 조사 후 월드맵 복귀 실패`;
            session.errors.push({ cycle, serverId, reason, softReset: row.softReset });
            cycleResult.stopped = true;
            cycleResult.reason = reason;
            state.ui.serverSurveyBatch.current = {
              phase: "worldReturnFailed",
              cycle,
              index: index + 1,
              total: serverIds.length,
              serverId,
              reason
            };
            console.error(`[TopWar V2.12.9] ${reason}`, row.softReset);
            break;
          }
        }

        const nextIndex = index < serverIds.length - 1 ? index + 1 : 0;
        const nextCycle = index < serverIds.length - 1 ? cycle : cycle + 1;
        writeServerSurveyResume({
          status: index < serverIds.length - 1 ? "betweenServers" : "cycleComplete",
          mode: session.mode,
          cycle: nextCycle,
          currentIndex: nextIndex,
          currentServerId: serverIds[nextIndex],
          lastCompletedServerId: serverId,
          lastCompletedAt: nowIso(),
          startedAt: session.startedAt
        });

        if (index < serverIds.length - 1) {
          const keepGoing = await waitInterruptible(
            Number(normalizedOptions.betweenServerDelay ?? 2000)
          );

          if (!keepGoing) {
            cycleResult.stopped = true;
            cycleResult.reason = "manual stop during between-server delay";
            break;
          }
        }
      }

      cycleResult.finishedAt = nowIso();
      session.cycles.push(cycleResult);
      if (session.cycles.length > keepBatchHistory) session.cycles.shift();

      // UI 자동실행/반복조사에서 한 사이클이 끝날 때마다 compact movement history를 즉시 저장한다.
      // 기존 V2.9.3 래퍼는 repeatUntilStopped 루프가 완전히 종료된 뒤에야 실행되므로,
      // 무한 반복 UI 모드에서는 여기서 직접 flush해야 실제로 "매 사이클 저장"이 된다.
      if (normalizedOptions.flushCompactHistoryAfterEachCycle === true) {
        try {
          cycleResult.compactHistoryFlush = await window.TOPWAR_DATAHUB.flushQueued(100);
          console.log("[TopWar DataHub] cycle pending queue flush 완료:", cycleResult.compactHistoryFlush);
        } catch (error) {
          cycleResult.compactHistoryFlush = { ok: false, error: error?.message || String(error) };
          console.error("[TopWar V2.10.0 UI] cycle compact history flush 실패:", error);
        }
      }

      if (cycleResult.stopped || shouldStop()) {
        session.stopped = true;
        session.reason = cycleResult.reason ?? "manual stop after cycle";
        break;
      }

      state.ui.serverSurveyBatch.running = true;
      state.fullScan.running = true;
      state.fullScan.phase = "repeatDelay";
      state.ui.serverSurveyBatch.current = {
        phase: "repeatDelay",
        mode: session.mode,
        cycle,
        nextCycle: cycle + 1,
        repeatDelay,
        serverIds
      };

      if (!(await waitInterruptible(repeatDelay))) {
        session.stopped = true;
        session.reason = "manual stop during repeat delay";
        break;
      }
    }

    if (shouldStop() && !session.reason) {
      session.stopped = true;
      session.reason = "manual stop";
    }

    session.finishedAt = nowIso();
    session.ok = !session.stopped && session.errors.length === 0;

    state.ui.serverSurveyBatch.running = false;
    state.ui.serverSurveyBatch.stopping = false;
    state.ui.serverSurveyBatch.finishedAt = session.finishedAt;
    state.ui.serverSurveyBatch.result = session;
    state.ui.serverSurveyBatch.current = {
      phase: session.stopped ? "stopped" : "done",
      mode: session.mode,
      cycles: cycle,
      serverIds
    };

    state.fullScan.running = false;
    state.fullScan.phase = session.stopped ? "stopped" : "done";

    return session;
  };

  // 기존 별칭도 최종 통합 함수를 바라보도록 통일합니다.
  TOPWAR.runServerSurveyBatch = TOPWAR.runMultiServerSurvey;

  Object.assign(TOPWAR, {
    __v28CleanRuntimeInstalled: true,
    getServerPopularityCache,
    updateServerPopularityFromSurvey,
    sortServerIdsByPopularity,
    serverPopularityStatus,
    clearServerPopularityCache,
    readServerSurveyResume,
    writeServerSurveyResume,
    clearServerSurveyResume,
    serverSurveyResumeStatus,
    detectCrossTreasureRound,
    collectCrossTreasureTextEntries,
    crossTreasureRoundStatus,
    performSoftMemoryReset,
    goBaseInteriorForSoftReset: goBaseInterior,
    goWorldMapFromBaseForSoftReset: goWorldMapFromBase,
    closeVisiblePopupsForSoftReset: closeVisiblePopups
  });

  console.log("%c[TopWar V2.8 Clean Runtime] installed", "color:#00e676;font-weight:bold");
})();
/* ---------------------------------------------------------------------------
 * TopWar V2.9 Storage Policy Override
 * - Detailed history OFF by default: server latest.json only
 * - Population summary history ON: compact per-survey rows
 * - User movement history ON: actual UID cross-server movement events only
 * - User latest indexes ON: compact comparison baseline
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  const TOPWAR = window.TOPWAR;

  if (!TOPWAR) {
    console.error("[TopWar V2.9 Storage] TOPWAR 객체가 없습니다.");
    return;
  }

  if (TOPWAR.__v29StoragePolicyInstalled) {
    console.warn("[TopWar V2.9 Storage] 이미 설치되어 있습니다.");
    return;
  }

  const SETTINGS_KEY = "TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS";
  const DEFAULT_BRANCH = "main";

  const DEFAULT_STORAGE_POLICY = {
    uploadHistory: false,
    uploadLatest: true,
    uploadSummaryIndex: true,
    uploadPopulationHistory: true,
    uploadUserMovementHistory: true,
    uploadUserLatestIndex: true,
    uploadUserServerIndex: true,

    latestPathTemplate: "topwar-results/server-{serverId}/latest.json",
    pathTemplate: "topwar-results/server-{serverId}/{date}/topwar-server-{serverId}-{timestamp}.json",
    summaryIndexPath: "topwar-results/indexes/server-popularity-index.json",
    populationHistoryPathTemplate: "topwar-results/history/population/{date}.json",
    serverUserLatestIndexPathTemplate: "topwar-results/indexes/users/server-{serverId}.json",
    userServerIndexPath: "topwar-results/indexes/user-server-index.json",
    userMovementHistoryPathTemplate: "src/assets/json/realpower/movement/{date}.json",

    recordFirstSeen: true,
    minCoordDistance: 10,
    baseMoveCooldownMs: 6 * 60 * 60 * 1000,
    powerChangeRate: 0.05,
    powerChangeAbsolute: 10000000,
    powerChangeCooldownMs: 24 * 60 * 60 * 1000,
    missingThreshold: 3,
    missingRetentionDays: 30,
    maxPopulationHistoryRowsPerDay: 100000,
    maxMovementHistoryRowsPerDay: 100000,
    maxUserServerIndexEntries: 200000,
    pretty: true
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function readStoredSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const token = TOPWAR.getGithubToken?.() || "";
      if (token) settings.token = token;
      return settings;
    } catch {
      return { token: TOPWAR.getGithubToken?.() || "" };
    }
  }

  function saveStoredSettings(settings) {
    if (settings?.token) TOPWAR.setGithubToken?.(settings.token);
    const merged = {
      ...readStoredSettings(),
      ...settings
    };
    const token = TOPWAR.getGithubToken?.() || settings?.token || "";
    delete merged.token;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    return { ...merged, token };
  }

  function getStorageSettings(options = {}) {
    return {
      ...DEFAULT_STORAGE_POLICY,
      ...readStoredSettings(),
      ...options
    };
  }

  function encodeGithubPath(path) {
    return String(path)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
  }

  function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function fromBase64Utf8(base64) {
    const binary = atob(String(base64 ?? "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateParts(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value || Date.now());
    return {
      date: [d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate())].join("-"),
      time: [pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())].join(":"),
      timestamp: [
        d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate()),
        "-", pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())
      ].join("")
    };
  }

  function renderPath(template, context = {}) {
    const parts = dateParts(context.exportedAt || context.t || new Date());
    return String(template)
      .replaceAll("{serverId}", String(context.serverId ?? "unknown"))
      .replaceAll("{date}", parts.date)
      .replaceAll("{time}", parts.time.replaceAll(":", ""))
      .replaceAll("{timestamp}", parts.timestamp);
  }

  function compactNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function compactString(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  }

  function sameNumber(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) && !Number.isFinite(nb)) return true;
    return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
  }

  function sameText(a, b) {
    return String(a ?? "") === String(b ?? "");
  }

  function coordDistance(a, b) {
    const ax = Number(a?.x);
    const ay = Number(a?.y);
    const bx = Number(b?.x);
    const by = Number(b?.y);
    if (![ax, ay, bx, by].every(Number.isFinite)) return 0;
    return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
  }

  function timeSinceMs(value, fallback = Infinity) {
    const ms = Date.parse(value || "");
    if (!Number.isFinite(ms)) return fallback;
    return Date.now() - ms;
  }

  async function githubApiRequest({ method, url, token, body }) {
    const response = await fetch(url, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(`[GitHub API ${response.status}] ${data?.message || response.statusText}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function assertGithubSettings(settings) {
    if (!settings.enabled) throw new Error("GitHub 업로드가 비활성화되어 있습니다.");
    if (!settings.token) throw new Error("GitHub token이 없습니다.");
    if (!settings.owner) throw new Error("GitHub owner가 없습니다.");
    if (!settings.repo) throw new Error("GitHub repo가 없습니다.");
  }

  function contentApiUrl(settings, path) {
    return `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeGithubPath(path)}`;
  }

  async function readGithubTextFile(settings, path) {
    assertGithubSettings(settings);

    try {
      const data = await githubApiRequest({
        method: "GET",
        url: `${contentApiUrl(settings, path)}?ref=${encodeURIComponent(settings.branch || DEFAULT_BRANCH)}`,
        token: settings.token
      });

      return {
        ok: true,
        path,
        sha: data?.sha ?? null,
        text: data?.content ? fromBase64Utf8(data.content) : "",
        apiResult: data
      };
    } catch (error) {
      if (error.status === 404) {
        return { ok: false, missing: true, path, sha: null, text: null };
      }
      throw error;
    }
  }

  async function readGithubJsonFile(settings, path, fallback) {
    const file = await readGithubTextFile(settings, path);
    if (file.missing) return fallback;
    try {
      return JSON.parse(file.text || "null") ?? fallback;
    } catch (error) {
      console.warn("[TopWar V2.9 Storage] JSON 파싱 실패 - fallback 사용:", { path, error });
      return fallback;
    }
  }

  async function writeGithubTextFile(settings, path, content, message) {
    assertGithubSettings(settings);

    let sha = null;
    try {
      const current = await readGithubTextFile(settings, path);
      sha = current.sha;
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    const body = {
      message,
      content: toBase64Utf8(content),
      branch: settings.branch || DEFAULT_BRANCH
    };

    if (sha) body.sha = sha;

    const uploaded = await githubApiRequest({
      method: "PUT",
      url: contentApiUrl(settings, path),
      token: settings.token,
      body
    });

    return {
      type: "file",
      path,
      htmlUrl: uploaded?.content?.html_url ?? null
    };
  }

  async function writeGithubJsonFile(settings, path, value, message) {
    const text = settings.pretty === false ? JSON.stringify(value) : JSON.stringify(value, null, 2);
    return await writeGithubTextFile(settings, path, text, message);
  }

  function extractServerId(data, settings = {}) {
    const value = data?.serverId ?? data?.summary?.serverId ?? settings.serverId ?? TOPWAR.range?.()?.k;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : String(value ?? "unknown");
  }

  function buildPopulationRow(data, settings = {}) {
    const summary = data?.summary || {};
    const activity = summary.activity || {};
    const serverActivity = summary.serverActivity || {};
    const userStatus = summary.userStatus || {};
    const exportedAt = data?.exportedAt || nowIso();

    return {
      t: exportedAt,
      s: extractServerId(data, settings),
      p: compactNumber(summary.players),
      mp: compactNumber(summary.mapPlayers),
      a: compactNumber(summary.alliances),
      ad: compactNumber(summary.allianceDetails),
      core: compactNumber(activity.coreCount),
      active: compactNumber(activity.activeCount),
      watch: compactNumber(activity.watchCount),
      low: compactNumber(activity.lowCount),
      activeTotal: compactNumber(activity.activeTotalCount),
      grade: compactString(serverActivity.grade),
      score: compactNumber(serverActivity.score),
      activeUsers: compactNumber(userStatus.activeUsers),
      recentUsers: compactNumber(userStatus.recentUsers),
      inactiveUsers: compactNumber(userStatus.inactiveUsers),
      quitLikelyUsers: compactNumber(userStatus.quitLikelyUsers),
      activeUserRate: compactNumber(userStatus.activeUserRate),
      quitLikelyRate: compactNumber(userStatus.quitLikelyRate)
    };
  }

  function compactPlayerForUserIndex(player, serverId, exportedAt, previous = null) {
    const uid = compactString(player?.uid);
    if (!uid) return null;

    const row = {
      uid,
      serverId: compactNumber(player.serverId ?? player.worldId ?? serverId) ?? serverId,
      x: compactNumber(player.x),
      y: compactNumber(player.y),
      username: compactString(player.username ?? player.nickname),
      nickname: compactString(player.nickname ?? player.username),
      allianceId: compactString(player.allianceId),
      allianceTag: compactString(player.allianceTag),
      allianceName: compactString(player.allianceName),
      level: compactNumber(player.level),
      power: compactNumber(player.power),
      activityGrade: compactString(player.activityGrade),
      activityScore: compactNumber(player.activityScore),
      firstSeenAt: previous?.firstSeenAt || exportedAt,
      lastSeenAt: exportedAt,
      seenCount: Number(previous?.seenCount ?? 0) + 1,
      missingCount: 0
    };

    if (previous?.lastBaseMoveEventAt) row.lastBaseMoveEventAt = previous.lastBaseMoveEventAt;
    if (previous?.lastPowerEventAt) row.lastPowerEventAt = previous.lastPowerEventAt;

    Object.keys(row).forEach(key => {
      if (row[key] == null || row[key] === "") delete row[key];
    });

    return row;
  }

  function compactGlobalUserServerRow(player, serverId, exportedAt, previous = null) {
    return {
      uid: player.uid,
      serverId: player.serverId ?? serverId,
      x: player.x ?? null,
      y: player.y ?? null,
      username: player.username ?? player.nickname ?? previous?.username ?? null,
      allianceId: player.allianceId ?? null,
      allianceTag: player.allianceTag ?? null,
      power: player.power ?? null,
      lastSeenAt: exportedAt,
      firstSeenAt: previous?.firstSeenAt || exportedAt
    };
  }

  function pushEvent(events, event) {
    Object.keys(event).forEach(key => {
      if (event[key] == null || event[key] === "") delete event[key];
    });
    events.push(event);
  }

  function buildUserMovementDiff(data, previousServerIndex, previousGlobalIndex, settings = {}) {
    const exportedAt = data?.exportedAt || nowIso();
    const serverId = extractServerId(data, settings);
    const players = Array.isArray(data?.players) ? data.players : [];
    const previousUsers = previousServerIndex?.users && typeof previousServerIndex.users === "object"
      ? previousServerIndex.users
      : {};
    const previousHadBaseline = Object.keys(previousUsers).length > 0;
    const nextUsers = {};
    const nextGlobalIndex = {
      version: previousGlobalIndex?.version || 1,
      updatedAt: exportedAt,
      users: previousGlobalIndex?.users && typeof previousGlobalIndex.users === "object"
        ? { ...previousGlobalIndex.users }
        : {}
    };

    const currentUidSet = new Set();
    const events = [];

    const minCoordDistance = Number(settings.minCoordDistance ?? DEFAULT_STORAGE_POLICY.minCoordDistance);
    const baseMoveCooldownMs = Number(settings.baseMoveCooldownMs ?? DEFAULT_STORAGE_POLICY.baseMoveCooldownMs);
    const powerChangeRate = Number(settings.powerChangeRate ?? DEFAULT_STORAGE_POLICY.powerChangeRate);
    const powerChangeAbsolute = Number(settings.powerChangeAbsolute ?? DEFAULT_STORAGE_POLICY.powerChangeAbsolute);
    const powerChangeCooldownMs = Number(settings.powerChangeCooldownMs ?? DEFAULT_STORAGE_POLICY.powerChangeCooldownMs);
    const missingThreshold = Number(settings.missingThreshold ?? DEFAULT_STORAGE_POLICY.missingThreshold);
    const missingRetentionDays = Number(settings.missingRetentionDays ?? DEFAULT_STORAGE_POLICY.missingRetentionDays);

    for (const raw of players) {
      const uid = compactString(raw?.uid);
      if (!uid) continue;

      const prev = previousUsers[uid] || null;
      const globalPrev = nextGlobalIndex.users[uid] || null;
      const current = compactPlayerForUserIndex(raw, serverId, exportedAt, prev);
      if (!current) continue;

      currentUidSet.add(uid);

      if (!prev) {
        if (globalPrev && !sameNumber(globalPrev.serverId, current.serverId)) {
          pushEvent(events, {
            t: exportedAt,
            type: "SERVER_MOVE",
            uid,
            name: current.username,
            from: { serverId: globalPrev.serverId, x: globalPrev.x, y: globalPrev.y, allianceId: globalPrev.allianceId, allianceTag: globalPrev.allianceTag },
            to: { serverId: current.serverId, x: current.x, y: current.y, allianceId: current.allianceId, allianceTag: current.allianceTag }
          });
        } else if (previousHadBaseline && settings.recordFirstSeen !== false) {
          pushEvent(events, {
            t: exportedAt,
            type: "FIRST_SEEN",
            uid,
            name: current.username,
            serverId: current.serverId,
            x: current.x,
            y: current.y,
            allianceId: current.allianceId,
            allianceTag: current.allianceTag,
            power: current.power
          });
        }
      } else {
        if (Number(prev.missingCount ?? 0) >= missingThreshold) {
          pushEvent(events, {
            t: exportedAt,
            type: "REAPPEARED",
            uid,
            name: current.username,
            serverId: current.serverId,
            x: current.x,
            y: current.y,
            missingCount: Number(prev.missingCount ?? 0),
            lastSeenAt: prev.lastSeenAt
          });
        }

        if (coordDistance(prev, current) >= minCoordDistance && timeSinceMs(prev.lastBaseMoveEventAt) >= baseMoveCooldownMs) {
          pushEvent(events, {
            t: exportedAt,
            type: "BASE_MOVE",
            uid,
            name: current.username,
            serverId: current.serverId,
            from: { x: prev.x, y: prev.y },
            to: { x: current.x, y: current.y },
            distance: Number(coordDistance(prev, current).toFixed(2)),
            allianceId: current.allianceId,
            allianceTag: current.allianceTag
          });
          current.lastBaseMoveEventAt = exportedAt;
        }

        const allianceChanged =
          !sameText(prev.allianceId, current.allianceId) ||
          !sameText(prev.allianceTag, current.allianceTag);

        if (allianceChanged) {
          pushEvent(events, {
            t: exportedAt,
            type: "ALLIANCE_CHANGE",
            uid,
            name: current.username,
            serverId: current.serverId,
            from: { allianceId: prev.allianceId, allianceTag: prev.allianceTag, allianceName: prev.allianceName },
            to: { allianceId: current.allianceId, allianceTag: current.allianceTag, allianceName: current.allianceName }
          });
        }

        if (!sameText(prev.username, current.username) && current.username) {
          pushEvent(events, {
            t: exportedAt,
            type: "NAME_CHANGE",
            uid,
            serverId: current.serverId,
            from: { name: prev.username },
            to: { name: current.username }
          });
        }

        const prevPower = Number(prev.power ?? 0);
        const curPower = Number(current.power ?? 0);
        const powerDiff = curPower - prevPower;
        const powerRate = prevPower > 0 ? Math.abs(powerDiff) / prevPower : 0;

        if (
          prevPower > 0 && curPower > 0 &&
          Math.abs(powerDiff) >= powerChangeAbsolute &&
          powerRate >= powerChangeRate &&
          timeSinceMs(prev.lastPowerEventAt) >= powerChangeCooldownMs
        ) {
          pushEvent(events, {
            t: exportedAt,
            type: "POWER_CHANGE",
            uid,
            name: current.username,
            serverId: current.serverId,
            from: { power: prevPower },
            to: { power: curPower },
            diff: powerDiff,
            rate: Number(powerRate.toFixed(4))
          });
          current.lastPowerEventAt = exportedAt;
        }
      }

      nextUsers[uid] = current;
      nextGlobalIndex.users[uid] = compactGlobalUserServerRow(current, serverId, exportedAt, globalPrev);
    }

    if (previousHadBaseline) {
      for (const [uid, prev] of Object.entries(previousUsers)) {
        if (currentUidSet.has(uid)) continue;

        const missingCount = Number(prev.missingCount ?? 0) + 1;
        const missingSinceAt = prev.missingSinceAt || exportedAt;
        const missingAgeMs = Date.now() - Date.parse(missingSinceAt || exportedAt);
        const shouldKeepMissing = !Number.isFinite(missingAgeMs) || missingAgeMs <= missingRetentionDays * 24 * 60 * 60 * 1000;

        if (!shouldKeepMissing) continue;

        const nextMissing = {
          ...prev,
          missingCount,
          missingSinceAt
        };

        if (missingCount >= missingThreshold && !prev.missingEventAt) {
          nextMissing.missingEventAt = exportedAt;
          pushEvent(events, {
            t: exportedAt,
            type: "MISSING",
            uid,
            name: prev.username,
            serverId: prev.serverId ?? serverId,
            x: prev.x,
            y: prev.y,
            allianceId: prev.allianceId,
            allianceTag: prev.allianceTag,
            lastSeenAt: prev.lastSeenAt,
            missingCount
          });
        }

        nextUsers[uid] = nextMissing;
      }
    }

    pruneGlobalUserServerIndex(nextGlobalIndex, Number(settings.maxUserServerIndexEntries ?? DEFAULT_STORAGE_POLICY.maxUserServerIndexEntries));

    return {
      events,
      serverUserIndex: {
        version: 1,
        serverId,
        updatedAt: exportedAt,
        userCount: Object.values(nextUsers).filter(row => Number(row.missingCount ?? 0) === 0).length,
        missingCount: Object.values(nextUsers).filter(row => Number(row.missingCount ?? 0) > 0).length,
        users: nextUsers
      },
      userServerIndex: nextGlobalIndex
    };
  }

  function pruneGlobalUserServerIndex(index, maxEntries) {
    if (!maxEntries || maxEntries <= 0) return index;
    const users = index?.users || {};
    const keys = Object.keys(users);
    if (keys.length <= maxEntries) return index;

    keys
      .sort((a, b) => Date.parse(users[b]?.lastSeenAt || 0) - Date.parse(users[a]?.lastSeenAt || 0))
      .slice(maxEntries)
      .forEach(uid => delete users[uid]);

    index.prunedAt = nowIso();
    index.maxEntries = maxEntries;
    return index;
  }

  async function updateServerSummaryIndex(settings, data, uploads) {
    const serverId = extractServerId(data, settings);
    const path = settings.summaryIndexPath || DEFAULT_STORAGE_POLICY.summaryIndexPath;
    const row = buildPopulationRow(data, settings);
    const current = await readGithubJsonFile(settings, path, { version: 1, updatedAt: null, servers: {} });

    current.version = 1;
    current.updatedAt = data?.exportedAt || nowIso();
    current.servers ??= {};
    current.servers[String(serverId)] = {
      status: "active",
      serverId,
      players: row.p,
      mapPlayers: row.mp,
      alliances: row.a,
      allianceDetails: row.ad,
      activity: {
        core: row.core,
        active: row.active,
        watch: row.watch,
        low: row.low,
        activeTotal: row.activeTotal
      },
      serverActivity: {
        grade: row.grade,
        score: row.score
      },
      userStatus: {
        activeUsers: row.activeUsers,
        recentUsers: row.recentUsers,
        inactiveUsers: row.inactiveUsers,
        quitLikelyUsers: row.quitLikelyUsers,
        activeUserRate: row.activeUserRate,
        quitLikelyRate: row.quitLikelyRate
      },
      lastSurveyedAt: row.t,
      lastSeenInServerListAt: current.servers[String(serverId)]?.lastSeenInServerListAt ?? null
    };

    uploads.push(await writeGithubJsonFile(
      settings,
      path,
      current,
      `Update TopWar server summary index ${serverId}`
    ));
  }

  async function updatePopulationHistory(settings, data, uploads) {
    const serverId = extractServerId(data, settings);
    const exportedAt = data?.exportedAt || nowIso();
    const path = renderPath(
      settings.populationHistoryPathTemplate || DEFAULT_STORAGE_POLICY.populationHistoryPathTemplate,
      { serverId, exportedAt }
    );
    const parts = dateParts(exportedAt);
    const current = await readGithubJsonFile(settings, path, { version: 1, date: parts.date, rows: [] });
    const row = buildPopulationRow(data, settings);

    current.version = 1;
    current.date = current.date || parts.date;
    current.rows = Array.isArray(current.rows) ? current.rows : [];

    const duplicate = current.rows.some(item => String(item.t) === String(row.t) && String(item.s) === String(row.s));
    if (!duplicate) current.rows.push(row);

    const maxRows = Number(settings.maxPopulationHistoryRowsPerDay ?? DEFAULT_STORAGE_POLICY.maxPopulationHistoryRowsPerDay);
    if (maxRows > 0 && current.rows.length > maxRows) {
      current.rows = current.rows.slice(-maxRows);
      current.prunedAt = nowIso();
    }

    current.updatedAt = exportedAt;

    uploads.push(await writeGithubJsonFile(
      settings,
      path,
      current,
      `Append TopWar population history ${serverId} ${parts.date}`
    ));
  }

  async function updateUserMovementHistory(settings, data, uploads) {
    const serverId = extractServerId(data, settings);
    const exportedAt = data?.exportedAt || nowIso();
    const serverUserIndexPath = renderPath(
      settings.serverUserLatestIndexPathTemplate || DEFAULT_STORAGE_POLICY.serverUserLatestIndexPathTemplate,
      { serverId, exportedAt }
    );
    const userServerIndexPath = settings.userServerIndexPath || DEFAULT_STORAGE_POLICY.userServerIndexPath;
    const movementHistoryPath = renderPath(
      settings.userMovementHistoryPathTemplate || DEFAULT_STORAGE_POLICY.userMovementHistoryPathTemplate,
      { serverId, exportedAt }
    );

    const previousServerIndex = await readGithubJsonFile(settings, serverUserIndexPath, { version: 1, serverId, users: {} });
    const previousGlobalIndex = settings.uploadUserServerIndex === false
      ? { version: 1, users: {} }
      : await readGithubJsonFile(settings, userServerIndexPath, { version: 1, users: {} });

    const diff = buildUserMovementDiff(data, previousServerIndex, previousGlobalIndex, settings);

    if (settings.uploadUserLatestIndex !== false) {
      uploads.push(await writeGithubJsonFile(
        settings,
        serverUserIndexPath,
        diff.serverUserIndex,
        `Update TopWar user latest index server ${serverId}`
      ));
    }

    if (settings.uploadUserServerIndex !== false) {
      uploads.push(await writeGithubJsonFile(
        settings,
        userServerIndexPath,
        diff.userServerIndex,
        `Update TopWar global user server index ${serverId}`
      ));
    }

    if (settings.uploadUserMovementHistory !== false && diff.events.length) {
      const parts = dateParts(exportedAt);
      const current = await readGithubJsonFile(settings, movementHistoryPath, { version: 1, date: parts.date, rows: [] });
      current.version = 1;
      current.date = current.date || parts.date;
      current.rows = Array.isArray(current.rows) ? current.rows : [];

      const existingKeys = new Set(current.rows.map(row => `${row.t}|${row.type}|${row.uid}|${JSON.stringify(row.to ?? {})}`));
      for (const event of diff.events) {
        const key = `${event.t}|${event.type}|${event.uid}|${JSON.stringify(event.to ?? {})}`;
        if (!existingKeys.has(key)) {
          current.rows.push(event);
          existingKeys.add(key);
        }
      }

      const maxRows = Number(settings.maxMovementHistoryRowsPerDay ?? DEFAULT_STORAGE_POLICY.maxMovementHistoryRowsPerDay);
      if (maxRows > 0 && current.rows.length > maxRows) {
        current.rows = current.rows.slice(-maxRows);
        current.prunedAt = nowIso();
      }

      current.updatedAt = exportedAt;

      uploads.push(await writeGithubJsonFile(
        settings,
        movementHistoryPath,
        current,
        `Append TopWar user movement history ${serverId} ${parts.date}`
      ));
    }

    return {
      events: diff.events.length,
      serverUserIndexPath,
      userServerIndexPath,
      movementHistoryPath
    };
  }

  async function uploadSurveyResultToGithubV29(data, options = {}) {
    if (TOPWAR.state?.watch133?.running === true) {
      return { ok: false, skipped: true, reason: "blocked during thief+cityReward finder" };
    }
    const settings = getStorageSettings(options);

    if (!settings.enabled) {
      console.log("[TopWar V2.9 Storage] GitHub 업로드 비활성화 상태입니다.");
      return { ok: false, skipped: true, reason: "github upload disabled" };
    }

    assertGithubSettings(settings);

    const serverId = extractServerId(data, settings);
    const exportedAt = data?.exportedAt || nowIso();
    const content = settings.pretty === false ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    const uploads = [];
    const result = {
      ok: false,
      mode: "v2.9-storage-policy",
      serverId,
      exportedAt,
      uploads,
      policy: {
        uploadHistory: settings.uploadHistory === true,
        uploadLatest: settings.uploadLatest !== false,
        uploadSummaryIndex: settings.uploadSummaryIndex !== false,
        uploadPopulationHistory: settings.uploadPopulationHistory !== false,
        uploadUserMovementHistory: settings.uploadUserMovementHistory !== false,
        uploadUserLatestIndex: settings.uploadUserLatestIndex !== false
      }
    };

    if (settings.uploadHistory === true) {
      const historyPath = renderPath(settings.pathTemplate || DEFAULT_STORAGE_POLICY.pathTemplate, { serverId, exportedAt });
      uploads.push(await writeGithubTextFile(
        settings,
        historyPath,
        content,
        `Upload TopWar server ${serverId} detailed history ${exportedAt}`
      ));
    }

    if (settings.uploadLatest !== false) {
      const latestPath = renderPath(settings.latestPathTemplate || DEFAULT_STORAGE_POLICY.latestPathTemplate, { serverId, exportedAt });
      uploads.push(await writeGithubTextFile(
        settings,
        latestPath,
        content,
        `Update TopWar server ${serverId} latest result`
      ));
    }

    if (settings.uploadSummaryIndex !== false) {
      await updateServerSummaryIndex(settings, data, uploads);
    }

    if (settings.uploadPopulationHistory !== false) {
      await updatePopulationHistory(settings, data, uploads);
    }

    if (settings.uploadUserLatestIndex !== false || settings.uploadUserMovementHistory !== false || settings.uploadUserServerIndex !== false) {
      result.userMovement = await updateUserMovementHistory(settings, data, uploads);
    }

    result.ok = true;

    console.log("[TopWar V2.9 Storage] 저장 정책 업로드 완료:", {
      serverId,
      uploads: uploads.map(row => ({ path: row.path, htmlUrl: row.htmlUrl })),
      movementEvents: result.userMovement?.events ?? 0
    });

    return result;
  }

  function configureGithubStoragePolicy(settings = {}) {
    const saved = saveStoredSettings({
      ...DEFAULT_STORAGE_POLICY,
      ...settings
    });

    const safe = {
      ...saved,
      token: saved.token ? `${String(saved.token).slice(0, 8)}...` : ""
    };

    console.log("[TopWar V2.9 Storage] 저장 정책 설정 완료:", safe);
    return safe;
  }

  function githubStoragePolicyStatus() {
    const settings = getStorageSettings();
    const safe = {
      ...settings,
      token: settings.token ? `${String(settings.token).slice(0, 8)}...` : ""
    };
    console.log("[TopWar V2.9 Storage] 현재 저장 정책:", safe);
    return safe;
  }

  Object.assign(TOPWAR, {
    __v29StoragePolicyInstalled: true,
    uploadSurveyResultToGithub: uploadSurveyResultToGithubV29,
    configureGithubStoragePolicy,
    githubStoragePolicyStatus,
    buildPopulationRowForStorage: buildPopulationRow,
    buildUserMovementDiffForStorage: buildUserMovementDiff
  });

  console.log("%c[TopWar V2.9 Storage Policy] installed", "color:#00e676;font-weight:bold");
})();


/* ---------------------------------------------------------------------------
 * TopWar V2.9.3 Fast GitHub Storage Override
 * - Sorting never reads GitHub.
 * - Remote server list is cached for 1 hour by default.
 * - Per-server survey upload writes only latest.json immediately.
 * - Population / movement / user indexes are collected locally and flushed in batches.
 * - GitHub SHA cache avoids a GET before every overwrite after the first successful write.
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  const TOPWAR = window.TOPWAR;

  if (!TOPWAR) {
    console.error("[TopWar V2.9.3 Fast Storage] TOPWAR 객체가 없습니다.");
    return;
  }

  if (TOPWAR.__v293FastGithubStorageInstalled) {
    console.warn("[TopWar V2.9.3 Fast Storage] 이미 설치되어 있습니다.");
    return;
  }

  const SETTINGS_KEY = "TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS";
  const SHA_CACHE_KEY = "TOPWAR_GITHUB_SHA_CACHE_V293";
  const QUEUE_KEY = "TOPWAR_FAST_COMPACT_HISTORY_QUEUE_V293";
  const GLOBAL_USER_INDEX_KEY = "TOPWAR_FAST_GLOBAL_USER_INDEX_V293";
  const SERVER_USER_INDEX_PREFIX = "TOPWAR_FAST_SERVER_USER_INDEX_V293:";
  const DEFAULT_BRANCH = "main";

  const DEFAULT_FAST_POLICY = {
    fastGithubStorage: true,

    // 서버별 상세 최신 데이터는 즉시 업로드한다. 단, SHA 캐시로 두 번째부터는 GET 없이 PUT을 시도한다.
    uploadLatest: true,
    latestPathTemplate: "topwar-results/server-{serverId}/latest.json",

    // 상세 히스토리는 기본 OFF. 용량 폭증 방지.
    uploadHistory: false,
    pathTemplate: "topwar-results/server-{serverId}/{date}/topwar-server-{serverId}-{timestamp}.json",

    // 아래 항목은 조사 중 localStorage 큐에 모았다가 flush 때 업로드한다.
    uploadSummaryIndex: true,
    uploadPopulationHistory: true,
    uploadUserMovementHistory: true,
    uploadUserLatestIndex: true,

    // 전역 UID 인덱스는 크기가 커지기 쉬우므로 GitHub 업로드 기본 OFF.
    // SERVER_MOVE 감지는 localStorage 전역 인덱스로 수행한다.
    uploadUserServerIndex: false,

    summaryIndexPath: "topwar-results/indexes/server-popularity-index.json",

    // compact flush 시 프런트엔드용 서버 목록 두 종류를 함께 업로드한다.
    uploadServerLists: true,
    popularServerListPath: "src/assets/json/servers/servers-popular.json",
    ascendingServerListPath: "src/assets/json/servers/servers.json",

    populationHistoryPathTemplate: "topwar-results/history/population/{date}.json",
    userMovementHistoryPathTemplate: "src/assets/json/realpower/movement/{date}.json",
    serverUserLatestIndexPathTemplate: "topwar-results/indexes/users/server-{serverId}.json",
    userServerIndexPath: "topwar-results/indexes/user-server-index.json",

    autoFlushCompactHistory: false,
    compactFlushEveryServers: 10,
    flushCompactHistoryAfterEachCycle: true,

    // UID가 다른 서버에서 실제로 다시 발견된 경우에만 SERVER_MOVE를 기록한다.
    // 원래 서버에서 한 번 보이지 않았다는 이유만으로 OUT을 즉시 기록하지 않는다.
    trackActualInOut: true,
    recordFirstSeen: false,
    minCoordDistance: 10,
    baseMoveCooldownMs: 6 * 60 * 60 * 1000,
    powerChangeRate: 0.05,
    powerChangeAbsolute: 10000000,
    powerChangeCooldownMs: 24 * 60 * 60 * 1000,
    missingThreshold: 3,
    maxPopulationHistoryRowsPerDay: 20000,
    maxMovementHistoryRowsPerDay: 20000,
    maxLocalGlobalUserIndexEntries: 25000,
    maxLocalQueueRowsPerDate: 3000,

    pretty: true
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function readJsonLocal(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "") || fallback;
    } catch {
      return fallback;
    }
  }

  function writeJsonLocal(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  function readStoredSettings() {
    const settings = readJsonLocal(SETTINGS_KEY, {});
    const token = TOPWAR.getGithubToken?.() || "";
    if (token) settings.token = token;
    return settings;
  }

  function saveStoredSettings(settings) {
    if (settings?.token) TOPWAR.setGithubToken?.(settings.token);
    const merged = {
      ...readStoredSettings(),
      ...settings
    };
    const token = TOPWAR.getGithubToken?.() || settings?.token || "";
    delete merged.token;
    writeJsonLocal(SETTINGS_KEY, merged);
    return { ...merged, token };
  }

  function getFastSettings(options = {}) {
    const settings = {
      ...DEFAULT_FAST_POLICY,
      ...readStoredSettings(),
      ...options
    };
    // 일반 설정 JSON에서는 token을 의도적으로 제거해 보관한다. 호출 옵션에
    // token: undefined가 포함되더라도 마지막 spread가 공용 토큰을 지우지 못하게 한다.
    settings.token = String(
      options.token || TOPWAR.getGithubToken?.() || settings.token || ""
    ).trim();
    return settings;
  }

  function assertGithubSettings(settings) {
    if (!settings.enabled) throw new Error("GitHub 업로드가 비활성화되어 있습니다.");
    if (!settings.token) throw new Error("GitHub token이 없습니다.");
    if (!settings.owner) throw new Error("GitHub owner가 없습니다.");
    if (!settings.repo) throw new Error("GitHub repo가 없습니다.");
  }

  function encodeGithubPath(path) {
    return String(path).split("/").map(encodeURIComponent).join("/");
  }

  function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  function fromBase64Utf8(base64) {
    const binary = atob(String(base64 ?? "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  function contentApiUrl(settings, path) {
    return `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeGithubPath(path)}`;
  }

  async function githubApiRequest({ method, url, token, body }) {
    const response = await fetch(url, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(`[GitHub API ${response.status}] ${data?.message || response.statusText}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function readShaCache() {
    const cache = readJsonLocal(SHA_CACHE_KEY, { version: 1, updatedAt: null, entries: {} });
    cache.version = 1;
    cache.entries ??= {};
    return cache;
  }

  function writeShaCache(cache) {
    cache.updatedAt = nowIso();
    return writeJsonLocal(SHA_CACHE_KEY, cache);
  }

  function rememberSha(path, sha) {
    if (!sha) return;
    const cache = readShaCache();
    cache.entries[path] = { sha, updatedAt: nowIso() };
    writeShaCache(cache);
  }

  function forgetSha(path) {
    const cache = readShaCache();
    delete cache.entries[path];
    writeShaCache(cache);
  }

  async function readGithubTextFile(settings, path) {
    assertGithubSettings(settings);

    try {
      const data = await githubApiRequest({
        method: "GET",
        url: `${contentApiUrl(settings, path)}?ref=${encodeURIComponent(settings.branch || DEFAULT_BRANCH)}`,
        token: settings.token
      });

      rememberSha(path, data?.sha ?? null);

      return {
        ok: true,
        path,
        sha: data?.sha ?? null,
        text: data?.content ? fromBase64Utf8(data.content) : "",
        apiResult: data
      };
    } catch (error) {
      if (error.status === 404) {
        forgetSha(path);
        return { ok: false, missing: true, path, sha: null, text: null };
      }
      throw error;
    }
  }

  async function readGithubJsonFile(settings, path, fallback) {
    const file = await readGithubTextFile(settings, path);
    if (file.missing) return fallback;

    try {
      return JSON.parse(file.text || "null") ?? fallback;
    } catch (error) {
      console.warn("[TopWar V2.9.3 Fast Storage] JSON 파싱 실패 - fallback 사용:", { path, error });
      return fallback;
    }
  }

  async function writeGithubTextFileFast(settings, path, content, message) {
    assertGithubSettings(settings);

    const shaCache = readShaCache();
    let sha = shaCache.entries?.[path]?.sha ?? null;

    if (!sha) {
      const current = await readGithubTextFile(settings, path);
      sha = current.sha;
    }

    async function putWithSha(shaValue) {
      const body = {
        message,
        content: toBase64Utf8(content),
        branch: settings.branch || DEFAULT_BRANCH
      };

      if (shaValue) body.sha = shaValue;

      return await githubApiRequest({
        method: "PUT",
        url: contentApiUrl(settings, path),
        token: settings.token,
        body
      });
    }

    try {
      const uploaded = await putWithSha(sha);
      rememberSha(path, uploaded?.content?.sha ?? uploaded?.content?.git_url ?? sha);
      await mirrorUserDataFile(settings, path, content, message);
      return { type: "file", path, htmlUrl: uploaded?.content?.html_url ?? null, shaCached: !!sha };
    } catch (error) {
      // SHA가 오래되어 409가 날 수 있다. 이때만 다시 GET 후 1회 재시도한다.
      if (error.status !== 409) throw error;

      console.warn("[TopWar V2.9.3 Fast Storage] SHA 충돌 - 최신 SHA 재조회 후 재시도:", path);
      const current = await readGithubTextFile(settings, path);
      const uploaded = await putWithSha(current.sha);
      rememberSha(path, uploaded?.content?.sha ?? current.sha);
      await mirrorUserDataFile(settings, path, content, message);
      return { type: "file", path, htmlUrl: uploaded?.content?.html_url ?? null, shaRefreshed: true };
    }
  }

  function isMirrorUserDataPath(path) {
    const value = String(path || "");
    return value.startsWith("src/assets/json/realpower/") ||
      value === "src/assets/json/power/playerData.json" ||
      value === "src/assets/json/power/serverData.json" ||
      value === "src/assets/json/power/allianceData.json" ||
      value.startsWith("src/assets/json/power/movement/") ||
      value.startsWith("src/assets/json/power/nickname/");
  }

  async function mirrorUserDataFile(settings, path, content, message) {
    if (settings?._skipUserDataMirror === true) return null;
    if (String(settings?.repo || "") !== "topwar-webutil-vite") return null;
    if (!isMirrorUserDataPath(path)) return null;

    const mirrorSettings = {
      ...settings,
      owner: "hiphop5782",
      repo: "topwar-database",
      branch: "main",
      _skipUserDataMirror: true
    };
    const current = await readGithubTextFile(mirrorSettings, path);
    const body = {
      message: `[mirror] ${message || `Update ${path}`}`,
      content: toBase64Utf8(content),
      branch: mirrorSettings.branch
    };
    if (current?.sha) body.sha = current.sha;
    const uploaded = await githubApiRequest({
      method: "PUT",
      url: contentApiUrl(mirrorSettings, path),
      token: mirrorSettings.token,
      body
    });
    console.log("[TopWar Dual Upload] topwar-database mirror 완료", { path });
    return uploaded;
  }

  async function writeGithubJsonFileFast(settings, path, value, message) {
    const text = settings.pretty === false ? JSON.stringify(value) : JSON.stringify(value, null, 2);
    return await writeGithubTextFileFast(settings, path, text, message);
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateParts(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value || Date.now());
    return {
      date: [d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate())].join("-"),
      time: [pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())].join(":"),
      timestamp: [
        d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate()),
        "-", pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())
      ].join("")
    };
  }

  function serverDateParts(value = new Date()) {
    const source = value instanceof Date ? value : new Date(value || Date.now());
    const shifted = new Date(source.getTime() + 8 * 60 * 60 * 1000);
    return {
      date: [shifted.getUTCFullYear(), pad2(shifted.getUTCMonth() + 1), pad2(shifted.getUTCDate())].join("-"),
      time: [pad2(shifted.getUTCHours()), pad2(shifted.getUTCMinutes()), pad2(shifted.getUTCSeconds())].join(":")
    };
  }

  function renderPath(template, context = {}) {
    const parts = dateParts(context.exportedAt || context.t || new Date());
    return String(template)
      .replaceAll("{serverId}", String(context.serverId ?? "unknown"))
      .replaceAll("{date}", parts.date)
      .replaceAll("{time}", parts.time.replaceAll(":", ""))
      .replaceAll("{timestamp}", parts.timestamp);
  }

  function compactNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function compactString(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  }

  function extractServerId(data, settings = {}) {
    const value = data?.serverId ?? data?.summary?.serverId ?? settings.serverId ?? TOPWAR.range?.()?.k;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : String(value ?? "unknown");
  }

  function buildPopulationRow(data, settings = {}) {
    const summary = data?.summary || {};
    const activity = summary.activity || {};
    const serverActivity = summary.serverActivity || {};
    const userStatus = summary.userStatus || {};
    const exportedAt = data?.exportedAt || nowIso();

    return {
      t: exportedAt,
      s: extractServerId(data, settings),
      p: compactNumber(summary.players),
      mp: compactNumber(summary.mapPlayers),
      a: compactNumber(summary.alliances),
      ad: compactNumber(summary.allianceDetails),
      core: compactNumber(activity.coreCount),
      active: compactNumber(activity.activeCount),
      watch: compactNumber(activity.watchCount),
      low: compactNumber(activity.lowCount),
      activeTotal: compactNumber(activity.activeTotalCount),
      grade: compactString(serverActivity.grade),
      score: compactNumber(serverActivity.score),
      activeUsers: compactNumber(userStatus.activeUsers),
      recentUsers: compactNumber(userStatus.recentUsers),
      inactiveUsers: compactNumber(userStatus.inactiveUsers),
      quitLikelyUsers: compactNumber(userStatus.quitLikelyUsers),
      activeUserRate: compactNumber(userStatus.activeUserRate),
      quitLikelyRate: compactNumber(userStatus.quitLikelyRate)
    };
  }

  function playerUid(row) {
    return compactString(row?.uid ?? row?.pid ?? row?.userId);
  }

  function normalizePlayer(row, serverId, exportedAt) {
    const uid = playerUid(row);
    if (!uid) return null;

    return {
      uid,
      serverId: compactNumber(row?.serverId ?? serverId),
      x: compactNumber(row?.x),
      y: compactNumber(row?.y),
      username: compactString(row?.username ?? row?.nickname ?? row?.name),
      nickname: compactString(row?.nickname ?? row?.username ?? row?.name),
      allianceId: compactString(row?.allianceId ?? row?.aid),
      allianceTag: compactString(row?.allianceTag ?? row?.a_tag),
      allianceName: compactString(row?.allianceName ?? row?.a_name),
      level: compactNumber(row?.level),
      rank: compactNumber(row?.rank),
      power: compactNumber(row?.power),
      score: compactNumber(row?.score ?? row?.power),
      armyPower: compactNumber(row?.armyPower),
      firstSeenAt: exportedAt,
      lastSeenAt: exportedAt,
      seenCount: 1,
      missingCount: 0
    };
  }

  function sameText(a, b) {
    return String(a ?? "") === String(b ?? "");
  }

  function coordDistance(a, b) {
    const ax = Number(a?.x);
    const ay = Number(a?.y);
    const bx = Number(b?.x);
    const by = Number(b?.y);
    if (![ax, ay, bx, by].every(Number.isFinite)) return 0;
    return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
  }

  function timeSinceMs(value, fallback = Infinity) {
    const ms = Date.parse(value || "");
    if (!Number.isFinite(ms)) return fallback;
    return Date.now() - ms;
  }

  function pushEvent(events, event) {
    events.push(Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)));
  }

  function movementPlayerSnapshot(player, fallbackServerId = null) {
    return {
      uid: compactString(player?.uid),
      nickname: compactString(player?.nickname ?? player?.username),
      server: compactNumber(player?.serverId ?? player?.server ?? fallbackServerId),
      rank: compactNumber(player?.rank),
      score: compactNumber(player?.score ?? player?.power),
      level: compactNumber(player?.level),
      allianceId: compactString(player?.allianceId),
      allianceTag: compactString(player?.allianceTag),
      allianceName: compactString(player?.allianceName)
    };
  }

  function readServerUserIndexLocal(serverId) {
    const value = readJsonLocal(`${SERVER_USER_INDEX_PREFIX}${serverId}`, null);
    return value && typeof value === "object" ? value : { version: 1, serverId, updatedAt: null, users: {} };
  }

  function writeServerUserIndexLocal(serverId, value) {
    value.version = 1;
    value.serverId = serverId;
    value.updatedAt = value.updatedAt || nowIso();
    return writeJsonLocal(`${SERVER_USER_INDEX_PREFIX}${serverId}`, value);
  }

  function readGlobalUserIndexLocal() {
    const value = readJsonLocal(GLOBAL_USER_INDEX_KEY, null);
    return value && typeof value === "object" ? value : { version: 1, updatedAt: null, users: {} };
  }

  function writeGlobalUserIndexLocal(value, settings) {
    value.version = 1;
    value.updatedAt = nowIso();

    const users = value.users || {};
    const maxEntries = Number(settings.maxLocalGlobalUserIndexEntries ?? DEFAULT_FAST_POLICY.maxLocalGlobalUserIndexEntries);
    const keys = Object.keys(users);

    if (maxEntries > 0 && keys.length > maxEntries) {
      keys
        .sort((a, b) => Date.parse(users[b]?.lastSeenAt || 0) - Date.parse(users[a]?.lastSeenAt || 0))
        .slice(maxEntries)
        .forEach(uid => delete users[uid]);
      value.prunedAt = nowIso();
      value.maxEntries = maxEntries;
    }

    return writeJsonLocal(GLOBAL_USER_INDEX_KEY, value);
  }

  function buildLocalMovementDiff(data, settings = {}) {
    const serverId = extractServerId(data, settings);
    const exportedAt = data?.exportedAt || nowIso();
    const players = Array.isArray(data?.players) ? data.players : [];
    const previousServerIndex = readServerUserIndexLocal(serverId);
    const previousUsers = previousServerIndex.users || {};
    const previousHadBaseline = Object.keys(previousUsers).length > 0;
    const trackActualInOut = settings.trackActualInOut !== false;
    const globalIndex = readGlobalUserIndexLocal();
    const globalUsers = globalIndex.users || {};
    const nextUsers = {};
    const seen = new Set();
    const events = [];

    for (const row of players) {
      const current = normalizePlayer(row, serverId, exportedAt);
      if (!current) continue;

      const uid = current.uid;
      seen.add(uid);
      const prev = previousUsers[uid] || null;
      const prevGlobal = globalUsers[uid] || null;

      const prevMissingCount = Number(prev?.missingCount ?? 0);
      const wasInPreviousActualSnapshot = !!prev && prevMissingCount === 0;

      // 실제 IN: 직전 실제 조사 결과에는 없었고, 이번 실제 조사 결과에는 있는 UID.
      // 첫 조사처럼 baseline이 없을 때는 전체 유저를 IN으로 오인하지 않도록 기록하지 않는다.
      if (trackActualInOut && previousHadBaseline && !wasInPreviousActualSnapshot) {
        pushEvent(events, {
          t: exportedAt,
          type: "IN",
          uid,
          name: current.username ?? prev?.username,
          serverId: current.serverId,
          x: current.x,
          y: current.y,
          allianceId: current.allianceId,
          allianceTag: current.allianceTag,
          power: current.power,
          previousStatus: prev ? "OUT" : "NOT_SEEN",
          previousMissingCount: prev?.missingCount,
          previousLastSeenAt: prev?.lastSeenAt
        });
      }

      if (!prev) {
        if (settings.recordFirstSeen === true) {
          pushEvent(events, {
            t: exportedAt,
            type: "FIRST_SEEN",
            uid,
            name: current.username,
            serverId: current.serverId,
            x: current.x,
            y: current.y,
            allianceId: current.allianceId,
            allianceTag: current.allianceTag,
            power: current.power
          });
        }
      } else if (prevMissingCount >= Number(settings.missingThreshold ?? DEFAULT_FAST_POLICY.missingThreshold)) {
        pushEvent(events, {
          t: exportedAt,
          type: "REAPPEARED",
          uid,
          name: current.username,
          serverId: current.serverId,
          x: current.x,
          y: current.y,
          previousMissingCount: prev.missingCount,
          lastSeenAt: prev.lastSeenAt
        });
      }

      if (prevGlobal?.serverId != null && String(prevGlobal.serverId) !== String(current.serverId)) {
        pushEvent(events, {
          detectedAt: exportedAt,
          uid,
          nickname: current.nickname ?? current.username ?? prevGlobal.nickname ?? prevGlobal.username,
          fromServer: compactNumber(prevGlobal.serverId),
          toServer: compactNumber(current.serverId),
          from: movementPlayerSnapshot(prevGlobal, prevGlobal.serverId),
          to: movementPlayerSnapshot(current, current.serverId)
        });
      }

      if (prev) {
        const distance = coordDistance(prev, current);
        const minDistance = Number(settings.minCoordDistance ?? DEFAULT_FAST_POLICY.minCoordDistance);
        const moveCooldown = Number(settings.baseMoveCooldownMs ?? DEFAULT_FAST_POLICY.baseMoveCooldownMs);

        if (distance >= minDistance && timeSinceMs(prev.lastBaseMoveEventAt || prev.lastSeenAt) >= moveCooldown) {
          pushEvent(events, {
            t: exportedAt,
            type: "BASE_MOVE",
            uid,
            name: current.username ?? prev.username,
            serverId: current.serverId,
            from: { x: prev.x, y: prev.y },
            to: { x: current.x, y: current.y },
            distance: Math.round(distance * 100) / 100,
            allianceId: current.allianceId,
            allianceTag: current.allianceTag
          });
          current.lastBaseMoveEventAt = exportedAt;
        } else {
          current.lastBaseMoveEventAt = prev.lastBaseMoveEventAt ?? null;
        }

        if (!sameText(prev.allianceId, current.allianceId) || !sameText(prev.allianceTag, current.allianceTag)) {
          pushEvent(events, {
            t: exportedAt,
            type: "ALLIANCE_CHANGE",
            uid,
            name: current.username ?? prev.username,
            serverId: current.serverId,
            from: { allianceId: prev.allianceId ?? null, allianceTag: prev.allianceTag ?? null },
            to: { allianceId: current.allianceId ?? null, allianceTag: current.allianceTag ?? null }
          });
        }

        if (current.username && prev.username && !sameText(prev.username, current.username)) {
          pushEvent(events, {
            t: exportedAt,
            type: "NAME_CHANGE",
            uid,
            serverId: current.serverId,
            from: prev.username,
            to: current.username
          });
        }

        const prevPower = Number(prev.power);
        const curPower = Number(current.power);
        if (Number.isFinite(prevPower) && Number.isFinite(curPower) && prevPower > 0) {
          const diff = curPower - prevPower;
          const absDiff = Math.abs(diff);
          const rate = absDiff / prevPower;
          const minRate = Number(settings.powerChangeRate ?? DEFAULT_FAST_POLICY.powerChangeRate);
          const minAbs = Number(settings.powerChangeAbsolute ?? DEFAULT_FAST_POLICY.powerChangeAbsolute);
          const cooldown = Number(settings.powerChangeCooldownMs ?? DEFAULT_FAST_POLICY.powerChangeCooldownMs);

          if ((rate >= minRate || absDiff >= minAbs) && timeSinceMs(prev.lastPowerEventAt) >= cooldown) {
            pushEvent(events, {
              t: exportedAt,
              type: "POWER_CHANGE",
              uid,
              name: current.username ?? prev.username,
              serverId: current.serverId,
              from: prevPower,
              to: curPower,
              diff,
              rate: Math.round(rate * 10000) / 10000
            });
            current.lastPowerEventAt = exportedAt;
          } else {
            current.lastPowerEventAt = prev.lastPowerEventAt ?? null;
          }
        }
      }

      nextUsers[uid] = {
        ...prev,
        ...current,
        firstSeenAt: prev?.firstSeenAt ?? current.firstSeenAt,
        lastSeenAt: exportedAt,
        seenCount: Number(prev?.seenCount ?? 0) + 1,
        missingCount: 0
      };

      globalUsers[uid] = {
        uid,
        serverId: current.serverId,
        username: current.username,
        nickname: current.nickname ?? current.username,
        allianceId: current.allianceId,
        allianceTag: current.allianceTag,
        allianceName: current.allianceName,
        x: current.x,
        y: current.y,
        level: current.level,
        rank: current.rank,
        power: current.power,
        score: current.score ?? current.power,
        lastSeenAt: exportedAt
      };
    }

    const missingThreshold = Number(settings.missingThreshold ?? DEFAULT_FAST_POLICY.missingThreshold);
    for (const [uid, prev] of Object.entries(previousUsers)) {
      if (seen.has(uid)) continue;

      const missingCount = Number(prev.missingCount ?? 0) + 1;
      const nextMissing = {
        ...prev,
        missingCount,
        lastMissingAt: exportedAt
      };

      // 이 서버에서 보이지 않는 것만으로는 OUT이나 서버이동으로 확정하지 않는다.
      // 전역 UID 인덱스에서 같은 UID가 다른 서버에서 실제 발견될 때 SERVER_MOVE로 기록한다.

      if (missingCount === missingThreshold) {
        pushEvent(events, {
          t: exportedAt,
          type: "MISSING",
          uid,
          name: prev.username,
          serverId: prev.serverId ?? serverId,
          x: prev.x,
          y: prev.y,
          allianceId: prev.allianceId,
          allianceTag: prev.allianceTag,
          lastSeenAt: prev.lastSeenAt,
          missingCount
        });
      }

      nextUsers[uid] = nextMissing;
    }

    const serverUserIndex = {
      version: 1,
      serverId,
      updatedAt: exportedAt,
      userCount: Object.values(nextUsers).filter(row => Number(row.missingCount ?? 0) === 0).length,
      missingCount: Object.values(nextUsers).filter(row => Number(row.missingCount ?? 0) > 0).length,
      users: nextUsers
    };

    writeServerUserIndexLocal(serverId, serverUserIndex);
    globalIndex.users = globalUsers;
    writeGlobalUserIndexLocal(globalIndex, settings);

    return {
      serverId,
      exportedAt,
      events,
      serverUserIndex,
      userServerIndex: globalIndex
    };
  }

  function readQueue() {
    const queue = readJsonLocal(QUEUE_KEY, null);
    return queue && typeof queue === "object"
      ? queue
      : { version: 1, updatedAt: null, population: {}, movement: {}, summaryServers: {}, touchedServerIds: [], countSinceFlush: 0 };
  }

  function writeQueue(queue) {
    queue.version = 1;
    queue.updatedAt = nowIso();
    queue.touchedServerIds = [...new Set((queue.touchedServerIds || []).map(String))];
    return writeJsonLocal(QUEUE_KEY, queue);
  }

  function clearQueue() {
    localStorage.removeItem(QUEUE_KEY);
    return true;
  }

  function addUniqueRow(rows, row, keyFn) {
    const key = keyFn(row);
    if (!rows.some(item => keyFn(item) === key)) rows.push(row);
  }

  function enqueueCompactHistory(data, movementResult, settings) {
    const serverId = extractServerId(data, settings);
    const exportedAt = data?.exportedAt || nowIso();
    const parts = dateParts(exportedAt);
    const queue = readQueue();
    const populationRow = buildPopulationRow(data, settings);

    queue.population[parts.date] ??= [];
    addUniqueRow(queue.population[parts.date], populationRow, row => `${row.t}|${row.s}`);

    const maxRows = Number(settings.maxLocalQueueRowsPerDate ?? DEFAULT_FAST_POLICY.maxLocalQueueRowsPerDate);
    if (maxRows > 0 && queue.population[parts.date].length > maxRows) {
      queue.population[parts.date] = queue.population[parts.date].slice(-maxRows);
    }

    // 날짜별 movement 파일에는 UID가 다른 서버에서 실제 발견된 SERVER_MOVE만 저장한다.
    // 단순 미검출, IN/OUT, CHECK 행은 movement 파일에 넣지 않는다.
    const movementEvents = (Array.isArray(movementResult?.events) ? movementResult.events : [])
      .filter(event => event?.uid && event?.fromServer != null && event?.toServer != null);
    const inCount = 0;
    const outCount = 0;

    for (const event of movementEvents) {
      const movementDate = serverDateParts(event.detectedAt || exportedAt).date;
      queue.movement[movementDate] ??= [];
      addUniqueRow(
        queue.movement[movementDate],
        event,
        row => `${row.detectedAt}|${row.uid}|${row.fromServer}|${row.toServer}`
      );

      if (maxRows > 0 && queue.movement[movementDate].length > maxRows) {
        queue.movement[movementDate] = queue.movement[movementDate].slice(-maxRows);
      }
    }

    queue.summaryServers[String(serverId)] = {
      status: "active",
      serverId,
      players: populationRow.p,
      mapPlayers: populationRow.mp,
      alliances: populationRow.a,
      allianceDetails: populationRow.ad,
      activity: {
        core: populationRow.core,
        active: populationRow.active,
        watch: populationRow.watch,
        low: populationRow.low,
        activeTotal: populationRow.activeTotal
      },
      serverActivity: {
        grade: populationRow.grade,
        score: populationRow.score
      },
      userStatus: {
        activeUsers: populationRow.activeUsers,
        recentUsers: populationRow.recentUsers,
        inactiveUsers: populationRow.inactiveUsers,
        quitLikelyUsers: populationRow.quitLikelyUsers,
        activeUserRate: populationRow.activeUserRate,
        quitLikelyRate: populationRow.quitLikelyRate
      },
      lastSurveyedAt: populationRow.t
    };

    queue.touchedServerIds ??= [];
    if (!queue.touchedServerIds.map(String).includes(String(serverId))) queue.touchedServerIds.push(String(serverId));
    queue.countSinceFlush = Number(queue.countSinceFlush ?? 0) + 1;

    return writeQueue(queue);
  }

  function buildServerListFilesFromSummaryIndex(summaryIndex) {
    const rows = Object.entries(summaryIndex?.servers || {})
      .map(([key, value]) => {
        const serverId = Number(value?.serverId ?? key);
        return {
          serverId,
          status: value?.status ?? "active",
          players: Number(value?.players ?? value?.mapPlayers ?? 0),
          mapPlayers: Number(value?.mapPlayers ?? value?.players ?? 0),
          lastSurveyedAt: value?.lastSurveyedAt ?? null
        };
      })
      .filter(row =>
        Number.isFinite(row.serverId) &&
        row.serverId > 0 &&
        row.status !== "inactive" &&
        row.status !== "disabled"
      );

    const popularServerIds = rows
      .slice()
      .sort((a, b) =>
        b.players - a.players ||
        b.mapPlayers - a.mapPlayers ||
        a.serverId - b.serverId
      )
      .map(row => row.serverId);

    const ascendingServerIds = rows
      .map(row => row.serverId)
      .sort((a, b) => a - b);

    return {
      popularServerIds,
      ascendingServerIds
    };
  }

  async function uploadServerListFiles(settings, summaryIndex, uploads) {
    if (settings.uploadServerLists === false) return null;

    const { popularServerIds, ascendingServerIds } = buildServerListFilesFromSummaryIndex(summaryIndex);

    const popularPath =
      settings.popularServerListPath ||
      DEFAULT_FAST_POLICY.popularServerListPath;

    const ascendingPath =
      settings.ascendingServerListPath ||
      DEFAULT_FAST_POLICY.ascendingServerListPath;

    uploads.push(await writeGithubJsonFileFast(
      settings,
      popularPath,
      popularServerIds,
      `Update TopWar popular server list (${popularServerIds.length})`
    ));

    uploads.push(await writeGithubJsonFileFast(
      settings,
      ascendingPath,
      ascendingServerIds,
      `Update TopWar ascending server list (${ascendingServerIds.length})`
    ));

    console.log("[TopWar V2.10.1 Fast Storage] 서버 목록 파일 갱신:", {
      popularPath,
      popularCount: popularServerIds.length,
      ascendingPath,
      ascendingCount: ascendingServerIds.length
    });

    return {
      popularPath,
      popularServerIds,
      ascendingPath,
      ascendingServerIds
    };
  }

  async function mergeAndUploadSummaryIndex(settings, queue, uploads) {
    if (settings.uploadSummaryIndex === false) return;

    const path = settings.summaryIndexPath || DEFAULT_FAST_POLICY.summaryIndexPath;
    const current = await readGithubJsonFile(settings, path, { version: 1, updatedAt: null, servers: {} });
    current.version = 1;
    current.updatedAt = nowIso();
    current.servers ??= {};

    for (const [serverId, row] of Object.entries(queue.summaryServers || {})) {
      current.servers[String(serverId)] = {
        ...current.servers[String(serverId)],
        ...row
      };
    }

    uploads.push(await writeGithubJsonFileFast(settings, path, current, "Update TopWar compact server summary index"));
    await uploadServerListFiles(settings, current, uploads);
  }

  async function mergeAndUploadPopulationHistory(settings, queue, uploads) {
    if (settings.uploadPopulationHistory === false) return;

    for (const [date, rows] of Object.entries(queue.population || {})) {
      if (!Array.isArray(rows) || !rows.length) continue;

      const path = renderPath(settings.populationHistoryPathTemplate || DEFAULT_FAST_POLICY.populationHistoryPathTemplate, { t: `${date}T00:00:00` });
      const current = await readGithubJsonFile(settings, path, { version: 1, date, rows: [] });
      current.version = 1;
      current.date = current.date || date;
      current.rows = Array.isArray(current.rows) ? current.rows : [];

      for (const row of rows) addUniqueRow(current.rows, row, item => `${item.t}|${item.s}`);

      const maxRows = Number(settings.maxPopulationHistoryRowsPerDay ?? DEFAULT_FAST_POLICY.maxPopulationHistoryRowsPerDay);
      if (maxRows > 0 && current.rows.length > maxRows) {
        current.rows = current.rows.slice(-maxRows);
        current.prunedAt = nowIso();
      }

      current.updatedAt = nowIso();
      uploads.push(await writeGithubJsonFileFast(settings, path, current, `Append TopWar compact population history ${date}`));
    }
  }

  async function mergeAndUploadMovementHistory(settings, queue, uploads) {
    if (settings.uploadUserMovementHistory === false) return;

    for (const [date, rows] of Object.entries(queue.movement || {})) {
      if (!Array.isArray(rows) || !rows.length) continue;

      const path = renderPath(settings.userMovementHistoryPathTemplate || DEFAULT_FAST_POLICY.userMovementHistoryPathTemplate, { t: `${date}T00:00:00` });
      const current = await readGithubJsonFile(settings, path, {
        version: 1,
        date,
        rows: [],
        serverTimezone: "UTC+8",
        serverResetAt: "00:00 UTC+8 (01:00 Asia/Seoul)",
        updatedAt: null
      });
      current.version = 1;
      current.date = date;
      current.rows = (Array.isArray(current.rows) ? current.rows : [])
        .filter(row => row?.uid && row?.fromServer != null && row?.toServer != null);

      for (const row of rows) {
        if (!row?.uid || row?.fromServer == null || row?.toServer == null) continue;
        addUniqueRow(
          current.rows,
          row,
          item => `${item.detectedAt}|${item.uid}|${item.fromServer}|${item.toServer}`
        );
      }

      current.rows.sort((a, b) =>
        Date.parse(a.detectedAt || 0) - Date.parse(b.detectedAt || 0) ||
        String(a.uid || "").localeCompare(String(b.uid || ""))
      );

      const maxRows = Number(settings.maxMovementHistoryRowsPerDay ?? DEFAULT_FAST_POLICY.maxMovementHistoryRowsPerDay);
      if (maxRows > 0 && current.rows.length > maxRows) {
        current.rows = current.rows.slice(-maxRows);
        current.prunedAt = nowIso();
      }

      current.serverTimezone = "UTC+8";
      current.serverResetAt = "00:00 UTC+8 (01:00 Asia/Seoul)";
      current.updatedAt = nowIso();
      uploads.push(await writeGithubJsonFileFast(settings, path, current, `Update TopWar real movement list ${date}`));
    }
  }

  async function uploadTouchedUserIndexes(settings, queue, uploads) {
    if (settings.uploadUserLatestIndex === false) return;

    const serverIds = [...new Set((queue.touchedServerIds || []).map(String))];
    for (const serverId of serverIds) {
      const index = readServerUserIndexLocal(serverId);
      if (!index?.users) continue;

      const path = renderPath(settings.serverUserLatestIndexPathTemplate || DEFAULT_FAST_POLICY.serverUserLatestIndexPathTemplate, { serverId, exportedAt: index.updatedAt || nowIso() });
      uploads.push(await writeGithubJsonFileFast(settings, path, index, `Update TopWar local user latest index server ${serverId}`));
    }

    if (settings.uploadUserServerIndex !== false) {
      const global = readGlobalUserIndexLocal();
      const path = settings.userServerIndexPath || DEFAULT_FAST_POLICY.userServerIndexPath;
      uploads.push(await writeGithubJsonFileFast(settings, path, global, "Update TopWar local global user server index"));
    }
  }

  async function flushLocalCompactHistoryToGithub(options = {}) {
    await TOPWAR.ensureGithubToken?.({ interactive: false });
    const settings = getFastSettings(options);
    assertGithubSettings(settings);

    const queue = readQueue();
    const uploads = [];

    const hasWork =
      Object.keys(queue.summaryServers || {}).length > 0 ||
      Object.values(queue.population || {}).some(rows => Array.isArray(rows) && rows.length) ||
      Object.values(queue.movement || {}).some(rows => Array.isArray(rows) && rows.length) ||
      (queue.touchedServerIds || []).length > 0;

    if (!hasWork) {
      console.log("[TopWar V2.9.3 Fast Storage] flush할 compact history가 없습니다.");
      return { ok: true, skipped: true, reason: "empty queue" };
    }

    await mergeAndUploadSummaryIndex(settings, queue, uploads);
    await mergeAndUploadPopulationHistory(settings, queue, uploads);
    await mergeAndUploadMovementHistory(settings, queue, uploads);
    await uploadTouchedUserIndexes(settings, queue, uploads);

    clearQueue();

    const result = {
      ok: true,
      mode: "v2.9.3-fast-compact-flush",
      uploadedAt: nowIso(),
      uploads
    };

    console.log("[TopWar V2.9.3 Fast Storage] compact history flush 완료:", uploads.map(row => row.path));
    return result;
  }

  async function uploadSurveyResultToGithubFastV293(data, options = {}) {
    if (TOPWAR.state?.watch133?.running === true) {
      return { ok: false, skipped: true, reason: "blocked during thief+cityReward finder" };
    }
    const dataHubServerId = Number(data?.serverId ?? options?.serverId);
    if (!Number.isFinite(dataHubServerId) || dataHubServerId <= 0) {
      throw new Error("DataHub 지도 업로드 serverId가 없습니다.");
    }
    return window.TOPWAR_DATAHUB.uploadMap({ ...data, serverId: dataHubServerId });

    /* Legacy GitHub uploader retained below for rollback/reference only. */
    await TOPWAR.ensureGithubToken?.({ interactive: true });
    const settings = getFastSettings(options);

    if (!settings.enabled) {
      console.log("[TopWar V2.9.3 Fast Storage] GitHub 업로드 비활성화 상태입니다.");
      return { ok: false, skipped: true, reason: "github upload disabled" };
    }

    assertGithubSettings(settings);

    const serverId = extractServerId(data, settings);
    const exportedAt = data?.exportedAt || nowIso();
    const uploads = [];
    const content = settings.pretty === false ? JSON.stringify(data) : JSON.stringify(data, null, 2);

    // 상세 히스토리는 명시적으로 켠 경우에만 저장한다.
    if (settings.uploadHistory === true) {
      const historyPath = renderPath(settings.pathTemplate || DEFAULT_FAST_POLICY.pathTemplate, { serverId, exportedAt });
      uploads.push(await writeGithubTextFileFast(settings, historyPath, content, `Upload TopWar server ${serverId} detailed history ${exportedAt}`));
    }

    // 즉시 저장은 latest만 기본 수행한다. SHA 캐시 덕분에 다음 덮어쓰기부터는 GET을 줄인다.
    if (settings.uploadLatest !== false) {
      const latestPath = renderPath(settings.latestPathTemplate || DEFAULT_FAST_POLICY.latestPathTemplate, { serverId, exportedAt });
      uploads.push(await writeGithubTextFileFast(settings, latestPath, content, `Update TopWar server ${serverId} latest result`));
    }

    // 인원/이동 추적은 로컬에서 비교하고 큐에만 누적한다. GitHub는 flush 때만 접속한다.
    const movement = buildLocalMovementDiff(data, settings);
    const queue = enqueueCompactHistory(data, movement, settings);

    let flushResult = null;
    if (settings.autoFlushCompactHistory === true) {
      const threshold = Math.max(1, Number(settings.compactFlushEveryServers ?? DEFAULT_FAST_POLICY.compactFlushEveryServers));
      if (Number(queue.countSinceFlush ?? 0) >= threshold) {
        flushResult = await flushLocalCompactHistoryToGithub(settings);
      }
    }

    const result = {
      ok: true,
      mode: "v2.9.3-fast-github-storage",
      serverId,
      exportedAt,
      uploads,
      localCompactQueue: {
        countSinceFlush: readQueue().countSinceFlush ?? 0,
        populationDates: Object.keys(readQueue().population || {}).length,
        movementDates: Object.keys(readQueue().movement || {}).length,
        touchedServers: readQueue().touchedServerIds?.length ?? 0,
        movementEvents: movement.events.filter(event => event?.fromServer != null && event?.toServer != null).length,
        inEvents: 0,
        outEvents: 0
      },
      flushResult
    };

    console.log("[TopWar V2.9.3 Fast Storage] latest 저장 + compact local queue 완료:", {
      serverId,
      immediateUploads: uploads.map(row => row.path),
      movementEvents: result.localCompactQueue.movementEvents,
      inEvents: result.localCompactQueue.inEvents,
      outEvents: result.localCompactQueue.outEvents,
      queuedServers: result.localCompactQueue.touchedServers,
      flush: !!flushResult
    });

    return result;
  }

  function fastGithubStorageStatus() {
    const settings = getFastSettings();
    const queue = readQueue();
    const shaCache = readShaCache();
    const globalIndex = readGlobalUserIndexLocal();
    const status = {
      enabled: !!settings.enabled,
      fastGithubStorage: settings.fastGithubStorage !== false,
      uploadLatest: settings.uploadLatest !== false,
      uploadHistory: settings.uploadHistory === true,
      uploadServerLists: settings.uploadServerLists !== false,
      popularServerListPath: settings.popularServerListPath,
      ascendingServerListPath: settings.ascendingServerListPath,
      trackActualInOut: settings.trackActualInOut !== false,
      autoFlushCompactHistory: settings.autoFlushCompactHistory === true,
      compactFlushEveryServers: settings.compactFlushEveryServers,
      queued: {
        countSinceFlush: queue.countSinceFlush ?? 0,
        populationDates: Object.keys(queue.population || {}).length,
        movementDates: Object.keys(queue.movement || {}).length,
        summaryServers: Object.keys(queue.summaryServers || {}).length,
        touchedServers: queue.touchedServerIds?.length ?? 0
      },
      shaCacheEntries: Object.keys(shaCache.entries || {}).length,
      localGlobalUserIndexEntries: Object.keys(globalIndex.users || {}).length,
      note: "정렬은 GitHub에 접속하지 않습니다. compact history는 flush 때만 GitHub에 접속합니다."
    };

    console.log("[TopWar V2.9.3 Fast Storage] 상태:", status);
    return status;
  }

  function configureFastGithubStoragePolicy(settings = {}) {
    const saved = saveStoredSettings({ ...settings, fastGithubStorage: settings.fastGithubStorage ?? true });
    console.log("[TopWar V2.9.3 Fast Storage] 설정 저장:", {
      fastGithubStorage: saved.fastGithubStorage,
      uploadLatest: saved.uploadLatest,
      uploadHistory: saved.uploadHistory,
      uploadServerLists: saved.uploadServerLists !== false,
      popularServerListPath: saved.popularServerListPath,
      ascendingServerListPath: saved.ascendingServerListPath,
      trackActualInOut: saved.trackActualInOut !== false,
      autoFlushCompactHistory: saved.autoFlushCompactHistory,
      compactFlushEveryServers: saved.compactFlushEveryServers,
      uploadUserServerIndex: saved.uploadUserServerIndex
    });
    return getFastSettings();
  }

  function clearFastGithubLocalQueue() {
    clearQueue();
    console.warn("[TopWar V2.9.3 Fast Storage] compact history local queue cleared");
    return true;
  }

  function clearFastGithubShaCache() {
    localStorage.removeItem(SHA_CACHE_KEY);
    console.warn("[TopWar V2.9.3 Fast Storage] GitHub SHA cache cleared");
    return true;
  }

  // v2.9 storage override를 다시 한 번 빠른 저장 방식으로 교체한다.
  TOPWAR.uploadSurveyResultToGithub = uploadSurveyResultToGithubFastV293;

  // 반복 조사 1사이클이 끝날 때만 compact history를 flush하고 싶을 때를 위한 래퍼.
  const previousRunMultiServerSurvey = TOPWAR.runMultiServerSurvey?.bind(TOPWAR);
  if (typeof previousRunMultiServerSurvey === "function" && !TOPWAR.__v293RunMultiWrapped) {
    TOPWAR.runMultiServerSurvey = async function runMultiServerSurveyWithOptionalFlush(options = {}) {
      const normalized = Array.isArray(options) ? { serverIds: options } : { ...options };
      const result = await previousRunMultiServerSurvey(normalized);
      if (normalized.flushCompactHistoryAfterEachCycle === true) {
        try {
          result.compactHistoryFlush = await window.TOPWAR_DATAHUB.flushQueued(100);
        } catch (error) {
          result.compactHistoryFlush = { ok: false, error: error?.message || String(error) };
          console.error("[TopWar V2.9.3 Fast Storage] cycle flush 실패:", error);
        }
      }

      return result;
    };

    TOPWAR.runServerSurveyBatch = TOPWAR.runMultiServerSurvey;
    TOPWAR.__v293RunMultiWrapped = true;
  }

  Object.assign(TOPWAR, {
    __v293FastGithubStorageInstalled: true,
    uploadSurveyResultToGithubFastV293,
    flushLocalCompactHistoryToGithub,
    buildServerListFilesFromSummaryIndex,
    uploadServerListFiles,
    fastGithubStorageStatus,
    configureFastGithubStoragePolicy,
    clearFastGithubLocalQueue,
    clearFastGithubShaCache
  });

  console.log("%c[TopWar V2.9.3 Fast GitHub Storage] installed", "color:#00e676;font-weight:bold");
})();

/* ============================================================================
 * GitHub 업로드 고정 설정
 *
 * GitHub Personal Access Token은 통합 패널에서 한 번 입력하며 모든 업로드가 공통 사용합니다.
 *
 * 저장 위치:
 *   서버별 최신 결과:
 *     src/assets/json/realpower/{serverId}.json
 *
 *   날짜별 이동 기록:
 *     src/assets/json/realpower/movement/{date}.json
 * ========================================================================== */
(function applyFixedGithubUploadSettings() {
  "use strict";

  const STORAGE_KEY = "TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS";

  let previousSettings = {};

  try {
    previousSettings = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}"
    );
  } catch (error) {
    console.warn("[TopWar GitHub] 기존 설정을 읽지 못했습니다.", error);
  }

  const fixedSettings = {
    ...previousSettings,

    enabled: previousSettings.enabled ?? true,

    owner: "hiphop5782",
    repo: "topwar-webutil-vite",
    branch: "main",

    // 서버별 최신 조사 결과
    // 예: src/assets/json/realpower/3223.json
    uploadLatest: true,
    latestPathTemplate:
      "src/assets/json/realpower/{serverId}.json",

    // 서버별 날짜별 전체 상세 결과 파일은 생성하지 않음
    uploadHistory: false,

    // 날짜별 이동 기록
    // 예: src/assets/json/realpower/movement/2026-07-13.json
    uploadUserMovementHistory: true,
    userMovementHistoryPathTemplate:
      "src/assets/json/realpower/movement/{date}.json",

    // 실제 UID가 다른 서버에서 발견된 경우에만 이동 기록 생성
    // 단순 미검출 OUT은 기록하지 않음
    trackActualInOut: true,
    flushCompactHistoryAfterEachCycle: true,

    // realpower 폴더 외의 부가 파일 생성 방지
    uploadSummaryIndex: false,
    uploadPopulationHistory: false,
    uploadUserLatestIndex: false,
    uploadUserServerIndex: false,
    uploadServerLists: false,

    pretty: true
  };

  // token은 전용 TOPWAR_GITHUB_TOKEN 키에만 저장한다.
  delete fixedSettings.token;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(fixedSettings)
  );

  console.log("[TopWar GitHub] 고정 업로드 설정 적용 완료", {
    enabled: fixedSettings.enabled,
    tokenConfigured: !!window.TOPWAR?.getGithubToken?.(),
    owner: fixedSettings.owner,
    repo: fixedSettings.repo,
    branch: fixedSettings.branch,
    latestPathTemplate:
      fixedSettings.latestPathTemplate,
    movementPathTemplate:
      fixedSettings.userMovementHistoryPathTemplate
  });

  if (!window.TOPWAR?.getGithubToken?.()) {
    console.warn("[TopWar GitHub] 통합 패널의 GitHub Token을 한 번 입력하세요.");
  }
})();

/* ============================================================================
 * TopWar V2.10.4 UI Recovery Bootstrap
 * - 원본 UI 코드는 수정하지 않는다.
 * - 원본 자동 부팅이 패널 생성을 놓친 경우 installUnifiedControlPanel()을 재호출한다.
 * ========================================================================== */
(function restoreTopwarV2104Ui() {
  "use strict";

  const PANEL_ID = "topwar-unified-control-panel-v26";
  let attempts = 0;
  const maxAttempts = 120;

  function tryRestore() {
    attempts++;

    const TOPWAR = window.TOPWAR;
    if (!TOPWAR) {
      if (attempts >= maxAttempts) {
        console.error("[TopWar UI Recovery] TOPWAR 객체가 생성되지 않았습니다.");
        clearInterval(timer);
      }
      return false;
    }

    if (document.getElementById(PANEL_ID)) {
      clearInterval(timer);
      return true;
    }

    if (!document.body || typeof TOPWAR.installUnifiedControlPanel !== "function") {
      if (attempts >= maxAttempts) {
        console.error("[TopWar UI Recovery] UI 설치 함수가 준비되지 않았습니다.", {
          hasBody: !!document.body,
          hasTopwar: !!TOPWAR,
          installType: typeof TOPWAR.installUnifiedControlPanel
        });
        clearInterval(timer);
      }
      return false;
    }

    try {
      TOPWAR.installUnifiedControlPanel();
    } catch (error) {
      console.error("[TopWar UI Recovery] installUnifiedControlPanel 실행 실패:", error);
    }

    if (document.getElementById(PANEL_ID)) {
      console.log("[TopWar UI Recovery] 기존 V2.10.4 UI 복구 완료");
      clearInterval(timer);
      return true;
    }

    return false;
  }

  const timer = setInterval(tryRestore, 500);
  setTimeout(tryRestore, 0);
})();

/* ============================================================================
 * TopWar CityReward Finder Add-on V1.9
 * - IMPORTANT: TopWar V2.10.4 본문은 수정하지 않는다.
 * - 기존 통합 UI가 생성된 후 버튼만 별도로 추가한다.
 * - cityReward는 정규화 객체가 아니라 최근 901 원본 패킷에서 직접 추출한다.
 * - 서버 하나의 전체 지도 스캔 완료 후 GitHub 1회 업로드한다.
 * - GitHub에는 cityReward가 null이 아닌 객체인 기지만 locations에 저장한다.
 * ========================================================================== */
(function installTopwarCityRewardFinderV18() {
  "use strict";

  const TOPWAR = window.TOPWAR;
  if (!TOPWAR) {
    console.error("[TopWar Reward Finder] TOPWAR 객체가 없습니다.");
    return;
  }

  if (TOPWAR.__cityRewardFinderV19Installed) return;

  const state = TOPWAR.state;

  const GITHUB = Object.freeze({
    owner: "hiphop5782",
    repo: "topwar-reward-finder",
    branch: "main",
    path: "data/city-rewards.json"
  });

  // 동일 실행에서는 방금 업로드한 통합 데이터와 SHA를 재사용한다.
  // 첫 업로드 뒤에는 서버마다 반복하던 통합 파일 GET과 SHA GET이 사라진다.
  let existingGithubDataCache = null;
  let existingGithubShaCache = null;

  const PANEL_BODY_ID = "tw26-body";
  const SERVER_INPUT_ID = "tw26-server";
  const BOX_ID = "tw26-cityreward-box-v14";
  const BUTTON_ID = "tw26-cityreward-button-v14";
  const STATUS_ID = "tw26-cityreward-status-v14";
  const ACTION_GROUP_ID = "tw26-scan-actions";

  function githubToken() {
    return TOPWAR.getGithubToken?.() || "";
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function sleep(ms) {
    return typeof TOPWAR.sleep === "function"
      ? TOPWAR.sleep(Math.max(0, Number(ms) || 0))
      : new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function parseJson(value, fallback = null) {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(String(value));
    } catch {
      return fallback;
    }
  }

  function parseRewardServerIds(value) {
    if (Array.isArray(value)) {
      return [...new Set(value.flatMap(parseRewardServerIds))];
    }

    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? [Math.trunc(value)] : [];
    }

    const text = String(value ?? "").trim();
    if (!text) return [];

    const result = [];

    for (const token of text.split(/[\s,，、;/|]+/).filter(Boolean)) {
      const range = token.match(/^(\d+)\s*[-~]\s*(\d+)$/);

      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        const step = start <= end ? 1 : -1;
        const count = Math.abs(end - start) + 1;

        if (count > 1000) throw new Error(`서버 범위가 너무 큽니다: ${token}`);

        for (let serverId = start; ; serverId += step) {
          if (serverId > 0) result.push(serverId);
          if (serverId === end) break;
        }
        continue;
      }

      const serverId = Number(token);
      if (Number.isFinite(serverId) && serverId > 0) result.push(Math.trunc(serverId));
    }

    return [...new Set(result)];
  }

  function ensureRewardState() {
    state.cityRewardFinder ??= {
      running: false,
      stopRequested: false,
      startedAt: null,
      finishedAt: null,
      serverIds: [],
      completedServers: [],
      current: null,
      currentRewards: new Map(),
      allSessionRewards: new Map(),
      totalFound: 0,
      lastUpload: null,
      lastResult: null,
      error: null,
      repeat: true,
      cycle: 0,
      cyclesCompleted: 0,
      totalServerScans: 0
    };

    const reward = state.cityRewardFinder;
    reward.repeat ??= true;
    reward.cycle ??= 0;
    reward.cyclesCompleted ??= 0;
    reward.totalServerScans ??= 0;
    reward.completedServers ??= [];
    reward.currentRewards ??= new Map();
    reward.allSessionRewards ??= new Map();
    return reward;
  }

  const REWARD_TTL_MS = 33 * 60 * 1000;

  function isCityRewardObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function rewardTimestampMs(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return value < 1000000000000 ? value * 1000 : value;
    }
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }

  function isFreshReward(row, nowMs = Date.now()) {
    if (!row || !isCityRewardObject(row.cityReward)) return false;
    const seenMs = rewardTimestampMs(row.cityRewardSeenAt ?? row.foundAt);
    if (seenMs == null) return false;
    return nowMs - seenMs < REWARD_TTL_MS;
  }

  function pruneRewardMap(map, nowMs = Date.now()) {
    if (!(map instanceof Map)) return 0;
    let removed = 0;
    for (const [key, row] of map) {
      if (!isFreshReward(row, nowMs)) {
        map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  function prunePlayerMapCityRewards(nowMs = Date.now()) {
    if (!(state.playerMap instanceof Map)) return 0;
    let removed = 0;

    for (const player of state.playerMap.values()) {
      const reward = player?.cityReward ?? player?.playerInfo?.cityReward;
      if (!isCityRewardObject(reward)) continue;

      const seenMs = rewardTimestampMs(player.cityRewardSeenAt ?? player.time);
      if (seenMs != null && nowMs - seenMs < REWARD_TTL_MS) continue;

      player.cityReward = undefined;
      player.hasCityRewardField = false;
      player.cityRewardPath = null;
      player.cityRewardSeenAt = null;

      if (player.playerInfo && typeof player.playerInfo === "object") {
        delete player.playerInfo.cityReward;
      }

      removed++;
    }

    return removed;
  }

  function parsePlayerInfo(point) {
    const raw = point?.p?.playerInfo;
    const parsed = parseJson(raw, null);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }

  function rawPointServerId(point, detail, fallbackServerId) {
    const value = point?.k ?? point?.p?.w ?? point?.p?.cMid ?? detail?.k ?? fallbackServerId;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : Number(fallbackServerId);
  }

  function rewardKey(row) {
    if (row.uid) return `${row.serverId}:uid:${row.uid}`;
    if (row.pointId != null) return `${row.serverId}:point:${row.pointId}`;
    return `${row.serverId}:coord:${row.x}:${row.y}`;
  }

  function normalizeRawRewardPoint(point, detail, targetServerId, packetRecord) {
    if (Number(point?.pointType) !== 1) return null;

    const serverId = rawPointServerId(point, detail, targetServerId);
    if (Number(serverId) !== Number(targetServerId)) return null;

    const playerInfo = parsePlayerInfo(point);
    const cityReward = playerInfo.cityReward;
    if (!isCityRewardObject(cityReward)) return null;

    const p = point?.p || {};
    const x = point?.x ?? null;
    const y = point?.y ?? null;
    if (x == null || y == null) return null;

    return {
      serverId: Number(targetServerId),
      x,
      y,
      uid: p?.pid != null
        ? String(p.pid)
        : p?.uid != null
          ? String(p.uid)
          : null,
      username: playerInfo?.username ?? playerInfo?.nickname ?? p?.username ?? p?.nickname ?? null,
      level: p?.level ?? p?.sml ?? playerInfo?.level ?? null,
      allianceId: p?.aid != null ? String(p.aid) : null,
      allianceTag: p?.a_tag ?? playerInfo?.a_tag ?? playerInfo?.allianceTag ?? null,
      pointId: point?.id ?? null,
      cityReward,
      cityRewardSeenAt: packetRecord?.time ?? nowIso(),
      foundAt: packetRecord?.time ?? nowIso()
    };
  }

  function normalizeEnrichedRewardPlayer(player, targetServerId) {
    if (!player || Number(player.pointType) !== 1) return null;
    if (Number(player.serverId) !== Number(targetServerId)) return null;

    const cityReward = player.cityReward;
    if (!isCityRewardObject(cityReward)) return null;
    if (player.x == null || player.y == null) return null;

    return {
      serverId: Number(targetServerId),
      x: player.x,
      y: player.y,
      uid: player.uid != null ? String(player.uid) : null,
      username: player.username ?? player.playerInfo?.username ?? player.playerInfo?.nickname ?? null,
      level: player.level ?? null,
      allianceId: player.allianceId != null ? String(player.allianceId) : null,
      allianceTag: player.allianceTag ?? null,
      pointId: player.pointId ?? player.id ?? null,
      cityReward,
      cityRewardSeenAt: player.cityRewardSeenAt ?? player.time ?? null,
      foundAt: player.cityRewardSeenAt ?? player.time ?? nowIso()
    };
  }

  function collectRewardsFromRecent901(targetServerId, destinationMap = null) {
    const reward = ensureRewardState();
    const output = destinationMap instanceof Map ? destinationMap : reward.currentRewards;
    const nowMs = Date.now();
    const expiredPlayerRewardsRemoved = prunePlayerMapCityRewards(nowMs);
    const expiredRemoved = pruneRewardMap(output, nowMs);
    let added = 0;

    // V1.5부터는 TOPWAR.players()가 playerInfo/cityReward를 보존하므로 이것을 1차 소스로 사용한다.
    // 디버깅 시 TOPWAR.playersWithCityReward() 결과와 Finder 결과를 직접 비교할 수 있다.
    if (typeof TOPWAR.playerValues === "function" || typeof TOPWAR.players === "function") {
      // Map iterator를 직접 사용해 좌표마다 플레이어 전체 임시 배열을 만들지 않는다.
      const playerSource = typeof TOPWAR.playerValues === "function"
        ? TOPWAR.playerValues()
        : TOPWAR.players();
      for (const player of playerSource) {
        const row = normalizeEnrichedRewardPlayer(player, targetServerId);
        if (!row) continue;
        const key = rewardKey(row);
        if (!output.has(key)) added++;
        output.set(key, row);
      }
    }

    // 최근 901 원본도 fallback으로 계속 검사한다.
    // playerMap에 들어가지 못한 특이 케이스가 있어도 놓치지 않도록 이 경로를 유지한다.
    const records = typeof TOPWAR.byC === "function" ? (TOPWAR.byC(901) || []) : [];

    for (const record of records) {
      const decoded = record?.packet?.decoded;
      const detail = decoded?.parsedDetail ?? decoded?.detail ?? null;
      if (!detail || typeof detail !== "object") continue;

      const pointList = Array.isArray(detail?.pointList) ? detail.pointList : [];

      for (const point of pointList) {
        const row = normalizeRawRewardPoint(point, detail, targetServerId, record);
        if (!row) continue;

        const key = rewardKey(row);
        if (!output.has(key)) added++;
        output.set(key, row);
      }
    }

    const expiredRemovedAfterCollect = pruneRewardMap(output, Date.now());

    return {
      added,
      expiredRemoved: expiredRemoved + expiredRemovedAfterCollect,
      expiredPlayerRewardsRemoved,
      total: output.size,
      locations: [...output.values()]
    };
  }

  function stopRewardFinder() {
    const reward = ensureRewardState();
    if (!reward.running) return false;
    reward.stopRequested = true;
    console.warn("[TopWar Reward Finder] 중지 요청됨");
    return true;
  }

  function shouldStopRewardFinder() {
    const reward = ensureRewardState();
    return !!reward.stopRequested || !!state?.connectionGuard?.disconnected;
  }

  function rewardFinderStatus() {
    const reward = ensureRewardState();
    prunePlayerMapCityRewards();
    pruneRewardMap(reward.currentRewards);
    pruneRewardMap(reward.allSessionRewards);
    reward.totalFound = reward.allSessionRewards?.size ?? reward.totalFound;
    const result = {
      ttlMinutes: REWARD_TTL_MS / 60000,
      running: reward.running,
      stopRequested: reward.stopRequested,
      startedAt: reward.startedAt,
      finishedAt: reward.finishedAt,
      serverIds: reward.serverIds,
      completedServers: reward.completedServers,
      repeat: reward.repeat,
      cycle: reward.cycle,
      cyclesCompleted: reward.cyclesCompleted,
      totalServerScans: reward.totalServerScans,
      current: reward.current,
      totalFound: reward.totalFound,
      currentFound: reward.currentRewards?.size ?? 0,
      lastUpload: reward.lastUpload,
      error: reward.error
    };
    console.log("[TopWar Reward Finder] 상태:", result);
    return result;
  }

  function rewardFinderTable() {
    const reward = ensureRewardState();
    prunePlayerMapCityRewards();
    pruneRewardMap(reward.allSessionRewards);
    const rows = [...(reward.allSessionRewards?.values?.() || [])];
    console.table(rows.map((row, index) => ({
      index,
      serverId: row.serverId,
      x: row.x,
      y: row.y,
      uid: row.uid,
      username: row.username,
      allianceTag: row.allianceTag,
      cityReward: JSON.stringify(row.cityReward)
    })));
    return rows;
  }

  async function scanRewardServer(serverId, options = {}) {
    const reward = ensureRewardState();

    if (typeof TOPWAR.moveMapToStableUnified !== "function") {
      return { ok: false, completed: false, serverId, reason: "moveMapToStableUnified not found" };
    }

    if (typeof TOPWAR.buildScanCoords !== "function" || typeof TOPWAR.buildScanPlan !== "function") {
      return { ok: false, completed: false, serverId, reason: "scan helper not found" };
    }

    const controller = typeof TOPWAR.mapCtrl === "function" ? TOPWAR.mapCtrl() : null;
    if (!controller) {
      return { ok: false, completed: false, serverId, reason: "NWorldController not found" };
    }

    // 기존 수집 캐시만 초기화한다. UI DOM과는 관계없다.
    TOPWAR.clearCollected?.({ keepWatch: true });
    reward.currentRewards = new Map();

    const range = controller.getWorldMapDataInstance?.()?.status?.viewport?.range;
    const subMap = options.subMap ?? range?.sub ?? 0;
    const xs = TOPWAR.buildScanCoords(options.startX ?? 50, options.endX ?? 750, options.stepX ?? 80, "x");
    const ys = TOPWAR.buildScanCoords(options.startY ?? 50, options.endY ?? 875, options.stepY ?? 75, "y");
    const plan = TOPWAR.buildScanPlan(xs, ys, {
      startCorner: options.startCorner ?? "top-left",
      snake: options.snake !== false
    });

    const totalMoves = plan.reduce((sum, row) => sum + row.xOrder.length, 0);
    const startedAt = nowIso();
    const startedMs = Date.now();
    let moveIndex = 0;
    let failCount = 0;

    console.log(`[TopWar Reward Finder] 서버 ${serverId} 지도 스캔 시작: ${totalMoves} moves`);

    for (const row of plan) {
      for (const x of row.xOrder) {
        if (shouldStopRewardFinder()) {
          return {
            ok: false,
            stopped: true,
            completed: false,
            serverId: Number(serverId),
            reason: "stopped",
            startedAt,
            finishedAt: nowIso(),
            totalMoves,
            moveIndex,
            failCount,
            count: reward.currentRewards.size,
            locations: [...reward.currentRewards.values()]
          };
        }

        const y = row.y;
        reward.current = {
          phase: "mapScan",
          cycle: options.cycle ?? reward.cycle ?? 1,
          serverId: Number(serverId),
          serverIndex: options.serverIndex ?? null,
          totalServers: options.totalServers ?? reward.serverIds?.length ?? null,
          totalServerScans: reward.totalServerScans ?? 0,
          moveIndex: moveIndex + 1,
          totalMoves,
          x,
          y,
          found: reward.currentRewards.size
        };

        let moveResult = null;
        try {
          moveResult = await TOPWAR.moveMapToStableUnified(x, y, {
            serverId: Number(serverId),
            subMap,
            scale: options.scale ?? 0.27,
            afterMoveWait: options.afterMoveWait ?? 120,
            wait901Timeout: options.wait901Timeout ?? 2200,
            quietMs: options.quietMs ?? 300,
            interval: options.interval ?? 30,
            maxRetries: options.maxRetries ?? 1,
            retryDelay: options.retryDelay ?? 250,
            collectCache: true
          });
        } catch (error) {
          console.error(`[TopWar Reward Finder] 이동 오류 server=${serverId} (${x},${y})`, error);
        }

        moveIndex++;
        if (!moveResult?.ok) failCount++;

        const currentPlayers = Number(TOPWAR.summary?.()?.players ?? 0);
        const maxPlayersPerServer = Number(options.maxPlayersPerServer ?? 2000);
        if (Number.isFinite(maxPlayersPerServer) && maxPlayersPerServer > 0 &&
            currentPlayers >= maxPlayersPerServer) {
          const reason = `player limit exceeded: ${currentPlayers}/${maxPlayersPerServer}`;
          console.warn(`[TopWar Player Guard] server=${serverId} players=${currentPlayers} - 보상조사 폐기, 다음 서버로 이동`);

          reward.currentRewards.clear();
          TOPWAR.clearHeavySurveyData?.({ packetLimit: 0, outgoingLimit: 0 });
          TOPWAR.clearCollected?.({ keepWatch: true });

          return {
            ok: false,
            stopped: false,
            completed: false,
            skipped: true,
            playerLimitExceeded: true,
            serverId: Number(serverId),
            players: currentPlayers,
            maximumPlayers: maxPlayersPerServer,
            reason,
            startedAt,
            finishedAt: nowIso(),
            totalMoves,
            moveIndex,
            failCount,
            count: 0,
            locations: []
          };
        }

        const collected = collectRewardsFromRecent901(serverId, reward.currentRewards);

        reward.current = {
          phase: "mapScan",
          cycle: options.cycle ?? reward.cycle ?? 1,
          serverId: Number(serverId),
          serverIndex: options.serverIndex ?? null,
          totalServers: options.totalServers ?? reward.serverIds?.length ?? null,
          totalServerScans: reward.totalServerScans ?? 0,
          moveIndex,
          totalMoves,
          x,
          y,
          found: reward.currentRewards.size,
          failCount
        };

        if (
          collected.added > 0 ||
          moveIndex % Math.max(1, Number(options.logEvery ?? 5)) === 0 ||
          !moveResult?.ok
        ) {
          console.log(
            `[TopWar Reward Finder] server=${serverId} scan=${moveIndex}/${totalMoves} coord=(${x},${y}) ok=${!!moveResult?.ok} reward=${reward.currentRewards.size} new=${collected.added} fail=${failCount}`
          );
        }
      }
    }

    const allMovesFailed = totalMoves > 0 && failCount >= totalMoves;
    const locations = [...reward.currentRewards.values()].sort((a, b) =>
      Number(a.x ?? 0) - Number(b.x ?? 0) || Number(a.y ?? 0) - Number(b.y ?? 0)
    );

    return {
      ok: !allMovesFailed,
      completed: true,
      serverId: Number(serverId),
      startedAt,
      finishedAt: nowIso(),
      elapsedSec: Math.round((Date.now() - startedMs) / 1000),
      totalMoves,
      failCount,
      count: locations.length,
      locations,
      reason: allMovesFailed ? "all map moves failed" : null
    };
  }

  function decodeBase64Utf8(base64) {
    const clean = String(base64 ?? "").replace(/\s+/g, "");
    if (!clean) return "";
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function loadExistingGithubData() {
    if (existingGithubDataCache) return existingGithubDataCache;

    await TOPWAR.ensureGithubToken?.({ interactive: true });
    const token = githubToken();
    if (!token) throw new Error("GitHub token이 없습니다. 통합 패널에서 한 번 입력하세요.");
    const encodedPath = GITHUB.path.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(GITHUB.owner)}/${encodeURIComponent(GITHUB.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(GITHUB.branch)}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (response.status === 404) {
      existingGithubShaCache = null;
      existingGithubDataCache = { version: 3, updatedAt: null, count: 0, locations: [] };
      return existingGithubDataCache;
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`[GitHub ${response.status}] ${body?.message || response.statusText}`);
    }

    const text = decodeBase64Utf8(body?.content || "");
    const parsed = parseJson(text, null);
    existingGithubShaCache = body?.sha ?? null;

    if (Array.isArray(parsed?.locations)) {
      existingGithubDataCache = {
        version: Number(parsed.version || 3),
        updatedAt: parsed.updatedAt ?? null,
        count: parsed.locations.length,
        locations: parsed.locations.filter(row => isFreshReward(row))
      };
      return existingGithubDataCache;
    }

    // 예전 servers[].locations 형식도 읽는다.
    if (Array.isArray(parsed?.servers)) {
      const locations = parsed.servers.flatMap(server =>
        Array.isArray(server?.locations)
          ? server.locations.filter(row => isFreshReward(row))
          : []
      );
      existingGithubDataCache = { version: 3, updatedAt: parsed.updatedAt ?? null, count: locations.length, locations };
      return existingGithubDataCache;
    }

    existingGithubDataCache = { version: 3, updatedAt: null, count: 0, locations: [] };
    return existingGithubDataCache;
  }

  function mergeCompletedServer(existingData, serverResult) {
    const serverId = Number(serverResult.serverId);

    const untouched = (existingData?.locations || [])
      .filter(row => Number(row?.serverId) !== serverId)
      .filter(row => isFreshReward(row));

    const current = (serverResult?.locations || [])
      .filter(row => Number(row?.serverId) === serverId)
      .filter(row => isFreshReward(row));

    const locations = [...new Map(
      [...untouched, ...current].map(row => [rewardKey(row), row])
    ).values()].sort((a, b) =>
      Number(a.serverId ?? 0) - Number(b.serverId ?? 0) ||
      Number(a.x ?? 0) - Number(b.x ?? 0) ||
      Number(a.y ?? 0) - Number(b.y ?? 0)
    );

    return {
      version: 3,
      updatedAt: nowIso(),
      count: locations.length,
      locations
    };
  }

  async function uploadCompletedServer(serverResult) {
    if (!serverResult?.completed || !serverResult?.ok) {
      return { ok: false, skipped: true, reason: "server scan not completed" };
    }

    const dataHubServerId = Number(serverResult.serverId);
    if (!Number.isFinite(dataHubServerId) || dataHubServerId <= 0) {
      throw new Error("DataHub 도시보상 업로드 serverId가 없습니다.");
    }
    const locations = Array.isArray(serverResult.locations) ? serverResult.locations : [];
    const dataHubUpload = await window.TOPWAR_DATAHUB.uploadCityRewards({
      version: 3,
      serverId: dataHubServerId,
      scannedAt: serverResult.scannedAt || nowIso(),
      count: locations.length,
      locations
    });
    return { ...dataHubUpload, serverId: dataHubServerId, found: locations.length };

    /* Legacy GitHub uploader retained below for rollback/reference only. */
    const token = githubToken();
    const existing = await loadExistingGithubData();
    const merged = mergeCompletedServer(existing, serverResult);
    const content = JSON.stringify(merged, null, 2);

    if (typeof TOPWAR.uploadTextToGithubContents !== "function") {
      throw new Error("TOPWAR.uploadTextToGithubContents 함수를 찾지 못했습니다.");
    }

    const upload = await TOPWAR.uploadTextToGithubContents({
      token,
      owner: GITHUB.owner,
      repo: GITHUB.repo,
      branch: GITHUB.branch,
      path: GITHUB.path,
      content,
      message: `Update cityReward locations for server ${serverResult.serverId}`,
      knownSha: existingGithubShaCache
    });

    existingGithubDataCache = merged;
    existingGithubShaCache = upload?.content?.sha ?? existingGithubShaCache;

    return {
      ok: true,
      serverId: Number(serverResult.serverId),
      found: serverResult.count,
      totalCount: merged.count,
      path: GITHUB.path,
      htmlUrl: upload?.content?.html_url ?? null
    };
  }

  async function runRewardFinder(options = {}) {
    const reward = ensureRewardState();
    if (reward.running) return { ok: false, reason: "already running" };

    if (state?.ui?.serverSurvey?.running || state?.ui?.serverSurveyBatch?.running) {
      return { ok: false, reason: "server survey is running" };
    }

    if (state?.watch133?.running) {
      return { ok: false, reason: "thief watch is running" };
    }

    let serverIds = parseRewardServerIds(options.serverIds ?? options.servers ?? options.serverId);

    if (!serverIds.length) {
      serverIds = TOPWAR.getCachedRemoteServerList?.()?.serverIds ?? [];
    }

    if (!serverIds.length && options.useRemoteServerList !== false) {
      try {
        serverIds = await TOPWAR.loadRemoteServerIds?.({
          maxAgeMs: options.remoteServerListMaxAgeMs ?? 60 * 60 * 1000,
          debug: options.remoteServerListDebug ?? true
        }) ?? [];
      } catch (error) {
        console.error("[TopWar Reward Finder] popular 서버목록 로드 실패", error);
      }
    }

    if (!serverIds.length) return { ok: false, reason: "serverIds is required and popular server list is unavailable" };

    // 기본값은 무한 반복. 1회만 실행하려면 TOPWAR.runRewardFinder({ ..., repeat: false }) 사용.
    const repeat = options.repeat !== false;
    const historyLimit = Math.max(10, Number(options.historyLimit ?? 100));

    function pushRecent(list, value) {
      list.push(value);
      if (list.length > historyLimit) {
        list.splice(0, list.length - historyLimit);
      }
    }

    async function waitInterruptible(ms) {
      const delay = Math.max(0, Number(ms) || 0);
      const until = Date.now() + delay;
      while (Date.now() < until) {
        if (shouldStopRewardFinder()) return false;
        await sleep(Math.min(250, Math.max(1, until - Date.now())));
      }
      return !shouldStopRewardFinder();
    }

    reward.running = true;
    reward.stopRequested = false;
    reward.startedAt = nowIso();
    reward.finishedAt = null;
    reward.serverIds = serverIds.slice();
    reward.completedServers = [];
    reward.currentRewards = new Map();
    reward.allSessionRewards = new Map();
    reward.totalFound = 0;
    reward.lastUpload = null;
    reward.error = null;
    reward.repeat = repeat;
    reward.cycle = 0;
    reward.cyclesCompleted = 0;
    reward.totalServerScans = 0;

    const session = {
      ok: false,
      repeat,
      startedAt: reward.startedAt,
      finishedAt: null,
      serverIds: serverIds.slice(),
      cycle: 0,
      cyclesCompleted: 0,
      totalServerScans: 0,
      completedServers: [],
      results: [],
      uploads: [],
      stopped: false,
      reason: null
    };

    try {
      scanLoop:
      while (true) {
        if (shouldStopRewardFinder()) {
          session.stopped = true;
          session.reason = reward.stopRequested ? "stopped by user" : "connection disconnected";
          break;
        }

        const cycle = reward.cycle + 1;
        reward.cycle = cycle;
        reward.completedServers = [];
        session.cycle = cycle;
        session.completedServers = [];
        let completedThisCycle = 0;

        console.log(`[TopWar Reward Finder] ===== ${cycle}회차 시작: ${serverIds.join(",")} =====`);

        for (let index = 0; index < serverIds.length; index++) {
          const serverId = serverIds[index];

          if (shouldStopRewardFinder()) {
            session.stopped = true;
            session.reason = reward.stopRequested ? "stopped by user" : "connection disconnected";
            break scanLoop;
          }

          reward.current = {
            phase: "serverStart",
            cycle,
            serverId,
            serverIndex: index + 1,
            totalServers: serverIds.length,
            totalServerScans: reward.totalServerScans,
            found: reward.totalFound
          };

          const result = await scanRewardServer(serverId, {
            ...options,
            cycle,
            serverIndex: index + 1,
            totalServers: serverIds.length
          });
          result.cycle = cycle;
          pushRecent(session.results, result);

          if (result?.stopped || shouldStopRewardFinder()) {
            session.stopped = true;
            session.reason = reward.stopRequested ? "stopped by user" : (result?.reason || "connection disconnected");
            break scanLoop;
          }

          if (!result?.ok || !result?.completed) {
            console.error(`[TopWar Reward Finder] ${cycle}회차 서버 ${serverId} 스캔 실패`, result);

            if (options.stopOnServerFail === true) {
              session.reason = `server ${serverId} failed`;
              break scanLoop;
            }
          } else {
            completedThisCycle++;
            reward.totalServerScans++;
            session.totalServerScans = reward.totalServerScans;
            reward.completedServers.push(serverId);
            session.completedServers = reward.completedServers.slice();

            for (const row of result.locations || []) {
              if (isFreshReward(row)) reward.allSessionRewards.set(rewardKey(row), row);
            }
            pruneRewardMap(reward.allSessionRewards);
            reward.totalFound = reward.allSessionRewards.size;

            reward.current = {
              phase: "githubUpload",
              cycle,
              serverId,
              serverIndex: index + 1,
              totalServers: serverIds.length,
              totalServerScans: reward.totalServerScans,
              found: reward.totalFound
            };

            try {
              const upload = await uploadCompletedServer(result);
              upload.cycle = cycle;
              pushRecent(session.uploads, upload);
              reward.lastUpload = upload;
              console.log(`[TopWar Reward Finder] ${cycle}회차 서버 ${serverId} 업로드 완료: ${result.count}개`);
            } catch (error) {
              const uploadError = {
                ok: false,
                cycle,
                serverId,
                error: error?.message || String(error)
              };
              pushRecent(session.uploads, uploadError);
              reward.lastUpload = uploadError;
              console.error(`[TopWar Reward Finder] ${cycle}회차 서버 ${serverId} GitHub 업로드 실패`, error);

              if (options.stopOnUploadFail === true) {
                session.reason = `github upload failed: ${serverId}`;
                break scanLoop;
              }
            }
          }

          if (shouldStopRewardFinder()) {
            session.stopped = true;
            session.reason = reward.stopRequested ? "stopped by user" : "connection disconnected";
            break scanLoop;
          }

          const isLastServer = index === serverIds.length - 1;

          // 같은 회차 내에서 다음 서버로 넘어갈 때만 서버간 대기한다.
          if (!isLastServer && !(await waitInterruptible(options.betweenServerDelay ?? 1000))) {
            session.stopped = true;
            session.reason = reward.stopRequested ? "stopped by user" : "connection disconnected";
            break scanLoop;
          }
        }

        // 마지막 서버 처리 직후 회차 완료 여부를 먼저 확정한다.
        if (completedThisCycle === serverIds.length) {
          reward.cyclesCompleted++;
          session.cyclesCompleted = reward.cyclesCompleted;
          console.log(`[TopWar Reward Finder] ===== ${cycle}회차 완료 / 누적 서버스캔 ${reward.totalServerScans}회 =====`);
        } else {
          console.warn(`[TopWar Reward Finder] ${cycle}회차 일부 서버 미완료: ${completedThisCycle}/${serverIds.length}`);
        }

        if (!repeat) break;

        reward.current = {
          phase: "cycleDelay",
          cycle,
          nextCycle: cycle + 1,
          totalServers: serverIds.length,
          totalServerScans: reward.totalServerScans,
          found: reward.totalFound
        };

        // 한 회차가 끝나면 잠시 쉰 후 첫 번째 서버부터 다시 시작한다.
        if (!(await waitInterruptible(options.betweenCycleDelay ?? options.betweenServerDelay ?? 1000))) {
          session.stopped = true;
          session.reason = reward.stopRequested ? "stopped by user" : "connection disconnected";
          break;
        }
      }

      if (!repeat) {
        session.ok = session.cyclesCompleted >= 1 && !session.reason;
        if (!session.ok && !session.reason) session.reason = "some servers were not completed";
      } else {
        // 무한 반복은 정상 종료가 사용자 중지이므로, 최소 1회차 이상 완료했으면 실행 자체는 성공으로 본다.
        session.ok = session.cyclesCompleted >= 1 && !session.error;
      }

      return session;
    } catch (error) {
      session.reason = "exception";
      session.error = { message: error?.message || String(error), stack: error?.stack || null };
      reward.error = session.error;
      console.error("[TopWar Reward Finder] 실행 오류", error);
      return session;
    } finally {
      session.finishedAt = nowIso();
      session.cycle = reward.cycle;
      session.cyclesCompleted = reward.cyclesCompleted;
      session.totalServerScans = reward.totalServerScans;
      session.completedServers = reward.completedServers.slice();

      reward.running = false;
      reward.finishedAt = session.finishedAt;
      reward.lastResult = session;
      reward.current = {
        phase: session.stopped ? "stopped" : "done",
        cycle: reward.cycle,
        cyclesCompleted: reward.cyclesCompleted,
        completedServers: reward.completedServers.slice(),
        totalServers: serverIds.length,
        totalServerScans: reward.totalServerScans,
        found: reward.totalFound
      };
    }
  }

  function installRewardButton() {
    const body = document.getElementById(PANEL_BODY_ID);
    if (!body) return false;

    const actionGroup = document.getElementById(ACTION_GROUP_ID) || body;
    let button = document.getElementById(BUTTON_ID);
    let box = document.getElementById(BOX_ID);
    let status = document.getElementById(STATUS_ID);

    // 도둑찾기/서버조사와 같은 작업 버튼 그룹에 배치한다.
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.textContent = "도시보상";
      button.style.cssText = "height:38px;border:0;border-radius:7px;background:#3b3b3b;color:#eee;font-size:12px;font-weight:700;cursor:pointer;min-width:0;";
      actionGroup.appendChild(button);
    }

    // 상세 진행 상태는 버튼 그룹 바로 아래에 작게 유지한다.
    if (!box) {
      box = document.createElement("div");
      box.id = BOX_ID;
      box.style.cssText = "display:none;margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);";
      status = document.createElement("div");
      status.id = STATUS_ID;
      status.style.cssText = "font-size:10px;line-height:1.4;color:#aaa;word-break:break-word;";
      status.textContent = "cityReward 객체 보유 기지만 GitHub 저장 · 서버 미입력 시 popular 전체";
      box.appendChild(status);
      actionGroup.insertAdjacentElement("afterend", box);
    }

    if (button.dataset.topwarRewardBound === "1") return true;
    button.dataset.topwarRewardBound = "1";

    async function handleClick(event) {
      event.preventDefault();
      event.stopPropagation();

      const reward = ensureRewardState();
      if (reward.running) {
        stopRewardFinder();
        return;
      }

      if (state?.connectionGuard?.disconnected) {
        alert("서버 연결 실패 상태입니다. 연결을 복구한 뒤 실행하세요.");
        return;
      }

      if (state?.watch133?.running) {
        alert("도둑찾기가 진행 중입니다. 먼저 OFF 하세요.");
        return;
      }

      if (state?.ui?.serverSurvey?.running || state?.ui?.serverSurveyBatch?.running) {
        alert("서버조사가 진행 중입니다. 먼저 OFF 하세요.");
        return;
      }

      const input = document.getElementById(SERVER_INPUT_ID);
      let serverIds;
      try {
        serverIds = parseRewardServerIds(input?.value ?? "");
      } catch (error) {
        alert(error?.message || String(error));
        return;
      }

      if (!serverIds.length) {
        try {
          serverIds = await TOPWAR.resolveAutomationServerIds?.() ??
            TOPWAR.getCachedRemoteServerList?.()?.serverIds ?? [];
        } catch (error) {
          console.error("[TopWar Reward Finder UI] popular 서버목록 확인 실패", error);
        }
      }

      if (!serverIds.length) {
        alert("popular 서버목록을 사용할 수 없습니다. 서버번호를 직접 입력하세요.");
        return;
      }

      if (!TOPWAR.mapCtrl?.()) {
        alert("월드맵 화면에서 실행하세요.");
        return;
      }

      runRewardFinder({
        serverIds,
        startX: 50,
        startY: 50,
        endX: 750,
        endY: 875,
        stepX: 80,
        stepY: 75,
        scale: 0.27,
        wait901Timeout: 2200,
        quietMs: 300,
        maxRetries: 1,
        betweenServerDelay: 1000,
        betweenCycleDelay: 1000,
        repeat: true,
        logEvery: 5,
        stopOnUploadFail: false
      }).then(result => {
        console.log("[TopWar Reward Finder UI] 종료", result);
      }).catch(error => {
        console.error("[TopWar Reward Finder UI] 오류", error);
      });
    }

    button.addEventListener("click", handleClick);

    const updateTimer = setInterval(() => {
      if (!document.body?.contains(box)) {
        clearInterval(updateTimer);
        return;
      }

      const reward = ensureRewardState();
      const current = reward.current || {};

      box.style.display = reward.running ? "block" : "none";

      if (reward.running) {
        button.textContent = reward.stopRequested ? "중지중" : "도시보상 OFF";
        button.style.background = reward.stopRequested ? "#66504b" : "#8a3f3f";
        button.style.color = "#fff";

        const serverProgress = current.totalServers
          ? `${current.serverIndex ?? reward.completedServers.length}/${current.totalServers}`
          : `${reward.completedServers.length}`;
        const mapProgress = current.totalMoves
          ? ` / 맵 ${current.moveIndex ?? 0}/${current.totalMoves}`
          : "";
        const cycle = current.cycle ?? reward.cycle ?? 1;
        const totalServerScans = current.totalServerScans ?? reward.totalServerScans ?? 0;

        status.innerHTML = `${cycle}회차 실행중: 서버 ${current.serverId ?? "-"} (${serverProgress})${mapProgress}<br>발견 <b style="color:#ffe082">${current.found ?? reward.totalFound ?? 0}</b> / 누적 서버스캔 ${totalServerScans}회`;
      } else {
        button.textContent = "도시보상";
        button.style.background = "#3b3b3b";
        button.style.color = "#eee";

        const upload = reward.lastUpload;
        status.innerHTML = reward.lastResult
          ? `${reward.cycle ?? 0}회차에서 종료 / 완료회차 ${reward.cyclesCompleted ?? 0} / 누적 서버스캔 ${reward.totalServerScans ?? 0}회<br>발견 ${reward.totalFound} / GitHub: ${upload?.ok ? "업로드 완료" : upload?.error ? `실패 - ${upload.error}` : "-"}`
          : "cityReward 객체 보유 기지만 GitHub 저장 · 서버 미입력 시 popular 전체";
      }
    }, 500);

    console.log("[TopWar Reward Finder] 기존 UI에 버튼 추가 완료");
    return true;
  }

  Object.assign(TOPWAR, {
    __cityRewardFinderV19Installed: true,
    parseRewardServerIds,
    collectRewardsFromRecent901,
    scanCityRewardServer: scanRewardServer,
    runRewardFinder,
    stopRewardFinder,
    rewardFinderStatus,
    rewardFinderTable,
    rewardTtlMs: REWARD_TTL_MS,
    pruneExpiredCityRewards() {
      const reward = ensureRewardState();
      const playerRewardsRemoved = prunePlayerMapCityRewards();
      const currentRemoved = pruneRewardMap(reward.currentRewards);
      const sessionRemoved = pruneRewardMap(reward.allSessionRewards);
      reward.totalFound = reward.allSessionRewards.size;
      return { playerRewardsRemoved, currentRemoved, sessionRemoved, ttlMinutes: REWARD_TTL_MS / 60000 };
    },
    uploadRewardServerResults: uploadCompletedServer,
    installRewardFinderButton: installRewardButton
  });

  // 메모리상의 cityReward는 1분마다 TTL을 검사한다. 플레이어 정보 자체는 삭제하지 않는다.
  const rewardTtlCleanupTimer = setInterval(() => {
    const reward = ensureRewardState();
    const playerRewardsRemoved = prunePlayerMapCityRewards();
    const currentRemoved = pruneRewardMap(reward.currentRewards);
    const sessionRemoved = pruneRewardMap(reward.allSessionRewards);
    reward.totalFound = reward.allSessionRewards.size;

    if (playerRewardsRemoved || currentRemoved || sessionRemoved) {
      console.log(`[TopWar Reward Finder] ${REWARD_TTL_MS / 60000}분 TTL 정리`, {
        playerRewardsRemoved,
        currentRemoved,
        sessionRemoved
      });
    }
  }, 60 * 1000);

  // V2.11.0부터 기본 UI는 도둑+cityReward 통합 스캔 버튼 하나만 사용한다.
  // standalone Finder 함수와 installRewardFinderButton()은 호환/수동 사용을 위해 그대로 보존한다.
  console.log("%c[TopWar CityReward Finder V1.9] backend installed (standalone UI auto-install disabled)", "color:#ffd54f;font-weight:bold");
})();

(function () {"use strict";

/*

통합형 RealPower 조사 백엔드

기존 RealPower 조사 로직/IndexedDB 큐는 독립적으로 유지
GitHub Token은 TOPWAR_GITHUB_TOKEN 하나만 공유
별도 RealPower 패널은 자동 생성하지 않고 TOPWAR 통합 패널에서 실행*/

const API_NAME = "REALPOWER";const SETTINGS_KEY = "REALPOWER_STANDALONE_GITHUB_SETTINGS";const OLD_SETTINGS_KEY = "TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS";const STATE_KEY = "REALPOWER_STANDALONE_STATE";const CALIBRATION_KEY = "REALPOWER_STANDALONE_CLICK_CALIBRATION";const QUEUE_KEY = "REALPOWER_STANDALONE_SERVER_QUEUE";const PENDING_DB_NAME = "REALPOWER_STANDALONE_PENDING_DB";const PENDING_DB_VERSION = 1;const PENDING_STORE = "pendingFiles";const STORAGE_SCHEMA_KEY = "REALPOWER_STANDALONE_STORAGE_SCHEMA";const STORAGE_SCHEMA_VERSION = 4;const UI_STATE_KEY = "REALPOWER_STANDALONE_UI_STATE";
const SHARED_GITHUB_TOKEN_KEY = "TOPWAR_GITHUB_TOKEN";

function sharedGithubToken() {
  try {
    const apiToken = window.TOPWAR?.getGithubToken?.();
    if (apiToken) return String(apiToken).trim();
    return String(localStorage.getItem(SHARED_GITHUB_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function migrateLegacyRealPowerToken() {
  try {
    const own = readLocal(SETTINGS_KEY, {});
    const legacyToken = String(own?.token || "").trim();
    if (legacyToken && !sharedGithubToken()) {
      if (window.TOPWAR?.setGithubToken) window.TOPWAR.setGithubToken(legacyToken);
      else localStorage.setItem(SHARED_GITHUB_TOKEN_KEY, legacyToken);
    }
    if (own && typeof own === "object" && Object.prototype.hasOwnProperty.call(own, "token")) {
      delete own.token;
      writeLocal(SETTINGS_KEY, own);
    }
  } catch (error) {
    console.warn("[REALPOWER] legacy token migration failed:", error);
  }
}


const loopRuntime = {stopRequested: false,runningPromise: null,abortController: null,mode: "idle",progress: {currentIndex: 0,total: 0,currentServerId: null,phase: "idle"}};

const DEFAULT_SETTINGS = {owner: "hiphop5782",repo: "topwar-webutil-vite",branch: "main",

powerBasePath: "src/assets/json/power",
allianceDataPath: "src/assets/json/power/allianceData.json",
playerDataPath: "src/assets/json/power/playerData.json",
serverDataPath: "src/assets/json/power/serverData.json",
movementBasePath: "src/assets/json/power/movement",
nicknameHistoryBasePath: "src/assets/json/power/nickname",
serverListBasePath: "src/assets/json/servers",
serversLatestPath: "src/assets/json/servers/servers.json",
serversPopularLatestPath: "src/assets/json/servers/servers-popular.json",

// 조사 중에는 서버별 결과를 IndexedDB에 보관하고,
// 전체 조사가 끝나면 통합 파일, 서버 이동현황, 닉네임 변경이력을 한 번에 GitHub에 커밋한다.
uploadServerLatest: true,
movementEnabled: true,
nicknameHistoryEnabled: true,

// Java Rectangle 내부 좌표의 기준 크기.
// 기존 Java 코드의 최대 좌표가 약 480x720 화면 기준이므로 현재 canvas 크기에 맞게 비율 보정한다.
coordinateBaseWidth: 480,
coordinateBaseHeight: 720,

// 자동 클릭/대기 설정
clickDelayMs: 1200,
moveDelayMs: 1800,
moveTimeoutMs: 15000,
movePollIntervalMs: 200,
moveRetryCount: 2,
moveRetryDelayMs: 1000,
minimumMoveSettleMs: 1200,
rankOpenTimeoutMs: 12000,
rankDataTimeoutMs: 20000,
// 시간 기준이 아니라 개인 100명 / 동맹 2개 수신 여부만 확인한다.
rankPollIntervalMs: 100,
betweenServerDelayMs: 1500,
loopDelayMs: 3000,
requiredPlayerCount: 100,
requiredAllianceCount: 2,
continueOnError: true,
refreshAllServerListEachCycle: true,

// 전체 조사가 끝난 뒤 GitHub 커밋을 한 번만 생성한다.
commitAfterFullCycle: true,
gitTreeChunkMaxEntries: 80,
gitTreeChunkMaxBytes: 2500000,

// Java 코드의 클릭 흐름을 canvas 좌표로 옮긴 기본값
openPowerRankClicks: [
  [243, 355],
  [299, 657]
],
backClick: [83, 24],
openAllianceRankClicks: [
  [400, 657]
]

};

function nowIso() {return new Date().toISOString();}

function todayString() {const d = new Date();const y = d.getFullYear();const m = String(d.getMonth() + 1).padStart(2, "0");const day = String(d.getDate()).padStart(2, "0");return `${y}-${m}-${day}`;}

// TopWar 서버 날짜는 UTC+8의 00:00에 변경된다.
// 한국 시간(UTC+9) 기준으로는 매일 01:00이 날짜 경계다.
function serverDateString(value = Date.now()) {
  const source = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(source.getTime())) throw new Error(`잘못된 날짜 값: ${value}`);

  const shifted = new Date(source.getTime() + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

class RealPowerStoppedError extends Error {constructor(message = "사용자 중지") {super(message);this.name = "RealPowerStoppedError";this.code = "REALPOWER_STOPPED";}}

function activeAbortSignal() {return loopRuntime.abortController?.signal || null;}

function isStopError(error) {return error?.code === "REALPOWER_STOPPED" ||error?.name === "RealPowerStoppedError" ||error?.name === "AbortError";}

function isUnifiedFinderRunning() {return window.TOPWAR?.state?.watch133?.running === true;}

function assertRealPowerUploadAllowed(action = "RealPower 작업") {
  if (isUnifiedFinderRunning()) {
    throw new RealPowerStoppedError(
      `${action} 차단: 도시보상+도둑찾기 실행 중에는 RealPower 저장/업로드를 수행하지 않습니다.`
    );
  }
  return true;
}

function throwIfStopped() {const signal = activeAbortSignal();if (loopRuntime.stopRequested || signal?.aborted) {throw new RealPowerStoppedError();}}

function sleep(ms) {const delay = Math.max(0, Number(ms) || 0);const signal = activeAbortSignal();

if (!signal) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

if (signal.aborted || loopRuntime.stopRequested) {
  return Promise.reject(new RealPowerStoppedError());
}

return new Promise((resolve, reject) => {
  let settled = false;

  const cleanup = () => signal.removeEventListener("abort", onAbort);

  const finish = callback => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    cleanup();
    callback();
  };

  const onAbort = () => finish(() => reject(new RealPowerStoppedError()));
  const timer = setTimeout(() => finish(resolve), delay);

  signal.addEventListener("abort", onAbort, { once: true });
});

}

function updateProgress(patch = {}) {loopRuntime.progress = {...loopRuntime.progress,...patch};

saveState({
  progress: loopRuntime.progress,
  running: loopRuntime.mode !== "idle"
});

renderPanelSafe();
return loopRuntime.progress;

}

function safeJsonParse(text, fallback) {try {return JSON.parse(text);} catch {return fallback;}}

function readLocal(key, fallback) {try {const text = localStorage.getItem(key);return text ? JSON.parse(text) : fallback;} catch {return fallback;}}

function writeLocal(key, value) {localStorage.setItem(key, JSON.stringify(value));return value;}

function openPendingDb() {return new Promise((resolve, reject) => {const request = indexedDB.open(PENDING_DB_NAME, PENDING_DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;

    if (!db.objectStoreNames.contains(PENDING_STORE)) {
      const store = db.createObjectStore(PENDING_STORE, {
        keyPath: "path"
      });
      store.createIndex("type", "type", { unique: false });
      store.createIndex("updatedAt", "updatedAt", { unique: false });
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("IndexedDB 열기 실패"));
  request.onblocked = () => reject(new Error("IndexedDB가 다른 탭에 의해 차단되었습니다."));
});

}

function idbRequest(request) {return new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error || new Error("IndexedDB 요청 실패"));});}

async function withPendingStore(mode, callback) {const db = await openPendingDb();

try {
  const tx = db.transaction(PENDING_STORE, mode);
  const store = tx.objectStore(PENDING_STORE);
  const result = await callback(store, tx);

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("IndexedDB 트랜잭션 실패"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB 트랜잭션 중단"));
  });

  return result;
} finally {
  db.close();
}

}

async function putPendingFile(path, data, metadata = {}) {const row = {path: String(path),data,type: metadata.type || "json",serverId: metadata.serverId == null ? null : String(metadata.serverId),date: metadata.date || null,runId: metadata.runId || loadServerQueue()?.runId || null,updatedAt: nowIso()};

await withPendingStore("readwrite", async store => {
  await idbRequest(store.put(row));
});

return row;

}

async function getPendingFile(path) {return withPendingStore("readonly", store => idbRequest(store.get(String(path))));}

async function listPendingFiles() {
  return withPendingStore("readonly", store => new Promise((resolve, reject) => {
    const rows = [];
    const request = store.openCursor();

    request.onerror = () => reject(request.error || new Error("IndexedDB cursor 실패"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        rows.sort((a, b) => String(a.path).localeCompare(String(b.path)));
        resolve(rows);
        return;
      }

      rows.push(cursor.value);
      cursor.continue();
    };
  }));
}

async function countPendingFilesByType(type) {
  return withPendingStore("readonly", store =>
    idbRequest(store.index("type").count(String(type)))
  );
}

async function inspectPendingFilesLightweight() {
  return withPendingStore("readonly", store => new Promise((resolve, reject) => {
    const stats = {
      count: 0,
      serverFiles: 0,
      movementFiles: 0,
      legacyWithoutRunId: 0,
      totalCharsApprox: 0
    };

    const request = store.openCursor();
    request.onerror = () => reject(request.error || new Error("IndexedDB cursor 실패"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(stats);
        return;
      }

      const row = cursor.value || {};
      stats.count++;
      if (row.type === "server") stats.serverFiles++;
      if (row.type === "movement") stats.movementFiles++;
      if (!row.runId) stats.legacyWithoutRunId++;

      // 상태표시를 위해 정확한 UTF-8 바이트 배열을 만들지 않는다.
      // JSON 문자열 길이만 사용하여 대형 Uint8Array 생성을 피한다.
      try { stats.totalCharsApprox += JSON.stringify(row.data)?.length || 0; } catch {}

      cursor.continue();
    };
  }));
}

async function deletePendingFiles(paths = null) {return withPendingStore("readwrite", async store => {if (!Array.isArray(paths)) {await idbRequest(store.clear());return true;}

  for (const path of paths) {
    await idbRequest(store.delete(String(path)));
  }

  return true;
});

}

async function pendingCacheStatus() {
  const stats = await inspectPendingFilesLightweight();

  const status = {
    count: stats.count,
    totalCharsApprox: stats.totalCharsApprox,
    totalMBApprox: Math.round(stats.totalCharsApprox / 1024 / 1024 * 100) / 100,
    serverFiles: stats.serverFiles,
    movementFiles: stats.movementFiles,
    legacyWithoutRunId: stats.legacyWithoutRunId
  };

  console.log("[REALPOWER] pending cache:", status);
  return status;
}

function getSettings(options = {}) {
  const legacySettings = { ...readLocal(OLD_SETTINGS_KEY, {}) };
  const ownSettings = { ...readLocal(SETTINGS_KEY, {}) };
  delete legacySettings.token;
  delete ownSettings.token;

  return {
    ...DEFAULT_SETTINGS,
    ...legacySettings,
    ...ownSettings,
    ...options,

    // GitHub token은 통합 스크립트의 TOPWAR_GITHUB_TOKEN 하나만 사용한다.
    token: String(options.token ?? sharedGithubToken() ?? "").trim(),

    // GitHub 결과 경로는 프로젝트에서 사용하는 파일로 고정한다.
    powerBasePath: "src/assets/json/power",
    allianceDataPath: "src/assets/json/power/allianceData.json",
    playerDataPath: "src/assets/json/power/playerData.json",
    serverDataPath: "src/assets/json/power/serverData.json",
    movementBasePath: "src/assets/json/power/movement",
    nicknameHistoryBasePath: "src/assets/json/power/nickname",
    serverListBasePath: "src/assets/json/servers",
    serversLatestPath: "src/assets/json/servers/servers.json",
    serversPopularLatestPath: "src/assets/json/servers/servers-popular.json",
    movementEnabled: true,
    nicknameHistoryEnabled: true,
    requiredPlayerCount: Number(options.requiredPlayerCount ?? 100),
    requiredAllianceCount: Number(options.requiredAllianceCount ?? 2)
  };
}

function saveSettings(settings = {}) {
  const clean = { ...settings };
  delete clean.token;

  const saved = {
    ...readLocal(SETTINGS_KEY, {}),
    ...clean,
    powerBasePath: "src/assets/json/power",
    allianceDataPath: "src/assets/json/power/allianceData.json",
    playerDataPath: "src/assets/json/power/playerData.json",
    serverDataPath: "src/assets/json/power/serverData.json",
    movementBasePath: "src/assets/json/power/movement",
    nicknameHistoryBasePath: "src/assets/json/power/nickname",
    serverListBasePath: "src/assets/json/servers",
    serversLatestPath: "src/assets/json/servers/servers.json",
    serversPopularLatestPath: "src/assets/json/servers/servers-popular.json",
    movementEnabled: true,
    nicknameHistoryEnabled: true,
    requiredPlayerCount: 100,
    requiredAllianceCount: 2
  };
  delete saved.token;
  writeLocal(SETTINGS_KEY, saved);
  return getSettings();
}

function getState() {return readLocal(STATE_KEY, {version: 1,lastRunAt: null,lastServerId: null,running: false,logs: []});}

function saveState(patch = {}) {const state = {...getState(),...patch,version: 1,updatedAt: nowIso()};writeLocal(STATE_KEY, state);return state;}

function compactLogData(data) {
  if (data == null || typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return data;
  }

  try {
    const text = JSON.stringify(data);
    if (text.length <= 3000) return data;
    return {
      truncated: true,
      approxChars: text.length,
      preview: text.slice(0, 1500)
    };
  } catch {
    return String(data).slice(0, 1500);
  }
}

function pushLog(message, data = null) {
  const state = getState();
  const row = { t: nowIso(), message, data: compactLogData(data) };
  state.logs = Array.isArray(state.logs) ? state.logs : [];
  state.logs.push(row);
  if (state.logs.length > 40) state.logs = state.logs.slice(-40);
  writeLocal(STATE_KEY, state);
  console.log(`[REALPOWER] ${message}`, data ?? "");
  renderPanelSafe();
  return row;
}

function assertGithubSettings(settings) {if (!settings.owner) throw new Error("GitHub owner가 없습니다. REALPOWER.configure({ owner: '...' })로 설정하세요.");if (!settings.repo) throw new Error("GitHub repo가 없습니다.");if (!settings.branch) throw new Error("GitHub branch가 없습니다.");if (!settings.token) throw new Error("GitHub token이 없습니다.");}

function renderPath(template, vars = {}) {return String(template).replaceAll("{serverId}", String(vars.serverId ?? "unknown")).replaceAll("{date}", String(vars.date ?? todayString())).replaceAll("{timestamp}", String(vars.timestamp ?? Date.now()));}

function encodeGithubPath(path) {return String(path).split("/").map(encodeURIComponent).join("/");}

function toBase64Utf8(text) {const bytes = new TextEncoder().encode(text);const chunkSize = 0x8000;const chunks = [];

for (let offset = 0; offset < bytes.length; offset += chunkSize) {
  const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
  chunks.push(String.fromCharCode(...chunk));
}

return btoa(chunks.join(""));}

function fromBase64Utf8(base64) {const binary = atob(String(base64 || "").replace(/\s/g, ""));const bytes = new Uint8Array([...binary].map(ch => ch.charCodeAt(0)));return new TextDecoder("utf-8").decode(bytes);}

async function githubRequest(settings, method, path, body = null) {assertGithubSettings(settings);

const baseUrl =
  `https://api.github.com/repos/${encodeURIComponent(settings.owner)}` +
  `/${encodeURIComponent(settings.repo)}/contents/${encodeGithubPath(path)}`;

const url = method === "GET"
  ? `${baseUrl}?ref=${encodeURIComponent(settings.branch)}`
  : baseUrl;

throwIfStopped();

const res = await fetch(url, {
  method,
  signal: activeAbortSignal() || undefined,
  headers: {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${settings.token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  },
  body: body == null ? undefined : JSON.stringify(body)
});

throwIfStopped();
const text = await res.text();
const json = safeJsonParse(text, { raw: text });

if (!res.ok) {
  const err = new Error(`GitHub ${method} ${path} 실패: ${res.status} ${res.statusText}`);
  err.status = res.status;
  err.response = json;
  throw err;
}

return json;

}

async function githubApiRequest(settings, method, apiPath, body = null) {assertGithubSettings(settings);throwIfStopped();

const normalizedPath = String(apiPath || "")
  .split("/")
  .filter(Boolean)
  .map(encodeURIComponent)
  .join("/");

const url =
  `https://api.github.com/repos/${encodeURIComponent(settings.owner)}` +
  `/${encodeURIComponent(settings.repo)}/${normalizedPath}`;

const res = await fetch(url, {
  method,
  signal: activeAbortSignal() || undefined,
  headers: {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${settings.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  },
  body: body == null ? undefined : JSON.stringify(body)
});

throwIfStopped();
const responseText = await res.text();
const json = safeJsonParse(responseText, { raw: responseText });

if (!res.ok) {
  const error = new Error(
    `GitHub ${method} ${apiPath} 실패: ${res.status} ${res.statusText}`
  );
  error.status = res.status;
  error.response = json;
  throw error;
}

return json;

}

async function readGithubFile(settings, path) {try {return await githubRequest(settings, "GET", path);} catch (e) {if (e.status === 404) return null;throw e;}}

async function readGithubJson(settings, path, fallback = null) {const file = await readGithubFile(settings, path);if (!file?.content) return fallback;try {return JSON.parse(fromBase64Utf8(file.content));} catch (e) {console.warn("[REALPOWER] GitHub JSON parse failed:", path, e);return fallback;}}


// GitHub Contents API의 base64 응답은 대용량 파일에서 content가 생략될 수 있다.
// playerData.json처럼 큰 기준 파일은 raw media type으로 직접 읽는다.
async function readGithubRawText(settings, path) {
  assertGithubSettings(settings);
  throwIfStopped();

  const baseUrl =
    `https://api.github.com/repos/${encodeURIComponent(settings.owner)}` +
    `/${encodeURIComponent(settings.repo)}/contents/${encodeGithubPath(path)}`;
  const url = `${baseUrl}?ref=${encodeURIComponent(settings.branch)}`;

  const res = await fetch(url, {
    method: "GET",
    signal: activeAbortSignal() || undefined,
    headers: {
      "Accept": "application/vnd.github.raw+json",
      "Authorization": `Bearer ${settings.token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  throwIfStopped();

  if (res.status === 404) return null;

  const text = await res.text();

  if (!res.ok) {
    const error = new Error(
      `GitHub raw GET ${path} 실패: ${res.status} ${res.statusText}`
    );
    error.status = res.status;
    error.response = safeJsonParse(text, { raw: text });
    throw error;
  }

  // 일부 환경에서 raw media type 대신 Contents JSON이 반환되는 경우도 처리한다.
  const parsed = safeJsonParse(text, null);
  if (
    parsed &&
    !Array.isArray(parsed) &&
    typeof parsed === "object" &&
    typeof parsed.content === "string"
  ) {
    return fromBase64Utf8(parsed.content);
  }

  return text;
}

async function readGithubJsonRaw(settings, path, fallback = null) {
  const text = await readGithubRawText(settings, path);
  if (text == null || text === "") return fallback;

  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn("[REALPOWER] GitHub raw JSON parse failed:", path, error);
    return fallback;
  }
}

async function writeGithubJson(settings, path, data, message) {const existing = await readGithubFile(settings, path);

const body = {
  message: message || `Update ${path}`,
  branch: settings.branch,
  content: toBase64Utf8(JSON.stringify(data, null, 2))
};

if (existing?.sha) body.sha = existing.sha;

const result = await githubRequest(settings, "PUT", path, body);

return {
  ok: true,
  path,
  sha: result?.content?.sha ?? null,
  htmlUrl: result?.content?.html_url ?? null
};

}

// ---------------------------------------------------------------------------// Cocos / TopWar 데이터 접근// ---------------------------------------------------------------------------

function scene() {return window.cc?.director?.getScene?.() || null;}

function findNodeByNameIncludes(root, namePart) {if (!root) return null;if (String(root.name || "").includes(namePart)) return root;

for (const child of root.children || []) {
  const found = findNodeByNameIncludes(child, namePart);
  if (found) return found;
}

return null;

}

function getComponent(componentName) {const root = scene();if (!root) throw new Error("게임 scene을 찾지 못했습니다. 로딩 완료 후 실행하세요.");

try {
  const rows = root.getComponentsInChildren?.(componentName);
  if (Array.isArray(rows) && rows.length) {
    const active = rows.find(comp =>
      comp &&
      comp.node &&
      comp.node.active !== false &&
      comp.node.activeInHierarchy !== false
    );
    return active || rows[0];
  }
} catch {}

const node = findNodeByNameIncludes(root, componentName);
if (node) {
  try {
    const comp = node.getComponent?.(componentName);
    if (comp) return comp;
  } catch {}
}

return null;

}

function getComponentSafe(componentName) {try {return getComponent(componentName);} catch {return null;}}

function deepCopy(value) {return JSON.parse(JSON.stringify(value ?? null));}

function parseMaybeJson(value) {if (typeof value !== "string") return value;const s = value.trim();if (!s || (!s.startsWith("{") && !s.startsWith("["))) return value;try {return JSON.parse(s);} catch {return value;}}

function pick(...values) {for (const v of values) {if (v !== undefined && v !== null && v !== "") return v;}return null;}

function num(value) {const n = Number(value);return Number.isFinite(n) ? n : null;}

function str(value) {if (value === undefined || value === null || value === "") return null;return String(value);}


function objectValue(value) {
  let current = value;

  // playerInfo가 일반 JSON 문자열 또는 이중 인코딩된 JSON 문자열인 경우를 모두 처리한다.
  for (let i = 0; i < 3; i++) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      return current;
    }

    if (typeof current !== "string") return null;

    const source = current.trim();
    if (!source) return null;

    try {
      current = JSON.parse(source);
    } catch {
      return null;
    }
  }

  return current && typeof current === "object" && !Array.isArray(current)
    ? current
    : null;
}

function safeObjectProperty(object, key) {
  if (!object) return undefined;

  try {
    return object[key];
  } catch {
    return undefined;
  }
}

function firstObjectValue(objects, keys) {
  for (const object of objects || []) {
    if (!object) continue;

    for (const key of keys || []) {
      const value = safeObjectProperty(object, key);

      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
  }

  return null;
}

function parsePlayerDetailFromSources(playerSources, row) {
  const playerInfoValue = firstObjectValue(playerSources, ["playerInfo"]);
  const parsedPlayerInfo = objectValue(playerInfoValue);

  if (parsedPlayerInfo) return parsedPlayerInfo;

  const directDetailCandidates = [
    safeObjectProperty(row, "detail"),
    safeObjectProperty(row, "playerDetail"),
    safeObjectProperty(row, "userDetail"),
    safeObjectProperty(row, "roleDetail"),
    safeObjectProperty(row, "detailInfo")
  ];

  for (const candidate of directDetailCandidates) {
    const parsed = objectValue(candidate);
    if (parsed) return parsed;
  }

  return {};
}

// 기존 Java getServerInfo2()와 동일하게
// _rankList의 각 행 자체를 Player로 보고 player.playerInfo를 PlayerDetail로 파싱한다.
// Cocos 객체의 프로퍼티가 getter/비열거 속성이어도 JSON 복사 전에 필요한 값을 읽는다.
function snapshotPlayerRankRow(rawRow) {
  const row = objectValue(rawRow) || {};

  const nestedPlayerCandidates = [
    safeObjectProperty(row, "player"),
    safeObjectProperty(row, "playerData"),
    safeObjectProperty(row, "role"),
    safeObjectProperty(row, "user"),
    Array.isArray(rawRow) ? rawRow[0] : null
  ]
    .map(objectValue)
    .filter(Boolean);

  // Java 코드의 Player는 랭킹 행 자체이므로 row를 최우선으로 둔다.
  const playerSources = [row, ...nestedPlayerCandidates];
  const detail = parsePlayerDetailFromSources(playerSources, row);

  const player = {
    val: firstObjectValue(playerSources, ["val", "score", "value"]),
    power: firstObjectValue(playerSources, ["power", "cp", "fightPower"]),
    lv: firstObjectValue(playerSources, ["lv", "level"]),
    serverId: firstObjectValue(playerSources, [
      "serverId", "server", "serverNumber", "worldId"
    ]),
    allianceId: firstObjectValue(playerSources, [
      "allianceId", "aid", "guildId"
    ]),
    allianceTag: firstObjectValue(playerSources, [
      "allianceTag", "a_tag", "tag"
    ]),
    allianceName: firstObjectValue(playerSources, [
      "allianceName", "guildName"
    ]),
    uid: firstObjectValue(playerSources, [
      "uid", "pid", "userId", "playerId", "roleId", "id"
    ]),
    lang: firstObjectValue(playerSources, ["lang", "language"]),
    lastLoginTime: firstObjectValue(playerSources, [
      "lastLoginTime", "lastLogin", "last_login"
    ]),
    lastOnlineTime: firstObjectValue(playerSources, [
      "lastOnlineTime", "lastRequest", "last_request"
    ]),
    isOnline: firstObjectValue(playerSources, ["isOnline", "online"]),
    playerInfo: firstObjectValue(playerSources, ["playerInfo"])
  };

  const score = num(player.val);
  const cp = num(player.power);
  const onlineRaw = player.isOnline;
  const online =
    onlineRaw === true ||
    Number(onlineRaw) === 1 ||
    String(onlineRaw).toLowerCase() === "true";

  // Java ServerPlayerInfo.create()의 정확한 PlayerDetail 매핑
  const countryFlag = num(pick(
    safeObjectProperty(detail, "nationalflag"),
    safeObjectProperty(detail, "nationalFlag"),
    safeObjectProperty(detail, "countryFlag")
  ));

  const gender = num(pick(
    safeObjectProperty(detail, "gender"),
    safeObjectProperty(detail, "usergender"),
    safeObjectProperty(detail, "userGender")
  ));

  const profile = str(pick(
    safeObjectProperty(detail, "avatarurl"),
    safeObjectProperty(detail, "avatarUrl"),
    safeObjectProperty(detail, "headimgurl"),
    safeObjectProperty(detail, "headImgUrl")
  ));

  const nickname = str(pick(
    safeObjectProperty(detail, "username"),
    safeObjectProperty(detail, "userName"),
    safeObjectProperty(detail, "nickname"),
    safeObjectProperty(detail, "nickName")
  ));

  const rank = num(firstObjectValue(playerSources, ["rank", "ranking"]));

  return {
    __realpowerPlayerSnapshot: true,
    rank,
    score,
    cp,
    uid: str(player.uid),
    serverId: num(player.serverId),
    level: num(player.lv),
    allianceId: str(player.allianceId),
    allianceTag: str(player.allianceTag),
    allianceName: str(player.allianceName),
    lang: str(player.lang),
    lastLogin: num(player.lastLoginTime),
    lastRequest: num(player.lastOnlineTime),
    online,
    isOnline: online,
    countryFlag,
    gender,
    profile,
    nickname,
    name: nickname,

    // 최종 변환 단계에서도 Java 원본 구조를 그대로 참조할 수 있게 보관한다.
    player,
    detail,
    playerDetail: detail,
    playerInfo: detail
  };
}

function inspectPlayerRankRow(index = 0) {
  const component = getComponentSafe("WorldServerPowerRank");
  const rows = component?._rankList;
  const row = Array.isArray(rows) ? rows[Number(index) || 0] : null;

  if (!row) {
    throw new Error(`개인 랭킹 ${index}번 행을 찾지 못했습니다.`);
  }

  const playerInfoValue = safeObjectProperty(row, "playerInfo");
  const detail = objectValue(playerInfoValue);
  const snapshot = snapshotPlayerRankRow(row);

  const result = {
    index: Number(index) || 0,
    rowKeys: (() => {
      try {
        return Object.keys(row);
      } catch {
        return [];
      }
    })(),
    playerInfoType: typeof playerInfoValue,
    playerInfoPreview: typeof playerInfoValue === "string"
      ? playerInfoValue.slice(0, 300)
      : playerInfoValue,
    detailKeys: detail ? Object.keys(detail) : [],
    snapshot
  };

  console.log("[REALPOWER] 개인 랭킹 원본 진단", result);
  return result;
}

function copyRankRows(componentName, rows, requiredCount) {
  const selected = Array.from(rows || []).slice(0, requiredCount);

  if (componentName === "WorldServerPowerRank") {
    return selected.map(snapshotPlayerRankRow);
  }

  return deepCopy(selected);
}

function normalizePlayer(serverId, rawRow, index = 0) {
  const raw = rawRow?.__realpowerPlayerSnapshot === true
    ? rawRow
    : snapshotPlayerRankRow(rawRow);

  const player = objectValue(raw.player) || {};
  const detail = objectValue(raw.detail)
    || objectValue(raw.playerDetail)
    || objectValue(raw.playerInfo)
    || {};

  // Java ServerPlayerInfo.create(int server, Player player, PlayerDetail detail)와 동일한 매핑
  const score = num(pick(raw.score, player.val));
  const cp = num(pick(raw.cp, player.power));

  const uid = str(pick(raw.uid, player.uid));
  const nickname = str(pick(
    raw.nickname,
    safeObjectProperty(detail, "username"),
    safeObjectProperty(detail, "nickname")
  ));

  const allianceId = str(pick(raw.allianceId, player.allianceId));
  const onlineRaw = pick(raw.isOnline, raw.online, player.isOnline);
  const online =
    onlineRaw === true ||
    Number(onlineRaw) === 1 ||
    String(onlineRaw).toLowerCase() === "true";

  return {
    server: Number(serverId),
    serverNumber: Number(serverId),
    serverId: String(serverId),
    rank: num(pick(raw.rank, index + 1)),
    score,
    cp,
    power: cp,
    uid,
    level: num(pick(raw.level, player.lv)),
    lang: str(pick(raw.lang, player.lang)),
    lastLogin: num(pick(raw.lastLogin, player.lastLoginTime)),
    lastRequest: num(pick(raw.lastRequest, player.lastOnlineTime)),
    online,
    isOnline: online,
    countryFlag: num(pick(
      raw.countryFlag,
      safeObjectProperty(detail, "nationalflag")
    )),
    gender: num(pick(
      raw.gender,
      safeObjectProperty(detail, "gender"),
      safeObjectProperty(detail, "usergender")
    )),
    profile: str(pick(
      raw.profile,
      safeObjectProperty(detail, "avatarurl"),
      safeObjectProperty(detail, "headimgurl")
    )),
    nickname,
    name: nickname,
    allianceId,
    allianceTag: str(pick(raw.allianceTag, player.allianceTag)),
    allianceName: str(pick(raw.allianceName, player.allianceName))
    // OOM 방지: 정규화가 끝난 100명 플레이어에 원본 Cocos/snapshot 객체를 다시 매달지 않는다.
  };
}


function normalizeAlliance(serverId, rawRow, index = 0) {const raw = deepCopy(rawRow) || {};

const aid = str(pick(raw.aid, raw.allianceId, raw.guildId, raw.id));
const tag = str(pick(raw.tag, raw.allianceTag, raw.a_tag));
const name = str(pick(raw.name, raw.allianceName, raw.guildName));
const power = num(pick(raw.cp, raw.power, raw.fightPower, raw.score, raw.value));

return {
  server: Number(serverId),
  serverNumber: Number(serverId),
  serverId: String(serverId),
  rank: num(pick(raw.rank, raw.ranking, index + 1)),
  aid,
  allianceId: aid,
  tag,
  allianceTag: tag,
  name,
  allianceName: name,
  cp: power,
  power,
  memberCount: num(pick(raw.memberCount, raw.members, raw.num)),
  raw
};

}

function rankRowIdentity(row, index = 0) {if (!row || typeof row !== "object") {return `${index}:${String(row)}`;}

return [
  pick(
    row.uid,
    row.userId,
    row.roleId,
    row.playerId,
    row.aid,
    row.allianceId,
    row.guildId,
    row.id,
    row.rank,
    row.ranking,
    index
  ),
  pick(
    row.cp,
    row.power,
    row.fightPower,
    row.score,
    row.value,
    ""
  ),
  pick(
    row.name,
    row.playerName,
    row.roleName,
    row.allianceName,
    row.guildName,
    row.tag,
    ""
  )
].map(value => String(value ?? "")).join(":");

}

function rankListFingerprint(rows) {if (!Array.isArray(rows)) return "not-array";

const sampleIndexes = [
  0,
  1,
  2,
  Math.floor(rows.length / 2),
  rows.length - 3,
  rows.length - 2,
  rows.length - 1
].filter(index => index >= 0 && index < rows.length);

const samples = [...new Set(sampleIndexes)]
  .map(index => rankRowIdentity(rows[index], index))
  .join("|");

return `${rows.length}#${samples}`;

}

function rankCaptureSnapshot(componentName) {const component = getComponentSafe(componentName);const rows = component?._rankList;

return {
  component,
  componentName,
  active: componentIsActive(componentName),
  rowsReference: Array.isArray(rows) ? rows : null,
  count: Array.isArray(rows) ? rows.length : 0,
  fingerprint: rankListFingerprint(rows),
  capturedAt: Date.now()
};

}

function prepareRankCapture(componentName) {const snapshot = rankCaptureSnapshot(componentName);

// 닫힌 패널에 이전 서버 데이터가 남아 있으면 새 조사와 구분하기 위해 비운다.
// 화면이 열린 상태에서는 절대 건드리지 않는다.
if (
  snapshot.component &&
  snapshot.active === false &&
  Array.isArray(snapshot.component._rankList)
) {
  try {
    snapshot.component._rankList = [];
    snapshot.cacheCleared = true;
  } catch {
    try {
      snapshot.component._rankList.length = 0;
      snapshot.cacheCleared = true;
    } catch {
      snapshot.cacheCleared = false;
    }
  }
}

pushLog(`${componentName} 수집 준비`, {
  previousCount: snapshot.count,
  previousFingerprint: snapshot.fingerprint,
  cacheCleared: snapshot.cacheCleared === true
});

return snapshot;

}

function expectedRankCount(componentName, options = {}) {if (componentName === "WorldServerPowerRank") {return Number(options.requiredPlayerCount ?? 100);}

if (componentName === "WorldServerAlliancePowerRank") {
  return Number(options.requiredAllianceCount ?? 2);
}

return 1;

}

function rankProgressPhase(componentName) {return componentName === "WorldServerPowerRank"? "collecting-personal": "collecting-alliance";}

async function waitForRankList(componentName,options = {},baseline = null) {const timeoutMs = Number(options.rankDataTimeoutMs ??options.rankOpenTimeoutMs ??20000);const intervalMs = Number(options.rankPollIntervalMs ?? 100);const requiredCount = expectedRankCount(componentName,options);

const startedAt = Date.now();
let lastReportedCount = -1;

while (Date.now() - startedAt < timeoutMs) {
  throwIfStopped();

  const component = getComponentSafe(componentName);
  const rows = component?._rankList;
  const active = componentIsActive(componentName);
  const count = Array.isArray(rows) ? rows.length : 0;
  const fingerprint = rankListFingerprint(rows);

  if (count !== lastReportedCount) {
    lastReportedCount = count;

    updateProgress({
      phase: rankProgressPhase(componentName),
      rankComponentName: componentName,
      rankCount: Math.min(count, requiredCount),
      requiredRankCount: requiredCount
    });

    pushLog(
      `${componentName} 데이터 수신: ${count}/${requiredCount}`,
      {
        active,
        fingerprint
      }
    );
  }

  // 캐시는 패널을 열기 전에 비우므로 시간 대기는 필요 없다.
  // 개인 100명 또는 동맹 2개가 실제로 들어온 순간 즉시 확정한다.
  if (
    active &&
    Array.isArray(rows) &&
    count >= requiredCount
  ) {
    const copiedRows = copyRankRows(
      componentName,
      rows,
      requiredCount
    );

    if (
      !Array.isArray(copiedRows) ||
      copiedRows.length !== requiredCount
    ) {
      await sleep(intervalMs);
      continue;
    }

    updateProgress({
      phase: "rank-collected",
      rankComponentName: componentName,
      rankCount: requiredCount,
      requiredRankCount: requiredCount
    });

    pushLog(
      `${componentName} 수집 확정: ${requiredCount}개`,
      {
        receivedCount: count,
        savedCount: copiedRows.length,
        requiredCount,
        fingerprint,
        baselineFingerprint:
          baseline?.fingerprint ?? null,
        baselineCount: baseline?.count ?? 0,
        completionRule: "required-count-only"
      }
    );

    return {
      component,
      rows: copiedRows,
      count: copiedRows.length,
      receivedCount: count,
      requiredCount,
      fingerprint,
      baselineFingerprint:
        baseline?.fingerprint ?? null,
      completionRule: "required-count-only",
      elapsedMs: Date.now() - startedAt
    };
  }

  await sleep(intervalMs);
}

throw new Error(
  `${componentName}._rankList 수집 시간 초과 ` +
  `(현재 ${Math.max(lastReportedCount, 0)}/${requiredCount})`
);

}

function getServerPowerRankRaw() {
  const comp = getComponent("WorldServerPowerRank");
  const rows = comp?._rankList;

  if (!Array.isArray(rows)) {
    throw new Error("WorldServerPowerRank._rankList 없음. 개인 전투력 랭킹 화면을 먼저 열어야 합니다.");
  }

  return Array.from(rows).map(snapshotPlayerRankRow);
}

function getServerAllianceRankRaw() {const comp = getComponent("WorldServerAlliancePowerRank");const rows = comp?._rankList;if (!Array.isArray(rows)) {throw new Error("WorldServerAlliancePowerRank._rankList 없음. 동맹 전투력 랭킹 화면을 먼저 열어야 합니다.");}return deepCopy(rows);}

function getServerPowerRank(serverId) {return getServerPowerRankRaw().map((row, index) => normalizePlayer(serverId, row, index));}

function getServerAllianceRank(serverId) {return getServerAllianceRankRaw().map((row, index) => normalizeAlliance(serverId, row, index));}

function enrichPlayers(players, alliances) {const byAid = new Map();

for (const a of alliances || []) {
  if (a.aid != null) byAid.set(String(a.aid), a);
  if (a.allianceId != null) byAid.set(String(a.allianceId), a);
}

for (const p of players || []) {
  const a = byAid.get(String(p.allianceId ?? ""));
  if (!a) continue;
  p.allianceName = p.allianceName || a.name || a.allianceName || null;
  p.allianceTag = p.allianceTag || a.tag || a.allianceTag || null;
}

return players;

}

function buildServerInfo(serverId, players, alliances) {const enrichedPlayers = enrichPlayers(players || [], alliances || []);const exportedAt = nowIso();

return {
  version: 1,
  source: "realpower-standalone-userscript",
  serverNumber: Number(serverId),
  server: Number(serverId),
  serverId: String(serverId),
  researchTime: Date.now(),
  exportedAt,
  playerList: enrichedPlayers,
  allianceList: alliances || [],
  summary: {
    players: enrichedPlayers.length,
    alliances: (alliances || []).length,
    totalPlayerPower: enrichedPlayers.reduce((sum, p) => sum + Number(p.cp ?? p.power ?? 0), 0),
    totalAlliancePower: (alliances || []).reduce((sum, a) => sum + Number(a.cp ?? a.power ?? 0), 0)
  }
};

}

function getAllServersFromListPanel() {const comp = getComponent("WorldServerListPanel");const data = comp?.m_data || comp?._data || null;if (!data || typeof data !== "object") {throw new Error("WorldServerListPanel.m_data 없음. 서버 목록 창을 먼저 열어야 합니다.");}

return Object.keys(data)
  .map(Number)
  .filter(Number.isFinite)
  .sort((a, b) => a - b);

}

function getAllServerInfoFromListPanel() {const comp = getComponent("WorldServerListPanel");const data = comp?.m_data || comp?._data || null;if (!data || typeof data !== "object") {throw new Error("WorldServerListPanel.m_data 없음. 서버 목록 창을 먼저 열어야 합니다.");}

return Object.entries(data)
  .map(([serverNumber, row]) => ({
    serverNumber: Number(serverNumber),
    server: Number(serverNumber),
    serverId: String(serverNumber),
    kingUid: str(row?.throneUid || ""),
    kingName: row?.throneName || "",
    allianceTag: row?.allianceTag || "",
    playerList: row?.throneUid
      ? [{ uid: String(row.throneUid), nickname: row.throneName || "" }]
      : [],
    allianceList: row?.allianceTag
      ? [{ tag: row.allianceTag }]
      : []
  }))
  .filter(row => Number.isFinite(row.serverNumber))
  .sort((a, b) => a.serverNumber - b.serverNumber);

}

// Java JavascriptUtil.getAllServers2()와 동일한 역할.
// 서버 목록 패널의 m_data를 기준으로 전체 서버 목록과 왕/동맹 기본정보를 만든다.
function getAllServers2() {const root = scene();if (!root) {throw new Error("게임 scene이 없습니다.");}

const panelNode = findNodeByNameIncludes(root, "WorldServerListPanel");
const panel = panelNode?.getComponent?.("WorldServerListPanel")
  || getComponentSafe("WorldServerListPanel");

const data = panel?.m_data;
if (!data || typeof data !== "object") {
  throw new Error(
    "WorldServerListPanel.m_data를 찾지 못했습니다. " +
    "월드맵에서 서버 목록 창을 한 번 열어 전체 서버 데이터가 로드되게 해주세요."
  );
}

const servers = Object.keys(data)
  .map(serverNumber => {
    const row = data[serverNumber] || {};
    const number = Number(serverNumber);

    return {
      serverNumber: number,
      server: number,
      serverId: String(number),
      kingUid: String(row.throneUid || ""),
      kingName: row.throneName || "",
      allianceTag: row.allianceTag || "",
      playerList: row.throneUid
        ? [{
            uid: String(row.throneUid),
            nickname: row.throneName || ""
          }]
        : [],
      allianceList: row.allianceTag
        ? [{
            tag: row.allianceTag || ""
          }]
        : []
    };
  })
  .filter(server => Number.isFinite(server.serverNumber))
  .sort((a, b) => a.serverNumber - b.serverNumber);

pushLog(`전체 서버 목록 조회 완료: ${servers.length}개`);
return servers;

}

function getRealPowerServerOrderMode(options = {}) {
  const requested = String(
    options.serverOrderMode ??
    window.TOPWAR?.getAutomationServerOrderMode?.() ??
    (() => {
      try { return localStorage.getItem("TOPWAR_AUTOMATION_SERVER_ORDER"); }
      catch { return null; }
    })() ??
    "popular"
  ).trim().toLowerCase();

  return ["sequential", "popular", "random"].includes(requested)
    ? requested
    : "popular";
}

function orderRealPowerServers(servers, options = {}) {
  const mode = getRealPowerServerOrderMode(options);
  const rows = Array.isArray(servers) ? servers.slice() : [];

  if (mode === "sequential") {
    return rows.sort((a, b) => Number(a?.serverNumber) - Number(b?.serverNumber));
  }

  if (mode === "random") {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    return rows;
  }

  const popularIds = window.TOPWAR?.getCachedRemoteServerList?.()?.serverIds ?? [];
  if (!popularIds.length) {
    return rows.sort((a, b) => Number(a?.serverNumber) - Number(b?.serverNumber));
  }

  const rank = new Map(popularIds.map((id, index) => [String(id), index]));
  return rows.sort((a, b) => {
    const ar = rank.get(String(a?.serverNumber));
    const br = rank.get(String(b?.serverNumber));
    if (ar != null && br != null) return ar - br;
    if (ar != null) return -1;
    if (br != null) return 1;
    return Number(a?.serverNumber) - Number(b?.serverNumber);
  });
}

function initializeAllServerQueue(options = {}) {
  const mode = getRealPowerServerOrderMode(options);
  const requestedIds = Array.isArray(options.serverIds)
    ? options.serverIds.map(Number).filter(Number.isFinite)
    : [];
  const servers = requestedIds.length
    ? orderRealPowerServers(createQueueFromServerIds(requestedIds), { ...options, serverOrderMode: mode })
    : orderRealPowerServers(getAllServers2(), { ...options, serverOrderMode: mode });
  const queue = saveServerQueue(servers, {
    status: "ready",
    source: requestedIds.length ? `remote-or-explicit-server-ids:${mode}` : `WorldServerListPanel.m_data:${mode}`,
    allServers: true,
    serverOrderMode: mode,
    total: servers.length,
    currentIndex: 0,
    currentServerId: null,
    lastError: null
  });

  pushLog(`전체 서버 조사 큐 생성: ${servers.length}개`, {
    serverOrderMode: mode,
    firstServers: servers.slice(0, 20).map(server => server.serverNumber)
  });
  return queue;
}

function findWorldMapController() {const directCandidates = [window.NWorldController,window.NWorldMapController,window.mapCtrl];

for (const candidate of directCandidates) {
  if (candidate && typeof candidate.getWorldMapDataInstance === "function") {
    return candidate;
  }
}

const root = scene();
if (!root) return null;

const visited = new Set();
const stack = [root];

while (stack.length) {
  const node = stack.pop();
  if (!node || visited.has(node)) continue;
  visited.add(node);

  for (const comp of node._components || []) {
    if (comp && typeof comp.getWorldMapDataInstance === "function") {
      return comp;
    }
  }

  for (const child of node.children || []) stack.push(child);
}

return null;

}

function getCurrentServerId() {const ctrl = findWorldMapController();const range = ctrl?.getWorldMapDataInstance?.()?.status?.viewport?.range;

const value = pick(
  range?.k,
  range?.serverId,
  range?.worldId,
  ctrl?.serverId,
  ctrl?.worldId
);

const number = Number(value);
return Number.isFinite(number) ? number : null;

}

function isServerListPanelActive() {const panel = getComponentSafe("WorldServerListPanel");if (!panel?.node) return false;return panel.node.active !== false && panel.node.activeInHierarchy !== false;}

function collectActiveSceneTexts() {const root = scene();if (!root) return [];

const texts = [];
const stack = [root];
const visited = new Set();

while (stack.length) {
  const node = stack.pop();
  if (!node || visited.has(node)) continue;
  visited.add(node);

  if (node.active !== false && node.activeInHierarchy !== false) {
    try {
      const label = node.getComponent?.(cc.Label);
      if (label?.string) texts.push(String(label.string));
    } catch {}

    try {
      const rich = node.getComponent?.(cc.RichText);
      if (rich?.string) texts.push(String(rich.string));
    } catch {}

    for (const child of node.children || []) stack.push(child);
  }
}

return texts;

}

function isTargetBattleAreaVisible(serverId) {const target = String(Number(serverId));const texts = collectActiveSceneTexts();

const patterns = [
  new RegExp(`전투\\s*지역\\s*S?${target}\\b`, "i"),
  new RegExp(`BATTLE\\s*AREA\\s*S?${target}\\b`, "i"),
  new RegExp(`戦闘\\s*地域\\s*S?${target}\\b`, "i"),
  new RegExp(`战斗\\s*区域\\s*S?${target}\\b`, "i")
];

return texts.some(text => patterns.some(pattern => pattern.test(String(text))));

}

function hasBattleAreaRankButtons() {try {return !!findRankButton("personal")?.match && !!findRankButton("alliance")?.match;} catch {return false;}}

async function waitForServerSelection(serverId, options = {}) {const target = Number(serverId);const waitMs = Number(options.serverSelectionWaitMs ?? options.moveDelayMs ?? 1800);

// gotoServerById()는 서버 목록에서 대상을 선택/표시하는 단계다.
// 이 시점에는 아직 중앙 서버 카드를 클릭하지 않았으므로
// 전투 지역 제목이나 랭킹 버튼이 나타나지 않는 것이 정상이다.
await sleep(waitMs);

return {
  ok: true,
  verification: "selection-delay",
  targetServerId: target,
  elapsedMs: waitMs,
  panelActive: isServerListPanelActive()
};

}

async function waitForBattleAreaEntry(serverId, options = {}) {const target = Number(serverId);const timeoutMs = Number(options.moveTimeoutMs ?? 15000);const intervalMs = Number(options.movePollIntervalMs ?? 200);const minimumSettleMs = Number(options.minimumMoveSettleMs ?? 700);const startedAt = Date.now();

let titleMatched = false;
let rankButtonsVisible = false;

while (Date.now() - startedAt < timeoutMs) {
  const elapsedMs = Date.now() - startedAt;

  titleMatched = isTargetBattleAreaVisible(target);
  rankButtonsVisible = hasBattleAreaRankButtons();

  if (
    elapsedMs >= minimumSettleMs &&
    (titleMatched || rankButtonsVisible)
  ) {
    return {
      ok: true,
      verification: titleMatched
        ? "battle-area-title"
        : "battle-area-buttons",
      targetServerId: target,
      elapsedMs,
      titleMatched,
      rankButtonsVisible
    };
  }

  await sleep(intervalMs);
}

return {
  ok: false,
  targetServerId: target,
  elapsedMs: Date.now() - startedAt,
  titleMatched,
  rankButtonsVisible
};

}

// 이전 API 호환용. 실제 전투 지역 진입 확인은 중앙 클릭 후 waitForBattleAreaEntry()에서 한다.
async function waitForServerMove(serverId, options = {}) {return waitForServerSelection(serverId, options);}

async function moveToServer(serverId, options = {}) {const settings = getSettings(options);const target = Number(serverId);

if (!Number.isFinite(target)) {
  throw new Error(`잘못된 서버번호: ${serverId}`);
}

const retryCount = Math.max(0, Number(settings.moveRetryCount ?? 2));
let lastResult = null;

for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
  const comp = getComponent("WorldServerListPanel");

  if (!comp || typeof comp.gotoServerById !== "function") {
    throw new Error(
      "WorldServerListPanel.gotoServerById 없음. " +
      "서버 목록 창을 연 상태에서 조사를 시작해야 합니다."
    );
  }

  pushLog(`${target} 서버 선택 요청 (${attempt}/${retryCount + 1})`, {
    panelActive: isServerListPanelActive()
  });

  try {
    comp.gotoServerById(target);
  } catch (error) {
    lastResult = {
      ok: false,
      targetServerId: target,
      attempt,
      error: error?.message || String(error)
    };

    pushLog(`${target} gotoServerById 호출 실패`, lastResult);

    if (attempt <= retryCount) {
      await sleep(Number(settings.moveRetryDelayMs ?? 1000));
      continue;
    }

    throw error;
  }

  lastResult = await waitForServerSelection(target, settings);

  // 여기서는 전투 지역 화면 진입 여부를 검사하지 않는다.
  // Java 원본처럼 다음 단계에서 중앙 서버 카드를 클릭해야 진입이 완료된다.
  pushLog(`${target} 서버 선택 완료`, lastResult);
  return lastResult;
}

throw new Error(
  `${target} 서버 선택 실패: gotoServerById 호출을 완료하지 못했습니다.`
);

}

// ---------------------------------------------------------------------------// Canvas click automation// ---------------------------------------------------------------------------

function getCanvas() {return document.querySelector("canvas");}

function toClientPoint(x, y, options = {}) {const canvas = getCanvas();if (!canvas) throw new Error("canvas 없음");

const settings = getSettings(options);
const rect = canvas.getBoundingClientRect();
const baseWidth = Number(settings.coordinateBaseWidth ?? 480);
const baseHeight = Number(settings.coordinateBaseHeight ?? 720);
const coordinateMode = options.coordinateMode || "scaled";

const scaleX = coordinateMode === "raw"
  ? 1
  : rect.width / baseWidth;

const scaleY = coordinateMode === "raw"
  ? 1
  : rect.height / baseHeight;

const localX = Number(x) * scaleX;
const localY = Number(y) * scaleY;

return {
  sourceX: Number(x),
  sourceY: Number(y),
  coordinateMode,
  localX,
  localY,
  clientX: rect.left + localX,
  clientY: rect.top + localY,
  canvasRect: {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  },
  scaleX,
  scaleY
};

}

function readCalibration() {const saved = readLocal(CALIBRATION_KEY, null);

if (!saved || typeof saved !== "object") {
  return {
    version: 1,
    updatedAt: null,
    points: {}
  };
}

saved.points = saved.points && typeof saved.points === "object"
  ? saved.points
  : {};

return saved;

}

function writeCalibration(calibration) {const value = {version: 1,updatedAt: nowIso(),points: calibration?.points || {}};

writeLocal(CALIBRATION_KEY, value);
return value;

}

function calibrationPoint(name) {return readCalibration().points?.[String(name)] || null;}

function saveCalibrationPoint(name, event) {const canvas = getCanvas();if (!canvas) throw new Error("canvas 없음");

const rect = canvas.getBoundingClientRect();
const clientX = Number(event.clientX);
const clientY = Number(event.clientY);

const point = {
  name: String(name),
  capturedAt: nowIso(),
  normalizedX: rect.width > 0
    ? (clientX - rect.left) / rect.width
    : 0,
  normalizedY: rect.height > 0
    ? (clientY - rect.top) / rect.height
    : 0,
  clientX,
  clientY,
  canvas: {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
};

const calibration = readCalibration();
calibration.points[String(name)] = point;
writeCalibration(calibration);

pushLog(`클릭 좌표 보정 저장: ${name}`, point);
return point;

}

function captureNextClick(name, timeoutMs = 30000) {const allowed = ["center", "personal", "alliance", "back"];const key = String(name);

if (!allowed.includes(key)) {
  throw new Error(
    `보정 이름 오류: ${key}. center, personal, alliance, back 중 하나를 사용하세요.`
  );
}

const canvas = getCanvas();
if (!canvas) throw new Error("canvas 없음");

pushLog(
  `${key} 좌표 보정 대기 중 - 30초 안에 실제 게임 화면에서 원하는 위치를 직접 클릭하세요.`
);

return new Promise((resolve, reject) => {
  let finished = false;

  const cleanup = () => {
    canvas.removeEventListener("pointerdown", handler, true);
    clearTimeout(timer);
  };

  const handler = event => {
    if (finished) return;

    // 사용자가 직접 누른 실제 입력만 보정값으로 인정한다.
    if (event.isTrusted === false) return;

    finished = true;
    cleanup();

    try {
      const point = saveCalibrationPoint(key, event);
      resolve(point);
    } catch (error) {
      reject(error);
    }
  };

  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    cleanup();
    reject(new Error(`${key} 좌표 보정 시간 초과`));
  }, Number(timeoutMs) || 30000);

  // capture 단계에서 좌표만 기록하고 이벤트 전파는 막지 않는다.
  // 따라서 사용자가 클릭한 원래 게임 동작도 그대로 실행된다.
  canvas.addEventListener("pointerdown", handler, true);
});

}

function calibratedClientPoint(name) {const saved = calibrationPoint(name);if (!saved) return null;

const canvas = getCanvas();
if (!canvas) return null;

const rect = canvas.getBoundingClientRect();

return {
  name: String(name),
  source: "calibration",
  normalizedX: saved.normalizedX,
  normalizedY: saved.normalizedY,
  localX: Number(saved.normalizedX) * rect.width,
  localY: Number(saved.normalizedY) * rect.height,
  clientX: rect.left + Number(saved.normalizedX) * rect.width,
  clientY: rect.top + Number(saved.normalizedY) * rect.height,
  canvasRect: {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
};

}

function clickSavedPoint(name, fallbackX, fallbackY, options = {}) {const point = calibratedClientPoint(name);

if (point) {
  dispatchDomClick(point);

  const result = {
    ...point,
    clickMode: "calibrated-dom",
    domDispatched: true
  };

  pushLog(`보정 좌표 클릭: ${name}`, result);
  return result;
}

const result = clickCanvas(
  fallbackX,
  fallbackY,
  {
    ...options,
    clickMode: "dom-only",
    coordinateMode: "scaled"
  }
);

pushLog(`보정값 없음 - 기존 좌표 사용: ${name}`, result);
return result;

}

function calibrationStatus() {const status = readCalibration();console.log("[REALPOWER] calibration:", status);return status;}

function clearCalibration(name = null) {if (name == null) {localStorage.removeItem(CALIBRATION_KEY);pushLog("전체 클릭 좌표 보정값 삭제");return true;}

const calibration = readCalibration();
delete calibration.points[String(name)];
writeCalibration(calibration);
pushLog(`클릭 좌표 보정값 삭제: ${name}`);
return true;

}

function getCocosDesignSize() {try {const size = cc?.view?.getDesignResolutionSize?.();if (size?.width && size?.height) {return {width: Number(size.width),height: Number(size.height)};}} catch {}

try {
  const size = cc?.view?.getVisibleSize?.();
  if (size?.width && size?.height) {
    return {
      width: Number(size.width),
      height: Number(size.height)
    };
  }
} catch {}

return {
  width: 480,
  height: 720
};

}

function canvasLocalToCocos(localX, localY) {const canvas = getCanvas();const rect = canvas?.getBoundingClientRect?.();if (!rect) return null;

const design = getCocosDesignSize();

return {
  x: Number(localX) / rect.width * design.width,
  y: design.height - Number(localY) / rect.height * design.height,
  designWidth: design.width,
  designHeight: design.height
};

}

function nodeWorldRect(node) {if (!node) return null;

try {
  const box = node.getBoundingBoxToWorld?.();
  if (box && Number.isFinite(box.x) && Number.isFinite(box.y)) {
    return {
      left: Number(box.x),
      right: Number(box.x + box.width),
      bottom: Number(box.y),
      top: Number(box.y + box.height)
    };
  }
} catch {}

try {
  const size = node.getContentSize?.();
  const world = node.convertToWorldSpaceAR?.({ x: 0, y: 0 });
  if (!size || !world) return null;

  const ax = Number(node.anchorX ?? 0.5);
  const ay = Number(node.anchorY ?? 0.5);
  const sx = Math.abs(Number(node.scaleX ?? 1));
  const sy = Math.abs(Number(node.scaleY ?? 1));

  return {
    left: world.x - size.width * sx * ax,
    right: world.x + size.width * sx * (1 - ax),
    bottom: world.y - size.height * sy * ay,
    top: world.y + size.height * sy * (1 - ay)
  };
} catch {
  return null;
}

}

function findActiveButtonAtCanvasPoint(localX, localY) {const root = scene();if (!root || !window.cc?.Button) return null;

const cocosPoint = canvasLocalToCocos(localX, localY);
if (!cocosPoint) return null;

const cocosX = cocosPoint.x;
const cocosY = cocosPoint.y;

const matches = [];
const stack = [{ node: root, depth: 0 }];

while (stack.length) {
  const { node, depth } = stack.pop();
  if (!node || node.active === false || node.activeInHierarchy === false) continue;

  let button = null;
  try { button = node.getComponent?.(cc.Button); } catch {}

  if (button && button.interactable !== false && button.enabled !== false) {
    const r = nodeWorldRect(node);
    if (
      r &&
      cocosX >= r.left &&
      cocosX <= r.right &&
      cocosY >= r.bottom &&
      cocosY <= r.top
    ) {
      const area = Math.abs((r.right - r.left) * (r.top - r.bottom));
      matches.push({ node, button, rect: r, depth, area, cocosPoint });
    }
  }

  for (const child of node.children || []) {
    stack.push({ node: child, depth: depth + 1 });
  }
}

// 가장 깊고, 같은 깊이면 면적이 작은 버튼을 우선한다.
matches.sort((a, b) => b.depth - a.depth || a.area - b.area);
return matches[0] || null;

}

function invokeButtonDirectly(match) {if (!match?.button) return false;

const button = match.button;
let invoked = false;

try {
  if (Array.isArray(button.clickEvents) && button.clickEvents.length) {
    for (const handler of button.clickEvents) {
      try {
        handler?.emit?.([button]);
        invoked = true;
      } catch (error) {
        console.warn("[REALPOWER] clickEvent emit 실패", error);
      }
    }
  }
} catch {}

try {
  match.node?.emit?.("click", button);
  invoked = true;
} catch {}

try {
  match.node?.emit?.("touchend", {
    target: match.node,
    currentTarget: match.node
  });
  invoked = true;
} catch {}

return invoked;

}

function dispatchDomClick(point) {const canvas = getCanvas();if (!canvas) throw new Error("canvas 없음");

const base = {
  bubbles: true,
  cancelable: true,
  composed: true,
  clientX: point.clientX,
  clientY: point.clientY,
  screenX: point.clientX,
  screenY: point.clientY,
  button: 0,
  buttons: 1,
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true
};

try {
  canvas.dispatchEvent(new PointerEvent("pointerdown", base));
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
} catch {}

canvas.dispatchEvent(new MouseEvent("mousedown", base));
canvas.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
canvas.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));

}

function getCanvasCenterPoint() {const canvas = getCanvas();if (!canvas) throw new Error("canvas 없음");

const rect = canvas.getBoundingClientRect();

return {
  source: "canvas-center",
  normalizedX: 0.5,
  normalizedY: 0.5,
  localX: rect.width / 2,
  localY: rect.height / 2,
  clientX: rect.left + rect.width / 2,
  clientY: rect.top + rect.height / 2,
  canvasRect: {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
};

}

function clickCanvasCenter() {const point = getCanvasCenterPoint();

// 처음 실제 동작이 확인됐던 DOM Canvas 이벤트만 정확히 한 번 보낸다.
// Cocos 메서드 호출, 버튼 후보 탐색, 재클릭은 하지 않는다.
dispatchDomClick(point);

pushLog("Canvas 중앙 서버 카드 클릭", point);
return point;

}

async function openSelectedServerByCanvasCenter(serverId, options = {}) {const settings = getSettings(options);

throwIfStopped();

const click = clickCanvasCenter();

// UI 로딩만 기다리고 TheaterPanel 탐지 실패로 조사를 중단하지 않는다.
// 실제 진입 여부는 다음 개인 랭킹 단계에서 자연스럽게 검증된다.
await sleep(Number(settings.serverCardOpenDelayMs ?? 1600));

throwIfStopped();

return {
  ok: true,
  method: "canvas-center-dom-click",
  serverId: Number(serverId),
  click
};

}

function clickCanvasNormalized(normalizedX, normalizedY) {const canvas = getCanvas();if (!canvas) throw new Error("canvas 없음");

const rect = canvas.getBoundingClientRect();
const nx = Math.max(0, Math.min(1, Number(normalizedX)));
const ny = Math.max(0, Math.min(1, Number(normalizedY)));

const point = {
  source: "normalized",
  normalizedX: nx,
  normalizedY: ny,
  localX: rect.width * nx,
  localY: rect.height * ny,
  clientX: rect.left + rect.width * nx,
  clientY: rect.top + rect.height * ny,
  canvasRect: {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height
  }
};

dispatchDomClick(point);
pushLog("화면 비율 좌표 클릭", point);
return point;

}

function clickCanvas(x, y, options = {}) {const point = toClientPoint(x, y, options);const mode = options.clickMode || "both";

let buttonMatch = null;
let directInvoked = false;
let domDispatched = false;

if (mode !== "dom-only") {
  buttonMatch = findActiveButtonAtCanvasPoint(point.localX, point.localY);
  directInvoked = invokeButtonDirectly(buttonMatch);
}

if (mode !== "direct-only") {
  dispatchDomClick(point);
  domDispatched = true;
}

const result = {
  ...point,
  clickMode: mode,
  directButtonInvoked: directInvoked,
  domDispatched,
  buttonNodeName: buttonMatch?.node?.name || null,
  cocosPoint: buttonMatch?.cocosPoint || canvasLocalToCocos(point.localX, point.localY)
};

pushLog(`게임 좌표 클릭 (${x}, ${y})`, result);
return result;

}

async function clickSequence(points, delayMs, options = {}) {const results = [];

for (const [x, y] of points || []) {
  results.push(clickCanvas(x, y, options));
  await sleep(delayMs);
}

return results;

}

async function collectOpenRanks(serverId) {const players = getServerPowerRank(serverId);const alliances = getServerAllianceRank(serverId);return buildServerInfo(serverId, players, alliances);}



function componentClassName(component) {if (!component) return "";

return String(
  component.__classname__ ||
  component.constructor?.name ||
  component.name ||
  ""
);

}

function componentMethodNames(component) {if (!component) return [];

const names = new Set();
let current = component;
let depth = 0;

while (current && depth < 8) {
  for (const name of Object.getOwnPropertyNames(current)) {
    if (name === "constructor") continue;

    try {
      if (typeof component[name] === "function") names.add(name);
    } catch {}
  }

  current = Object.getPrototypeOf(current);
  depth++;
}

return [...names];

}

function nodePathText(node, maxDepth = 8) {const names = [];let current = node;let depth = 0;

while (current && depth < maxDepth) {
  if (current.name) names.push(String(current.name));
  current = current.parent;
  depth++;
}

return names.join(" > ");

}

function clickEventDescriptor(eventHandler) {if (!eventHandler) return "";

const target = eventHandler.target || eventHandler._target || null;
const fields = [
  eventHandler.component,
  eventHandler._componentName,
  eventHandler.componentName,
  eventHandler.handler,
  eventHandler._handler,
  eventHandler.customEventData,
  eventHandler._customEventData,
  target?.name,
  target ? nodePathText(target, 5) : ""
];

return fields
  .filter(value => value !== undefined && value !== null && value !== "")
  .map(String)
  .join(" ");

}

function buttonSemanticDescriptor(row) {const componentNames = [];

for (const component of row?.node?._components || []) {
  const name = componentClassName(component);
  if (name) componentNames.push(name);
}

const eventText = (row?.button?.clickEvents || [])
  .map(clickEventDescriptor)
  .join(" ");

return [
  row?.name,
  row?.text,
  nodePathText(row?.node),
  componentNames.join(" "),
  eventText
]
  .filter(Boolean)
  .join(" ")
  .replace(/\s+/g, " ")
  .trim();

}

function semanticRankScore(text, kind) {const value = String(text || "").replace(/\s+/g, "").toLowerCase();

const allianceWords = [
  "alliance",
  "guild",
  "union",
  "alliancepower",
  "alliancepowerrank",
  "guildpowerrank",
  "길드",
  "동맹",
  "연맹"
];

const personalWords = [
  "personal",
  "player",
  "individual",
  "user",
  "role",
  "person",
  "개인",
  "플레이어",
  "유저"
];

const rankWords = [
  "rank",
  "ranking",
  "power",
  "fight",
  "combat",
  "force",
  "전투력",
  "랭킹",
  "순위"
];

const hasAlliance = allianceWords.some(word => value.includes(word));
const hasPersonal = personalWords.some(word => value.includes(word));
const rankHits = rankWords.filter(word => value.includes(word)).length;

let score = rankHits * 200;

if (kind === "personal") {
  if (hasPersonal) score += 2000;
  if (hasAlliance) score -= 5000;

  // WorldServerPowerRank / onClickPowerRank처럼 개인 표시가 생략된 경우.
  if (
    !hasAlliance &&
    (
      value.includes("worldserverpowerrank") ||
      value.includes("openpowerrank") ||
      value.includes("clickpowerrank") ||
      value.includes("showpowerrank")
    )
  ) {
    score += 1500;
  }
} else {
  if (hasAlliance) score += 3000;
  if (hasPersonal && !hasAlliance) score -= 3000;

  if (
    value.includes("worldserveralliancepowerrank") ||
    value.includes("alliancepowerrank") ||
    value.includes("guildpowerrank")
  ) {
    score += 2500;
  }
}

return score;

}

function semanticCloseScore(text) {const value = String(text || "").replace(/\s+/g, "").toLowerCase();

const words = [
  "back",
  "close",
  "return",
  "exit",
  "dismiss",
  "cancel",
  "hide",
  "previous",
  "뒤로",
  "닫기",
  "돌아가기",
  "返回",
  "关闭"
];

let score = 0;

for (const word of words) {
  if (value.includes(word)) score += 1000;
}

return score;

}

function primitiveServerIdMatch(value, targetServerId) {if (value === undefined || value === null) return false;

const target = String(Number(targetServerId));

if (
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "bigint"
) {
  return String(value) === target;
}

return false;

}

function objectServerIdScore(value, targetServerId, depth = 0, visited = new Set()) {if (value === undefined || value === null || depth > 2) return 0;

if (primitiveServerIdMatch(value, targetServerId)) return 50;

if (typeof value !== "object" || visited.has(value)) return 0;
visited.add(value);

const preferredKeys = [
  "serverId",
  "_serverId",
  "server",
  "_server",
  "sid",
  "_sid",
  "worldId",
  "_worldId",
  "id",
  "_id",
  "data",
  "_data",
  "info",
  "_info",
  "cfg",
  "_cfg"
];

let score = 0;

for (const key of preferredKeys) {
  let child;

  try {
    child = value[key];
  } catch {
    continue;
  }

  if (primitiveServerIdMatch(child, targetServerId)) {
    score += key.toLowerCase().includes("server") ||
             key.toLowerCase().includes("world") ||
             key.toLowerCase().includes("sid")
      ? 1000
      : 300;
    continue;
  }

  if (
    child &&
    typeof child === "object" &&
    depth < 2
  ) {
    score += objectServerIdScore(
      child,
      targetServerId,
      depth + 1,
      visited
    );
  }
}

return score;

}

function nearestButtonFromNode(node, maxAncestorDepth = 6) {let current = node;let depth = 0;

while (current && depth <= maxAncestorDepth) {
  try {
    const button = current.getComponent?.(cc.Button);

    if (
      button &&
      button.enabled !== false &&
      button.interactable !== false
    ) {
      return {
        node: current,
        button,
        ancestorDepth: depth,
        name: String(current.name || ""),
        text: collectNodeText(current),
        rect: nodeWorldRect(current)
      };
    }
  } catch {}

  current = current.parent;
  depth++;
}

const stack = [{ node, depth: 0 }];
const visited = new Set();

while (stack.length) {
  const item = stack.shift();
  if (!item?.node || visited.has(item.node) || item.depth > 4) continue;
  visited.add(item.node);

  try {
    const button = item.node.getComponent?.(cc.Button);

    if (
      button &&
      button.enabled !== false &&
      button.interactable !== false
    ) {
      return {
        node: item.node,
        button,
        descendantDepth: item.depth,
        name: String(item.node.name || ""),
        text: collectNodeText(item.node),
        rect: nodeWorldRect(item.node)
      };
    }
  } catch {}

  for (const child of item.node.children || []) {
    stack.push({
      node: child,
      depth: item.depth + 1
    });
  }
}

return null;

}

function findServerNodeCandidates(targetServerId) {const panel = getComponentSafe("WorldServerListPanel");const root = panel?.node;

if (!root) return [];

const candidates = [];
const stack = [{ node: root, depth: 0 }];
const visited = new Set();
const targetText = String(Number(targetServerId));

while (stack.length) {
  const { node, depth } = stack.pop();

  if (!node || visited.has(node)) continue;
  visited.add(node);

  if (node.active !== false && node.activeInHierarchy !== false) {
    let score = 0;
    const reasons = [];
    const nodeName = String(node.name || "");

    if (nodeName.includes(targetText)) {
      score += 1200;
      reasons.push("node-name");
    }

    for (const component of node._components || []) {
      const componentScore = objectServerIdScore(
        component,
        targetServerId
      );

      if (componentScore > 0) {
        score += componentScore;
        reasons.push(
          `component:${componentClassName(component)}`
        );
      }
    }

    if (score > 0) {
      const button = nearestButtonFromNode(node);

      candidates.push({
        node,
        depth,
        score: score + (button ? 500 : 0),
        reasons,
        name: nodeName,
        path: nodePathText(node, 10),
        button
      });
    }

    for (const child of node.children || []) {
      stack.push({
        node: child,
        depth: depth + 1
      });
    }
  }
}

candidates.sort((a, b) =>
  b.score - a.score ||
  b.depth - a.depth
);

return candidates;

}

function serverOpenSemanticScore(text, targetServerId) {const value = String(text || "").replace(/\s+/g, "").toLowerCase();

const target = String(Number(targetServerId));

const positiveWords = [
  "worldservertheater",
  "servertheater",
  "theater",
  "enterserver",
  "openserver",
  "showserver",
  "serverdetail",
  "serveritem",
  "clickserver",
  "selectserver",
  "onserverclick",
  "onserveritem",
  "전투지역",
  "서버진입",
  "서버상세"
];

const negativeWords = [
  "gotoServerById".toLowerCase(),
  "rank",
  "power",
  "alliance",
  "guild",
  "back",
  "close",
  "return",
  "refresh",
  "filter",
  "sort"
];

let score = 0;

for (const word of positiveWords) {
  if (value.includes(word.toLowerCase())) score += 1500;
}

for (const word of negativeWords) {
  if (value.includes(word.toLowerCase())) score -= 3000;
}

if (value.includes(target)) score += 1000;
if (value.includes("server")) score += 200;
if (value.includes("click") || value.includes("open") || value.includes("enter")) {
  score += 500;
}

return score;

}

async function waitForTheaterPanel(timeoutMs = 5000) {const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  const panel = getTheaterPanelComponent();

  if (
    panel?.node &&
    panel.node.active !== false &&
    panel.node.activeInHierarchy !== false
  ) {
    return {
      ok: true,
      component: panel,
      elapsedMs: Date.now() - startedAt
    };
  }

  await sleep(100);
}

return {
  ok: false,
  component: null,
  elapsedMs: Date.now() - startedAt
};

}

function theaterPanelSnapshot() {const rows = [];const root = scene();if (!root) return rows;

const stack = [root];
const visited = new Set();

while (stack.length) {
  const node = stack.pop();
  if (!node || visited.has(node)) continue;
  visited.add(node);

  for (const component of node._components || []) {
    if (componentClassName(component) === "WorldServerTheaterPanel") {
      rows.push({
        component,
        node,
        uuid: node.uuid || node._id || null,
        active: node.active !== false,
        activeInHierarchy: node.activeInHierarchy !== false,
        siblingIndex: node.getSiblingIndex?.() ?? null
      });
    }
  }

  for (const child of node.children || []) stack.push(child);
}

return rows;

}

async function waitForFreshTheaterPanel(beforeSnapshot = [], timeoutMs = 5000) {const beforeComponents = new Set(beforeSnapshot.map(row => row.component));const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  const current = theaterPanelSnapshot();
  const activeRows = current.filter(row => row.active && row.activeInHierarchy);
  const fresh = activeRows.find(row => !beforeComponents.has(row.component));

  if (fresh) {
    return {
      ok: true,
      fresh: true,
      row: fresh,
      elapsedMs: Date.now() - startedAt
    };
  }

  // 같은 풀링 인스턴스를 재사용할 수 있으므로, 서버 목록 패널의 실제 표시 상태가
  // 바뀌었고 Theater 패널이 활성화되어 있으면 새 진입으로 인정한다.
  if (activeRows.length > 0 && !isServerListPanelActive()) {
    return {
      ok: true,
      fresh: false,
      row: activeRows[0],
      elapsedMs: Date.now() - startedAt
    };
  }

  await sleep(100);
}

return {
  ok: false,
  fresh: false,
  row: null,
  elapsedMs: Date.now() - startedAt
};

}

async function emitNodeOpenEvents(node) {if (!node) return false;

let emitted = false;

for (const eventName of [
  "click",
  "touchend",
  "mouseup",
  "pointerup"
]) {
  try {
    node.emit?.(eventName, {
      target: node,
      currentTarget: node
    });
    emitted = true;
  } catch {}
}

return emitted;

}

function nodeListenerDescriptor(node) {const keys = new Set();const visited = new Set();

const scan = (value, depth = 0) => {
  if (!value || typeof value !== "object" || visited.has(value) || depth > 2) return;
  visited.add(value);

  for (const key of Object.keys(value)) {
    keys.add(String(key));
    let child;
    try { child = value[key]; } catch { continue; }
    if (child && typeof child === "object") scan(child, depth + 1);
  }
};

scan(node?._bubblingListeners);
scan(node?._capturingListeners);
scan(node?._eventProcessor);
scan(node?._callbackTable);

return [...keys].join(" ");

}

function serverControlNegativeScore(text) {const value = String(text || "").replace(/\s+/g, "").toLowerCase();const words = ["close", "back", "return", "exit", "cancel","left", "right", "previous", "next", "arrow","tab", "help", "info", "search", "filter", "sort","rank", "power", "alliance", "guild","닫기", "뒤로", "도움", "검색", "정렬", "랭킹"];

return words.reduce((sum, word) =>
  value.includes(word) ? sum + 5000 : sum,
  0
);

}

function serverCardPositiveScore(text) {const value = String(text || "").replace(/\s+/g, "").toLowerCase();const words = ["server", "worldserver", "item", "cell", "card", "theater","region", "area", "enter", "open", "select", "touch", "click","서버", "지역", "전투"];

return words.reduce((sum, word) =>
  value.includes(word) ? sum + 500 : sum,
  0
);

}

function ancestorServerDataScore(node, targetServerId, stopNode) {let current = node;let depth = 0;let score = 0;

while (current && depth < 7 && current !== stopNode) {
  for (const component of current._components || []) {
    const className = componentClassName(component);
    if (className === "WorldServerListPanel") continue;
    score += objectServerIdScore(component, targetServerId, 0, new Set());
  }
  current = current.parent;
  depth++;
}

return score;

}

function collectStructuralServerOpenCandidates(panel, targetServerId) {if (!panel?.node) return [];

return buttonsInsideNode(panel.node)
  .map(row => {
    const rect = row.rect;
    const width = rect ? Math.max(0, rect.right - rect.left) : 0;
    const height = rect ? Math.max(0, rect.top - rect.bottom) : 0;
    const area = width * height;
    const descriptor = [
      row.descriptor || buttonSemanticDescriptor(row),
      nodeListenerDescriptor(row.node),
      nodePathText(row.node, 12)
    ].join(" ");

    const targetDataScore = ancestorServerDataScore(
      row.node,
      targetServerId,
      panel.node
    );
    const positive = serverCardPositiveScore(descriptor);
    const negative = serverControlNegativeScore(descriptor);

    // 고정 좌표는 쓰지 않는다. 서버 카드형 큰 인터랙션 노드와
    // server/item/cell 관련 구조를 우선한다.
    const score =
      targetDataScore * 10 +
      positive +
      Math.min(area, 2000000) / 100 -
      negative +
      row.depth * 5;

    return {
      ...row,
      descriptor,
      targetDataScore,
      positive,
      negative,
      width,
      height,
      area,
      score
    };
  })
  .filter(row =>
    row.negative === 0 &&
    (row.area >= 500 || row.targetDataScore > 0 || row.positive > 0)
  )
  .sort((a, b) =>
    b.score - a.score ||
    b.area - a.area ||
    b.depth - a.depth
  );

}

async function invokeStructuralServerCandidates(panel,targetServerId,theaterBefore,settings) {const candidates = collectStructuralServerOpenCandidates(panel,targetServerId);

for (let index = 0; index < Math.min(candidates.length, 25); index++) {
  throwIfStopped();
  const candidate = candidates[index];

  const invoked = invokeButtonDirectly(candidate);

  pushLog(`${targetServerId} 구조 기반 서버 카드 시도 ${index + 1}`, {
    nodeName: candidate.name,
    path: nodePathText(candidate.node, 10),
    score: Math.round(candidate.score),
    area: Math.round(candidate.area),
    targetDataScore: candidate.targetDataScore,
    descriptor: candidate.descriptor,
    invoked
  });

  if (!invoked) continue;

  const opened = await waitForFreshTheaterPanel(
    theaterBefore,
    Number(settings.theaterOpenAttemptTimeoutMs ?? 2500)
  );

  if (opened.ok) {
    return {
      ok: true,
      method: "structural-cocos-button",
      serverId: Number(targetServerId),
      candidateIndex: index + 1,
      nodeName: candidate.name,
      nodePath: nodePathText(candidate.node, 10),
      descriptor: candidate.descriptor
    };
  }

  // 잘못된 후보를 눌렀더라도 서버 선택 화면으로 다시 맞춘다.
  try {
    panel.gotoServerById?.(Number(targetServerId));
    await sleep(350);
  } catch {}
}

console.table(
  candidates.slice(0, 30).map((row, index) => ({
    index,
    name: row.name,
    score: Math.round(row.score),
    area: Math.round(row.area),
    targetDataScore: row.targetDataScore,
    positive: row.positive,
    descriptor: row.descriptor
  }))
);

return {
  ok: false,
  method: "structural-cocos-button",
  candidateCount: candidates.length
};

}

async function openSelectedServerSemantic(serverId, options = {}) {const settings = getSettings(options);const target = Number(serverId);const panel = getComponentSafe("WorldServerListPanel");

if (!panel?.node) {
  throw new Error("WorldServerListPanel을 찾지 못했습니다.");
}

const alreadyOpen = await waitForTheaterPanel(150);

if (alreadyOpen.ok) {
  return {
    ok: true,
    method: "already-open",
    serverId: target
  };
}

// 1. target serverId를 실제 데이터로 가진 노드/컴포넌트를 찾아 실행한다.
const serverNodes = findServerNodeCandidates(target);

for (const candidate of serverNodes) {
  let invoked = false;

  if (candidate.button) {
    invoked = invokeButtonDirectly(candidate.button);
  }

  if (!invoked) {
    invoked = await emitNodeOpenEvents(candidate.node);
  }

  pushLog(`${target} 서버 노드 실행 시도`, {
    name: candidate.name,
    path: candidate.path,
    score: candidate.score,
    reasons: candidate.reasons,
    buttonName: candidate.button?.name || null,
    invoked
  });

  if (!invoked) continue;

  const opened = await waitForTheaterPanel(
    Number(settings.theaterOpenTimeoutMs ?? 5000)
  );

  if (opened.ok) {
    pushLog(`${target} 전투 지역 패널 열기 성공`, {
      method: "server-node",
      nodeName: candidate.name,
      path: candidate.path
    });

    return {
      ok: true,
      method: "server-node",
      serverId: target,
      nodeName: candidate.name,
      nodePath: candidate.path
    };
  }

  try {
    panel.gotoServerById?.(target);
    await sleep(300);
  } catch {}
}

// 2. 서버 목록 패널 안의 버튼 clickEvents를 의미 기반으로 찾는다.
const buttonCandidates = buttonsInsideNode(panel.node)
  .map(row => ({
    ...row,
    descriptor: row.descriptor || buttonSemanticDescriptor(row),
    score: serverOpenSemanticScore(
      row.descriptor || buttonSemanticDescriptor(row),
      target
    )
  }))
  .filter(row => row.score > 0)
  .sort((a, b) =>
    b.score - a.score ||
    b.depth - a.depth
  );

for (const candidate of buttonCandidates) {
  const invoked = invokeButtonDirectly(candidate);

  pushLog(`${target} 서버 열기 버튼 시도`, {
    name: candidate.name,
    descriptor: candidate.descriptor,
    score: candidate.score,
    invoked
  });

  if (!invoked) continue;

  const opened = await waitForTheaterPanel(
    Number(settings.theaterOpenTimeoutMs ?? 5000)
  );

  if (opened.ok) {
    return {
      ok: true,
      method: "semantic-button",
      serverId: target,
      buttonName: candidate.name,
      descriptor: candidate.descriptor
    };
  }

  try {
    panel.gotoServerById?.(target);
    await sleep(300);
  } catch {}
}

// 3. WorldServerListPanel 컴포넌트 메서드를 의미 기반으로 실행한다.
const serverData = panel.m_data?.[target] ||
  panel.m_data?.[String(target)] ||
  null;

const methodCandidates = componentMethodNames(panel)
  .filter(methodName => methodName !== "gotoServerById")
  .map(methodName => {
    const descriptor =
      `${componentClassName(panel)} ${methodName}`;

    return {
      methodName,
      descriptor,
      score: serverOpenSemanticScore(descriptor, target),
      argCount: Number(panel[methodName]?.length ?? 0)
    };
  })
  .filter(row => row.score > 0)
  .sort((a, b) => b.score - a.score);

for (const candidate of methodCandidates) {
  const argumentSets = [];

  if (candidate.argCount === 0) {
    argumentSets.push([]);
  }

  argumentSets.push(
    [target],
    [String(target)]
  );

  if (serverData) {
    argumentSets.push(
      [serverData],
      [target, serverData],
      [serverData, target]
    );
  }

  for (const args of argumentSets) {
    try {
      panel[candidate.methodName](...args);
    } catch {
      continue;
    }

    pushLog(`${target} 서버 열기 메서드 시도`, {
      methodName: candidate.methodName,
      descriptor: candidate.descriptor,
      args: args.map(arg =>
        typeof arg === "object"
          ? "[object]"
          : arg
      )
    });

    const opened = await waitForTheaterPanel(
      Number(settings.theaterOpenTimeoutMs ?? 5000)
    );

    if (opened.ok) {
      return {
        ok: true,
        method: "panel-method",
        serverId: target,
        methodName: candidate.methodName
      };
    }

    try {
      panel.gotoServerById?.(target);
      await sleep(300);
    } catch {}
  }
}

console.table(
  serverNodes.slice(0, 30).map((row, index) => ({
    index,
    name: row.name,
    path: row.path,
    score: row.score,
    buttonName: row.button?.name,
    reasons: row.reasons.join(",")
  }))
);

console.table(
  buttonCandidates.slice(0, 30).map((row, index) => ({
    index,
    name: row.name,
    score: row.score,
    descriptor: row.descriptor
  }))
);

console.table(
  methodCandidates.slice(0, 30).map((row, index) => ({
    index,
    methodName: row.methodName,
    score: row.score,
    argCount: row.argCount,
    descriptor: row.descriptor
  }))
);

throw new Error(
  `${target} 서버 전투 지역을 좌표 없이 열지 못했습니다.`
);

}

function getTheaterPanelComponent() {return getComponentSafe("WorldServerTheaterPanel");}

function componentsFromNodeAndAncestors(node, maxDepth = 8) {const rows = [];const seen = new Set();let current = node;let depth = 0;

while (current && depth < maxDepth) {
  for (const component of current._components || []) {
    if (!component || seen.has(component)) continue;
    seen.add(component);

    rows.push({
      component,
      node: current,
      depth,
      className: componentClassName(component)
    });
  }

  current = current.parent;
  depth++;
}

return rows;

}

function buttonsInsideNode(root) {if (!root || !window.cc?.Button) return [];

const rows = [];
const stack = [{ node: root, depth: 0 }];
const visited = new Set();

while (stack.length) {
  const { node, depth } = stack.pop();
  if (!node || visited.has(node)) continue;
  visited.add(node);

  if (node.active !== false && node.activeInHierarchy !== false) {
    let button = null;

    try {
      button = node.getComponent?.(cc.Button);
    } catch {}

    if (button && button.enabled !== false && button.interactable !== false) {
      const row = {
        node,
        button,
        depth,
        name: String(node.name || ""),
        text: collectNodeText(node),
        rect: nodeWorldRect(node)
      };

      row.descriptor = buttonSemanticDescriptor(row);
      rows.push(row);
    }

    for (const child of node.children || []) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }
}

return rows;

}

async function waitForRequestedRankPanel(kind, timeoutMs = 4000) {const targetName = kind === "personal"? "WorldServerPowerRank": "WorldServerAlliancePowerRank";

const wrongName = kind === "personal"
  ? "WorldServerAlliancePowerRank"
  : "WorldServerPowerRank";

const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  if (componentIsActive(targetName)) {
    return {
      ok: true,
      targetOpened: true,
      wrongOpened: false,
      componentName: targetName,
      elapsedMs: Date.now() - startedAt
    };
  }

  if (componentIsActive(wrongName)) {
    return {
      ok: false,
      targetOpened: false,
      wrongOpened: true,
      componentName: wrongName,
      elapsedMs: Date.now() - startedAt
    };
  }

  await sleep(100);
}

return {
  ok: false,
  targetOpened: false,
  wrongOpened: false,
  componentName: null,
  elapsedMs: Date.now() - startedAt
};

}

async function invokeRankMethodCandidate(component, methodName, kind, settings) {try {component[methodName]();} catch (error) {return {ok: false,methodName,error: error?.message || String(error)};}

const result = await waitForRequestedRankPanel(
  kind,
  Number(settings.rankOpenTimeoutMs ?? 12000)
);

return {
  ...result,
  methodName
};

}

async function openRankPanelSemantic(kind, options = {}) {const settings = getSettings(options);const theater = getTheaterPanelComponent();

if (!theater?.node) {
  throw new Error("WorldServerTheaterPanel을 찾지 못했습니다.");
}

const methodCandidates = componentMethodNames(theater)
  .map(name => ({
    name,
    descriptor: `${componentClassName(theater)} ${name}`,
    score: semanticRankScore(`${componentClassName(theater)} ${name}`, kind)
  }))
  .filter(row => row.score > 0)
  .sort((a, b) => b.score - a.score);

for (const candidate of methodCandidates) {
  const result = await invokeRankMethodCandidate(
    theater,
    candidate.name,
    kind,
    settings
  );

  pushLog(`${kind} 랭킹 메서드 시도`, {
    method: candidate.name,
    score: candidate.score,
    result
  });

  if (result.targetOpened) {
    return {
      ok: true,
      kind,
      method: "component-method",
      methodName: candidate.name
    };
  }

  if (result.wrongOpened) {
    await closeRankPanel(result.componentName, settings);
    await sleep(300);
  }
}

const buttonCandidates = buttonsInsideNode(theater.node)
  .map(row => ({
    ...row,
    score: semanticRankScore(row.descriptor, kind)
  }))
  .filter(row => row.score > 0)
  .sort((a, b) => b.score - a.score || b.depth - a.depth);

for (const candidate of buttonCandidates) {
  const invoked = invokeButtonDirectly(candidate);

  pushLog(`${kind} 랭킹 버튼 시도`, {
    nodeName: candidate.name,
    descriptor: candidate.descriptor,
    score: candidate.score,
    invoked
  });

  if (!invoked) continue;

  const result = await waitForRequestedRankPanel(
    kind,
    Number(settings.rankOpenTimeoutMs ?? 12000)
  );

  if (result.targetOpened) {
    return {
      ok: true,
      kind,
      method: "cocos-button-event",
      buttonName: candidate.name,
      descriptor: candidate.descriptor
    };
  }

  if (result.wrongOpened) {
    await closeRankPanel(result.componentName, settings);
    await sleep(300);
  }
}

console.table(
  buttonCandidates.slice(0, 30).map((row, index) => ({
    index,
    name: row.name,
    text: row.text,
    score: row.score,
    descriptor: row.descriptor
  }))
);

console.table(
  methodCandidates.slice(0, 30).map((row, index) => ({
    index,
    methodName: row.name,
    score: row.score,
    descriptor: row.descriptor
  }))
);

throw new Error(
  `${kind === "personal" ? "개인" : "길드"} 전투력 랭킹 실행 메서드/버튼을 찾지 못했습니다.`
);

}

function normalizeCommandName(name) {return String(name || "").replace(/[^a-zA-Z0-9가-힣]/g, "").toLowerCase();}

function closeCommandScore(methodName, className = "", path = "") {const name = normalizeCommandName(methodName);const context = normalizeCommandName(`${className} ${path}`);

const blocked = [
  "open",
  "show",
  "create",
  "init",
  "start",
  "enable",
  "disable",
  "destroy",
  "update",
  "refresh",
  "reset",
  "load",
  "schedule",
  "unschedule",
  "removeall",
  "clearall"
];

if (blocked.some(word => name.includes(word))) return -100000;

const exact = new Map([
  ["onclickclose", 20000],
  ["onbtnclose", 19800],
  ["oncloseclick", 19600],
  ["onclickbtnclose", 19400],
  ["onclosebtnclick", 19200],
  ["close", 19000],
  ["closepanel", 18800],
  ["closeview", 18600],
  ["closewindow", 18400],
  ["closeself", 18200],
  ["onclose", 18000],

  ["onclickback", 17500],
  ["onbtnback", 17300],
  ["onbackclick", 17100],
  ["onclickbtnback", 16900],
  ["goback", 16700],
  ["back", 16500],
  ["onback", 16300],
  ["returnback", 16100],

  ["dismiss", 15000],
  ["hide", 14500],
  ["hidepanel", 14300],
  ["hideview", 14100],
  ["removefromparent", 13000]
]);

if (exact.has(name)) return exact.get(name);

let score = 0;

if (/^(on)?(click|btn)?close/.test(name)) score += 17000;
if (/close(click|handler|callback|panel|view|window|self)?$/.test(name)) score += 16000;
if (/^(on)?(click|btn)?back/.test(name)) score += 15000;
if (/(go|return)?back$/.test(name)) score += 14500;
if (/dismiss|hidepanel|hideview/.test(name)) score += 13000;

if (context.includes("worldserverpowerrank")) score += 500;
if (context.includes("worldserveralliancepowerrank")) score += 500;
if (context.includes("worldservertheaterpanel")) score += 500;
if (context.includes("uiframescreen")) score += 300;

return score;

}

function resolveEventHandlerTarget(handler) {const targetNode = handler?.target || handler?._target || null;const componentName = String(handler?.component ||handler?._componentName ||handler?.componentName ||"");const handlerName = String(handler?.handler ||handler?._handler ||"");const customEventData =handler?.customEventData ??handler?._customEventData ??null;

let component = null;

if (targetNode && componentName) {
  try {
    component = targetNode.getComponent?.(componentName) || null;
  } catch {}

  if (!component) {
    component = (targetNode._components || []).find(row =>
      componentClassName(row) === componentName ||
      componentClassName(row).includes(componentName)
    ) || null;
  }
}

return {
  targetNode,
  componentName,
  handlerName,
  customEventData,
  component
};

}

function invokeCloseEventHandler(handler) {if (!handler) return {ok: false,reason: "handler missing"};

const resolved = resolveEventHandlerTarget(handler);

// Cocos EventHandler 자체가 있으면 연결된 컴포넌트 메서드를 직접 실행한다.
try {
  if (typeof handler.emit === "function") {
    handler.emit([]);
    return {
      ok: true,
      method: "event-handler-emit",
      ...resolved
    };
  }
} catch (error) {
  // 아래 직접 호출로 계속 진행한다.
}

const fn = resolved.component?.[resolved.handlerName];

if (typeof fn !== "function") {
  return {
    ok: false,
    reason: "resolved handler function missing",
    ...resolved
  };
}

try {
  if (fn.length <= 0) {
    fn.call(resolved.component);
  } else if (fn.length === 1) {
    fn.call(
      resolved.component,
      resolved.customEventData
    );
  } else {
    fn.call(
      resolved.component,
      null,
      resolved.customEventData
    );
  }

  return {
    ok: true,
    method: "event-handler-direct-call",
    ...resolved
  };
} catch (error) {
  return {
    ok: false,
    reason: error?.message || String(error),
    ...resolved
  };
}

}

function collectPanelCloseCommands(componentName) {const target = getComponentSafe(componentName);

if (!target?.node) {
  return {
    componentName,
    target: null,
    methods: [],
    handlers: []
  };
}

const componentRows = componentsFromNodeAndAncestors(
  target.node,
  12
);

const methods = [];

for (const row of componentRows) {
  for (const methodName of componentMethodNames(row.component)) {
    const score = closeCommandScore(
      methodName,
      row.className,
      nodePathText(row.node)
    );

    if (score <= 0) continue;

    methods.push({
      component: row.component,
      componentClassName: row.className,
      node: row.node,
      depth: row.depth,
      methodName,
      argCount: Number(
        row.component?.[methodName]?.length ?? 0
      ),
      score,
      path: nodePathText(row.node, 12)
    });
  }
}

methods.sort((a, b) =>
  b.score - a.score ||
  a.depth - b.depth ||
  a.argCount - b.argCount
);

let root = target.node;
for (let i = 0; i < 6 && root?.parent; i++) {
  root = root.parent;
}

const handlers = [];

for (const buttonRow of buttonsInsideNode(root)) {
  const buttonScore = semanticCloseScore(
    buttonRow.descriptor
  );

  for (
    const handler of buttonRow.button?.clickEvents || []
  ) {
    const resolved = resolveEventHandlerTarget(handler);
    const methodScore = closeCommandScore(
      resolved.handlerName,
      resolved.componentName,
      buttonRow.descriptor
    );

    const score = Math.max(
      buttonScore,
      methodScore
    );

    if (score <= 0) continue;

    handlers.push({
      handler,
      buttonNode: buttonRow.node,
      buttonName: buttonRow.name,
      descriptor: buttonRow.descriptor,
      resolved,
      score,
      depth: buttonRow.depth
    });
  }
}

handlers.sort((a, b) =>
  b.score - a.score ||
  b.depth - a.depth
);

return {
  componentName,
  target,
  methods,
  handlers
};

}

function inspectPanelCloseCommands(componentName) {const result = collectPanelCloseCommands(componentName);

console.table(
  result.methods.slice(0, 50).map((row, index) => ({
    index,
    score: row.score,
    component: row.componentClassName,
    method: row.methodName,
    args: row.argCount,
    depth: row.depth,
    path: row.path
  }))
);

console.table(
  result.handlers.slice(0, 50).map((row, index) => ({
    index,
    score: row.score,
    button: row.buttonName,
    component: row.resolved.componentName,
    handler: row.resolved.handlerName,
    descriptor: row.descriptor
  }))
);

return result;

}

async function invokeCloseMethodCandidate(candidate,componentName,settings) {const fn = candidate.component?.[candidate.methodName];

if (typeof fn !== "function") {
  return {
    ok: false,
    reason: "method missing"
  };
}

const argSets = candidate.argCount <= 0
  ? [[]]
  : [
      [null],
      [candidate.component],
      [null, null]
    ];

let lastError = null;

for (const args of argSets) {
  try {
    fn.apply(candidate.component, args);
  } catch (error) {
    lastError = error;
    continue;
  }

  const closed = await waitForComponentInactive(
    componentName,
    Number(settings.commandCloseVerifyMs ?? 700)
  );

  if (closed.ok) {
    return {
      ok: true,
      method: "component-command",
      methodName: candidate.methodName,
      componentClassName:
        candidate.componentClassName,
      argsUsed: args.length,
      closed
    };
  }
}

return {
  ok: false,
  methodName: candidate.methodName,
  error: lastError?.message || null
};

}

async function closePanelByCommand(componentName, options = {}) {const settings = getSettings(options);

throwIfStopped();

if (!componentIsActive(componentName)) {
  return {
    ok: true,
    alreadyClosed: true,
    method: "already-closed"
  };
}

const commands = collectPanelCloseCommands(componentName);

// 1. close(), onClickClose(), onBack() 같은 컴포넌트 메서드 직접 호출
for (const candidate of commands.methods) {
  throwIfStopped();

  const result = await invokeCloseMethodCandidate(
    candidate,
    componentName,
    settings
  );

  pushLog(`${componentName} 닫기 명령 시도`, {
    component: candidate.componentClassName,
    methodName: candidate.methodName,
    score: candidate.score,
    result
  });

  if (result.ok) {
    return result;
  }
}

// 2. 닫기 버튼에 직렬화된 Cocos 핸들러 함수 직접 실행
for (const candidate of commands.handlers) {
  throwIfStopped();

  const invoked = invokeCloseEventHandler(
    candidate.handler
  );

  pushLog(`${componentName} 닫기 핸들러 시도`, {
    buttonName: candidate.buttonName,
    componentName:
      candidate.resolved.componentName,
    handlerName:
      candidate.resolved.handlerName,
    score: candidate.score,
    invoked
  });

  if (!invoked.ok) continue;

  const closed = await waitForComponentInactive(
    componentName,
    Number(settings.commandCloseVerifyMs ?? 700)
  );

  if (closed.ok) {
    return {
      ok: true,
      method: invoked.method,
      buttonName: candidate.buttonName,
      componentName:
        candidate.resolved.componentName,
      handlerName:
        candidate.resolved.handlerName,
      closed
    };
  }
}

inspectPanelCloseCommands(componentName);

throw new Error(
  `${componentName}에서 실행 가능한 close/back 명령을 찾지 못했습니다.`
);

}

async function closePanelSemantic(componentName, options = {}) {
// 기존 API 호환. 이제 마우스·키보드 입력을 전혀 사용하지 않는다.
return closePanelByCommand(componentName, options);
}

function nodeOwnText(node) {const texts = [];

try {
  const label = node?.getComponent?.(cc.Label);
  if (label?.string) texts.push(String(label.string));
} catch {}

try {
  const richText = node?.getComponent?.(cc.RichText);
  if (richText?.string) texts.push(String(richText.string));
} catch {}

return texts.join(" ").replace(/\s+/g, " ").trim();

}

function collectNodeText(root, maxDepth = 8) {if (!root) return "";

const texts = [];
const stack = [{ node: root, depth: 0 }];
const visited = new Set();

while (stack.length) {
  const { node, depth } = stack.pop();
  if (!node || visited.has(node) || depth > maxDepth) continue;
  visited.add(node);

  const ownText = nodeOwnText(node);
  if (ownText) texts.push(ownText);

  for (const child of node.children || []) {
    stack.push({ node: child, depth: depth + 1 });
  }
}

return texts.join(" ").replace(/\s+/g, " ").trim();

}

function listActiveButtons() {const root = scene();if (!root || !window.cc?.Button) return [];

const rows = [];
const stack = [{ node: root, depth: 0 }];
const visited = new Set();

while (stack.length) {
  const { node, depth } = stack.pop();
  if (!node || visited.has(node)) continue;
  visited.add(node);

  if (node.active !== false && node.activeInHierarchy !== false) {
    let button = null;
    try { button = node.getComponent?.(cc.Button); } catch {}

    if (button && button.enabled !== false && button.interactable !== false) {
      const rect = nodeWorldRect(node);
      rows.push({
        node,
        button,
        depth,
        name: String(node.name || ""),
        text: collectNodeText(node),
        rect
      });
    }

    for (const child of node.children || []) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }
}

rows.sort((a, b) => {
  const ay = a.rect?.bottom ?? -999999;
  const by = b.rect?.bottom ?? -999999;
  return by - ay || b.depth - a.depth;
});

return rows;

}

function buttonTextScore(row, includeWords, excludeWords = []) {const haystack = `${row?.name || ""} ${row?.text || ""}`.replace(/\s+/g, "").toLowerCase();

let score = 0;

for (const word of includeWords || []) {
  const normalized = String(word).replace(/\s+/g, "").toLowerCase();
  if (!normalized) continue;

  if (haystack.includes(normalized)) {
    score += normalized.length >= 5 ? 1000 : 200;
  }
}

for (const word of excludeWords || []) {
  const normalized = String(word).replace(/\s+/g, "").toLowerCase();
  if (normalized && haystack.includes(normalized)) {
    score -= 2000;
  }
}

if (row?.rect) {
  // 화면 하단 버튼 우선
  score += Math.max(0, Number(row.rect.bottom || 0)) / 100;
}

return score;

}

function findRankButton(kind) {const buttons = listActiveButtons();

const config = kind === "personal"
  ? {
      include: [
        "개인 전투력 랭킹",
        "개인전투력랭킹",
        "개인 전투력",
        "개인",
        "personal",
        "player power",
        "worldserverpowerrank"
      ],
      exclude: [
        "길드",
        "동맹",
        "alliance",
        "guild"
      ]
    }
  : {
      include: [
        "길드 전투력 랭킹",
        "동맹 전투력 랭킹",
        "길드전투력랭킹",
        "길드 전투력",
        "동맹 전투력",
        "길드",
        "동맹",
        "alliance",
        "guild",
        "worldserveralliancepowerrank"
      ],
      exclude: [
        "개인",
        "personal"
      ]
    };

const ranked = buttons
  .map(row => ({
    ...row,
    score: buttonTextScore(row, config.include, config.exclude)
  }))
  .filter(row => row.score > 0)
  .sort((a, b) => b.score - a.score || b.depth - a.depth);

return {
  match: ranked[0] || null,
  candidates: ranked
};

}

function pointToRectDistance(point, rect) {if (!point || !rect) return Number.POSITIVE_INFINITY;

const dx =
  point.x < rect.left ? rect.left - point.x :
  point.x > rect.right ? point.x - rect.right :
  0;

const dy =
  point.y < rect.bottom ? rect.bottom - point.y :
  point.y > rect.top ? point.y - rect.top :
  0;

return Math.hypot(dx, dy);

}

function findButtonNearSourceCoordinate(sourceX, sourceY, options = {}) {const point = toClientPoint(sourceX, sourceY, options);const cocosPoint = canvasLocalToCocos(point.localX, point.localY);const buttons = listActiveButtons();

const candidates = buttons
  .filter(row => row.rect)
  .map(row => {
    const centerX = (row.rect.left + row.rect.right) / 2;
    const centerY = (row.rect.bottom + row.rect.top) / 2;
    const centerDistance = Math.hypot(
      centerX - cocosPoint.x,
      centerY - cocosPoint.y
    );
    const rectDistance = pointToRectDistance(cocosPoint, row.rect);
    const contains = rectDistance === 0;

    return {
      ...row,
      sourceX,
      sourceY,
      cocosPoint,
      centerX,
      centerY,
      centerDistance,
      rectDistance,
      contains,
      geometryScore:
        (contains ? 100000 : 0) -
        rectDistance * 100 -
        centerDistance
    };
  })
  .sort((a, b) =>
    b.geometryScore - a.geometryScore ||
    b.depth - a.depth
  );

return {
  point,
  cocosPoint,
  match: candidates[0] || null,
  candidates
};

}

function getRankPanelState() {return {personal: componentIsActive("WorldServerPowerRank"),alliance: componentIsActive("WorldServerAlliancePowerRank")};}

async function waitForAnyRankPanel(timeoutMs = 2500) {const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  const state = getRankPanelState();

  if (state.personal || state.alliance) {
    return {
      ...state,
      elapsedMs: Date.now() - startedAt
    };
  }

  await sleep(100);
}

return {
  ...getRankPanelState(),
  elapsedMs: Date.now() - startedAt
};

}

async function closeAnyRankPanel(options = {}) {const results = [];

if (componentIsActive("WorldServerPowerRank")) {
  try {
    results.push(await closeRankPanel("WorldServerPowerRank", options));
  } catch (error) {
    results.push({
      ok: false,
      componentName: "WorldServerPowerRank",
      error: error?.message || String(error)
    });
  }
}

if (componentIsActive("WorldServerAlliancePowerRank")) {
  try {
    results.push(await closeRankPanel("WorldServerAlliancePowerRank", options));
  } catch (error) {
    results.push({
      ok: false,
      componentName: "WorldServerAlliancePowerRank",
      error: error?.message || String(error)
    });
  }
}

return results;

}

function rankCoordinateAttempts(kind) {if (kind === "personal") {return [// Java 원본 좌표{ x: 299, y: 657, coordinateMode: "scaled" },{ x: 299, y: 657, coordinateMode: "raw" },

    // 개인 버튼 방향인 왼쪽으로 보정
    { x: 280, y: 657, coordinateMode: "scaled" },
    { x: 260, y: 657, coordinateMode: "scaled" },
    { x: 280, y: 657, coordinateMode: "raw" },
    { x: 260, y: 657, coordinateMode: "raw" },

    // 세로 위치 보정
    { x: 299, y: 675, coordinateMode: "scaled" },
    { x: 280, y: 675, coordinateMode: "scaled" }
  ];
}

return [
  // Java 원본 좌표
  { x: 400, y: 657, coordinateMode: "scaled" },
  { x: 400, y: 657, coordinateMode: "raw" },

  // 길드 버튼 방향인 오른쪽으로 보정
  { x: 420, y: 657, coordinateMode: "scaled" },
  { x: 440, y: 657, coordinateMode: "scaled" },
  { x: 420, y: 657, coordinateMode: "raw" },
  { x: 440, y: 657, coordinateMode: "raw" },

  // 세로 위치 보정
  { x: 400, y: 675, coordinateMode: "scaled" },
  { x: 420, y: 675, coordinateMode: "scaled" }
];

}

async function clickRankButtonByCoordinate(kind, options = {}) {
// 하위 호환용 이름만 유지한다.
// 실제 구현은 좌표를 전혀 사용하지 않는다.
return openRankPanelSemantic(kind, options);
}

async function clickRankButton(kind, options = {}) {return openRankPanelSemantic(kind, options);}

function componentIsActive(componentName) {const comp = getComponentSafe(componentName);if (!comp?.node) return false;return comp.node.active !== false && comp.node.activeInHierarchy !== false;}

async function waitForComponentActive(componentName, timeoutMs = 2500) {const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  if (componentIsActive(componentName)) return true;
  await sleep(100);
}

return false;

}

async function openRankPanelByCoordinate(componentName, x, y, options = {}) {const settings = getSettings(options);const attempts = [{ clickMode: "dom-only", label: "DOM 이벤트" },{ clickMode: "both", label: "DOM + Cocos 직접 호출" },{ clickMode: "direct-only", label: "Cocos 직접 호출" }];

for (const attempt of attempts) {
  const result = clickCanvas(x, y, {
    ...settings,
    clickMode: attempt.clickMode
  });

  const opened = await waitForComponentActive(
    componentName,
    Number(settings.clickDelayMs ?? 1200) + 1000
  );

  pushLog(`${componentName} 열기 시도: ${attempt.label}`, {
    opened,
    click: result
  });

  if (opened) {
    return {
      ok: true,
      componentName,
      attempt: attempt.label,
      click: result
    };
  }

  await sleep(300);
}

throw new Error(`${componentName} 화면을 열지 못했습니다.`);

}

function findLikelyCloseButton(componentName) {const comp = getComponentSafe(componentName);const root = comp?.node;if (!root) return null;

const namePattern = /(back|close|return|exit|cancel|btn.?back|btn.?close|返回|关闭|닫기|뒤로)/i;
const candidates = [];
const stack = [{ node: root, depth: 0 }];

while (stack.length) {
  const { node, depth } = stack.pop();
  if (!node || node.active === false || node.activeInHierarchy === false) continue;

  let button = null;
  try { button = node.getComponent?.(cc.Button); } catch {}

  if (button && button.enabled !== false && button.interactable !== false) {
    const rect = nodeWorldRect(node);
    const name = String(node.name || "");
    const score =
      (namePattern.test(name) ? 1000 : 0) +
      (rect ? Math.max(0, 500 - rect.left) : 0) +
      depth;

    candidates.push({ node, button, rect, depth, score, name });
  }

  for (const child of node.children || []) {
    stack.push({ node: child, depth: depth + 1 });
  }
}

candidates.sort((a, b) => b.score - a.score);
return candidates[0] || null;

}

async function closeRankPanel(componentName, options = {}) {return closePanelSemantic(componentName, options);}



function dispatchDomMousePress(point) {const canvas = getCanvas();if (!canvas) throw new Error("canvas 없음");

const down = {
  bubbles: true,
  cancelable: true,
  composed: true,
  clientX: point.clientX,
  clientY: point.clientY,
  screenX: point.clientX,
  screenY: point.clientY,
  button: 0,
  buttons: 1
};

const up = {
  ...down,
  buttons: 0
};

// Cocos가 실제 마우스 입력으로 처리하는 한 쌍만 전송한다.
// pointer/click 이벤트를 추가로 보내지 않아 새로 열린 화면에 재입력되는 것을 방지한다.
canvas.dispatchEvent(new MouseEvent("mousedown", down));
canvas.dispatchEvent(new MouseEvent("mouseup", up));

}

function clickJavaPointMouseOnly(x, y, options = {}) {const point = toClientPoint(x, y, {...getSettings(options),coordinateMode: "scaled"});

dispatchDomMousePress(point);

const result = {
  ...point,
  clickMode: "mouse-down-up-only",
  domDispatched: true
};

pushLog(`게임 단일 마우스 클릭 (${x}, ${y})`, result);
return result;

}

async function waitForEitherRankPanel(timeoutMs = 3000) {const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  throwIfStopped();

  const personal = componentIsActive("WorldServerPowerRank");
  const alliance = componentIsActive("WorldServerAlliancePowerRank");

  if (personal || alliance) {
    return {
      opened: true,
      personal,
      alliance,
      componentName: personal
        ? "WorldServerPowerRank"
        : "WorldServerAlliancePowerRank",
      elapsedMs: Date.now() - startedAt
    };
  }

  await sleep(80);
}

return {
  opened: false,
  personal: false,
  alliance: false,
  componentName: null,
  elapsedMs: Date.now() - startedAt
};

}

function rankPointAttempts(kind) {if (kind === "personal") {
// 299가 동맹 버튼으로 판정되는 화면을 고려해 왼쪽부터 시작한다.
return [{ x: 260, y: 657 },{ x: 280, y: 657 },{ x: 299, y: 657 },{ x: 250, y: 675 },{ x: 275, y: 675 }];}

return [
  { x: 400, y: 657 },
  { x: 420, y: 657 },
  { x: 440, y: 657 },
  { x: 400, y: 675 },
  { x: 425, y: 675 }
];

}

function clickJavaPointDomOnly(x, y, options = {}) {return clickJavaPointMouseOnly(x, y, options);}

async function waitForComponentInactive(componentName, timeoutMs = 5000) {const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  throwIfStopped();

  if (!componentIsActive(componentName)) {
    return {
      ok: true,
      componentName,
      elapsedMs: Date.now() - startedAt
    };
  }

  await sleep(100);
}

return {
  ok: false,
  componentName,
  elapsedMs: Date.now() - startedAt
};

}

function rankOpenCommandScore(kind, methodName, context = "") {const name = normalizeCommandName(methodName);const haystack = normalizeCommandName(`${methodName} ${context}`);

const personalWords = [
  "personal",
  "player",
  "power",
  "person",
  "role",
  "user",
  "worldserverpowerrank",
  "개인",
  "유저",
  "전투력"
];

const allianceWords = [
  "alliance",
  "guild",
  "league",
  "clan",
  "union",
  "worldserveralliancepowerrank",
  "동맹",
  "길드",
  "연맹"
];

const targetWords = kind === "personal"
  ? personalWords
  : allianceWords;

const oppositeWords = kind === "personal"
  ? allianceWords
  : personalWords;

const openWords = [
  "open",
  "show",
  "enter",
  "click",
  "select",
  "rank",
  "power",
  "list",
  "panel",
  "view"
];

const blocked = [
  "close",
  "back",
  "hide",
  "dismiss",
  "destroy",
  "remove",
  "refresh",
  "update",
  "init",
  "start"
];

if (blocked.some(word => name.includes(word))) {
  return -100000;
}

let score = 0;

for (const word of targetWords) {
  if (haystack.includes(normalizeCommandName(word))) {
    score += 6000;
  }
}

for (const word of oppositeWords) {
  if (haystack.includes(normalizeCommandName(word))) {
    score -= 9000;
  }
}

for (const word of openWords) {
  if (haystack.includes(word)) {
    score += 1000;
  }
}

if (kind === "alliance") {
  if (/alliance|guild|league|clan|union/.test(name)) {
    score += 8000;
  }
  if (/rank|power/.test(name)) {
    score += 2000;
  }
} else {
  if (/personal|player|role|user/.test(name)) {
    score += 8000;
  }
  if (/rank|power/.test(name)) {
    score += 2000;
  }
}

return score;

}

function collectRankOpenCommands(kind) {const theater = getComponentSafe("WorldServerTheaterPanel");

if (!theater?.node) {
  return {
    kind,
    theater: null,
    methods: [],
    handlers: []
  };
}

const componentRows = componentsFromNodeAndAncestors(
  theater.node,
  8
);

const methods = [];

for (const row of componentRows) {
  for (const methodName of componentMethodNames(row.component)) {
    const context = [
      row.className,
      nodePathText(row.node, 12)
    ].join(" ");

    const score = rankOpenCommandScore(
      kind,
      methodName,
      context
    );

    if (score <= 0) continue;

    methods.push({
      component: row.component,
      componentClassName: row.className,
      node: row.node,
      methodName,
      argCount: Number(
        row.component?.[methodName]?.length ?? 0
      ),
      score,
      path: nodePathText(row.node, 12)
    });
  }
}

methods.sort((a, b) =>
  b.score - a.score ||
  a.argCount - b.argCount
);

const handlers = [];

for (const buttonRow of buttonsInsideNode(theater.node)) {
  for (
    const handler of buttonRow.button?.clickEvents || []
  ) {
    const resolved = resolveEventHandlerTarget(handler);

    const context = [
      buttonRow.descriptor,
      resolved.componentName,
      resolved.handlerName
    ].join(" ");

    const score = rankOpenCommandScore(
      kind,
      resolved.handlerName,
      context
    );

    if (score <= 0) continue;

    handlers.push({
      handler,
      buttonNode: buttonRow.node,
      buttonName: buttonRow.name,
      descriptor: buttonRow.descriptor,
      resolved,
      score,
      depth: buttonRow.depth
    });
  }
}

handlers.sort((a, b) =>
  b.score - a.score ||
  b.depth - a.depth
);

return {
  kind,
  theater,
  methods,
  handlers
};

}

function inspectRankOpenCommands(kind = "alliance") {const result = collectRankOpenCommands(kind);

console.table(
  result.methods.slice(0, 50).map((row, index) => ({
    index,
    score: row.score,
    component: row.componentClassName,
    method: row.methodName,
    args: row.argCount,
    path: row.path
  }))
);

console.table(
  result.handlers.slice(0, 50).map((row, index) => ({
    index,
    score: row.score,
    button: row.buttonName,
    component: row.resolved.componentName,
    handler: row.resolved.handlerName,
    descriptor: row.descriptor
  }))
);

return result;

}

async function invokeRankOpenMethodCandidate(candidate,expectedComponent,wrongComponent,settings) {const fn = candidate.component?.[candidate.methodName];

if (typeof fn !== "function") {
  return {
    ok: false,
    reason: "method missing"
  };
}

const argSets = candidate.argCount <= 0
  ? [[]]
  : [
      [null],
      [candidate.component],
      [0],
      [1],
      [null, null]
    ];

for (const args of argSets) {
  try {
    fn.apply(candidate.component, args);
  } catch {
    continue;
  }

  const detected = await waitForEitherRankPanel(
    Number(settings.rankCommandVerifyMs ?? 1000)
  );

  if (detected.componentName === expectedComponent) {
    return {
      ok: true,
      method: "rank-component-command",
      methodName: candidate.methodName,
      componentClassName:
        candidate.componentClassName,
      argsUsed: args,
      detected
    };
  }

  if (detected.componentName === wrongComponent) {
    await closePanelByCommand(
      wrongComponent,
      settings
    );
    await sleep(
      Number(settings.wrongRankRetryDelayMs ?? 250)
    );
  }
}

return {
  ok: false,
  methodName: candidate.methodName
};

}

async function openRankPanelByCommand(kind, options = {}) {const settings = getSettings(options);const expectedComponent = kind === "personal"? "WorldServerPowerRank": "WorldServerAlliancePowerRank";const wrongComponent = kind === "personal"? "WorldServerAlliancePowerRank": "WorldServerPowerRank";

throwIfStopped();

if (componentIsActive(expectedComponent)) {
  return {
    ok: true,
    alreadyOpen: true,
    method: "already-open",
    componentName: expectedComponent
  };
}

if (componentIsActive(wrongComponent)) {
  await closePanelByCommand(
    wrongComponent,
    settings
  );
}

const commands = collectRankOpenCommands(kind);

// 1. WorldServerTheaterPanel 및 부모 컴포넌트의 메서드 직접 호출
for (const candidate of commands.methods) {
  throwIfStopped();

  const result = await invokeRankOpenMethodCandidate(
    candidate,
    expectedComponent,
    wrongComponent,
    settings
  );

  pushLog(
    `${kind === "personal" ? "개인" : "길드"} 랭킹 열기 명령 시도`,
    {
      component:
        candidate.componentClassName,
      methodName: candidate.methodName,
      score: candidate.score,
      result
    }
  );

  if (result.ok) {
    return {
      ...result,
      kind,
      componentName: expectedComponent
    };
  }
}

// 2. 버튼에 직렬화된 Cocos EventHandler 직접 실행
for (const candidate of commands.handlers) {
  throwIfStopped();

  const invoked = invokeCloseEventHandler(
    candidate.handler
  );

  pushLog(
    `${kind === "personal" ? "개인" : "길드"} 랭킹 버튼 핸들러 시도`,
    {
      buttonName: candidate.buttonName,
      componentName:
        candidate.resolved.componentName,
      handlerName:
        candidate.resolved.handlerName,
      score: candidate.score,
      invoked
    }
  );

  if (!invoked.ok) continue;

  const detected = await waitForEitherRankPanel(
    Number(settings.rankCommandVerifyMs ?? 1000)
  );

  if (detected.componentName === expectedComponent) {
    return {
      ok: true,
      kind,
      method: invoked.method,
      componentName: expectedComponent,
      buttonName: candidate.buttonName,
      handlerName:
        candidate.resolved.handlerName,
      detected
    };
  }

  if (detected.componentName === wrongComponent) {
    await closePanelByCommand(
      wrongComponent,
      settings
    );
    await sleep(
      Number(settings.wrongRankRetryDelayMs ?? 250)
    );
  }
}

inspectRankOpenCommands(kind);

return {
  ok: false,
  kind,
  reason: "rank open command not found"
};

}

async function openRankPanelByJavaPoint(kind, options = {}) {const settings = getSettings(options);const personal = kind === "personal";const expectedComponent = personal? "WorldServerPowerRank": "WorldServerAlliancePowerRank";const wrongComponent = personal? "WorldServerAlliancePowerRank": "WorldServerPowerRank";

// 길드 랭킹은 화면 크기 영향을 받지 않도록 명령 기반을 우선한다.
if (!personal) {
  const commandResult = await openRankPanelByCommand(
    kind,
    settings
  );

  if (commandResult.ok) {
    return commandResult;
  }

  pushLog(
    "길드 랭킹 명령 기반 열기 실패 - 좌표 fallback",
    commandResult
  );
}

const attempts = rankPointAttempts(kind);

if (componentIsActive("WorldServerPowerRank")) {
  await closePanelByCommand(
    "WorldServerPowerRank",
    settings
  );
}

if (componentIsActive("WorldServerAlliancePowerRank")) {
  await closePanelByCommand(
    "WorldServerAlliancePowerRank",
    settings
  );
}

for (let index = 0; index < attempts.length; index++) {
  throwIfStopped();

  const point = attempts[index];
  const click = clickJavaPointMouseOnly(
    point.x,
    point.y,
    settings
  );

  pushLog(
    `${personal ? "개인" : "길드"} 랭킹 클릭 시도 ${index + 1}`,
    {
      expectedComponent,
      point,
      click
    }
  );

  const detected = await waitForEitherRankPanel(
    Number(
      settings.rankChoiceDetectTimeoutMs ?? 2500
    )
  );

  if (detected.componentName === expectedComponent) {
    return {
      ok: true,
      kind,
      method: "verified-mouse-coordinate",
      componentName: expectedComponent,
      selected: point,
      attempt: index + 1,
      click,
      detected
    };
  }

  if (detected.componentName === wrongComponent) {
    await closePanelByCommand(
      wrongComponent,
      settings
    );
    await sleep(
      Number(settings.wrongRankRetryDelayMs ?? 350)
    );
    continue;
  }

  await sleep(
    Number(settings.rankRetryDelayMs ?? 250)
  );
}

throw new Error(
  `${personal ? "개인" : "길드"} 랭킹 화면을 정확히 열지 못했습니다.`
);

}

function backPointAttempts() {return [// Java 원본 좌표{ x: 83, y: 24 },

  // 브라우저/Canvas 상단 여백 차이를 고려한 좌측 상단 후보
  { x: 55, y: 35 },
  { x: 40, y: 40 },
  { x: 70, y: 45 },
  { x: 95, y: 45 },
  { x: 35, y: 60 },
  { x: 60, y: 65 },
  { x: 85, y: 65 },
  { x: 110, y: 65 }
];

}

async function trySemanticPanelClose(componentName, options = {}) {if (!componentIsActive(componentName)) {return {ok: true,alreadyClosed: true,method: "already-closed"};}

try {
  const result = await closePanelSemantic(componentName, options);

  if (!componentIsActive(componentName)) {
    return {
      ok: true,
      method: result?.method || "semantic-close",
      result
    };
  }
} catch (error) {
  pushLog(`${componentName} 의미 기반 닫기 실패 - 좌표 재시도`, {
    error: error?.message || String(error)
  });
}

return {
  ok: false,
  method: "semantic-close-failed"
};

}

async function closeByJavaBackPoint(componentName, options = {}) {
// 기존 함수명은 호환을 위해 유지하지만 좌표 클릭은 사용하지 않는다.
const result = await closePanelByCommand(componentName,options);

await sleep(
  Number(
    getSettings(options).afterRankCloseDelayMs ?? 500
  )
);

return {
  ...result,
  compatibilityName: "closeByJavaBackPoint",
  coordinateUsed: false
};

}

async function exitTheaterByJavaBackPoint(options = {}) {
// WorldServerTheaterPanel 역시 close/back 명령만 사용한다.
const result = await closePanelByCommand("WorldServerTheaterPanel",options);

await sleep(
  Number(getSettings(options).clickDelayMs ?? 1200)
);

return {
  ...result,
  theaterExit: true,
  coordinateUsed: false
};

}

async function collectByClick(serverId, options = {}) {const settings = getSettings(options);

// 1. 서버 선택
const moveResult = await moveToServer(serverId, settings);

// 2. Canvas 정중앙의 서버 카드 진입
const theaterOpen = await openSelectedServerByCanvasCenter(
  serverId,
  settings
);

pushLog(`${serverId} 중앙 서버 카드 클릭 완료`, {
  theaterOpen
});

// 3. 개인 랭킹의 이전 캐시를 정리하고 새 데이터가 안정될 때까지 기다린다.
const personalBaseline = prepareRankCapture(
  "WorldServerPowerRank"
);

const personalOpen = await openRankPanelByJavaPoint(
  "personal",
  settings
);

const powerRank = await waitForRankList(
  "WorldServerPowerRank",
  settings,
  personalBaseline
);

const players = powerRank.rows.map((row, index) =>
  normalizePlayer(serverId, row, index)
);

if (
  players.length <
  Number(settings.requiredPlayerCount ?? 100)
) {
  throw new Error(
    `${serverId} 개인 랭킹 부족: ` +
    `${players.length}/${settings.requiredPlayerCount ?? 100}`
  );
}

pushLog(`${serverId} 개인 랭킹 수집 확정: ${players.length}명`, {
  moveElapsedMs: moveResult.elapsedMs,
  theaterOpen,
  personalOpen,
  rankElapsedMs: powerRank.elapsedMs,
  fingerprint: powerRank.fingerprint
});

// 4. 개인 랭킹 닫기
const personalClose = await closeByJavaBackPoint(
  "WorldServerPowerRank",
  settings
);

// 5. 길드 랭킹도 이전 캐시를 정리하고 2개가 수신될 때까지 기다린다.
const allianceBaseline = prepareRankCapture(
  "WorldServerAlliancePowerRank"
);

const allianceOpen = await openRankPanelByJavaPoint(
  "alliance",
  settings
);

const allianceRank = await waitForRankList(
  "WorldServerAlliancePowerRank",
  settings,
  allianceBaseline
);

const alliances = allianceRank.rows.map((row, index) =>
  normalizeAlliance(serverId, row, index)
);

if (
  alliances.length <
  Number(settings.requiredAllianceCount ?? 2)
) {
  throw new Error(
    `${serverId} 길드 랭킹 부족: ` +
    `${alliances.length}/${settings.requiredAllianceCount ?? 2}`
  );
}

pushLog(`${serverId} 길드 랭킹 수집 확정: ${alliances.length}개`, {
  allianceOpen,
  rankElapsedMs: allianceRank.elapsedMs,
  fingerprint: allianceRank.fingerprint
});

// 6. 길드 랭킹 닫기
const allianceClose = await closeByJavaBackPoint(
  "WorldServerAlliancePowerRank",
  settings
);

// 7. Java 원본처럼 한 번 더 뒤로가서 서버 목록으로 복귀
const theaterClose = await exitTheaterByJavaBackPoint(settings);

pushLog(`${serverId} 조사 화면 종료`, {
  personalClose,
  allianceClose,
  theaterClose
});

return buildServerInfo(serverId, players, alliances);

}

async function testJavaClickFlow(serverId, options = {}) {const settings = getSettings(options);const steps = [];

pushLog(`${serverId} Java 클릭 흐름 단독 테스트 시작`);

steps.push({
  name: "서버 선택",
  result: await moveToServer(serverId, settings)
});

steps.push({
  name: "Canvas 중앙 서버 카드",
  result: await openSelectedServerByCanvasCenter(serverId, settings)
});

steps.push({
  name: "개인 랭킹 열기",
  result: await openRankPanelByJavaPoint("personal", settings)
});

steps.push({
  name: "개인 랭킹 닫기",
  result: await closeByJavaBackPoint(
    "WorldServerPowerRank",
    settings
  )
});

steps.push({
  name: "길드 랭킹 열기",
  result: await openRankPanelByJavaPoint("alliance", settings)
});

steps.push({
  name: "길드 랭킹 닫기",
  result: await closeByJavaBackPoint(
    "WorldServerAlliancePowerRank",
    settings
  )
});

steps.push({
  name: "전투 지역 닫기",
  result: await exitTheaterByJavaBackPoint(settings)
});

console.table(
  steps.map((step, index) => ({
    index,
    name: step.name,
    ok: step.result?.ok !== false,
    method: step.result?.method || null,
    clientX: step.result?.click?.clientX ?? null,
    clientY: step.result?.click?.clientY ?? null
  }))
);

return {
  ok: true,
  serverId: Number(serverId),
  steps
};

}

// ---------------------------------------------------------------------------
// GitHub power JSON output format
// ---------------------------------------------------------------------------

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return null;
}

function numberValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const converted = Number(value);
    if (Number.isFinite(converted)) return converted;
  }
  return null;
}

function numericId(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : fallback;
}

function textOrNull(value) {
  return value === undefined || value === null ? null : String(value);
}

function sourceRow(row) {
  return row?.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
    ? row.raw
    : (row || {});
}

function sourceDetail(row) {
  const raw = sourceRow(row);
  return objectValue(raw.detail)
    || objectValue(raw.playerDetail)
    || objectValue(raw.userDetail)
    || objectValue(raw.roleDetail)
    || objectValue(raw.playerInfo)
    || {};
}

function sourcePlayer(row) {
  const raw = sourceRow(row);
  return objectValue(raw.player)
    || objectValue(raw.playerData)
    || objectValue(raw.role)
    || objectValue(raw.user)
    || {};
}

function booleanValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (value === true || value === false) return value;
    if (Number(value) === 1) return true;
    if (Number(value) === 0) return false;
    const text = String(value).toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return false;
}

function formatPowerPlayer(player, fallbackServerId) {
  const raw = sourceRow(player);
  const detail = sourceDetail(player);
  const nestedPlayer = sourcePlayer(player);

  const server = numberValue(
    player?.server,
    player?.serverNumber,
    player?.serverId,
    nestedPlayer.serverId,
    nestedPlayer.server,
    raw.server,
    raw.serverNumber,
    raw.serverId,
    fallbackServerId
  );

  // Java 매핑: player.val -> score, player.power -> cp
  const score = numberValue(
    nestedPlayer.val,
    nestedPlayer.score,
    raw.score,
    player?.score
  ) ?? 0;

  const cp = numberValue(
    nestedPlayer.power,
    nestedPlayer.cp,
    nestedPlayer.fightPower,
    raw.cp,
    raw.power,
    player?.cp,
    player?.power,
    score
  ) ?? 0;

  // Java 매핑: detail.avatarurl 우선, 없으면 detail.headimgurl
  const profile = pick(
    detail.avatarurl,
    detail.avatarUrl,
    detail.headimgurl,
    detail.headImgUrl,
    raw.profile,
    player?.profile
  );

  const online = booleanValue(
    nestedPlayer.isOnline,
    nestedPlayer.online,
    raw.isOnline,
    raw.online,
    player?.isOnline,
    player?.online
  );

  // Java 매핑: detail.username 우선, 없으면 detail.nickname
  const nickname = textOrNull(pick(
    detail.username,
    detail.userName,
    detail.user_name,
    detail.nickname,
    detail.nickName,
    detail.nick_name,
    raw.nickname,
    nestedPlayer.nickname,
    player?.nickname
  ));

  return {
    score,
    cp,
    uid: String(pick(
      nestedPlayer.uid,
      nestedPlayer.pid,
      nestedPlayer.userId,
      nestedPlayer.playerId,
      nestedPlayer.roleId,
      nestedPlayer.id,
      raw.uid,
      player?.uid,
      ""
    )),
    server: Number(server ?? fallbackServerId),
    level: numberValue(
      nestedPlayer.lv,
      nestedPlayer.level,
      raw.level,
      raw.lv,
      player?.level
    ),
    lang: textOrNull(pick(
      nestedPlayer.lang,
      nestedPlayer.language,
      raw.lang,
      raw.language,
      player?.lang
    )),
    lastLogin: numberValue(
      nestedPlayer.lastLoginTime,
      nestedPlayer.lastLogin,
      nestedPlayer.last_login,
      raw.lastLogin,
      player?.lastLogin
    ),
    lastRequest: numberValue(
      nestedPlayer.lastOnlineTime,
      nestedPlayer.lastRequest,
      nestedPlayer.last_request,
      raw.lastRequest,
      player?.lastRequest
    ),
    countryFlag: numberValue(
      detail.nationalflag,
      detail.nationalFlag,
      detail.countryFlag,
      raw.countryFlag,
      player?.countryFlag
    ),
    gender: numberValue(
      detail.gender,
      detail.usergender,
      detail.userGender,
      raw.gender,
      player?.gender
    ),
    profile: profile === undefined ? null : profile,
    nickname,
    allianceId: numericId(pick(
      nestedPlayer.allianceId,
      nestedPlayer.aid,
      nestedPlayer.guildId,
      raw.allianceId,
      player?.allianceId,
      0
    )),
    allianceTag: textOrNull(pick(
      player?.allianceTag,
      nestedPlayer.allianceTag,
      nestedPlayer.a_tag,
      nestedPlayer.tag,
      raw.allianceTag,
      raw.a_tag,
      raw.tag
    )),
    allianceName: textOrNull(pick(
      player?.allianceName,
      nestedPlayer.allianceName,
      nestedPlayer.guildName,
      raw.allianceName,
      raw.guildName
    )),
    online,
    isOnline: online
  };
}

function formatPowerAlliance(alliance, fallbackServerId) {
  const raw = sourceRow(alliance);
  const server = numberValue(
    alliance?.server,
    alliance?.serverNumber,
    alliance?.serverId,
    raw.server,
    raw.serverNumber,
    raw.serverId,
    fallbackServerId
  );
  const score = numberValue(
    raw.score,
    raw.cp,
    raw.power,
    raw.fightPower,
    alliance?.score,
    alliance?.cp,
    alliance?.power
  ) ?? 0;

  return {
    score,
    leader_name: textOrNull(firstDefined(
      raw.leader_name,
      raw.leaderName,
      raw.leader,
      raw.chiefName,
      alliance?.leader_name,
      alliance?.leaderName,
      ""
    )),
    name: textOrNull(firstDefined(
      raw.name,
      raw.allianceName,
      raw.guildName,
      alliance?.name,
      alliance?.allianceName,
      ""
    )),
    icon: numberValue(raw.icon, raw.iconId, raw.avatar, alliance?.icon),
    rank: numberValue(raw.rank, raw.ranking, alliance?.rank),
    tag: textOrNull(firstDefined(
      raw.tag,
      raw.allianceTag,
      raw.a_tag,
      alliance?.tag,
      alliance?.allianceTag,
      ""
    )),
    aid: numericId(firstDefined(
      raw.aid,
      raw.allianceId,
      raw.guildId,
      raw.id,
      alliance?.aid,
      alliance?.allianceId,
      0
    )),
    server: Number(server ?? fallbackServerId)
  };
}

function findServerQueueMetadata(serverId) {
  const target = Number(serverId);
  const queue = loadServerQueue();
  return queue?.servers?.find(row => serverNumberOf(row) === target) || null;
}

function formatPowerServer(serverData) {
  const serverNumber = Number(
    serverData?.serverNumber ?? serverData?.server ?? serverData?.serverId
  );
  const metadata = findServerQueueMetadata(serverNumber) || {};
  const players = (Array.isArray(serverData?.playerList) ? serverData.playerList : [])
    .map(player => formatPowerPlayer(player, serverNumber))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const alliances = (Array.isArray(serverData?.allianceList) ? serverData.allianceList : [])
    .map(alliance => formatPowerAlliance(alliance, serverNumber))
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));

  return {
    serverNumber,
    kingUid: String(firstDefined(
      serverData?.kingUid,
      metadata.kingUid,
      ""
    )),
    kingName: String(firstDefined(
      serverData?.kingName,
      metadata.kingName,
      ""
    )),
    allianceTag: String(firstDefined(
      serverData?.allianceTag,
      metadata.allianceTag,
      ""
    )),
    researchTime: null,
    playerList: players,
    allianceList: alliances
  };
}

function toEpochSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number >= 1000000000000 ? Math.floor(number / 1000) : Math.floor(number);
}

function latestPlayerActivitySeconds(player) {
  return Math.max(
    toEpochSeconds(player?.lastRequest),
    toEpochSeconds(player?.lastLogin)
  );
}

function active7dPlayerCpSum(serverData, nowSeconds = Math.floor(Date.now() / 1000)) {
  const players = Array.isArray(serverData?.playerList) ? serverData.playerList : [];
  const activeSince = nowSeconds - 7 * 24 * 60 * 60;

  return players.reduce((sum, player) => {
    const activityAt = latestPlayerActivitySeconds(player);
    const activeWithin7Days = player?.online === true || activityAt >= activeSince;

    if (!activeWithin7Days) return sum;

    const cp = Number(player?.score ?? player?.cp ?? 0);
    return sum + (Number.isFinite(cp) && cp > 0 ? cp : 0);
  }, 0);
}

function buildServerListOutputFiles(serverData, settings) {
  const date = todayString();
  const basePath = String(
    settings.serverListBasePath || "src/assets/json/servers"
  ).replace(/\/+$/, "");

  // 전체 서버 목록은 서버번호만 담은 정수 배열이다.
  const servers = [...new Set(
    serverData
      .map(row => Number(row?.serverNumber))
      .filter(Number.isFinite)
  )].sort((a, b) => a - b);

  // 인기 서버 목록도 서버번호 정수 배열만 저장한다.
  // 최근 7일 이내 활동한 상위 100명 플레이어의 CP 합계가 큰 서버부터 정렬한다.
  const popularServers = serverData
    .map(row => ({
      serverNumber: Number(row?.serverNumber),
      active7dCpSum: active7dPlayerCpSum(row)
    }))
    .filter(row => Number.isFinite(row.serverNumber))
    .sort((a, b) =>
      Number(b.active7dCpSum || 0) - Number(a.active7dCpSum || 0) ||
      a.serverNumber - b.serverNumber
    )
    .map(row => row.serverNumber);

  return [
    {
      path: `${basePath}/servers-${date}.json`,
      data: servers,
      type: "servers-dated"
    },
    {
      path: settings.serversLatestPath || `${basePath}/servers.json`,
      data: servers,
      type: "servers-latest"
    },
    {
      path: `${basePath}/servers-${date}-popular.json`,
      data: popularServers,
      type: "servers-popular-dated"
    },
    {
      path: settings.serversPopularLatestPath || `${basePath}/servers-popular.json`,
      data: popularServers,
      type: "servers-popular-latest"
    }
  ];
}

function usableNickname(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function playerNicknameValue(player) {
  return usableNickname(firstDefined(
    player?.nickname,
    player?.nickName,
    player?.nick_name,
    player?.userName,
    player?.username,
    player?.user_name,
    player?.playerName,
    player?.roleName,
    player?.displayName,
    player?.name,
    null
  ));
}

function restoreMissingPlayerNicknames(stagedServerRows, previousPlayerData) {
  const previousByUid = new Map();

  for (const player of movementPlayerList(previousPlayerData)) {
    const uid = movementUidOf(player);
    const nickname = playerNicknameValue(player);
    if (uid && nickname && !previousByUid.has(uid)) {
      previousByUid.set(uid, nickname);
    }
  }

  let restoredCount = 0;
  const restoredUids = [];

  const rows = (stagedServerRows || []).map(row => {
    const data = row?.data;
    if (!data || !Array.isArray(data.playerList)) return row;

    const playerList = data.playerList.map(player => {
      if (playerNicknameValue(player)) return player;

      const uid = movementUidOf(player);
      const previousNickname = uid ? previousByUid.get(uid) : null;
      if (!previousNickname) return player;

      restoredCount++;
      if (restoredUids.length < 20) restoredUids.push(uid);

      return {
        ...player,
        nickname: previousNickname,
        name: usableNickname(player?.name) || previousNickname
      };
    });

    return {
      ...row,
      data: {
        ...data,
        playerList
      }
    };
  });

  return {
    rows,
    restoredCount,
    previousNicknameCount: previousByUid.size,
    sampleUids: restoredUids
  };
}


function serverNumberFromData(serverData) {
  return numberValue(
    serverData?.serverNumber,
    serverData?.server,
    serverData?.serverId,
    serverData?.worldId
  );
}

function serverDataList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.serverList)) return data.serverList;
  if (Array.isArray(data?.servers)) return data.servers;
  return [];
}

// 일부 서버 조사에 실패하더라도 성공한 서버 데이터는 업로드할 수 있도록
// GitHub의 직전 serverData.json을 기준으로 이번 성공분만 덮어쓴다.
// 실패 서버는 직전 데이터가 그대로 유지되므로 부분 커밋으로 인한 데이터 유실을 막는다.
function mergeStagedServersWithPrevious(stagedServerRows, previousServerData) {
  const byServer = new Map();
  let previousCount = 0;
  let stagedCount = 0;

  for (const serverData of serverDataList(previousServerData)) {
    const serverNumber = serverNumberFromData(serverData);
    if (!Number.isFinite(serverNumber)) continue;

    previousCount++;
    byServer.set(Number(serverNumber), serverData);
  }

  for (const row of stagedServerRows || []) {
    const serverData = row?.data;
    const serverNumber = serverNumberFromData(serverData);
    if (!serverData || !Number.isFinite(serverNumber)) continue;

    stagedCount++;
    byServer.set(Number(serverNumber), serverData);
  }

  const rows = [...byServer.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([serverNumber, data]) => ({
      path: `__power_server__/${serverNumber}.json`,
      type: "server",
      serverId: String(serverNumber),
      data
    }));

  return {
    rows,
    previousCount,
    stagedCount,
    mergedCount: rows.length
  };
}

async function mergePendingServersWithPrevious(previousServerData) {
  const byServer = new Map();
  let previousCount = 0;
  let stagedCount = 0;

  for (const serverData of serverDataList(previousServerData)) {
    const serverNumber = serverNumberFromData(serverData);
    if (!Number.isFinite(serverNumber)) continue;
    previousCount++;
    byServer.set(Number(serverNumber), serverData);
  }

  // OOM 방지: pending server 전체를 getAll()로 복사하지 않고 cursor로 한 행씩 덮어쓴다.
  await withPendingStore("readonly", store => new Promise((resolve, reject) => {
    const index = store.index("type");
    const request = index.openCursor(IDBKeyRange.only("server"));

    request.onerror = () => reject(request.error || new Error("IndexedDB server cursor 실패"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const row = cursor.value || {};
      const serverData = row.data;
      const serverNumber = serverNumberFromData(serverData);

      if (serverData && Number.isFinite(serverNumber)) {
        stagedCount++;
        byServer.set(Number(serverNumber), serverData);
      }

      cursor.continue();
    };
  }));

  const rows = [...byServer.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([serverNumber, data]) => ({
      path: `__power_server__/${serverNumber}.json`,
      type: "server",
      serverId: String(serverNumber),
      data
    }));

  return {
    rows,
    previousCount,
    stagedCount,
    mergedCount: rows.length
  };
}

function buildPowerOutputFiles(stagedServerRows, settings) {
  const serverData = stagedServerRows
    .map(row => row?.data)
    .filter(row => row && Number.isFinite(Number(row.serverNumber)))
    .sort((a, b) => Number(a.serverNumber) - Number(b.serverNumber));

  const playerData = serverData.flatMap(row => row.playerList || []);
  const allianceData = serverData.flatMap(row => row.allianceList || []);

  const powerFiles = [
    {
      path: settings.allianceDataPath,
      data: allianceData,
      type: "allianceData"
    },
    {
      path: settings.playerDataPath,
      data: playerData,
      type: "playerData"
    },
    {
      path: settings.serverDataPath,
      data: serverData,
      type: "serverData"
    }
  ];

  return [
    ...powerFiles,
    ...buildServerListOutputFiles(serverData, settings)
  ];
}

// ---------------------------------------------------------------------------// Cross-server movement history// ---------------------------------------------------------------------------

function movementUidOf(player) {
  return str(pick(
    player?.uid,
    player?.pid,
    player?.playerId,
    player?.roleId,
    player?.id
  ));
}

function movementServerOf(player) {
  return numberValue(
    player?.server,
    player?.serverNumber,
    player?.serverId,
    player?.worldId
  );
}

function compactMovementPlayer(player) {
  return {
    uid: movementUidOf(player),
    nickname: str(pick(
      player?.nickname,
      player?.nickName,
      player?.nick_name,
      player?.userName,
      player?.username,
      player?.user_name,
      player?.playerName,
      player?.roleName,
      player?.displayName,
      player?.name
    )),
    server: movementServerOf(player),
    rank: numberValue(player?.rank),
    score: numberValue(player?.score, player?.cp, player?.power),
    level: numberValue(player?.level, player?.lv),
    allianceId: str(pick(player?.allianceId, player?.aid, player?.guildId)),
    allianceTag: str(pick(player?.allianceTag, player?.tag, player?.a_tag)),
    allianceName: str(pick(player?.allianceName, player?.guildName))
  };
}

function movementPlayerList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.playerList)) return data.playerList;
  if (Array.isArray(data?.players)) return data.players;
  return [];
}

function buildUniqueMovementIndex(data) {
  const rows = movementPlayerList(data);
  const byUid = new Map();
  const conflictingUids = new Set();
  let invalidRows = 0;

  for (const raw of rows) {
    const player = compactMovementPlayer(raw);
    const uid = player.uid;
    const server = player.server;

    if (!uid || !Number.isFinite(server)) {
      invalidRows++;
      continue;
    }

    const previous = byUid.get(uid);

    if (!previous) {
      byUid.set(uid, player);
      continue;
    }

    // 같은 조사 데이터 안에서 같은 UID가 서로 다른 서버에 동시에 존재하면
    // 랭킹 반영 지연일 수 있으므로 이동 판정에서 제외한다.
    if (Number(previous.server) !== Number(server)) {
      conflictingUids.add(uid);
      continue;
    }

    // 같은 서버의 중복 행은 더 높은 전투력 행을 대표값으로 사용한다.
    if (Number(player.score || 0) > Number(previous.score || 0)) {
      byUid.set(uid, player);
    }
  }

  for (const uid of conflictingUids) {
    byUid.delete(uid);
  }

  return {
    byUid,
    sourceCount: rows.length,
    validUidCount: byUid.size,
    conflictingUidCount: conflictingUids.size,
    invalidRows
  };
}

function movementRecordKey(row) {
  return [
    String(row?.uid || ""),
    String(row?.fromServer ?? ""),
    String(row?.toServer ?? "")
  ].join("|");
}

function buildCrossServerMovementRows(previousPlayerData, currentPlayerData) {
  const previousIndex = buildUniqueMovementIndex(previousPlayerData);
  const currentIndex = buildUniqueMovementIndex(currentPlayerData);
  const detectedAt = nowIso();
  const rows = [];

  for (const [uid, current] of currentIndex.byUid.entries()) {
    const previous = previousIndex.byUid.get(uid);
    if (!previous) continue;

    const fromServer = Number(previous.server);
    const toServer = Number(current.server);

    if (
      !Number.isFinite(fromServer) ||
      !Number.isFinite(toServer) ||
      fromServer === toServer
    ) {
      continue;
    }

    rows.push({
      detectedAt,
      uid,
      nickname: current.nickname || previous.nickname || null,
      fromServer,
      toServer,
      from: previous,
      to: current
    });
  }

  rows.sort((a, b) =>
    Number(a.fromServer) - Number(b.fromServer) ||
    Number(a.toServer) - Number(b.toServer) ||
    String(a.nickname || "").localeCompare(String(b.nickname || "")) ||
    String(a.uid).localeCompare(String(b.uid))
  );

  return {
    rows,
    previous: {
      sourceCount: previousIndex.sourceCount,
      validUidCount: previousIndex.validUidCount,
      conflictingUidCount: previousIndex.conflictingUidCount,
      invalidRows: previousIndex.invalidRows
    },
    current: {
      sourceCount: currentIndex.sourceCount,
      validUidCount: currentIndex.validUidCount,
      conflictingUidCount: currentIndex.conflictingUidCount,
      invalidRows: currentIndex.invalidRows
    }
  };
}

async function buildDailyMovementOutput(
  settings,
  previousPlayerData,
  currentPlayerData
) {
  if (settings.movementEnabled === false) {
    return {
      output: null,
      skipped: true,
      reason: "movementEnabled=false",
      detectedCount: 0,
      addedCount: 0
    };
  }

  throwIfStopped();

  // 이동현황 파일의 날짜는 TopWar 서버 시간(UTC+8)을 기준으로 한다.
  // 한국 시간 00:00~00:59에는 아직 서버 기준 전날이다.
  const date = serverDateString();
  const basePath = String(
    settings.movementBasePath || "src/assets/json/power/movement"
  ).replace(/\/+$/, "");
  const path = `${basePath}/${date}.json`;
  const comparison = buildCrossServerMovementRows(
    previousPlayerData,
    currentPlayerData
  );

  if (!comparison.rows.length) {
    return {
      output: null,
      skipped: true,
      reason: "no-server-change",
      path,
      detectedCount: 0,
      addedCount: 0,
      comparison
    };
  }

  const existingData = await readGithubJsonRaw(settings, path, null);
  const history = Array.isArray(existingData)
    ? { version: 1, date, rows: existingData }
    : (
      existingData &&
      typeof existingData === "object"
        ? { ...existingData }
        : { version: 1, date, rows: [] }
    );

  history.version = 1;
  history.date = history.date || date;
  history.serverTimezone = "UTC+8";
  history.serverResetAt = "00:00 UTC+8 (01:00 Asia/Seoul)";
  history.rows = Array.isArray(history.rows) ? history.rows : [];

  const keys = new Set(history.rows.map(movementRecordKey));
  let addedCount = 0;

  for (const row of comparison.rows) {
    const key = movementRecordKey(row);
    if (keys.has(key)) continue;

    history.rows.push(row);
    keys.add(key);
    addedCount++;
  }

  if (addedCount === 0) {
    return {
      output: null,
      skipped: true,
      reason: "already-recorded",
      path,
      detectedCount: comparison.rows.length,
      addedCount: 0,
      comparison
    };
  }

  history.updatedAt = nowIso();
  history.rows.sort((a, b) =>
    String(a?.detectedAt || "").localeCompare(String(b?.detectedAt || "")) ||
    Number(a?.fromServer || 0) - Number(b?.fromServer || 0) ||
    Number(a?.toServer || 0) - Number(b?.toServer || 0) ||
    String(a?.uid || "").localeCompare(String(b?.uid || ""))
  );

  return {
    output: {
      path,
      data: history,
      type: "movement-daily"
    },
    skipped: false,
    path,
    detectedCount: comparison.rows.length,
    addedCount,
    totalCount: history.rows.length,
    comparison
  };
}


// ---------------------------------------------------------------------------
// Nickname change history (separate from server movement history)
// ---------------------------------------------------------------------------

function nicknameChangeRecordKey(row) {
  return [
    String(row?.uid || ""),
    String(row?.fromNickname || ""),
    String(row?.toNickname || ""),
    String(row?.fromServer ?? ""),
    String(row?.toServer ?? "")
  ].join("|");
}

function buildNicknameChangeRows(previousPlayerData, currentPlayerData) {
  const previousIndex = buildUniqueMovementIndex(previousPlayerData);
  const currentIndex = buildUniqueMovementIndex(currentPlayerData);
  const detectedAt = nowIso();
  const rows = [];

  for (const [uid, current] of currentIndex.byUid.entries()) {
    const previous = previousIndex.byUid.get(uid);
    if (!previous) continue;

    // 빈 닉네임은 변경으로 판정하지 않는다.
    // commitPendingBatch()에서 현재 데이터의 누락 닉네임을 먼저 복원하므로
    // 수집 누락이 닉네임 변경으로 잘못 기록되는 것도 방지된다.
    const fromNickname = usableNickname(previous.nickname);
    const toNickname = usableNickname(current.nickname);

    if (!fromNickname || !toNickname || fromNickname === toNickname) {
      continue;
    }

    const fromServer = Number(previous.server);
    const toServer = Number(current.server);

    rows.push({
      detectedAt,
      uid,
      fromNickname,
      toNickname,
      server: Number.isFinite(toServer) ? toServer : null,
      fromServer: Number.isFinite(fromServer) ? fromServer : null,
      toServer: Number.isFinite(toServer) ? toServer : null,
      serverChanged:
        Number.isFinite(fromServer) &&
        Number.isFinite(toServer) &&
        fromServer !== toServer,
      from: previous,
      to: current
    });
  }

  rows.sort((a, b) =>
    Number(a.toServer ?? a.server ?? 0) - Number(b.toServer ?? b.server ?? 0) ||
    String(a.fromNickname || "").localeCompare(String(b.fromNickname || "")) ||
    String(a.toNickname || "").localeCompare(String(b.toNickname || "")) ||
    String(a.uid || "").localeCompare(String(b.uid || ""))
  );

  return {
    rows,
    previous: {
      sourceCount: previousIndex.sourceCount,
      validUidCount: previousIndex.validUidCount,
      conflictingUidCount: previousIndex.conflictingUidCount,
      invalidRows: previousIndex.invalidRows
    },
    current: {
      sourceCount: currentIndex.sourceCount,
      validUidCount: currentIndex.validUidCount,
      conflictingUidCount: currentIndex.conflictingUidCount,
      invalidRows: currentIndex.invalidRows
    }
  };
}

async function buildDailyNicknameHistoryOutput(
  settings,
  previousPlayerData,
  currentPlayerData
) {
  if (settings.nicknameHistoryEnabled === false) {
    return {
      output: null,
      skipped: true,
      reason: "nicknameHistoryEnabled=false",
      detectedCount: 0,
      addedCount: 0
    };
  }

  throwIfStopped();

  // 이동현황과 동일하게 TopWar 서버 날짜(UTC+8)를 기준으로 일자별 분리한다.
  const date = serverDateString();
  const basePath = String(
    settings.nicknameHistoryBasePath || "src/assets/json/power/nickname"
  ).replace(/\/+$/, "");
  const path = `${basePath}/${date}.json`;
  const comparison = buildNicknameChangeRows(
    previousPlayerData,
    currentPlayerData
  );

  if (!comparison.rows.length) {
    return {
      output: null,
      skipped: true,
      reason: "no-nickname-change",
      path,
      detectedCount: 0,
      addedCount: 0,
      comparison
    };
  }

  const existingData = await readGithubJsonRaw(settings, path, null);
  const history = Array.isArray(existingData)
    ? { version: 1, date, rows: existingData }
    : (
      existingData && typeof existingData === "object"
        ? { ...existingData }
        : { version: 1, date, rows: [] }
    );

  history.version = 1;
  history.date = history.date || date;
  history.serverTimezone = "UTC+8";
  history.serverResetAt = "00:00 UTC+8 (01:00 Asia/Seoul)";
  history.rows = Array.isArray(history.rows) ? history.rows : [];

  const keys = new Set(history.rows.map(nicknameChangeRecordKey));
  let addedCount = 0;

  for (const row of comparison.rows) {
    const key = nicknameChangeRecordKey(row);
    if (keys.has(key)) continue;

    history.rows.push(row);
    keys.add(key);
    addedCount++;
  }

  if (addedCount === 0) {
    return {
      output: null,
      skipped: true,
      reason: "already-recorded",
      path,
      detectedCount: comparison.rows.length,
      addedCount: 0,
      comparison
    };
  }

  history.updatedAt = nowIso();
  history.rows.sort((a, b) =>
    String(a?.detectedAt || "").localeCompare(String(b?.detectedAt || "")) ||
    Number(a?.toServer ?? a?.server ?? 0) - Number(b?.toServer ?? b?.server ?? 0) ||
    String(a?.uid || "").localeCompare(String(b?.uid || "")) ||
    String(a?.fromNickname || "").localeCompare(String(b?.fromNickname || "")) ||
    String(a?.toNickname || "").localeCompare(String(b?.toNickname || ""))
  );

  return {
    output: {
      path,
      data: history,
      type: "nickname-daily"
    },
    skipped: false,
    path,
    detectedCount: comparison.rows.length,
    addedCount,
    totalCount: history.rows.length,
    comparison
  };
}

async function stageServerData(serverData, options = {}) {
  assertRealPowerUploadAllowed("RealPower 임시 저장");
  throwIfStopped();

  const formatted = formatPowerServer(serverData);
  const serverId = String(formatted.serverNumber);
  const numericServerId = Number(serverId);
  if (!Number.isFinite(numericServerId) || numericServerId <= 0) {
    throw new Error("DataHub Top100 임시 저장 serverId가 없습니다.");
  }
  const internalPath = `__power_server__/${serverId}.json`;
  await putPendingFile(internalPath, {
    ...formatted,
    serverId: numericServerId
  }, {
    type: "server",
    serverId
  });
  saveState({
    lastRunAt: nowIso(),
    lastServerId: serverId,
    pendingCommit: true
  });
  pushLog(`${serverId} Top100 로컬 임시 저장 완료`);
  return {
    ok: true,
    staged: true,
    serverId,
    stagedAt: nowIso(),
    internalPath,
    files: [{ ok: true, staged: true, path: internalPath }]
  };

  /* Legacy GitHub staging retained below for rollback/reference only. */
  const settings = getSettings(options);
  assertGithubSettings(settings);
  const legacyInternalPath = `__power_server__/${serverId}.json`;

  await putPendingFile(internalPath, formatted, {
    type: "server",
    serverId
  });

  saveState({
    lastRunAt: nowIso(),
    lastServerId: serverId,
    pendingCommit: true
  });

  const serverListBasePath = String(
    settings.serverListBasePath || "src/assets/json/servers"
  ).replace(/\/+$/, "");
  const date = todayString();
  const targetPaths = [
    settings.allianceDataPath,
    settings.playerDataPath,
    settings.serverDataPath,
    `${serverListBasePath}/servers-${date}.json`,
    settings.serversLatestPath || `${serverListBasePath}/servers.json`,
    `${serverListBasePath}/servers-${date}-popular.json`,
    settings.serversPopularLatestPath || `${serverListBasePath}/servers-popular.json`
  ];

  pushLog(`${serverId} 통합 JSON용 임시 저장 완료`, targetPaths);

  return {
    ok: true,
    staged: true,
    serverId,
    stagedAt: nowIso(),
    files: targetPaths.map(path => ({ ok: true, staged: true, path })),
    internalPath,
    targetPaths
  };
}

// 이전 API 이름 호환. 이제 즉시 업로드하지 않고 IndexedDB에만 저장한다.
async function uploadServerData(serverData, options = {}) {return stageServerData(serverData, options);}

function createGitTreeChunks(rows, settings) {
  const maxEntries = Math.max(1, Number(settings.gitTreeChunkMaxEntries ?? 80));
  const maxChars = Math.max(100000, Number(settings.gitTreeChunkMaxBytes ?? 2500000));
  const chunks = [];
  let current = [];
  let currentChars = 0;

  for (const row of rows) {
    const content = JSON.stringify(row.data);
    const chars = content.length;
    const entry = {
      path: row.path,
      mode: "100644",
      type: "blob",
      content
    };

    if (
      current.length > 0 &&
      (current.length >= maxEntries || currentChars + chars > maxChars)
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(entry);
    currentChars += chars;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

async function commitPendingBatch(options = {}) {
  const settings = getSettings(options);
  const queue = loadServerQueue();
  if (queue?.servers?.length) {
    const incomplete = queue.servers.filter(server => !isServerComplete(server, settings));
    if (incomplete.length) {
      return {
        ok: true,
        skipped: true,
        reason: "top100 survey is not fully completed",
        completed: queue.servers.length - incomplete.length,
        total: queue.servers.length
      };
    }
  }

  const pendingRows = (await listPendingFiles())
    .filter(row => row?.type === "server")
    .sort((a, b) =>
      Number(a?.data?.serverNumber ?? a?.data?.serverId ?? a?.serverId ?? 0) -
      Number(b?.data?.serverNumber ?? b?.data?.serverId ?? b?.serverId ?? 0)
    );
  if (!pendingRows.length) {
    const flushOnly = await window.TOPWAR_DATAHUB.flushQueued(100);
    return { ok: true, skipped: true, mode: "datahub-top100-complete", fileCount: 0, serverCount: 0, ...flushOnly };
  }

  const dataHubSettings = window.TOPWAR_DATAHUB.readSettings();
  const sourceRunId = String(
    pendingRows.find(row => row?.runId)?.runId ||
    loadServerQueue()?.runId ||
    `run-${Date.now()}`
  );
  const safeRunId = sourceRunId.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 80);
  const safeScannerId = String(dataHubSettings?.scannerId || "top100")
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .slice(0, 30);
  const batchId = `top100-${safeRunId}-${safeScannerId}`.slice(0, 120);
  const batchTotal = pendingRows.length;
  const results = [];
  for (let index = 0; index < pendingRows.length; index++) {
    throwIfStopped();
    const row = pendingRows[index];
    const numericServerId = Number(row?.data?.serverId ?? row?.serverId ?? row?.data?.serverNumber);
    updateProgress({
      phase: "committing",
      currentServerId: numericServerId,
      commitChunkIndex: index + 1,
      commitChunkTotal: pendingRows.length,
      currentOutputPath: `/api/v1/top100/server (${numericServerId})`
    });
    const upload = await window.TOPWAR_DATAHUB.upload("top100", {
      ...row.data,
      serverId: numericServerId,
      batchId,
      batchIndex: index + 1,
      batchTotal,
      batchCompleted: index + 1 === batchTotal,
      uploadedAt: nowIso()
    }, { flushFirst: false });
    results.push({ serverId: numericServerId, ...upload });
  }

  const completion = await window.TOPWAR_DATAHUB.completeTop100({
    batchId,
    expectedServers: batchTotal
  }, { flushFirst: false });

  // 서버별 요청과 완료 요청이 전송되었거나 재시도 큐에 안전하게 들어간 뒤에만
  // 원본 pending 데이터를 제거한다. 중간 종료 시 같은 batchId와 전체 개수로 재시도된다.
  if (completion?.ok || completion?.queued) {
    await deletePendingFiles(pendingRows.map(row => row.path));
  }

  const flush = await window.TOPWAR_DATAHUB.flushQueued(Math.max(200, batchTotal + 20));
  return {
    ok: true,
    mode: "datahub-top100-complete",
    skipped: false,
    batchId,
    batchTotal,
    fileCount: results.length,
    serverCount: results.length,
    results,
    completion,
    queueFlush: flush
  };

  /* Legacy GitHub batch commit retained below for rollback/reference only. */
  {
  assertRealPowerUploadAllowed("RealPower GitHub 업로드");
  const settings = getSettings(options);
  assertGithubSettings(settings);
  throwIfStopped();

  const stagedServerCount = Number(await countPendingFilesByType("server")) || 0;

  if (!stagedServerCount) {
    return {
      ok: true,
      skipped: true,
      reason: "pending server cache empty",
      fileCount: 0,
      serverCount: 0
    };
  }

  // OOM 방지: 큰 playerData/serverData를 Promise.all로 동시에 받아 피크 메모리를 높이지 않는다.
  // 먼저 serverData를 읽고 IndexedDB server cursor를 한 행씩 병합한 뒤 참조를 해제한다.
  let previousServerData = await readGithubJsonRaw(
    settings,
    settings.serverDataPath,
    []
  );

  const mergedServers = await mergePendingServersWithPrevious(
    previousServerData
  );

  previousServerData = null;

  let previousPlayerData = await readGithubJsonRaw(
    settings,
    settings.playerDataPath,
    []
  );

  // 장기 미접속 유저처럼 이번 랭킹 응답에 닉네임이 생략된 경우,
  // 동일 UID의 기존 닉네임을 승계한 뒤 전체 출력 파일을 생성한다.
  const nicknameRestore = restoreMissingPlayerNicknames(
    mergedServers.rows,
    previousPlayerData
  );
  const baseOutputFiles = buildPowerOutputFiles(
    nicknameRestore.rows,
    settings
  );

  // 출력 배열이 생성된 뒤에는 중간 server-row wrapper 그래프를 유지할 필요가 없다.
  mergedServers.rows = null;
  nicknameRestore.rows = null;

  let currentPlayerData = baseOutputFiles.find(
    row => row.type === "playerData"
  )?.data || [];

  pushLog("기존 GitHub 데이터 병합 완료", {
    previousServerCount: mergedServers.previousCount,
    stagedServerCount: mergedServers.stagedCount,
    mergedServerCount: mergedServers.mergedCount
  });

  pushLog("누락 닉네임 복원 완료", {
    restoredCount: nicknameRestore.restoredCount,
    previousNicknameCount: nicknameRestore.previousNicknameCount,
    sampleUids: nicknameRestore.sampleUids
  });

  // 동일 UID의 서버번호가 바뀐 경우만 날짜별 이동현황으로 추가한다.
  const movementResult = await buildDailyMovementOutput(
    settings,
    previousPlayerData,
    currentPlayerData
  );
  const nicknameHistoryResult = await buildDailyNicknameHistoryOutput(
    settings,
    previousPlayerData,
    currentPlayerData
  );

  // 비교가 끝난 이전/현재 playerData의 별도 로컬 참조는 더 이상 필요하지 않다.
  // 실제 업로드 데이터는 baseOutputFiles가 보유한다.
  previousPlayerData = null;
  currentPlayerData = null;

  const outputFiles = [
    ...baseOutputFiles,
    ...(movementResult.output ? [movementResult.output] : []),
    ...(nicknameHistoryResult.output ? [nicknameHistoryResult.output] : [])
  ];

  pushLog("서버 이동현황 비교 완료", {
    path: movementResult.path || null,
    detectedCount: movementResult.detectedCount || 0,
    addedCount: movementResult.addedCount || 0,
    reason: movementResult.reason || null,
    previousUsers: movementResult.comparison?.previous?.validUidCount ?? 0,
    currentUsers: movementResult.comparison?.current?.validUidCount ?? 0,
    previousConflicts:
      movementResult.comparison?.previous?.conflictingUidCount ?? 0,
    currentConflicts:
      movementResult.comparison?.current?.conflictingUidCount ?? 0
  });

  pushLog("닉네임 변경이력 비교 완료", {
    path: nicknameHistoryResult.path || null,
    detectedCount: nicknameHistoryResult.detectedCount || 0,
    addedCount: nicknameHistoryResult.addedCount || 0,
    reason: nicknameHistoryResult.reason || null,
    previousUsers:
      nicknameHistoryResult.comparison?.previous?.validUidCount ?? 0,
    currentUsers:
      nicknameHistoryResult.comparison?.current?.validUidCount ?? 0,
    previousConflicts:
      nicknameHistoryResult.comparison?.previous?.conflictingUidCount ?? 0,
    currentConflicts:
      nicknameHistoryResult.comparison?.current?.conflictingUidCount ?? 0
  });

  updateProgress({ phase: "committing" });
  pushLog(
    `GitHub 통합 커밋 준비: 신규 ${stagedServerCount}개 / 통합 ${mergedServers.mergedCount}개 서버 → ${outputFiles.length}개 파일`,
    outputFiles.map(row => row.path)
  );

  const branchPath = String(settings.branch)
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const mirrorSettings = {
    ...settings,
    owner: "hiphop5782",
    repo: "topwar-database",
    branch: "main"
  };
  const mirrorBranchPath = encodeURIComponent(mirrorSettings.branch);
  const mirrorRef = await githubApiRequest(
    mirrorSettings,
    "GET",
    `git/ref/heads/${mirrorBranchPath}`
  );
  const mirrorHeadSha = mirrorRef?.object?.sha;
  if (!mirrorHeadSha) {
    throw new Error("topwar-database main 브랜치 HEAD가 없습니다. 저장소에 README 초기 커밋을 먼저 생성하세요.");
  }
  const mirrorHeadCommit = await githubApiRequest(
    mirrorSettings,
    "GET",
    `git/commits/${mirrorHeadSha}`
  );
  const mirrorBaseTreeSha = mirrorHeadCommit?.tree?.sha;
  if (!mirrorBaseTreeSha) throw new Error("topwar-database 기준 Tree SHA를 찾지 못했습니다.");

  const ref = await githubApiRequest(
    settings,
    "GET",
    `git/ref/heads/${branchPath}`
  );

  const headSha = ref?.object?.sha;
  if (!headSha) throw new Error("GitHub 브랜치 HEAD SHA를 찾지 못했습니다.");

  const headCommit = await githubApiRequest(
    settings,
    "GET",
    `git/commits/${headSha}`
  );

  const baseTreeSha = headCommit?.tree?.sha;
  if (!baseTreeSha) throw new Error("GitHub 기준 Tree SHA를 찾지 못했습니다.");

  // 대용량 JSON을 tree 요청에 직접 넣지 않고 각각 Blob으로 먼저 생성한다.
  // playerData/serverData가 수 MB를 넘어도 tree 요청 크기 제한에 걸리지 않는다.
  const treeEntries = [];
  const mirrorTreeEntries = [];
  const outputStats = [];

  for (let index = 0; index < outputFiles.length; index++) {
    throwIfStopped();
    const output = outputFiles[index];
    const rows = Array.isArray(output.data) ? output.data.length : null;
    const content = JSON.stringify(output.data);
    const charLength = content.length;

    updateProgress({
      phase: "committing",
      commitChunkIndex: index + 1,
      commitChunkTotal: outputFiles.length,
      currentOutputPath: output.path
    });

    pushLog(`GitHub Blob 생성: ${output.path}`, {
      chars: charLength,
      rows
    });

    // Git Data API는 utf-8 blob을 직접 지원한다.
    // TextEncoder -> Uint8Array -> binary chunks -> base64의 대형 중간 복사를 제거한다.
    const blob = await githubApiRequest(
      settings,
      "POST",
      "git/blobs",
      {
        content,
        encoding: "utf-8"
      }
    );

    if (!blob?.sha) {
      throw new Error(`GitHub Blob 생성 실패: ${output.path}`);
    }

    treeEntries.push({
      path: output.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha
    });

    // 같은 직렬화 결과를 다시 만들지 않고, 메모리 참조를 해제하기 전에
    // 비공개 user-data 저장소에도 동일 Blob을 생성한다.
    const mirrorBlob = await githubApiRequest(
      mirrorSettings,
      "POST",
      "git/blobs",
      {
        content,
        encoding: "utf-8"
      }
    );
    if (!mirrorBlob?.sha) {
      throw new Error(`topwar-database GitHub Blob 생성 실패: ${output.path}`);
    }
    mirrorTreeEntries.push({
      path: output.path,
      mode: "100644",
      type: "blob",
      sha: mirrorBlob.sha
    });

    outputStats.push({
      path: output.path,
      chars: charLength,
      rows,
      sha: blob.sha
    });

    // 업로드가 끝난 출력 데이터는 다음 Blob 처리 전에 참조를 끊는다.
    output.data = null;
  }

  const tree = await githubApiRequest(
    settings,
    "POST",
    "git/trees",
    {
      base_tree: baseTreeSha,
      tree: treeEntries
    }
  );

  if (!tree?.sha) throw new Error("GitHub 통합 Tree 생성 실패");

  const movementCount = Number(movementResult.addedCount || 0);
  const nicknameChangeCount = Number(nicknameHistoryResult.addedCount || 0);
  const message =
    `Update power data ${todayString()} (${mergedServers.mergedCount} servers, ${stagedServerCount} refreshed` +
    `${movementCount > 0 ? `, ${movementCount} movements` : ""}` +
    `${nicknameChangeCount > 0 ? `, ${nicknameChangeCount} nickname changes` : ""})`;

  const commit = await githubApiRequest(
    settings,
    "POST",
    "git/commits",
    {
      message,
      tree: tree.sha,
      parents: [headSha]
    }
  );

  if (!commit?.sha) throw new Error("GitHub 커밋 생성 결과에 SHA가 없습니다.");

  await githubApiRequest(
    settings,
    "PATCH",
    `git/refs/heads/${branchPath}`,
    {
      sha: commit.sha,
      force: false
    }
  );

  const mirrorTree = await githubApiRequest(
    mirrorSettings,
    "POST",
    "git/trees",
    {
      base_tree: mirrorBaseTreeSha,
      tree: mirrorTreeEntries
    }
  );
  if (!mirrorTree?.sha) throw new Error("topwar-database 통합 Tree 생성 실패");

  const mirrorCommit = await githubApiRequest(
    mirrorSettings,
    "POST",
    "git/commits",
    {
      message: `[mirror] ${message}`,
      tree: mirrorTree.sha,
      parents: [mirrorHeadSha]
    }
  );
  if (!mirrorCommit?.sha) throw new Error("topwar-database 커밋 생성 실패");

  await githubApiRequest(
    mirrorSettings,
    "PATCH",
    `git/refs/heads/${mirrorBranchPath}`,
    {
      sha: mirrorCommit.sha,
      force: false
    }
  );
  pushLog("topwar-database 이중 업로드 완료", {
    commitSha: mirrorCommit.sha,
    files: mirrorTreeEntries.length
  });

  await deletePendingFiles();
  saveState({
    pendingCommit: false,
    lastCommitAt: nowIso(),
    lastCommitSha: commit.sha,
    lastCommitErrorAt: null,
    lastCommitError: null,
    lastCommitFileCount: outputFiles.length,
    lastCommitServerCount: mergedServers.mergedCount,
    lastCommitRefreshedServerCount: stagedServerCount,
    lastMovementPath: movementResult.path || null,
    lastMovementDetectedCount: movementResult.detectedCount || 0,
    lastMovementAddedCount: movementResult.addedCount || 0,
    lastNicknameHistoryPath: nicknameHistoryResult.path || null,
    lastNicknameHistoryDetectedCount: nicknameHistoryResult.detectedCount || 0,
    lastNicknameHistoryAddedCount: nicknameHistoryResult.addedCount || 0
  });

  pushLog(`GitHub 통합 커밋 완료: ${outputFiles.length}개 파일`, {
    sha: commit.sha,
    servers: mergedServers.mergedCount,
    refreshedServers: stagedServerCount,
    files: outputStats
  });

  return {
    ok: true,
    commitSha: commit.sha,
    fileCount: outputFiles.length,
    serverCount: mergedServers.mergedCount,
    refreshedServerCount: stagedServerCount,
    movement: {
      path: movementResult.path || null,
      detectedCount: movementResult.detectedCount || 0,
      addedCount: movementResult.addedCount || 0,
      totalCount: movementResult.totalCount || 0,
      reason: movementResult.reason || null
    },
    nicknameHistory: {
      path: nicknameHistoryResult.path || null,
      detectedCount: nicknameHistoryResult.detectedCount || 0,
      addedCount: nicknameHistoryResult.addedCount || 0,
      totalCount: nicknameHistoryResult.totalCount || 0,
      reason: nicknameHistoryResult.reason || null
    },
    files: outputStats,
    message
  };
  }
}

async function uploadOpenRanks(serverId, options = {}) {const data = await collectOpenRanks(serverId);const result = await uploadServerData(data, options);return { data, result };}

async function surveyServer(serverId, options = {}) {const ownsController = !loopRuntime.abortController;

if (ownsController) {
  loopRuntime.stopRequested = false;
  loopRuntime.abortController = new AbortController();
  loopRuntime.mode = "single";
  updateProgress({
    currentIndex: 1,
    total: 1,
    currentServerId: Number(serverId),
    phase: "surveying"
  });
}

try {
  throwIfStopped();
  const data = await collectByClick(serverId, options);
  throwIfStopped();
  const result = await uploadServerData(data, options);
  throwIfStopped();
  return { data, result };
} finally {
  if (ownsController) {
    loopRuntime.abortController = null;
    loopRuntime.stopRequested = false;
    loopRuntime.mode = "idle";
    updateProgress({ phase: "idle" });
  }
}

}

async function surveyServers(serverIds, options = {}) {const settings = getSettings(options);const ids = Array.isArray(serverIds)? serverIds: String(serverIds || "").split(/[,\s]+/).map(Number).filter(Number.isFinite);

saveState({ running: true });
const results = [];

try {
  for (const serverId of ids) {
    try {
      pushLog(`${serverId} 조사 시작`);
      const row = await surveyServer(serverId, settings);
      results.push({ serverId, ok: true, ...row.result });
    } catch (error) {
      console.error(`[REALPOWER] ${serverId} 조사 실패:`, error);
      results.push({ serverId, ok: false, error: error?.message || String(error) });
      pushLog(`${serverId} 조사 실패`, error?.message || String(error));
    }

    await sleep(settings.betweenServerDelayMs);
  }
} finally {
  saveState({ running: false });
}

return results;

}

// ---------------------------------------------------------------------------// Java Test34 무한반복 프로그램 대응 루프// ---------------------------------------------------------------------------

function serverNumberOf(server) {return Number(pick(server?.serverNumber, server?.server, server?.serverId));}

function createRunId() {try {return crypto.randomUUID();} catch {return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;}}

async function resetSurveyProgress(options = {}) {const preserveSchema = options.preserveSchema !== false;

if (loopRuntime.abortController || loopRuntime.runningPromise) {
  stopInfiniteLoop();
  await new Promise(resolve => setTimeout(resolve, 50));
}

localStorage.removeItem(QUEUE_KEY);
localStorage.removeItem(STATE_KEY);
await deletePendingFiles();

if (preserveSchema) {
  localStorage.setItem(
    STORAGE_SCHEMA_KEY,
    String(STORAGE_SCHEMA_VERSION)
  );
} else {
  localStorage.removeItem(STORAGE_SCHEMA_KEY);
}

loopRuntime.stopRequested = false;
loopRuntime.mode = "idle";
loopRuntime.progress = {
  currentIndex: 0,
  total: 0,
  currentServerId: null,
  phase: "idle"
};

renderPanelSafe();
pushLog("조사 진행상태와 임시 데이터 초기화 완료");

return {
  ok: true,
  githubSettingsPreserved: true,
  queueCleared: true,
  stateCleared: true,
  pendingCleared: true
};

}

async function repairInvalidCompletedQueue() {const queue = loadServerQueue();const settings = getSettings();

if (!queue?.servers?.length) {
  return {
    ok: true,
    repaired: false,
    reason: "queue empty"
  };
}

const invalidCompleted = queue.servers.filter(server =>
  server?.completed === true &&
  (
    !server?.lastSuccessAt ||
    Number(server?.playerCount || 0) < Number(settings.requiredPlayerCount ?? 100) ||
    Number(server?.allianceCount || 0) < Number(settings.requiredAllianceCount ?? 2)
  )
);

if (!invalidCompleted.length) {
  return {
    ok: true,
    repaired: false,
    invalidCount: 0
  };
}

localStorage.removeItem(QUEUE_KEY);
localStorage.removeItem(STATE_KEY);
await deletePendingFiles();

pushLog("잘못된 완료 큐 자동 정리", {
  invalidCount: invalidCompleted.length
});

return {
  ok: true,
  repaired: true,
  invalidCount: invalidCompleted.length
};

}

async function migrateLegacyPracticeData() {const currentSchema = Number(localStorage.getItem(STORAGE_SCHEMA_KEY) || 0);

if (currentSchema >= STORAGE_SCHEMA_VERSION) {
  return {
    ok: true,
    migrated: false,
    schemaVersion: currentSchema
  };
}

const queue = readLocal(QUEUE_KEY, null);
const pendingStats = await inspectPendingFilesLightweight();

const legacyQueue =
  !!queue &&
  (
    Number(queue.version || 0) < 3 ||
    (queue.servers || []).some(server =>
      server?.completed === true &&
      (
        !server?.lastSuccessAt ||
        Number(server?.playerCount || 0) < 100 ||
        Number(server?.allianceCount || 0) < 10
      )
    )
  );

const legacyPending = pendingStats.legacyWithoutRunId > 0;
const legacyState = !!readLocal(STATE_KEY, null);

if (legacyQueue || legacyPending || legacyState) {
  localStorage.removeItem(QUEUE_KEY);
  localStorage.removeItem(STATE_KEY);
  await deletePendingFiles();

  pushLog("V2.8 이전 연습/임시 데이터 자동 정리", {
    legacyQueue,
    legacyPending,
    legacyState,
    pendingCount: pendingStats.count
  });
}

localStorage.setItem(
  STORAGE_SCHEMA_KEY,
  String(STORAGE_SCHEMA_VERSION)
);

return {
  ok: true,
  migrated: legacyQueue || legacyPending || legacyState,
  schemaVersion: STORAGE_SCHEMA_VERSION,
  removedPendingCount: legacyPending ? pendingStats.count : 0
};

}

function normalizeServerQueueItem(server) {const serverNumber = serverNumberOf(server);const playerCount = Number(server?.playerCount ??(Array.isArray(server?.playerList) ? server.playerList.length : 0));const allianceCount = Number(server?.allianceCount ??(Array.isArray(server?.allianceList) ? server.allianceList.length : 0));

// 완료 여부는 단순히 데이터가 조금 존재하는지만으로 판단하지 않는다.
// 실제 조사 성공 시각이 있고, 개인 100명/길드 10개 기준을 모두 충족해야 한다.
const completed =
  !!server?.lastSuccessAt &&
  playerCount >= 100 &&
  allianceCount >= 10;

return {
  ...server,
  serverNumber,
  server: serverNumber,
  serverId: String(serverNumber),
  playerCount,
  allianceCount,
  completed,
  playerList: [],
  allianceList: []
};

}

function compactServerQueueItem(server) {const normalized = normalizeServerQueueItem(server);const {playerList,allianceList,lastUpload,...rest} = normalized;

return {
  ...rest,
  playerCount: Number(normalized.playerCount || 0),
  allianceCount: Number(normalized.allianceCount || 0),
  completed:
    !!normalized.lastSuccessAt &&
    Number(normalized.playerCount || 0) >= 100 &&
    Number(normalized.allianceCount || 0) >= 10
};

}

function isServerComplete(server, options = {}) {const settings = getSettings(options);const players = Number(server?.playerCount ??(Array.isArray(server?.playerList) ? server.playerList.length : 0));const alliances = Number(server?.allianceCount ??(Array.isArray(server?.allianceList) ? server.allianceList.length : 0));

// 실제 조사 성공 기록이 없는 서버는 완료로 취급하지 않는다.
return (
  !!server?.lastSuccessAt &&
  players >= Number(settings.requiredPlayerCount ?? 100) &&
  alliances >= Number(settings.requiredAllianceCount ?? 2)
);

}

function loadServerQueue() {const queue = readLocal(QUEUE_KEY, null);if (!queue || typeof queue !== "object") return null;queue.servers = Array.isArray(queue.servers)? queue.servers.map(normalizeServerQueueItem).filter(row => Number.isFinite(row.serverNumber)): [];return queue;}

function saveServerQueue(servers, patch = {}) {const previous = loadServerQueue();

const compactServers = (servers || [])
  .map(compactServerQueueItem)
  .filter(row => Number.isFinite(row.serverNumber));

const queue = {
  // allServers/source/total/currentIndex 등 기존 메타데이터를 보존한다.
  ...(previous || {}),
  version: 4,
  runId: patch.runId || previous?.runId || createRunId(),
  createdAt: patch.createdAt || previous?.createdAt || nowIso(),
  updatedAt: nowIso(),
  servers: compactServers,
  total: Number(
    patch.total ??
    previous?.total ??
    compactServers.length
  ),
  ...patch
};

// patch에 servers가 실수로 포함돼도 항상 정규화된 배열을 사용한다.
queue.servers = compactServers;

writeLocal(QUEUE_KEY, queue);
renderPanelSafe();
return queue;

}

function clearServerQueue() {localStorage.removeItem(QUEUE_KEY);renderPanelSafe();return true;}

function createQueueFromServerIds(serverIds) {const ids = Array.isArray(serverIds)? serverIds: String(serverIds || "").split(/[,\s]+/).map(Number).filter(Number.isFinite);

return ids.map(serverNumber => ({
  serverNumber,
  server: serverNumber,
  serverId: String(serverNumber),
  playerList: [],
  allianceList: []
}));

}

function isReusableAllServerQueue(queue) {if (!queue?.servers?.length) return false;

// V4.1 이후 정상 큐
if (queue.allServers === true) return true;

// 이전 버전에서 allServers 메타데이터가 유실된 큐 복구.
// 전체 서버 큐는 통상 여러 서버를 포함하므로 10개 이상이면 전체 큐로 간주한다.
return queue.servers.length >= 10;

}

function loadLastTempDataLikeJava(options = {}) {const queue = loadServerQueue();

if (options.allServers === true) {
  const requestedOrderMode = getRealPowerServerOrderMode(options);

  if (
    isReusableAllServerQueue(queue) &&
    options.forceRefreshAllServers !== true
  ) {
    let reusableServers = queue.servers;

    // 새로 읽은 popular 목록이 전달되면 기존 큐의 모드 문자열이 같더라도
    // 실제 순서를 다시 맞춘다. 완료/실패 정보는 서버번호별로 그대로 보존한다.
    const requestedIds = Array.isArray(options.serverIds)
      ? options.serverIds.map(Number).filter(Number.isFinite)
      : [];
    if (requestedIds.length) {
      const previousById = new Map(
        queue.servers.map(server => [Number(server?.serverNumber), server])
      );
      reusableServers = requestedIds.map(serverNumber =>
        previousById.get(serverNumber) || createQueueFromServerIds([serverNumber])[0]
      );
      saveServerQueue(reusableServers, {
        allServers: true,
        serverOrderMode: requestedOrderMode,
        source: `remote-or-explicit-server-ids:${requestedOrderMode}`,
        total: reusableServers.length,
        status: queue.status || "partial",
        popularOrderRefreshedAt: nowIso()
      });
      pushLog("최신 인기순 목록으로 기존 조사 큐 재정렬", {
        count: reusableServers.length,
        firstServers: reusableServers.slice(0, 20).map(server => server.serverNumber)
      });
      return reusableServers;
    }

    // 라디오 선택 기준이 기존 큐와 달라졌으면 완료/실패 정보는 유지한 채 순서만 다시 배치한다.
    if (queue.serverOrderMode !== requestedOrderMode) {
      reusableServers = orderRealPowerServers(queue.servers, {
        ...options,
        serverOrderMode: requestedOrderMode
      });

      saveServerQueue(reusableServers, {
        allServers: true,
        serverOrderMode: requestedOrderMode,
        source: `WorldServerListPanel.m_data:${requestedOrderMode}`,
        total: reusableServers.length,
        status: queue.status || "partial"
      });

      pushLog("전체 서버 임시 큐 순서 변경", {
        from: queue.serverOrderMode || "unknown",
        to: requestedOrderMode,
        firstServers: reusableServers.slice(0, 20).map(server => server.serverNumber)
      });
    } else if (queue.allServers !== true) {
      // 이전 버전에서 allServers가 유실됐다면 즉시 복구해서 저장한다.
      saveServerQueue(reusableServers, {
        allServers: true,
        serverOrderMode: requestedOrderMode,
        source: queue.source || `recovered-all-server-queue:${requestedOrderMode}`,
        total: reusableServers.length,
        status: queue.status || "partial"
      });
    }

    pushLog(
      `전체 서버 임시 큐 재개: ${reusableServers.length}개 서버`,
      { serverOrderMode: requestedOrderMode }
    );
    return reusableServers;
  }

  if (queue?.servers?.length) {
    pushLog(
      `단일/테스트 큐 ${queue.servers.length}개를 전체 서버 조사에 사용하지 않음`
    );
  }

  const requestedIds = Array.isArray(options.serverIds)
    ? options.serverIds.map(Number).filter(Number.isFinite)
    : [];
  const servers = orderRealPowerServers(requestedIds.length ? createQueueFromServerIds(requestedIds) : getAllServers2(), {
    ...options,
    serverOrderMode: requestedOrderMode
  });

  saveServerQueue(servers, {
    status: "ready",
    source: requestedIds.length ? `remote-or-explicit-server-ids:${requestedOrderMode}` : `WorldServerListPanel.m_data:${requestedOrderMode}`,
    allServers: true,
    serverOrderMode: requestedOrderMode,
    total: servers.length,
    currentIndex: 0,
    currentServerId: null,
    lastError: null
  });

  pushLog(`전체 서버 큐 새로 생성: ${servers.length}개 서버`, {
    serverOrderMode: requestedOrderMode
  });
  return servers;
}

if (
  queue?.servers?.length &&
  options.forceRefreshAllServers !== true
) {
  pushLog(`이전 임시 큐 로드: ${queue.servers.length}개 서버`);
  return queue.servers;
}

if (options.serverIds) {
  const servers = createQueueFromServerIds(options.serverIds);

  saveServerQueue(servers, {
    status: "ready",
    source: "manual-server-ids",
    allServers: false,
    total: servers.length,
    currentIndex: 0,
    currentServerId: null
  });

  pushLog(`입력 서버 큐 생성: ${servers.length}개 서버`);
  return servers;
}

const servers = getAllServers2();

saveServerQueue(servers, {
  status: "ready",
  source: "WorldServerListPanel.m_data",
  allServers: true,
  total: servers.length,
  currentIndex: 0,
  currentServerId: null
});

pushLog(`전체 서버 목록으로 큐 생성: ${servers.length}개 서버`);
return servers;

}

async function runOneCycle(options = {}) {const settings = getSettings(options);const startedAt = Date.now();

let servers = loadLastTempDataLikeJava(settings);
saveServerQueue(servers, {
  status: "running",
  startedAt: nowIso(),
  lastError: null,
  allServers: settings.allServers === true,
  source: settings.allServers === true
    ? "WorldServerListPanel.m_data"
    : "manual-server-ids",
  total: servers.length
});

const results = [];
pushLog(`서버 개수: ${servers.length}`);

try {
  const completedBeforeLoop = servers.filter(server =>
    isServerComplete(server, settings)
  ).length;

  if (
    servers.length > 0 &&
    completedBeforeLoop >= servers.length &&
    settings.commitAfterFullCycle !== false
  ) {
    updateProgress({
      currentIndex: servers.length,
      total: servers.length,
      phase: "committing"
    });

    const commitResult = await commitPendingBatch(settings);
    clearServerQueue();

    return {
      ok: true,
      elapsedSec: Math.round((Date.now() - startedAt) / 1000),
      completed: servers.length,
      total: servers.length,
      results,
      commitResult
    };
  }

  for (let i = 0; i < servers.length; i++) {
    if (loopRuntime.stopRequested) {
      pushLog("중지 요청 감지 - 현재 사이클 중단");
      break;
    }

    const server = normalizeServerQueueItem(servers[i]);
    const serverNumber = server.serverNumber;

    if (!Number.isFinite(serverNumber)) continue;

    updateProgress({
      currentIndex: i + 1,
      total: servers.length,
      currentServerId: serverNumber,
      phase: "surveying"
    });

    if (isServerComplete(server, settings)) {
      pushLog(`${serverNumber} 건너뜀: 이미 완료 (${server.playerCount}/${server.allianceCount})`);
      results.push({ serverId: serverNumber, ok: true, skipped: true, reason: "already complete" });
      continue;
    }

    try {
      pushLog(`${serverNumber} 서버 조사 시작`);
      const { data, result } = await surveyServer(serverNumber, settings);

      servers[i] = {
        ...server,
        serverNumber,
        server: serverNumber,
        serverId: String(serverNumber),
        playerCount: Array.isArray(data.playerList) ? data.playerList.length : 0,
        allianceCount: Array.isArray(data.allianceList) ? data.allianceList.length : 0,
        completed: true,
        lastSuccessAt: nowIso(),
        lastStagedAt: result?.stagedAt || nowIso(),
        lastError: null
      };

      saveServerQueue(servers, {
        status: "running",
        allServers: settings.allServers === true,
        total: servers.length,
        currentIndex: i + 1,
        currentServerId: serverNumber,
        nextIndex: i + 1
      });

      results.push({ serverId: serverNumber, ok: true, result });
      pushLog(`${serverNumber} 서버 조사 완료`);
    } catch (error) {
      if (isStopError(error)) {
        pushLog(`${serverNumber} 서버 조사 즉시 중지`);
        break;
      }

      servers[i] = {
        ...server,
        lastErrorAt: nowIso(),
        lastError: error?.message || String(error)
      };

      saveServerQueue(servers, {
        status: "failed",
        allServers: settings.allServers === true,
        total: servers.length,
        currentIndex: i + 1,
        currentServerId: serverNumber,
        nextIndex: i + 1,
        lastError: error?.message || String(error)
      });

      results.push({
        serverId: serverNumber,
        ok: false,
        error: error?.message || String(error)
      });

      pushLog(`${serverNumber} 서버 조사 오류 - 임시 큐 저장`, error?.message || String(error));

      if (settings.continueOnError !== true) {
        throw error;
      }
    }

    const nextServer = servers[i + 1];
    if (nextServer && !loopRuntime.stopRequested) {
      pushLog(
        `${serverNumber} 처리 종료 → 다음 서버 ${serverNumberOf(nextServer)} 이동 예정`,
        {
          currentIndex: i + 1,
          total: servers.length
        }
      );
    }

    await sleep(settings.betweenServerDelayMs);
  }

  const completed = servers.filter(server => isServerComplete(server, settings)).length;
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  let commitResult = null;
  // 개수 확인을 위해 IndexedDB 전체 데이터를 메모리로 가져오지 않는다.
  const stagedServerCount = Number(await countPendingFilesByType("server")) || 0;
  const fullyCompleted = servers.length > 0 && completed >= servers.length;

  // 마지막 서버까지 순회했다면 일부 서버가 실패했어도 성공분은 커밋한다.
  // commitPendingBatch()가 기존 serverData.json과 병합하므로 실패 서버 데이터는 보존된다.
  if (
    servers.length > 0 &&
    !loopRuntime.stopRequested &&
    stagedServerCount > 0 &&
    settings.commitAfterFullCycle !== false
  ) {
    saveServerQueue(servers, {
      status: fullyCompleted ? "commit-pending" : "partial-commit-pending",
      completed,
      total: servers.length,
      stagedServerCount,
      elapsedSec
    });

    try {
      commitResult = await commitPendingBatch(settings);

      if (fullyCompleted) {
        clearServerQueue();
        pushLog(
          `[알림] 모든 조회 및 일괄 커밋 완료 (${elapsedSec}s)`
        );
      } else {
        // 성공한 서버의 임시 데이터는 커밋 과정에서 삭제된다.
        // 큐는 유지하여 다음 사이클에서 실패한 서버만 다시 시도한다.
        saveServerQueue(servers, {
          status: "partial-committed",
          completed,
          total: servers.length,
          stagedServerCount,
          elapsedSec,
          lastCommitAt: nowIso(),
          lastCommitSha: commitResult?.commitSha || null,
          lastError: null
        });

        pushLog(
          `[알림] 부분 조사 결과 GitHub 업로드 완료: ` +
          `${completed}/${servers.length}, 신규 ${stagedServerCount}개 서버 (${elapsedSec}s)`
        );
      }
    } catch (error) {
      saveServerQueue(servers, {
        status: "commit-failed",
        completed,
        total: servers.length,
        stagedServerCount,
        elapsedSec,
        lastError: error?.message || String(error)
      });

      saveState({
        pendingCommit: true,
        lastCommitErrorAt: nowIso(),
        lastCommitError: error?.message || String(error)
      });

      pushLog(
        "일괄 커밋 실패 - IndexedDB와 진행상태 유지",
        {
          message: error?.message || String(error),
          status: error?.status ?? null,
          response: error?.response ?? null
        }
      );
      throw error;
    }
  } else if (loopRuntime.stopRequested) {
    saveServerQueue(servers, {
      status: "stopped",
      completed,
      total: servers.length,
      stagedServerCount,
      elapsedSec
    });
  } else if (stagedServerCount === 0) {
    saveServerQueue(servers, {
      status: fullyCompleted ? "complete-no-pending" : "partial-no-pending",
      completed,
      total: servers.length,
      stagedServerCount,
      elapsedSec
    });
    pushLog(
      `GitHub 업로드할 신규 임시 데이터가 없음: ${completed}/${servers.length}`
    );
  } else {
    saveServerQueue(servers, {
      status: fullyCompleted ? "commit-disabled" : "partial",
      completed,
      total: servers.length,
      stagedServerCount,
      elapsedSec
    });
    pushLog(
      `자동 커밋 비활성화: ${completed}/${servers.length}, 임시 서버 ${stagedServerCount}개`
    );
  }

  return {
    ok: true,
    elapsedSec,
    completed,
    total: servers.length,
    results,
    commitResult
  };
} catch (error) {
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  if (isStopError(error)) {
    pushLog(`사이클 즉시 중지 (${elapsedSec}s)`);
    return {
      ok: true,
      stopped: true,
      elapsedSec,
      results
    };
  }

  pushLog(`사이클 오류 (${elapsedSec}s)`, error?.message || String(error));
  return {
    ok: false,
    elapsedSec,
    error: error?.message || String(error),
    results
  };
}

}

async function startInfiniteLoop(options = {}) {await repairInvalidCompletedQueue();await migrateLegacyPracticeData();

if (loopRuntime.runningPromise) {
  pushLog("이미 무한반복 실행 중");
  return loopRuntime.runningPromise;
}

if (loopRuntime.abortController) {
  throw new Error("다른 조사가 실행 중입니다. 먼저 중지하세요.");
}

const settings = getSettings({
  allServers: true,
  ...options
});

loopRuntime.stopRequested = false;
loopRuntime.abortController = new AbortController();
loopRuntime.mode = "infinite";

const controller = loopRuntime.abortController;

const promise = (async () => {
  saveState({ running: true, mode: "infinite-all-servers" });
  updateProgress({
    currentIndex: 0,
    total: loadServerQueue()?.servers?.length || 0,
    currentServerId: null,
    phase: "starting"
  });
  pushLog("전체 서버 무한반복 시작");

  let cycleNumber = 0;

  try {
    while (!loopRuntime.stopRequested && !controller.signal.aborted) {
      throwIfStopped();
      cycleNumber++;

      const queue = loadServerQueue();

      if (!isReusableAllServerQueue(queue)) {
        if (queue?.servers?.length) {
          pushLog(
            `전체 서버 모드에서 ${queue.servers.length}개짜리 단일/테스트 큐 감지 - 전체 목록으로 교체`
          );
        }

        initializeAllServerQueue(settings);
      } else if (queue.allServers !== true) {
        saveServerQueue(queue.servers, {
          allServers: true,
          source: queue.source || "recovered-all-server-queue",
          total: queue.servers.length
        });
      }

      const cycleResult = await runOneCycle({
        ...settings,
        allServers: true
      });

      if (
        loopRuntime.stopRequested ||
        controller.signal.aborted ||
        cycleResult?.stopped
      ) {
        break;
      }

      if (
        cycleResult?.completed >= cycleResult?.total &&
        settings.refreshAllServerListEachCycle !== false
      ) {
        try {
          initializeAllServerQueue(settings);
        } catch (error) {
          pushLog("다음 사이클 전체 서버 목록 갱신 실패", error?.message || String(error));
        }
      }

      pushLog(
        cycleResult?.ok === false
          ? `전체 서버 사이클 ${cycleNumber} 오류 후 재개 대기`
          : `전체 서버 사이클 ${cycleNumber} 완료`,
        {
          completed: cycleResult?.completed,
          total: cycleResult?.total,
          ok: cycleResult?.ok,
          error: cycleResult?.error || null
        }
      );

      updateProgress({
        phase: cycleResult?.ok === false
          ? "retry-waiting"
          : "waiting"
      });
      await sleep(Number(settings.loopDelayMs ?? 3000));
    }
  } catch (error) {
    if (!isStopError(error)) throw error;
    pushLog("사용자 요청으로 즉시 중지");
  } finally {
    saveState({ running: false, mode: "idle" });

    if (loopRuntime.abortController === controller) {
      loopRuntime.abortController = null;
    }

    loopRuntime.stopRequested = false;
    loopRuntime.runningPromise = null;
    loopRuntime.mode = "idle";
    updateProgress({ phase: "idle" });
    pushLog("전체 서버 무한반복 종료");
  }

  return true;
})();

loopRuntime.runningPromise = promise;
renderPanelSafe();
return promise;

}

function startAllServersInfiniteLoop(options = {}) {return startInfiniteLoop({...options,allServers: true});}

async function resetAndStartAllServersInfiniteLoop(options = {}) {
  const active = !!loopRuntime.abortController || !!loopRuntime.runningPromise;

  if (active) {
    throw new Error("실행 중인 조사를 먼저 중지한 뒤 초기화 후 시작하세요.");
  }

  loopRuntime.mode = "resetting";
  updateProgress({
    currentIndex: 0,
    total: 0,
    currentServerId: null,
    phase: "resetting"
  });

  await resetSurveyProgress({ preserveSchema: true });
  pushLog("초기화 완료 - 전체 서버 조사를 처음부터 시작합니다.");

  return startAllServersInfiniteLoop({
    ...options,
    forceRefreshAllServers: true
  });
}

function stopInfiniteLoop() {const wasRunning = !!loopRuntime.abortController || !!loopRuntime.runningPromise;

loopRuntime.stopRequested = true;
loopRuntime.mode = wasRunning ? "stopping" : "idle";
updateProgress({ phase: wasRunning ? "stopping" : "idle" });

try {
  loopRuntime.abortController?.abort();
} catch {}

saveState({
  running: false,
  stopRequestedAt: nowIso()
});

pushLog(wasRunning ? "즉시 중지 요청" : "실행 중인 조사가 없음");
renderPanelSafe();
return wasRunning;

}


async function commitPendingNow(options = {}) {
  const active = !!loopRuntime.abortController || !!loopRuntime.runningPromise;

  if (active) {
    throw new Error("조사 실행 중에는 수동 업로드를 시작할 수 없습니다.");
  }

  if (loopRuntime.mode === "resetting" || loopRuntime.mode === "committing-manual") {
    throw new Error("다른 작업이 진행 중입니다.");
  }

  loopRuntime.stopRequested = false;
  loopRuntime.mode = "committing-manual";
  updateProgress({
    phase: "committing",
    currentServerId: null,
    currentOutputPath: null
  });

  try {
    const result = await commitPendingBatch(options);
    const queue = loadServerQueue();

    if (result?.skipped) {
      pushLog("수동 GitHub 업로드 생략", result);
      return result;
    }

    if (queue?.servers?.length) {
      const settings = getSettings(options);
      const completed = queue.servers.filter(server =>
        isServerComplete(server, settings)
      ).length;

      if (completed >= queue.servers.length) {
        clearServerQueue();
      } else {
        saveServerQueue(queue.servers, {
          status: "partial-committed",
          completed,
          total: queue.servers.length,
          lastCommitAt: nowIso(),
          lastCommitSha: result?.commitSha || null,
          lastError: null
        });
      }
    }

    pushLog("수동 GitHub 업로드 완료", {
      sha: result?.commitSha || null,
      serverCount: result?.serverCount || 0,
      refreshedServerCount: result?.refreshedServerCount || 0,
      fileCount: result?.fileCount || 0
    });

    return result;
  } catch (error) {
    saveState({
      pendingCommit: true,
      lastCommitErrorAt: nowIso(),
      lastCommitError: error?.message || String(error)
    });

    pushLog("수동 GitHub 업로드 실패", {
      message: error?.message || String(error),
      status: error?.status ?? null,
      response: error?.response ?? null
    });

    throw error;
  } finally {
    loopRuntime.mode = "idle";
    updateProgress({
      phase: "idle",
      currentOutputPath: null,
      commitChunkIndex: null,
      commitChunkTotal: null
    });
  }
}

function configure(settings = {}) {const clean = {...settings};delete clean.token;const saved = saveSettings(clean);pushLog("설정 저장", {owner: saved.owner,repo: saved.repo,branch: saved.branch,token: sharedGithubToken() ? "shared" : "",allianceDataPath: saved.allianceDataPath,playerDataPath: saved.playerDataPath,serverDataPath: saved.serverDataPath,serverListBasePath: saved.serverListBasePath,serversLatestPath: saved.serversLatestPath,serversPopularLatestPath: saved.serversPopularLatestPath,movementBasePath: saved.movementBasePath,nicknameHistoryBasePath: saved.nicknameHistoryBasePath});return {...saved,token: sharedGithubToken() ? "********" : ""};}

function promptConfigure() {const current = getSettings();const result = configure({owner: prompt("GitHub owner", current.owner || "") || current.owner,repo: prompt("GitHub repo", current.repo || "topwar-webutil-vite") || current.repo,branch: prompt("GitHub branch", current.branch || "main") || current.branch});window.TOPWAR?.ensureGithubToken?.({interactive:true}).catch(error => console.warn("[REALPOWER] shared token check failed:", error));return result;}

function status() {const settings = getSettings();const state = getState();

const st = {
  version: "4.6.1-unified",
  independent: false,
  settingsKey: SETTINGS_KEY,
  stateKey: STATE_KEY,
  settings: {
    ...settings,
    token: settings.token ? "********" : ""
  },
  state,
  queue: loadServerQueue(),
  storageSchemaVersion: Number(localStorage.getItem(STORAGE_SCHEMA_KEY) || 0),
  calibration: readCalibration(),
  paths: {
    allianceData: settings.allianceDataPath,
    playerData: settings.playerDataPath,
    serverData: settings.serverDataPath,
    movementBase: settings.movementBasePath,
    nicknameHistoryBase: settings.nicknameHistoryBasePath,
    serverListBase: settings.serverListBasePath,
    serversLatest: settings.serversLatestPath,
    serversPopularLatest: settings.serversPopularLatestPath
  },
  components: {
    WorldServerListPanel: !!getComponentSafe("WorldServerListPanel"),
    WorldServerPowerRank: !!getComponentSafe("WorldServerPowerRank"),
    WorldServerAlliancePowerRank: !!getComponentSafe("WorldServerAlliancePowerRank")
  }
};

console.log("[REALPOWER] status:", st);
return st;

}

async function clearOwnData() {localStorage.removeItem(SETTINGS_KEY);localStorage.removeItem(STATE_KEY);localStorage.removeItem(QUEUE_KEY);localStorage.removeItem(STORAGE_SCHEMA_KEY);localStorage.removeItem(UI_STATE_KEY);await deletePendingFiles();pushLog("독립 설정/상태/임시 데이터 초기화 완료");applyPanelVisibility();return true;}

// ---------------------------------------------------------------------------// Compact UI: start/stop toggle + slide collapse// ---------------------------------------------------------------------------

function readUiState() {const state = readLocal(UI_STATE_KEY, {collapsed: false});return {collapsed: state?.collapsed === true || state?.hidden === true};}

function applyPanelVisibility() {const collapsed = readUiState().collapsed;const panel = document.getElementById("realpower-standalone-panel");const slide = panel?.querySelector("#rp-slide");

if (panel) {
  panel.style.setProperty("display", "block", "important");
  panel.style.setProperty("visibility", "visible", "important");
  panel.style.transform = collapsed
    ? "translateX(calc(100% - 36px))"
    : "translateX(0)";
  panel.dataset.collapsed = collapsed ? "true" : "false";
}

if (slide) {
  slide.textContent = collapsed ? "◀" : "▶";
  slide.title = collapsed
    ? "RealPower UI 펼치기 (Ctrl+Alt+R)"
    : "RealPower UI 접기 (Ctrl+Alt+R)";
  slide.setAttribute("aria-label", slide.title);
  slide.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

return collapsed;

}

function setPanelCollapsed(collapsed) {writeLocal(UI_STATE_KEY, {collapsed: collapsed === true,updatedAt: nowIso()});applyPanelVisibility();renderPanelSafe();return collapsed === true;}

function hidePanel() {return setPanelCollapsed(true);}
function showPanel() {return setPanelCollapsed(false);}
function togglePanelVisibility() {return setPanelCollapsed(!readUiState().collapsed);}

function panelHtml() {return `
      <div style="display:flex;align-items:stretch;width:100%;min-height:44px">
        <button id="rp-slide" type="button" title="RealPower UI 접기 (Ctrl+Alt+R)" style="
          flex:0 0 36px;
          width:36px;
          min-height:44px;
          padding:0;
          border:1px solid rgba(255,255,255,.32);
          border-right:0;
          border-radius:9px 0 0 9px;
          background:rgba(0,0,0,.82);
          color:#fff;
          font-size:17px;
          font-weight:700;
          line-height:42px;
          cursor:pointer;
          box-shadow:-2px 2px 8px rgba(0,0,0,.30);
        ">▶</button>
        <div id="rp-body" style="
          flex:1 1 auto;
          min-width:0;
          box-sizing:border-box;
          padding:7px;
          border:1px solid rgba(255,255,255,.24);
          border-radius:0 0 0 8px;
          background:rgba(0,0,0,.76);
          box-shadow:0 2px 8px rgba(0,0,0,.28);
          backdrop-filter:blur(3px);
        ">
          <div style="display:flex;align-items:center;gap:7px">
            <button id="rp-toggle" type="button" style="
              flex:1 1 0;
              height:30px;
              border:0;
              border-radius:6px;
              color:#fff;
              font-weight:700;
              cursor:pointer;
            ">조사 시작</button>
            <button id="rp-reset-start" type="button" title="기존 진행상태와 임시 데이터를 지우고 처음부터 조사" style="
              flex:1.35 1 0;
              height:30px;
              border:0;
              border-radius:6px;
              background:#ef6c00;
              color:#fff;
              font-weight:700;
              cursor:pointer;
            ">초기화 후 시작</button>
            <button id="rp-upload-now" type="button" title="IndexedDB에 저장된 조사 결과를 지금 GitHub에 업로드" style="
              flex:1 1 0;
              height:30px;
              border:0;
              border-radius:6px;
              background:#1565c0;
              color:#fff;
              font-weight:700;
              cursor:pointer;
            ">지금 업로드</button>
          </div>
          <div id="rp-progress" style="
            min-width:0;
            margin-top:6px;
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
            color:#fff;
            font-size:12px;
          ">대기 중</div>
        </div>
      </div>
   `;}

function panelMountTarget() {return document.fullscreenElement || document.body || document.documentElement;}

function createPanel() {let panel = document.getElementById("realpower-standalone-panel");const oldLauncher = document.getElementById("realpower-standalone-launcher");

// 이전 버전의 별도 RP 버튼은 제거한다.
if (oldLauncher) oldLauncher.remove();

// 이전 UI 구조가 페이지에 남아 있으면 슬라이드형으로 다시 만든다.
if (panel && panel.dataset.uiVersion !== "slide-v3") {
  panel.remove();
  panel = null;
}

if (panel && panel.parentNode !== panelMountTarget()) {
  panelMountTarget().appendChild(panel);
}

if (!panel) {
  panel = document.createElement("div");
  panel.id = "realpower-standalone-panel";
  panel.dataset.uiVersion = "slide-v3";
  panel.style.cssText = [
    "display:block",
    "visibility:visible",
    "position:fixed",
    "right:0",
    "bottom:8px",
    "z-index:2147483647",
    "width:321px",
    "box-sizing:border-box",
    "font:12px/1.3 Arial,sans-serif",
    "transition:transform .22s ease",
    "will-change:transform",
    "pointer-events:auto",
    "isolation:isolate"
  ].join(";");

  panel.innerHTML = panelHtml();
  panelMountTarget().appendChild(panel);

  const ensureToken = () => {
    if (getSettings().token) return true;

    promptConfigure();

    if (!getSettings().token) {
      pushLog("GitHub token이 없어 조사를 시작하지 않았습니다.");
      return false;
    }

    return true;
  };

  const logStartError = error => {
    if (!isStopError(error)) {
      console.error("[REALPOWER] 전체 서버 조사 실패:", error);
      pushLog("전체 서버 조사 실패", error?.message || String(error));
    }
  };

  panel.querySelector("#rp-toggle").onclick = () => {
    const active = !!loopRuntime.abortController || !!loopRuntime.runningPromise;

    if (active) {
      stopInfiniteLoop();
      return;
    }

    if (loopRuntime.mode === "resetting" || !ensureToken()) return;
    startAllServersInfiniteLoop().catch(logStartError);
  };

  panel.querySelector("#rp-reset-start").onclick = () => {
    const active = !!loopRuntime.abortController || !!loopRuntime.runningPromise;

    if (active) {
      pushLog("조사 실행 중에는 초기화 후 시작을 사용할 수 없습니다. 먼저 중지하세요.");
      return;
    }

    if (loopRuntime.mode === "resetting" || !ensureToken()) return;

    const confirmed = window.confirm(
      "기존 조사 진행상태와 임시 저장 데이터를 삭제하고 처음부터 시작할까요?\nGitHub 설정과 토큰은 유지됩니다."
    );

    if (!confirmed) return;
    resetAndStartAllServersInfiniteLoop().catch(logStartError);
  };

  panel.querySelector("#rp-upload-now").onclick = () => {
    const active = !!loopRuntime.abortController || !!loopRuntime.runningPromise;

    if (active) {
      pushLog("조사 실행 중에는 지금 업로드를 사용할 수 없습니다. 먼저 중지하세요.");
      return;
    }

    if (
      loopRuntime.mode === "resetting" ||
      loopRuntime.mode === "committing-manual" ||
      !ensureToken()
    ) {
      return;
    }

    commitPendingNow().catch(error => {
      if (!isStopError(error)) {
        console.error("[REALPOWER] 수동 GitHub 업로드 실패:", error);
      }
    });
  };

  panel.querySelector("#rp-slide").onclick = togglePanelVisibility;
}

if (!window.__REALPOWER_UI_HOTKEY_BOUND__) {
  window.__REALPOWER_UI_HOTKEY_BOUND__ = true;
  window.addEventListener("keydown", event => {
    if (event.ctrlKey && event.altKey && event.code === "KeyR") {
      event.preventDefault();
      togglePanelVisibility();
    }
  });
}

applyPanelVisibility();
renderPanel();

}

function renderPanel() {const panel = document.getElementById("realpower-standalone-panel");if (!panel) return;

const button = panel.querySelector("#rp-toggle");
const resetStartButton = panel.querySelector("#rp-reset-start");
const uploadNowButton = panel.querySelector("#rp-upload-now");
const label = panel.querySelector("#rp-progress");
const state = getState();
const queue = loadServerQueue();
const progress = loopRuntime.progress || state.progress || {};
const active = !!loopRuntime.abortController || !!loopRuntime.runningPromise;
const resetting = loopRuntime.mode === "resetting" || progress.phase === "resetting";
const committing =
  loopRuntime.mode === "committing-manual" ||
  progress.phase === "committing";

if (button) {
  button.disabled = resetting || committing;
  button.textContent = resetting
    ? "초기화 중"
    : (committing ? "업로드 중" : (active ? "조사 중지" : "조사 시작"));
  button.style.background = resetting || committing
    ? "#616161"
    : (active ? "#c62828" : "#2e7d32");
  button.style.cursor = resetting || committing ? "default" : "pointer";
  button.style.opacity = resetting || committing ? ".72" : "1";
}

if (resetStartButton) {
  resetStartButton.disabled = active || resetting || committing;
  resetStartButton.style.background =
    active || resetting || committing ? "#6d4c41" : "#ef6c00";
  resetStartButton.style.cursor =
    active || resetting || committing ? "default" : "pointer";
  resetStartButton.style.opacity =
    active || resetting || committing ? ".62" : "1";
}

if (uploadNowButton) {
  uploadNowButton.disabled = active || resetting || committing;
  uploadNowButton.style.background =
    active || resetting || committing ? "#455a64" : "#1565c0";
  uploadNowButton.style.cursor =
    active || resetting || committing ? "default" : "pointer";
  uploadNowButton.style.opacity =
    active || resetting || committing ? ".62" : "1";
}

if (label) {
  const current = Number(progress.currentIndex || 0);
  const total = Number(progress.total || 0);
  const serverId = progress.currentServerId;

  if (resetting) {
    label.textContent = "진행상태와 임시 데이터를 초기화하는 중";
  } else if (committing) {
    const outputPath = progress.currentOutputPath;
    const chunkIndex = Number(progress.commitChunkIndex || 0);
    const chunkTotal = Number(progress.commitChunkTotal || 0);

    label.textContent = outputPath
      ? `GitHub 업로드 중 ${chunkIndex}/${chunkTotal}: ${outputPath}`
      : "GitHub 업로드 준비 중";
  } else if (active && serverId != null) {
    label.textContent = `${current}/${total} (${serverId}서버 조사중)`;
  } else if (active) {
    label.textContent = `${current}/${total} (서버 목록 준비중)`;
  } else if (state.lastCommitError) {
    label.textContent = `업로드 실패: ${state.lastCommitError}`;
    label.title = state.lastCommitError;
  } else if (queue?.status === "partial-committed") {
    label.textContent =
      `부분 업로드 완료: ${Number(queue.completed || 0)}/${Number(queue.total || 0)}`;
  } else {
    label.textContent = "대기 중";
    label.title = "";
  }
}

applyPanelVisibility();

}
function renderPanelSafe() {try {renderPanel();} catch {}}

const api = {version: "4.6.1-unified",independent: false,

configure,
promptConfigure,
status,
clearOwnData,

getSettings,
getState,
pendingCacheStatus,
resetSurveyProgress,
repairInvalidCompletedQueue,
migrateLegacyPracticeData,
listPendingFiles,
deletePendingFiles,
isStopError,
throwIfStopped,
readCalibration,
calibrationStatus,
captureNextClick,
clearCalibration,

getAllServersFromListPanel,
getAllServerInfoFromListPanel,
getAllServers2,
getRealPowerServerOrderMode,
orderRealPowerServers,
initializeAllServerQueue,
findWorldMapController,
getCurrentServerId,
collectActiveSceneTexts,
isTargetBattleAreaVisible,
waitForServerSelection,
waitForBattleAreaEntry,
waitForServerMove,
moveToServer,

getServerPowerRankRaw,
inspectPlayerRankRow,
getServerAllianceRankRaw,
getServerPowerRank,
getServerAllianceRank,
rankListFingerprint,
rankCaptureSnapshot,
prepareRankCapture,
waitForRankList,

dispatchDomMousePress,
clickJavaPointMouseOnly,
clickJavaPointDomOnly,
waitForEitherRankPanel,
rankPointAttempts,
backPointAttempts,
trySemanticPanelClose,
collectPanelCloseCommands,
inspectPanelCloseCommands,
closePanelByCommand,
collectRankOpenCommands,
inspectRankOpenCommands,
openRankPanelByCommand,
openRankPanelByJavaPoint,
closeByJavaBackPoint,
exitTheaterByJavaBackPoint,

buildServerInfo,
formatPowerPlayer,
formatPowerAlliance,
formatPowerServer,
toEpochSeconds,
latestPlayerActivitySeconds,
buildServerListOutputFiles,
buildPowerOutputFiles,
buildCrossServerMovementRows,
buildNicknameChangeRows,
serverDateString,
  buildDailyMovementOutput,
  buildDailyNicknameHistoryOutput,
collectOpenRanks,
collectByClick,
getTheaterPanelComponent,
theaterPanelSnapshot,
waitForFreshTheaterPanel,
findServerNodeCandidates,
collectStructuralServerOpenCandidates,
invokeStructuralServerCandidates,
openSelectedServerSemantic,
buttonsInsideNode,
openRankPanelSemantic,
closePanelSemantic,
listActiveButtons,
findRankButton,
findButtonNearSourceCoordinate,
clickRankButtonByCoordinate,
clickRankButton,
openRankPanelByCoordinate,
closeRankPanel,
testJavaClickFlow,

stageServerData,
uploadServerData,
commitPendingBatch,
commitPendingNow,
uploadOpenRanks,
surveyServer,
surveyServers,

loadServerQueue,
saveServerQueue,
clearServerQueue,
isReusableAllServerQueue,
loadLastTempDataLikeJava,
runOneCycle,
startInfiniteLoop,
startAllServersInfiniteLoop,
resetAndStartAllServersInfiniteLoop,
stopInfiniteLoop,
isServerComplete,

toClientPoint,
getCanvasCenterPoint,
clickCanvasCenter,
openSelectedServerByCanvasCenter,
clickCanvasNormalized,
calibratedClientPoint,
clickSavedPoint,
clickCanvas,
clickSequence,
createPanel,
readUiState,
hidePanel,
showPanel,
togglePanelVisibility

};

window[API_NAME] = api;
migrateLegacyRealPowerToken();

function bootRealPowerUi() {
  // 통합판에서는 별도 RealPower 패널을 만들지 않는다.
  // window.REALPOWER API만 제공하고 TOPWAR 패널에서 제어한다.
  return false;
}

// IndexedDB 복구는 백엔드 설치 후 별도로 실행한다.
setTimeout(async () => {
  try {
    await repairInvalidCompletedQueue();
    await migrateLegacyPracticeData();
  } catch (error) {
    console.warn("[REALPOWER] storage migration failed:", error);
  } finally {
    renderPanelSafe();
  }
}, 1500);

console.log("%c[REALPOWER Unified Backend] installed", "color:#90ee90;font-weight:bold", api);})();

/* ============================================================================
 * V2.12.1 RealPower unified-panel bridge
 * - Separate backend, shared TOPWAR GitHub token
 * - Main button: Top100조사 ON/OFF
 * - Advanced: 처음부터 / 지금 업로드
 * ========================================================================== */
(function installRealPowerUnifiedPanelBridge() {
  "use strict";

  const MAIN_BUTTON_ID = "tw26-realpower";
  const STATUS_ID = "tw26-realpower-status";
  const RESET_BUTTON_ID = "tw26-realpower-reset";
  const UPLOAD_BUTTON_ID = "tw26-realpower-upload";

  function rp() { return window.REALPOWER || null; }
  function topwar() { return window.TOPWAR || null; }

  function rpState() {
    try { return rp()?.getState?.() || {}; }
    catch { return {}; }
  }

  function otherAutomationRunning() {
    const tw = topwar();
    const s = tw?.state || {};
    return !!(
      s.watch133?.running ||
      s.ui?.serverSurvey?.running ||
      s.ui?.serverSurveyBatch?.running ||
      s.cityRewardFinder?.running
    );
  }

  async function ensureSharedToken() {
    const tw = topwar();
    if (typeof tw?.ensureGithubToken === "function") {
      const token = await tw.ensureGithubToken({ interactive: true });
      return !!token;
    }
    try { return !!String(localStorage.getItem("TOPWAR_GITHUB_TOKEN") || "").trim(); }
    catch { return false; }
  }

  async function resolveSharedServerOrderMode() {
    const tw = topwar();
    const mode = String(
      tw?.getAutomationServerOrderMode?.() ||
      (() => {
        try { return localStorage.getItem("TOPWAR_AUTOMATION_SERVER_ORDER"); }
        catch { return "popular"; }
      })() ||
      "popular"
    ).trim().toLowerCase();

    const normalized = ["sequential", "popular", "random"].includes(mode) ? mode : "popular";

    // Top100 인기순 정렬도 동일한 servers-popular.json 캐시를 사용한다.
    let serverIds = [];
    if (normalized === "popular") {
      try { serverIds = await tw?.resolveAutomationServerIds?.() || []; }
      catch (error) { console.warn("[REALPOWER Unified UI] popular 목록 준비 실패:", error); }
    }

    return { mode: normalized, serverIds };
  }

  async function startOrStop() {
    const api = rp();
    if (!api) {
      alert("RealPower 백엔드가 아직 준비되지 않았습니다.");
      return;
    }

    const state = rpState();
    if (state.running === true) {
      api.stopInfiniteLoop?.();
      update();
      return;
    }

    if (otherAutomationRunning()) {
      alert("다른 조사가 진행 중입니다. 보상탐색 또는 지도조사를 먼저 OFF 하세요.");
      return;
    }

    if (!await ensureSharedToken()) return;

    const { mode: serverOrderMode, serverIds } = await resolveSharedServerOrderMode();
    if (serverOrderMode === "popular" && !serverIds.length) {
      alert("인기순 서버목록을 읽지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.");
      return;
    }

    // Top100은 맵 901 데이터가 필요 없으므로 이전 지도조사의 대형 런타임 캐시를 먼저 해제한다.
    try { topwar()?.clearCollected?.({ keepWatch: true }); } catch {}

    api.startAllServersInfiniteLoop?.({ serverOrderMode, serverIds }).catch(error => {
      if (!api.isStopError?.(error)) {
        console.error("[REALPOWER Unified UI] 조사 실패:", error);
        alert(`Top100조사 오류\n\n${error?.message || String(error)}`);
      }
      update();
    });
    update();
  }

  async function resetAndStart() {
    const api = rp();
    if (!api) return;
    if (rpState().running === true || otherAutomationRunning()) {
      alert("실행 중인 조사를 먼저 모두 OFF 하세요.");
      return;
    }
    if (!await ensureSharedToken()) return;
    if (!confirm("전투력 조사 진행상태와 임시 저장 데이터를 지우고 처음부터 시작할까요?\nGitHub 토큰은 유지됩니다.")) return;

    const { mode: serverOrderMode, serverIds } = await resolveSharedServerOrderMode();
    if (serverOrderMode === "popular" && !serverIds.length) {
      alert("인기순 서버목록을 읽지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.");
      return;
    }
    try { topwar()?.clearCollected?.({ keepWatch: true }); } catch {}

    api.resetAndStartAllServersInfiniteLoop?.({ serverOrderMode, serverIds }).catch(error => {
      if (!api.isStopError?.(error)) {
        console.error("[REALPOWER Unified UI] 초기화 후 시작 실패:", error);
        alert(`Top100조사 오류\n\n${error?.message || String(error)}`);
      }
      update();
    });
    update();
  }

  async function uploadNow() {
    const api = rp();
    if (!api) return;
    if (rpState().running === true || otherAutomationRunning()) {
      alert("조사 실행 중에는 수동 업로드를 사용할 수 없습니다.");
      return;
    }
    if (!await ensureSharedToken()) return;

    api.commitPendingNow?.().catch(error => {
      console.error("[REALPOWER Unified UI] 수동 업로드 실패:", error);
      alert(`Top100 업로드 오류\n\n${error?.message || String(error)}`);
      update();
    });
    update();
  }

  function update() {
    const button = document.getElementById(MAIN_BUTTON_ID);
    const status = document.getElementById(STATUS_ID);
    const reset = document.getElementById(RESET_BUTTON_ID);
    const upload = document.getElementById(UPLOAD_BUTTON_ID);
    if (!button) return;

    const state = rpState();
    const progress = state.progress || {};
    const running = state.running === true;
    const blocked = otherAutomationRunning();

    button.textContent = "Top100조사";
    button.title = running ? "실행 중 · 클릭하면 중지" : "중지됨 · 클릭하면 실행";
    button.style.background = running ? "#247a4b" : "#3b3b3b";
    button.disabled = !running && blocked;
    button.style.opacity = button.disabled ? "0.55" : "1";

    if (reset) {
      reset.disabled = running || blocked;
      reset.style.opacity = reset.disabled ? "0.55" : "1";
    }
    if (upload) {
      upload.disabled = running || blocked;
      upload.style.opacity = upload.disabled ? "0.55" : "1";
    }

    if (status) {
      if (running) {
        const current = Number(progress.currentIndex || 0);
        const total = Number(progress.total || 0);
        const server = progress.currentServerId ?? "-";
        status.style.display = "block";
        status.textContent = `Top100 ${current}/${total} · ${server}서버 · ${progress.phase || "실행중"}`;
      } else if (state.lastCommitError) {
        status.style.display = "block";
        status.textContent = `Top100 업로드 실패: ${state.lastCommitError}`;
      } else {
        status.style.display = "none";
        status.textContent = "";
      }
    }
  }

  function install() {
    const api = rp();
    const group = document.getElementById("tw26-scan-actions");
    if (!api || !group) return false;

    let button = document.getElementById(MAIN_BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = MAIN_BUTTON_ID;
      button.type = "button";
      button.style.cssText = "height:38px;border:0;border-radius:7px;background:#3b3b3b;color:#eee;font-size:12px;font-weight:700;cursor:pointer;min-width:0;";
      button.textContent = "Top100조사";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void startOrStop();
      });
      group.appendChild(button);
    }

    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement("div");
      status.id = STATUS_ID;
      status.style.cssText = "display:none;margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.05);font-size:10px;line-height:1.4;color:#aaa;word-break:break-word;";
      group.insertAdjacentElement("afterend", status);
    }

    const advancedGrid = document.querySelector("#tw26-advanced div > div[style*='display:grid']");
    if (advancedGrid) {
      if (!document.getElementById(RESET_BUTTON_ID)) {
        const reset = document.createElement("button");
        reset.id = RESET_BUTTON_ID;
        reset.type = "button";
        reset.textContent = "Top100 처음부터";
        reset.style.cssText = "height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;";
        reset.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          void resetAndStart();
        });
        advancedGrid.appendChild(reset);
      }

      if (!document.getElementById(UPLOAD_BUTTON_ID)) {
        const upload = document.createElement("button");
        upload.id = UPLOAD_BUTTON_ID;
        upload.type = "button";
        upload.textContent = "Top100 업로드";
        upload.style.cssText = "height:29px;border:0;border-radius:6px;background:#333;color:#ccc;font-size:11px;cursor:pointer;";
        upload.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          void uploadNow();
        });
        advancedGrid.appendChild(upload);
      }
    }

    update();
    return true;
  }

  const timer = setInterval(() => {
    try {
      install();
      update();
    } catch (error) {
      console.warn("[REALPOWER Unified UI] bridge update failed:", error);
    }
  }, 500);

  window.addEventListener("beforeunload", () => clearInterval(timer), { once: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
