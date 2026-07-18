import type { LogEntry, LogProvider } from './types.js';

export class ConsoleLogProvider implements LogProvider {
  log(entry: LogEntry): void {
    const metaPart = entry.meta !== undefined ? ` ${JSON.stringify(entry.meta)}` : '';
    const msg = `[${entry.category}] ${entry.message}${metaPart}`;
    switch (entry.level) {
      case 'debug':
        if (entry.error !== undefined) {
          console.debug(msg, entry.error);
        } else {
          console.debug(msg);
        }
        return;
      case 'info':
        if (entry.error !== undefined) {
          console.info(msg, entry.error);
        } else {
          console.info(msg);
        }
        return;
      case 'warn':
        if (entry.error !== undefined) {
          console.warn(msg, entry.error);
        } else {
          console.warn(msg);
        }
        return;
      case 'error':
        if (entry.error !== undefined) {
          console.error(msg, entry.error);
        } else {
          console.error(msg);
        }
        return;
      case 'silent':
        return;
    }
  }
}
