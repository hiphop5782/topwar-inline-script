import { TopWarError } from "../../core/errors.js";

const DB_NAME = "TOPWAR_UNIFIED_ALPHA";
const DB_VERSION = 1;
const STORE = "top100Sessions";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

export class Top100Repository {
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
    const value = { ...session, updatedAt: new Date().toISOString() };
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
}
