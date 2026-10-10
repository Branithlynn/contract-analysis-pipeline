import { pino, type DestinationStream, type LevelWithSilent, type Logger } from "pino";

export type { Logger };

export const REDACT_PATHS = [
  "req.headers.authorization",
  "headers.authorization",
  // pino's * matches exactly one level, so the top level keys need their own paths.
  "apiKey",
  "api_key",
  "*.apiKey",
  "*.api_key",
];

// destination is only there so tests can capture output; services log to stdout.
export function createLogger(
  service: string,
  level: LevelWithSilent,
  destination?: DestinationStream,
): Logger {
  const options = {
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: REDACT_PATHS,
  };
  return destination ? pino(options, destination) : pino(options);
}
