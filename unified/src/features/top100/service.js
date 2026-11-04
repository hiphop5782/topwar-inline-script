import { TopWarError } from "../../core/errors.js";
import { createTop100Session, buildTop100Payload } from "./model.js";
import { mapPlayerRow, mapAllianceRow, fingerprintRows } from "./row-mapper.js";
import { validateTop100Session } from "./validator.js";

function activeRows(component) {
  const rows = component?._rankList;
  if (!Array.isArray(rows)) {
    throw new TopWarError("RANK_DATA_MISSING", "활성 랭킹 화면의 _rankList가 배열이 아닙니다.");
  }
  return Array.from(rows);
}

export class Top100Service {
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
    const capturedAt = new Date().toISOString();

    if (kind === "players") {
      const mapped = rows.slice(0, 100)
        .map((row, index) => mapPlayerRow(row, index, this.#session.serverId));
      this.#session.players = mapped;
      this.#session.captures.players = {
        capturedAt,
        receivedCount: rows.length,
        savedCount: mapped.length,
        fingerprint: fingerprintRows(mapped, row => `${row.rank}:${row.uid}:${row.cp}`)
      };
    } else {
      const mapped = rows.slice(0, 10)
        .map((row, index) => mapAllianceRow(row, index, this.#session.serverId));
      this.#session.alliances = mapped;
      this.#session.captures.alliances = {
        capturedAt,
        receivedCount: rows.length,
        savedCount: mapped.length,
        fingerprint: fingerprintRows(mapped, row => `${row.rank}:${row.aid}:${row.cp}`)
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
        this.#session.upload.serverAcknowledgedAt = new Date().toISOString();
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
        this.#session.upload.completedAt = new Date().toISOString();
        this.#session.upload.lastError = null;
        this.#session = await this.#repository.save(this.#session);
        this.#logger.info("TOP100 배치 완료 ACK 수신", { batchId: this.#session.batchId });
      }
      return this.#session.upload;
    } catch (error) {
      this.#session.upload.lastError = {
        at: new Date().toISOString(),
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
}
