import { EventBus } from "./core/event-bus.js";
import { Logger } from "./core/logger.js";
import { TaskRunner } from "./core/task-runner.js";
import { CocosAdapter } from "./adapters/cocos-adapter.js";
import { Top100Repository } from "./features/top100/repository.js";
import { DataHubTop100Uploader } from "./features/top100/uploader.js";
import { Top100Service } from "./features/top100/service.js";
import { validateTop100Session } from "./features/top100/validator.js";
import { UnifiedPanel } from "./app/panel.js";

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
