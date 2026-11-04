import { TopWarError, asTopWarError } from "./errors.js";

export class TaskRunner {
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
      startedAt: new Date().toISOString(),
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
      const normalized = controller.signal.aborted
        ? new TopWarError("TASK_ABORTED", `작업이 중지되었습니다: ${taskId}`, {
            reason: controller.signal.reason
          }, { cause: error })
        : asTopWarError(error, "TASK_FAILED");
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
}
