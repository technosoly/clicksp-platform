/**
 * Minimal structured JSON logger (one line per event on stdout), suitable for
 * Docker log collection. Never pass secrets, tokens or personal data in `fields`.
 */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): Level {
  const v = process.env.LOG_LEVEL;
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (order[level] < order[threshold()]) return;
  const line = JSON.stringify(
    { time: new Date().toISOString(), level, message, ...fields },
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
  );
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
};
