export type { LogLevel, LogEntry, LogProvider, ILogger, ILoggerFactory } from './types.js';
export { LoggerFactory } from './factory.js';
export { ConsoleLogProvider } from './console-provider.js';

/**
 * DI token for the {@link ILoggerFactory}. Inject it into a service or
 * controller with `@inject(LOGGER_FACTORY)` to obtain category-scoped loggers.
 */
export const LOGGER_FACTORY: unique symbol = Symbol('TypeMVC.ILoggerFactory');
