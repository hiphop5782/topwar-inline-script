import { downloadJson } from "../core/download.js";
import { STYLES } from "./styles.js";

function element(id) {
  return document.getElementById(id);
}

function formatError(error) {
  const code = error?.code ? `[${error.code}] ` : "";
  return `${code}${error?.message || String(error)}`;
}

export class UnifiedPanel {
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
    runtimeStatus.textContent = task.status === "idle"
      ? "대기 중"
      : `${task.status} · ${task.taskId} · ${task.startedAt}`;
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
      const state = validation?.ok
        ? "검증 통과"
        : validation
          ? `검증 실패: ${validation.errors.map(row => row.code).join(", ") || "경고만 있음"}`
          : "수집 대기";
      sessionStatus.textContent = `${session.serverId} 서버 · ${state}\n${session.runId}`;
      sessionStatus.dataset.tone = validation?.ok ? "success" : validation ? "error" : "warning";
    }

    const uploadStatus = element("twu-upload-status");
    const uploader = this.#runtime.uploader.status();
    const uploaded = session?.upload;
    uploadStatus.textContent = uploaded?.completed
      ? "서버 ACK 및 배치 완료 ACK 수신"
      : uploaded?.serverAcknowledged
        ? "서버 ACK 수신 · 배치 완료 재시도 필요"
        : uploader.configured
          ? `${uploader.scannerId} · Token 메모리 설정됨`
          : "조사기 ID와 Token을 설정하세요.";
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
      element("twu-inspect-status").textContent =
        `화면 ${this.#lastInspection.activeScreen} · 노드 ${summary.nodes}, 컴포넌트 ${summary.components}, 버튼 ${summary.buttons}\n` +
        Object.entries(known).map(([name, count]) => `${name}: ${count.active}/${count.total}`).join("\n");
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
      element("twu-session-status").textContent =
        `${result.kind === "players" ? "개인" : "길드"} 랭킹을 캡처했습니다.`;
    }, "twu-session-status"));
    on("twu-ranks-auto", "click", () => run("top100-ranks-auto", async ({ signal }) => {
      const validation = await this.#runtime.top100.collectRanksAutomatically({ signal });
      element("twu-session-status").textContent = validation.ok
        ? "개인·길드 랭킹 자동 수집 및 검증 완료"
        : validation.errors.map(row => `[${row.code}] ${row.message}`).join("\n");
    }, "twu-session-status"));
    on("twu-validate", "click", () => run("top100-validation", async () => {
      const result = await this.#runtime.top100.validate();
      element("twu-session-status").textContent = result.ok
        ? "검증을 통과했습니다."
        : result.errors.map(row => `[${row.code}] ${row.message}`).join("\n");
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
    on("twu-upload", "click", () => run("top100-upload", async ({ signal }) => {
      await this.#runtime.top100.upload({ signal });
    }, "twu-upload-status"));

    document.addEventListener("keydown", event => {
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
    container.replaceChildren(...rows.map(row => {
      const item = document.createElement("div");
      item.className = "twu-log";
      item.dataset.level = row.level;
      item.textContent = `${row.at.slice(11, 19)} ${row.message}`;
      item.title = row.details ? JSON.stringify(row.details, null, 2) : "";
      return item;
    }));
  }
}
