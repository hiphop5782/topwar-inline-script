const MAX_LOGS = 300;

export class Logger {
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
      at: new Date().toISOString(),
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
}
