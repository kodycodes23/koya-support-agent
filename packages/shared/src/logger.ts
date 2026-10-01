import { pino, type Logger } from "pino";

export type { Logger };

/**
 * Structured JSON logger. Pretty-prints only in an interactive dev terminal
 * (and only if pino-pretty is installed); production output stays JSON.
 */
export function createLogger(service: string, level: string = process.env.LOG_LEVEL ?? "info"): Logger {
  const pretty = process.env.NODE_ENV !== "production" && process.stdout.isTTY && process.env.LOG_PRETTY !== "0";
  return pino({
    name: service,
    level,
    base: { service },
    redact: {
      paths: ["*.authorization", "*.apiKey", "*.api_key", "*.password", "*.SUPABASE_SERVICE_ROLE_KEY", "headers.authorization"],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  });
}
