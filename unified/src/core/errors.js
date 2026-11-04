export class TopWarError extends Error {
  constructor(code, message, details = null, options = {}) {
    super(message, options);
    this.name = "TopWarError";
    this.code = code;
    this.details = details;
  }
}

export function asTopWarError(error, fallbackCode = "UNKNOWN") {
  if (error instanceof TopWarError) return error;
  return new TopWarError(
    fallbackCode,
    error?.message || String(error),
    null,
    { cause: error }
  );
}
