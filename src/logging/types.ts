/** Severity levels for the logging system, from most to least verbose; `silent` disables output. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** A single structured log record passed to a {@link LogProvider}. */
export interface LogEntry {
  readonly level: LogLevel;
  readonly category: string;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly error?: Error;
  readonly timestamp: number;
}

/** A log sink. Implement this to route framework log entries to a custom destination. */
export interface LogProvider {
  log(entry: LogEntry): void;
}

/** A category-scoped logger. Obtain one from an {@link ILoggerFactory}. */
export interface ILogger {
  debug(message: string, meta?: Readonly<Record<string, unknown>>): void;
  info(message: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
  error(message: string, error?: Error): void;
}

/** Creates category-scoped {@link ILogger} instances. Resolve it from DI via the `LOGGER_FACTORY` token. */
export interface ILoggerFactory {
  create(category: string): ILogger;
}
