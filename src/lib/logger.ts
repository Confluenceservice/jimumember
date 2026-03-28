import pino from "pino";

// Global base logger — always JSON, always structured
const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
});

type LogMeta = Record<string, unknown>;

export const logger = {
  info: (msg: string, meta?: LogMeta) => baseLogger.info(meta, msg),
  warn: (msg: string, meta?: LogMeta) => baseLogger.warn(meta, msg),
  error: (msg: string, meta?: LogMeta) => baseLogger.error(meta, msg),
  debug: (msg: string, meta?: LogMeta) => baseLogger.debug(meta, msg),

  // Child logger with preset context (e.g., a specific webhook invocation)
  child: (meta: LogMeta) => ({
    info: (msg: string, extra?: LogMeta) => baseLogger.child(meta).info(extra, msg),
    warn: (msg: string, extra?: LogMeta) => baseLogger.child(meta).warn(extra, msg),
    error: (msg: string, extra?: LogMeta) => baseLogger.child(meta).error(extra, msg),
    debug: (msg: string, extra?: LogMeta) => baseLogger.child(meta).debug(extra, msg),
  }),
};
