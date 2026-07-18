import type { ILogger, ILoggerFactory, LogLevel, LogProvider } from './types.js';

const LEVEL_ORDER = Object.create(null) as Record<LogLevel, number>;
LEVEL_ORDER.debug = 0;
LEVEL_ORDER.info = 1;
LEVEL_ORDER.warn = 2;
LEVEL_ORDER.error = 3;
LEVEL_ORDER.silent = 4;

function passes(entryLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LEVEL_ORDER[entryLevel] >= LEVEL_ORDER[configuredLevel];
}

class BoundLogger implements ILogger {
  readonly #category: string;
  readonly #level: LogLevel;
  readonly #provider: LogProvider;

  constructor(category: string, level: LogLevel, provider: LogProvider) {
    this.#category = category;
    this.#level = level;
    this.#provider = provider;
  }

  debug(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.#emit('debug', message, meta, undefined);
  }

  info(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.#emit('info', message, meta, undefined);
  }

  warn(message: string, meta?: Readonly<Record<string, unknown>>): void {
    this.#emit('warn', message, meta, undefined);
  }

  error(message: string, error?: Error): void {
    this.#emit('error', message, undefined, error);
  }

  #emit(
    level: LogLevel,
    message: string,
    meta: Readonly<Record<string, unknown>> | undefined,
    error: Error | undefined,
  ): void {
    if (!passes(level, this.#level)) return;
    const category = this.#category;
    const timestamp = Date.now();
    if (meta !== undefined && error !== undefined) {
      this.#provider.log({ level, category, message, timestamp, meta, error });
    } else if (meta !== undefined) {
      this.#provider.log({ level, category, message, timestamp, meta });
    } else if (error !== undefined) {
      this.#provider.log({ level, category, message, timestamp, error });
    } else {
      this.#provider.log({ level, category, message, timestamp });
    }
  }
}

export class LoggerFactory implements ILoggerFactory {
  readonly #level: LogLevel;
  readonly #provider: LogProvider;

  constructor(level: LogLevel, provider: LogProvider) {
    this.#level = level;
    this.#provider = provider;
  }

  create(category: string): ILogger {
    return new BoundLogger(category, this.#level, this.#provider);
  }
}
