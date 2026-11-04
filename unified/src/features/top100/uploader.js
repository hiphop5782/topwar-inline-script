import { TopWarError } from "../../core/errors.js";

const SETTINGS_KEY = "TOPWAR_UNIFIED_DATAHUB_V1";

function requestId(value) {
  return value || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

export class DataHubTop100Uploader {
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
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
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
}
