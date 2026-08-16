// ==UserScript==
// @name         TopWar Unified Automation V2.11.6 - Safe GitHub Token + Memory Cleanup
// @namespace    topwar-unified-automation-v2104-thief-share-ui-log-control
// @version      2.11.6
// @description  TopWar scanner + servers-popular list in page context + fast GitHub storage queue + user movement history
// @match        https://h5.topwargame.com/*
// @match        https://h5v2.topwargame.com/*
// @match        https://*.topwargame.com/*
// @match        https://*.topwarapp.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

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

  const VERSION = "2.11.6-safe-github-token-storage-memory-optimized";
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
    maxRecentPackets: 16,
    maxStoredObjects: 5000,
    maxStoredObjectsPerType: 1500,
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
    const result = await validateGithubToken(value);
    githubTokenValidationState = {
      checked: true,
      valid: !!result.ok,
      login: result.login ?? null,
      checkedAt: new Date().toISOString(),
      error: result.ok ? null : result.reason
    };

    if (!result.ok) {
      writeRawGithubToken("");
      return result;
    }

    writeRawGithubToken(value);
    return result;
  }

  async function ensureGithubToken(options = {}) {
    if (githubTokenEnsurePromise) return githubTokenEnsurePromise;

    githubTokenEnsurePromise = (async () => {
      const interactive = options.interactive !== false;
      let token = getGithubToken();

      if (token && options.forcePrompt !== true) {
        const validation = await validateGithubToken(token);
        githubTokenValidationState = {
          checked: true,
          valid: !!validation.ok,
          login: validation.login ?? null,
          checkedAt: new Date().toISOString(),
          error: validation.ok ? null : validation.reason
        };
        if (validation.ok) return token;

        console.warn("[TopWar GitHub] 저장된 token 검증 실패. 기존 token을 제거합니다.", {
          status: validation.status,
          reason: validation.reason
        });
        writeRawGithubToken("");
        token = "";
      }

      if (!interactive) return "";

      while (!token) {
        const entered = prompt(
          "GitHub Personal Access Token을 입력하세요.\n" +
          "입력값은 GitHub API 검증에 성공한 경우에만 localStorage에 저장됩니다."
        );
        if (entered == null) return "";

        const candidate = String(entered).trim();
        if (!candidate) continue;

        const validation = await validateAndSaveGithubToken(candidate);
        if (validation.ok) {
          console.log("[TopWar GitHub] token 검증 및 저장 완료", {
            login: validation.login ?? null
          });
          return candidate;
        }

        alert(`GitHub token 검증 실패 (${validation.status}): ${validation.reason || "unknown error"}`);
      }

      return token;
    })();

    try {
      return await githubTokenEnsurePromise;
    } finally {
      githubTokenEnsurePromise = null;
    }
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
    const serverId = point?.k ?? p.w ?? p.cMid ?? meta.serverId ?? null;
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

  function handleDecodedPacket(record) {
    const packet = record.packet;
    const detail = packet?.decoded?.parsedDetail ?? packet?.decoded?.detail ?? null;
    if (packet?.c === 901 && Array.isArray(detail?.pointList)) {
      record.collected = collectPointList(detail.pointList, { time: record.time, c: packet.c, seq: packet.seq, serverId: detail?.k });
      if (state.debug.log901) console.log("[TopWar 901 collected]", { seq: packet.seq, pointList: detail.pointList.length, collected: record.collected });
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

      let cacheCollected = null;
      if (!stable.ok && options.collectCache !== false) cacheCollected = collectObjectsFromWorldMapCache();

      const gainedObjects = state.objectMap.size - beforeObjects;
      const gainedPlayers = state.playerMap.size - beforePlayers;
      const ok = stable.ok || gainedObjects > 0 || gainedPlayers > 0;

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
          cacheCollected,
          gainedObjects,
          gainedPlayers,
          totals: getSummary()
        };
        noteMoveResultForConnectionGuard(successResult, { x, y, serverId, attempt });
        return successResult;
      }

      if (attempt <= maxRetries) {
        console.warn("[TopWar] no network/cache data, retry:", { x, y, attempt, stable, gainedObjects, gainedPlayers });
        await sleep(Number(options.retryDelay ?? 250));
      }
    }

    const failResult = { ok: false, x, y, serverId, subMap, scale, reason: "no network 901 and no cache objects", totals: getSummary() };
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
  function alliances() { return [...state.allianceMap.values()]; }
  function objects() { return [...state.objectMap.values()]; }
  function allianceRepresentatives() { return [...state.allianceRepresentativeMap.values()].sort((a, b) => Number(b.power ?? 0) - Number(a.power ?? 0)); }

  function getSummary() {
    return {
      players: state.playerMap.size,
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
    state.allianceMap = new Map();
    state.allianceRepresentativeMap = new Map();
    state.recentPackets = [];
    state.recentOutgoing = [];
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

  // 1) localStorage 확인 -> 2) GitHub API 검증 -> 3) 실패/없음 시 입력 -> 4) 검증 성공 시 저장
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
    "https://raw.githubusercontent.com/hiphop5782/topwar-webutil-vite/master/src/assets/json/servers/servers-popular.json",
    "https://github.com/hiphop5782/topwar-webutil-vite/raw/main/src/assets/json/servers/servers-popular.json",
    "https://github.com/hiphop5782/topwar-webutil-vite/raw/master/src/assets/json/servers/servers-popular.json",
    "https://api.github.com/repos/hiphop5782/topwar-webutil-vite/contents/src/assets/json/servers/servers-popular.json",
    "https://api.github.com/repos/hiphop5782/topwar-webutil-vite/contents/src/assets/json/servers/servers-popular.json?ref=main",
    "https://api.github.com/repos/hiphop5782/topwar-webutil-vite/contents/src/assets/json/servers/servers-popular.json?ref=master"
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
    const response = await fetch(url, {
      method: "GET",
      cache: options.force ? "no-store" : "default",
      mode: "cors",
      credentials: "omit",
      headers: {
        "Accept": "application/json,text/plain,*/*"
      }
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

    for (let round = 1; round <= Number(options.rounds ?? 2); round++) {
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
      waitBefore: options.beforeBaseClickDelay ?? 900,
      clickDelay: options.baseClickDelay ?? 350,
      popupTimeout: options.cityPopupClickTimeout ?? 1200,
      rounds: options.baseClickRounds ?? 2,
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

        if (result.stages.mapScan?.stopped || shouldStopServerSurvey()) {
          result.stopped = true;
          result.reason = "manual stop during map scan";
          return result;
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
            const githubSettings = JSON.parse(
              localStorage.getItem("TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS") || "{}"
            );

            if (githubSettings.enabled) {
              result.data.githubUpload = await TOPWAR.uploadSurveyResultToGithub(result.data, {
                ...githubSettings,
                // UI/서버조사 옵션을 GitHub 저장 레이어까지 명시적으로 전달합니다.
                trackActualInOut: surveyOptions.trackActualInOut ?? true,
                uploadUserMovementHistory: surveyOptions.uploadUserMovementHistory ?? true,
                uploadUserLatestIndex: surveyOptions.uploadUserLatestIndex ?? true,
                ...(surveyOptions.github || {})
              });

              result.githubUpload = result.data.githubUpload;

              console.log("[TopWar V2.6] GitHub 업로드 완료:", {
                serverId,
                githubUpload: result.githubUpload
              });
            } else {
              console.log("[TopWar V2.6] GitHub 업로드 비활성화 상태");
            }
          } catch (error) {
            result.githubUpload = {
              ok: false,
              error: error?.message || String(error)
            };

            result.data.githubUpload = result.githubUpload;

            console.error("[TopWar V2.6] GitHub 업로드 실패:", error);
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
      "width:min(320px,calc(100vw - 56px))",
      "max-height:calc(100vh - 16px)",
      "font-family:Arial,'Malgun Gothic',sans-serif",
      "background:rgba(20,20,20,0.92)",
      "color:#fff",
      "border:1px solid rgba(255,255,255,0.25)",
      "border-radius:10px",
      "box-shadow:0 4px 18px rgba(0,0,0,0.35)",
      "overflow:visible",
      "box-sizing:border-box",
      "transition:transform 0.25s ease",
      "will-change:transform",
      "user-select:none"
    ].join(";");

    panel.innerHTML = `
      <div id="tw26-header" style="
        height:34px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:0 10px;
        background:rgba(0,0,0,0.45);
        cursor:pointer;
        font-size:13px;
        font-weight:800;
      ">
        <span>TOPWAR 자동화</span>
        <span id="tw26-fold">접기 ▲</span>
      </div>

      <div id="tw26-body" style="padding:10px;max-height:calc(100vh - 66px);overflow-y:auto;overflow-x:hidden;box-sizing:border-box;">
        <label style="display:block;font-size:12px;color:#ddd;margin-bottom:4px;">서버번호 <span style="color:#aaa;">(비우면 popular 전체 / 직접 입력 가능)</span></label>
        <input id="tw26-server" type="text" placeholder="비우면 popular 전체 / 직접 입력: 3223,3453" style="
          width:100%;
          height:32px;
          box-sizing:border-box;
          border:1px solid rgba(255,255,255,0.25);
          border-radius:6px;
          padding:0 8px;
          background:#111;
          color:#fff;
          font-size:14px;
          outline:none;
        " />

        <label style="display:block;font-size:12px;color:#ddd;margin-top:8px;margin-bottom:4px;">GitHub Token <span style="color:#aaa;">(모든 업로드 공통)</span></label>
        <input id="tw26-github-token" type="password" autocomplete="off" spellcheck="false" placeholder="GitHub PAT 입력" style="
          width:100%;
          height:32px;
          box-sizing:border-box;
          border:1px solid rgba(255,255,255,0.25);
          border-radius:6px;
          padding:0 8px;
          background:#111;
          color:#fff;
          font-size:12px;
          outline:none;
        " />

        <div id="tw26-scan-actions" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px;">
          <button id="tw26-thief" style="
            height:40px;
            border:0;
            border-radius:8px;
            background:#555;
            color:white;
            font-size:13px;
            font-weight:800;
            cursor:pointer;
          ">도둑+보상 OFF</button>

          <button id="tw26-survey" style="
            height:40px;
            border:0;
            border-radius:8px;
            background:#555;
            color:white;
            font-size:13px;
            font-weight:800;
            cursor:pointer;
          ">서버조사 OFF</button>
        </div>

        <div id="tw26-status" style="
          margin-top:8px;
          padding:8px;
          border-radius:6px;
          background:rgba(255,255,255,0.08);
          font-size:12px;
          line-height:1.45;
          color:#ddd;
          word-break:break-all;
          min-height:95px;
        ">상태 확인 중...</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <button id="tw26-reset" style="
            height:28px;
            border:0;
            border-radius:6px;
            background:#333;
            color:#ddd;
            font-size:12px;
            cursor:pointer;
          ">진행 초기화</button>

          <button id="tw26-save" style="
            height:28px;
            border:0;
            border-radius:6px;
            background:#333;
            color:#ddd;
            font-size:12px;
            cursor:pointer;
          ">현재 저장</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <button id="tw26-reconnect" style="height:28px;border:0;border-radius:6px;background:#5b3b00;color:#ffd98a;font-size:12px;cursor:pointer;">연결상태 초기화</button>
          <button id="tw26-connection-status" style="height:28px;border:0;border-radius:6px;background:#333;color:#ddd;font-size:12px;cursor:pointer;">연결상태 보기</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <button id="tw26-program-logs" style="height:30px;border:0;border-radius:6px;background:#333;color:#ddd;font-size:11px;font-weight:700;cursor:pointer;">프로그램 로그 ON</button>
          <button id="tw26-game-font-logs" style="height:30px;border:0;border-radius:6px;background:#333;color:#ddd;font-size:11px;font-weight:700;cursor:pointer;">게임 폰트경고 OFF</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
          <button id="tw26-activity" style="
            height:28px;
            border:0;
            border-radius:6px;
            background:#333;
            color:#ddd;
            font-size:12px;
            cursor:pointer;
          ">활동표</button>

          <button id="tw26-alliance" style="
            height:28px;
            border:0;
            border-radius:6px;
            background:#333;
            color:#ddd;
            font-size:12px;
            cursor:pointer;
          ">동맹표</button>
        </div>
      </div>
    `;

    const PANEL_RIGHT_GAP = 8;
    const PANEL_STORAGE_KEY = "topwar-unified-control-panel-open";

    const slideToggleButton = document.createElement("button");
    slideToggleButton.id = "tw26-slide-toggle";
    slideToggleButton.type = "button";
    slideToggleButton.style.cssText = [
      "position:absolute",
      "left:-38px",
      "top:12px",
      "width:38px",
      "height:52px",
      "padding:0",
      "border:1px solid rgba(255,255,255,0.3)",
      "border-right:0",
      "border-radius:8px 0 0 8px",
      "background:rgba(20,20,20,0.94)",
      "color:#fff",
      "font-size:18px",
      "font-weight:800",
      "line-height:52px",
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
    const githubTokenInput = panel.querySelector("#tw26-github-token");
    const thiefButton = panel.querySelector("#tw26-thief");
    const surveyButton = panel.querySelector("#tw26-survey");
    const status = panel.querySelector("#tw26-status");
    const resetButton = panel.querySelector("#tw26-reset");
    const saveButton = panel.querySelector("#tw26-save");
    const reconnectButton = panel.querySelector("#tw26-reconnect");
    const connectionStatusButton = panel.querySelector("#tw26-connection-status");
    const programLogsButton = panel.querySelector("#tw26-program-logs");
    const gameFontLogsButton = panel.querySelector("#tw26-game-font-logs");
    const activityButton = panel.querySelector("#tw26-activity");
    const allianceButton = panel.querySelector("#tw26-alliance");

    const initialThiefUiSettings = loadThiefUiSettings();
    githubTokenInput.value = TOPWAR.getGithubToken?.() || "";

    let folded = false;
    let serverListLoading = false;
    let lastServerListError = null;

    function inputServerId() {
      return parseServerIdsStrict(serverInput.value)[0] ?? null;
    }

    function explicitInputServerIds() {
      return parseServerIdsStrict(serverInput.value);
    }

    function displayServerIds() {
      const explicit = explicitInputServerIds();
      if (explicit.length) return explicit;
      return TOPWAR.getCachedRemoteServerList?.()?.serverIds ?? [];
    }

    async function resolveSurveyServerIds() {
      const explicit = explicitInputServerIds();
      if (explicit.length) return explicit;

      const topwarApi = window.TOPWAR || TOPWAR;
      const cached = topwarApi?.getCachedRemoteServerList?.()?.serverIds ?? [];
      if (cached.length) return cached;

      const loader = topwarApi?.loadRemoteServerIds;
      if (typeof loader !== "function") return [];

      serverListLoading = true;
      lastServerListError = null;
      render();

      try {
        const ids = await loader.call(topwarApi, { maxAgeMs: 60 * 60 * 1000, debug: true });
        console.log("[TopWar V2.9.7 UI] 빈 서버 입력 - GitHub popular 목록 사용:", ids);
        return ids;
      } catch (error) {
        lastServerListError = error?.message || String(error);
        console.error("[TopWar V2.8 UI] GitHub 서버목록 로드 실패:", error);
        return [];
      } finally {
        serverListLoading = false;
        render();
      }
    }

    // UI/후속 add-on에서 동일한 서버 선택 규칙을 재사용한다.
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

    function collectNetworkThievesFromNew901(targetServerId, previousPacketRecords, destinationMap) {
      const output = destinationMap instanceof Map ? destinationMap : new Map();
      const previous = previousPacketRecords instanceof Set ? previousPacketRecords : new Set();
      let added = 0;
      let observed = 0;
      let packetCount = 0;

      for (const record of state.recentPackets || []) {
        if (previous.has(record)) continue;
        if (Number(record?.packet?.c) !== 901 || !record?.packet?.isDecoded) continue;

        const detail = record?.packet?.decoded?.parsedDetail ?? record?.packet?.decoded?.detail ?? null;
        if (!Array.isArray(detail?.pointList)) continue;
        packetCount++;

        const packetServerId = Number(detail?.k ?? targetServerId);
        if (Number.isFinite(packetServerId) && packetServerId !== Number(targetServerId)) continue;

        for (const point of detail.pointList) {
          if (Number(point?.pointType) !== 133) continue;

          const rawServerId = Number(
            point?.k ?? point?.p?.w ?? point?.p?.cMid ?? detail?.k ?? targetServerId
          );
          if (Number.isFinite(rawServerId) && rawServerId !== Number(targetServerId)) continue;

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
            time: record?.time ?? nowIso(),
            source: "network901"
          };

          if (!output.has(objectKey)) added++;
          output.set(objectKey, normalized);
        }
      }

      return { added, observed, packetCount, total: output.size, map: output };
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
      let moveIndex = 0;
      let failCount = 0;

      // 서버가 바뀔 때 이전 서버의 도둑/플레이어/901 캐시가 섞이지 않게 초기화한다.
      TOPWAR.clearCollected({ keepWatch: true });

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
          // 이 좌표 이동 전에 이미 존재하던 packet record를 기록한다.
          // 아래 도둑 수집에서는 이 Set에 없던 새 901만 검사한다.
          const packetRecordsBeforeMove = new Set(state.recentPackets || []);
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

          // 도둑은 이번 이동 후 새로 수신한 네트워크 901에서만 수집한다.
          // moveMapToStableUnified의 worldMapCache fallback 결과는 도둑 판정에 절대 사용하지 않는다.
          const thiefCollect = collectNetworkThievesFromNew901(
            targetServerId,
            packetRecordsBeforeMove,
            thiefMap
          );

          // 이 이동에서 실제 pointList를 가진 네트워크 901을 받았을 때만
          // 해당 scan cell을 "확인 완료"로 인정한다. cache fallback/실패 지점은
          // 기존 GitHub 좌표 삭제 범위에 절대 포함하지 않는다.
          if (Number(thiefCollect?.packetCount ?? 0) > 0) {
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

          if (newThieves.length > 0 && options.githubUpload !== false) {
            try {
              if (typeof TOPWAR.uploadDetectedThieves !== "function") {
                throw new Error("uploadDetectedThieves not installed");
              }

              // 새 도둑만 보내는 것이 아니라 "이번 회차에서 지금까지 실제로 확인된
              // 도둑 전체"를 함께 전달한다. 업로더는 confirmedScanCells에 속하는
              // 기존 GitHub 좌표 중 이 목록에 없는 행을 삭제하고 새 도둑을 upsert한다.
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
              console.error("[TopWar Unified Finder] 도둑 즉시 GitHub 업로드 실패:", error);
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
          console.error("[TopWar Unified Finder] 도둑 GitHub 업로드 실패:", error);
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
          console.error("[TopWar Unified Finder] 도시보상 GitHub 업로드 실패:", error);
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
      button.textContent = `${label} ${running ? "ON" : "OFF"}`;
      button.style.background = running ? "#0a9f4a" : "#555";
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
      button.style.background = enabled ? "#0a9f4a" : "#555";
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
      const remoteServerList = topwarApiForRender?.getCachedRemoteServerList?.();
      const shownServerIds = displayServerIds();
      const usingRemoteServerList = !explicitInputServerIds().length;

      const thiefUiSettings = loadThiefUiSettings();
      const tokenStatus = TOPWAR.githubTokenStatus?.() ?? { configured: false };
      const logStatus = window.TOPWAR_LOG_CONTROL?.status?.() ?? { programLogs: true, gameFontWarnings: true };

      setButton(thiefButton, !!watch.running, "도둑+보상");
      setButton(surveyButton, surveyRunning, surveyStopping ? "중지중" : "서버조사");
      setLogButton(programLogsButton, !!logStatus.programLogs, "프로그램 로그");
      setLogButton(gameFontLogsButton, !!logStatus.gameFontWarnings, "게임 폰트경고");

      thiefButton.disabled = surveyRunning || disconnected;
      surveyButton.disabled = (!!watch.running && !surveyRunning) || disconnected;

      thiefButton.style.opacity = thiefButton.disabled ? "0.55" : "1";
      surveyButton.style.opacity = surveyButton.disabled ? "0.55" : "1";
      githubTokenInput.disabled = !!(watch.running || surveyRunning || state.cityRewardFinder?.running);
      githubTokenInput.style.opacity = githubTokenInput.disabled ? "0.6" : "1";

      const thiefMulti = watch.multiServer || {};

      status.innerHTML = `
        서버: <b>${formatServerIdsForStatus(shownServerIds)}</b><br>
        서버목록: <b style="color:${serverListLoading ? "#ffd98a" : remoteServerList?.serverIds?.length ? "#66ff99" : "#aaa"}">${serverListLoading ? "GitHub 읽는 중" : remoteServerList?.serverIds?.length ? `popular ${remoteServerList.serverIds.length}개` : usingRemoteServerList ? "비우면 popular 자동로드" : "직접입력"}</b> / 파일순서 그대로${lastServerListError ? ` / 오류: ${lastServerListError}` : ""}<br>
        연결상태: <b style="color:${disconnected ? "#ff6666" : "#66ff99"}">${disconnected ? "연결 실패" : "정상"}</b>${connection.reason ? ` / ${connection.reason}` : ""}<br>
        GitHub: <b style="color:${tokenStatus.configured ? "#66ff99" : "#ff9999"}">${tokenStatus.configured ? "TOKEN 설정됨" : "TOKEN 필요"}</b><br>
        통합찾기: <b style="color:${watch.running ? "#66ff99" : "#ff9999"}">${watch.running ? "ON" : "OFF"}</b>${watch.running && thiefMulti.totalServers ? ` / 서버 ${thiefMulti.serverId ?? "-"} (${thiefMulti.serverIndex ?? 0}/${thiefMulti.totalServers})` : ""}<br>
        진행: ${watch.current?.totalMoves ? `맵 ${watch.current?.moveIndex ?? 0}/${watch.current.totalMoves}` : "-"} / 도둑 <b>${watch.current?.thiefCount ?? watch.lastUnifiedResult?.thiefCount ?? 0}</b> / 도시보상 <b>${watch.current?.rewardCount ?? watch.lastUnifiedResult?.rewardCount ?? 0}</b><br>
        GitHub: 도둑 <b>${watch.lastGithubUpload?.ok ? "✓" : watch.lastGithubUpload?.error ? "실패" : "-"}</b> / 도시보상 <b>${watch.lastRewardGithubUpload?.ok ? "✓" : watch.lastRewardGithubUpload?.error ? "실패" : "-"}</b><br>
        도둑 진행정리: 확인셀 <b>${watch.lastLiveThiefUpload?.confirmedCells ?? 0}</b> / 직전삭제 <b>${watch.lastLiveThiefUpload?.removedConfirmedMissing ?? 0}</b><br>
        로그: 프로그램 <b>${logStatus.programLogs ? "ON" : "OFF"}</b> / 게임 폰트경고 <b>${logStatus.gameFontWarnings ? "ON" : "OFF"}</b><br>
        큐 ${queue}
        / 처리 ${watch.handledKeys?.size ?? 0}
        / 공유좌표 ${watch.sharedLocationKeys?.size ?? 0}<br>
        서버조사: <b style="color:${surveyRunning ? "#66ff99" : "#ff9999"}">${surveyRunning ? "ON" : "OFF"}</b>
        ${surveyStopping ? " / 중지 요청됨" : ""}<br>
        단계: ${current.phase ?? state.fullScan?.phase ?? "-"}
        ${current.index ? ` (${current.index}/${current.total})` : ""}
        ${current.serverId ? ` / 서버 ${current.serverId}` : ""}<br>
        동맹: ${current.allianceTag ?? current.allianceName ?? current.allianceId ?? "-"}<br>
        플레이어: ${state.playerMap?.size ?? 0}
        / 동맹: ${state.allianceMap?.size ?? 0}<br>
        활동: CORE ${activitySummary.coreCount ?? "-"}
        / ACTIVE ${activitySummary.activeCount ?? "-"}
        / WATCH ${activitySummary.watchCount ?? "-"}
        / LOW ${activitySummary.lowCount ?? "-"}<br>
        서버활동: ${lastSummary.serverActivity?.grade ?? "-"}
        / 점수 ${lastSummary.serverActivity?.score ?? "-"}
        / 접음의심 ${lastSummary.userStatus?.quitLikelyUsers ?? "-"}
      `;
    }

    header.addEventListener("click", () => {
      folded = !folded;
      body.style.display = folded ? "none" : "block";
      fold.textContent = folded ? "펼치기 ▼" : "접기 ▲";
    });

    async function saveGithubTokenFromUi() {
      const candidate = String(githubTokenInput.value || "").trim();
      if (!candidate) {
        TOPWAR.setGithubToken?.("");
        render();
        return false;
      }

      githubTokenInput.disabled = true;
      try {
        const result = await TOPWAR.validateAndSaveGithubToken?.(candidate);
        if (!result?.ok) {
          githubTokenInput.value = "";
          alert(`GitHub token 검증 실패 (${result?.status ?? "?"}): ${result?.reason || "unknown error"}`);
          return false;
        }
        return true;
      } finally {
        githubTokenInput.disabled = false;
        render();
      }
    }

    githubTokenInput.addEventListener("change", event => {
      event.stopPropagation();
      void saveGithubTokenFromUi();
    });
    githubTokenInput.addEventListener("blur", () => { void saveGithubTokenFromUi(); });

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
          alert("서버조사가 진행 중입니다. 먼저 서버조사를 OFF 하세요.");
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

        surveyRunner.call(topwarApi || null, {
          serverIds,
          repeatUntilStopped: true,
          popularFirst: false,
          resortByPopularityEachCycle: false,
          // UI 자동실행은 실제 UID 서버이동 결과를 매 사이클마다 GitHub로 flush한다.
          trackActualInOut: true,
          flushCompactHistoryAfterEachCycle: true
        })
          .then(result => console.log("[TopWar V2.7 UI] 반복 서버조사 종료:", result))
          .catch(error => console.error("[TopWar V2.7 UI] 반복 서버조사 실패:", error));
      }

      render();
    });

    resetButton.addEventListener("click", event => {
      event.stopPropagation();

      if (state.ui.serverSurvey?.running || state.ui.serverSurveyBatch?.running) {
        alert("서버조사를 먼저 OFF 한 뒤 진행 위치를 초기화하세요.");
        return;
      }

      if (confirm("도둑 큐와 저장된 서버조사 진행 위치를 초기화할까요?\n\n초기화하지 않으면 다음 실행 시 저장된 서버부터 이어서 조사합니다.")) {
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
      throw new Error(`[GitHub API ${res.status}] ${data?.message || res.statusText}`);
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
    message
  }) {
    if (!token) throw new Error("GitHub token이 없습니다.");
    if (!owner) throw new Error("GitHub owner가 없습니다.");
    if (!repo) throw new Error("GitHub repo가 없습니다.");
    if (!path) throw new Error("GitHub 저장 path가 없습니다.");

    const encodedPath = encodeGithubPath(path);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;

    let sha = null;

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

    const body = {
      message,
      content: toBase64Utf8(content),
      branch
    };

    if (sha) {
      body.sha = sha;
    }

    return await githubRequest({
      method: "PUT",
      url: apiUrl,
      token,
      body
    });
  }

  async function uploadSurveyResultToGithub(data, options = {}) {
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

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (response.status === 404) {
      return {
        sha: null,
        data: { version: 1, updatedAt: null, count: 0, locations: [] }
      };
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`[GitHub GET ${response.status}] ${body?.message || response.statusText}`);
      error.status = response.status;
      error.data = body;
      throw error;
    }

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

    if (sha) payload.sha = sha;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`[GitHub PUT ${response.status}] ${body?.message || response.statusText}`);
      error.status = response.status;
      error.data = body;
      throw error;
    }

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
    await TOPWAR.ensureGithubToken?.({ interactive: true });
    const token = TOPWAR.getGithubToken?.() || "";
    if (!token) {
      return { ok: false, skipped: true, reason: "github token is not configured" };
    }

    const serverId = Number(targetServerId);
    if (!Number.isFinite(serverId) || serverId <= 0) {
      return { ok: false, skipped: true, reason: "invalid serverId" };
    }

    const observedAt = meta.detectedAt ?? new Date().toISOString();
    const detected = (Array.isArray(objects) ? objects : [])
      .map(obj => normalizeThiefLocation(obj, serverId, observedAt))
      .filter(Boolean);

    if (!detected.length) {
      return { ok: true, skipped: true, serverId, detected: 0, reason: "no new thieves" };
    }

    const commit = await commitThiefGithubMutation(
      token,
      existing => mergeDetectedThieves(existing, serverId, detected, meta.scanProgress ?? null),
      `Sync thief progress for server ${serverId} (${Number(meta?.scanProgress?.moveIndex ?? 0)}/${Number(meta?.scanProgress?.totalMoves ?? 0)})`,
      { maxAttempts: meta.githubConflictMaxAttempts ?? 5 }
    );
    const merged = commit.merged;
    const upload = commit.upload;

    return {
      ok: true,
      mode: "live-progress-sync",
      serverId,
      detected: detected.length,
      newDetected: Number(meta?.newDetectedCount ?? 0),
      removedConfirmedMissing: Number(merged.removedConfirmedMissing ?? 0),
      confirmedCells: Array.isArray(meta?.scanProgress?.confirmedScanCells)
        ? meta.scanProgress.confirmedScanCells.length
        : 0,
      moveIndex: Number(meta?.scanProgress?.moveIndex ?? 0),
      totalMoves: Number(meta?.scanProgress?.totalMoves ?? 0),
      totalCount: merged.count,
      githubAttempt: commit.attempt,
      path: GITHUB.path,
      htmlUrl: upload?.content?.html_url ?? null
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
    await TOPWAR.ensureGithubToken?.({ interactive: true });
    if (!serverResult?.completed || !serverResult?.ok) {
      return { ok: false, skipped: true, reason: "server scan not completed" };
    }

    const token = TOPWAR.getGithubToken?.() || "";
    if (!token) {
      return { ok: false, skipped: true, reason: "github token is not configured" };
    }

    const serverId = Number(serverResult?.serverId);
    if (!Number.isFinite(serverId) || serverId <= 0) {
      return { ok: false, skipped: true, reason: "invalid serverId" };
    }

    const commit = await commitThiefGithubMutation(
      token,
      existing => mergeCompletedServer(existing, serverResult),
      `Update thief locations for server ${serverId}`,
      { maxAttempts: serverResult.githubConflictMaxAttempts ?? 5 }
    );
    const merged = commit.merged;
    const upload = commit.upload;

    return {
      ok: true,
      serverId,
      found: serverResult.locations?.length ?? 0,
      totalCount: merged.count,
      githubAttempt: commit.attempt,
      path: GITHUB.path,
      htmlUrl: upload?.content?.html_url ?? null
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

  Object.assign(TOPWAR, {
    __thiefGithubUploaderInstalled: true,
    buildCompletedThiefServerResult,
    uploadDetectedThieves,
    uploadCompletedThiefServer,
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
    await closeVisiblePopups({
      maxRounds: options.closePopupRounds ?? 2,
      delay: options.closePopupDelay ?? 250
    });

    const picked = pickButton(scoreWorldButton, options.minScore ?? 80, !!options.debug);

    if (!picked.target) {
      return { ok: false, reason: "go world button not found", candidates: picked.candidates };
    }

    const clicked = TOPWAR.triggerCocosButtonSafe?.(picked.target.node) ?? false;
    const waitResult = await waitWorldMapReady({
      timeout: options.waitWorldTimeout ?? 12000,
      interval: options.waitWorldInterval ?? 300
    });

    return {
      ok: clicked && waitResult.ok,
      clicked,
      waitResult,
      target: {
        score: picked.target.score,
        nodeName: picked.target.nodeName,
        text: picked.target.text,
        path: picked.target.path
      }
    };
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
        state.fullScan.phase = "softReset";
        state.ui.serverSurveyBatch.current = {
          phase: "softReset",
          mode: session.mode,
          cycle,
          index: index + 1,
          total: serverIds.length,
          serverId,
          serverIds
        };

        if (normalizedOptions.softResetAfterServer !== false) {
          row.softReset = await performSoftMemoryReset({
            debug: !!normalizedOptions.softResetDebug,
            baseStayDelay: normalizedOptions.baseStayDelay ?? 8000,
            afterWorldDelay: normalizedOptions.afterWorldDelay ?? 4000,
            packetBufferLimit: normalizedOptions.packetBufferLimit ?? 20,
            outgoingBufferLimit: normalizedOptions.outgoingBufferLimit ?? 10
          });
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
          const storedGithubSettings = JSON.parse(
            localStorage.getItem("TOPWAR_GITHUB_JSON_UPLOAD_SETTINGS") || "{}"
          );

          if (storedGithubSettings.enabled && typeof TOPWAR.flushLocalCompactHistoryToGithub === "function") {
            cycleResult.compactHistoryFlush = await TOPWAR.flushLocalCompactHistoryToGithub({
              ...storedGithubSettings,
              ...normalizedOptions,
              trackActualInOut: normalizedOptions.trackActualInOut ?? true,
              flushCompactHistoryAfterEachCycle: true
            });
            console.log("[TopWar V2.10.0 UI] cycle compact history flush 완료:", {
              cycle,
              uploads: cycleResult.compactHistoryFlush?.uploads?.map(row => row.path) ?? []
            });
          } else {
            cycleResult.compactHistoryFlush = {
              ok: false,
              skipped: true,
              reason: storedGithubSettings.enabled
                ? "flushLocalCompactHistoryToGithub function is not ready"
                : "github upload disabled"
            };
            console.log("[TopWar V2.10.0 UI] cycle compact history flush 생략:", cycleResult.compactHistoryFlush.reason);
          }
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
    return {
      ...DEFAULT_FAST_POLICY,
      ...readStoredSettings(),
      ...options
    };
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
      return { type: "file", path, htmlUrl: uploaded?.content?.html_url ?? null, shaCached: !!sha };
    } catch (error) {
      // SHA가 오래되어 409가 날 수 있다. 이때만 다시 GET 후 1회 재시도한다.
      if (error.status !== 409) throw error;

      console.warn("[TopWar V2.9.3 Fast Storage] SHA 충돌 - 최신 SHA 재조회 후 재시도:", path);
      const current = await readGithubTextFile(settings, path);
      const uploaded = await putWithSha(current.sha);
      rememberSha(path, uploaded?.content?.sha ?? current.sha);
      return { type: "file", path, htmlUrl: uploaded?.content?.html_url ?? null, shaRefreshed: true };
    }
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
      const settings = getFastSettings(normalized);

      if (settings.flushCompactHistoryAfterEachCycle === true && settings.enabled) {
        try {
          result.compactHistoryFlush = await flushLocalCompactHistoryToGithub(settings);
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
    return Number.isFinite(number) ? number : Number(fallbackServerId);
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
    if (typeof TOPWAR.players === "function") {
      for (const player of TOPWAR.players()) {
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
      return { version: 3, updatedAt: null, count: 0, locations: [] };
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`[GitHub ${response.status}] ${body?.message || response.statusText}`);
    }

    const text = decodeBase64Utf8(body?.content || "");
    const parsed = parseJson(text, null);

    if (Array.isArray(parsed?.locations)) {
      return {
        version: Number(parsed.version || 3),
        updatedAt: parsed.updatedAt ?? null,
        count: parsed.locations.length,
        locations: parsed.locations.filter(row => isFreshReward(row))
      };
    }

    // 예전 servers[].locations 형식도 읽는다.
    if (Array.isArray(parsed?.servers)) {
      const locations = parsed.servers.flatMap(server =>
        Array.isArray(server?.locations)
          ? server.locations.filter(row => isFreshReward(row))
          : []
      );
      return { version: 3, updatedAt: parsed.updatedAt ?? null, count: locations.length, locations };
    }

    return { version: 3, updatedAt: null, count: 0, locations: [] };
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
    await TOPWAR.ensureGithubToken?.({ interactive: true });
    const token = githubToken();
    if (!token) throw new Error("GitHub token이 없습니다. 통합 패널에서 한 번 입력하세요.");
    if (!serverResult?.completed || !serverResult?.ok) {
      return { ok: false, skipped: true, reason: "server scan not completed" };
    }

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
      message: `Update cityReward locations for server ${serverResult.serverId}`
    });

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
      button.textContent = "cityReward 스캔";
      button.style.cssText = "height:40px;border:0;border-radius:8px;background:#5b4700;color:#ffe082;font-size:12px;font-weight:800;cursor:pointer;min-width:0;";
      actionGroup.appendChild(button);
    }

    // 상세 진행 상태는 버튼 그룹 바로 아래에 작게 유지한다.
    if (!box) {
      box = document.createElement("div");
      box.id = BOX_ID;
      box.style.cssText = "margin-top:6px;padding:6px 8px;border-radius:6px;background:rgba(255,193,7,0.06);border:1px solid rgba(255,193,7,0.18);";
      status = document.createElement("div");
      status.id = STATUS_ID;
      status.style.cssText = "font-size:11px;line-height:1.4;color:#d8d8d8;word-break:break-word;";
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

      if (reward.running) {
        button.textContent = reward.stopRequested ? "cityReward 중지중..." : "cityReward 스캔 OFF";
        button.style.background = reward.stopRequested ? "#6d4c41" : "#b71c1c";
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
        button.textContent = "cityReward 스캔";
        button.style.background = "#5b4700";
        button.style.color = "#ffe082";

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
