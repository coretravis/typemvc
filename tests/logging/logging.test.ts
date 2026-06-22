import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoggerFactory } from '../../src/logging/factory.js';
import { ConsoleLogProvider } from '../../src/logging/console-provider.js';
import { LOGGER_FACTORY } from '../../src/logging/index.js';
import type { LogEntry, LogProvider } from '../../src/logging/types.js';

// ---------------------------------------------------------------------------
// Spy provider
// ---------------------------------------------------------------------------

class SpyProvider implements LogProvider {
  readonly entries: LogEntry[] = [];
  log(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

// ---------------------------------------------------------------------------
// Level filtering:all six transitions
// ---------------------------------------------------------------------------

describe('LoggerFactory: level filtering', () => {
  it('passes debug entry when level is debug', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('debug', spy).create('T');
    log.debug('hello');
    expect(spy.entries.length).toBe(1);
  });

  it('blocks debug entry when level is info', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('info', spy).create('T');
    log.debug('hello');
    expect(spy.entries.length).toBe(0);
  });

  it('passes info entry when level is info', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('info', spy).create('T');
    log.info('hello');
    expect(spy.entries.length).toBe(1);
  });

  it('blocks info entry when level is warn', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('warn', spy).create('T');
    log.info('hello');
    expect(spy.entries.length).toBe(0);
  });

  it('passes warn entry when level is warn', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('warn', spy).create('T');
    log.warn('hello');
    expect(spy.entries.length).toBe(1);
  });

  it('blocks error entry when level is silent', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('silent', spy).create('T');
    log.error('hello');
    expect(spy.entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Factory creates distinct loggers per category
// ---------------------------------------------------------------------------

describe('LoggerFactory: distinct categories', () => {
  it('stamps each entry with the category passed to create()', () => {
    const spy = new SpyProvider();
    const factory = new LoggerFactory('debug', spy);
    factory.create('TypeMVC.Router').info('from router');
    factory.create('TypeMVC.Container').info('from container');
    expect(spy.entries[0]?.category).toBe('TypeMVC.Router');
    expect(spy.entries[1]?.category).toBe('TypeMVC.Container');
  });

  it('loggers from the same factory share the configured level', () => {
    const spy = new SpyProvider();
    const factory = new LoggerFactory('error', spy);
    factory.create('A').warn('filtered');
    factory.create('B').error('passes');
    expect(spy.entries.length).toBe(1);
    expect(spy.entries[0]?.category).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// Custom provider receives entries
// ---------------------------------------------------------------------------

describe('LoggerFactory: custom provider', () => {
  it('routes all passing entries to the configured provider', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('debug', spy).create('T');
    log.warn('test');
    expect(spy.entries.length).toBe(1);
    expect(spy.entries[0]?.message).toBe('test');
  });

  it('does not call any other provider', () => {
    const spy = new SpyProvider();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = new LoggerFactory('debug', spy).create('T');
    log.warn('test');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// silent suppresses all
// ---------------------------------------------------------------------------

describe('LoggerFactory: silent suppresses all', () => {
  it('blocks debug, info, warn, and error', () => {
    const spy = new SpyProvider();
    const log = new LoggerFactory('silent', spy).create('T');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(spy.entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LogEntry fields
// ---------------------------------------------------------------------------

describe('LoggerFactory: LogEntry fields', () => {
  it('sets level, category, message, and timestamp', () => {
    const spy = new SpyProvider();
    const before = Date.now();
    new LoggerFactory('debug', spy).create('Cat').warn('msg');
    const after = Date.now();
    const e = spy.entries[0];
    expect(e?.level).toBe('warn');
    expect(e?.category).toBe('Cat');
    expect(e?.message).toBe('msg');
    expect(e?.timestamp).toBeGreaterThanOrEqual(before);
    expect(e?.timestamp).toBeLessThanOrEqual(after);
  });

  it('includes meta when provided', () => {
    const spy = new SpyProvider();
    new LoggerFactory('debug', spy).create('T').info('msg', { key: 'val' });
    expect(spy.entries[0]?.meta).toEqual({ key: 'val' });
  });

  it('omits meta when not provided', () => {
    const spy = new SpyProvider();
    new LoggerFactory('debug', spy).create('T').info('msg');
    expect('meta' in (spy.entries[0] ?? {})).toBe(false);
  });

  it('includes error when provided to error()', () => {
    const spy = new SpyProvider();
    const err = new Error('boom');
    new LoggerFactory('debug', spy).create('T').error('msg', err);
    expect(spy.entries[0]?.error).toBe(err);
  });
});

// ---------------------------------------------------------------------------
// ConsoleLogProvider:correct console.* method per level
// ---------------------------------------------------------------------------

describe('ConsoleLogProvider: console method routing', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls console.debug for debug entries', () => {
    new ConsoleLogProvider().log({ level: 'debug', category: 'T', message: 'msg', timestamp: 0 });
    expect(debugSpy).toHaveBeenCalledOnce();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('calls console.info for info entries', () => {
    new ConsoleLogProvider().log({ level: 'info', category: 'T', message: 'msg', timestamp: 0 });
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('calls console.warn for warn entries', () => {
    new ConsoleLogProvider().log({ level: 'warn', category: 'T', message: 'msg', timestamp: 0 });
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('calls console.error for error entries', () => {
    new ConsoleLogProvider().log({ level: 'error', category: 'T', message: 'msg', timestamp: 0 });
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('passes the error object as a second argument when present', () => {
    const err = new Error('oops');
    new ConsoleLogProvider().log({ level: 'error', category: 'T', message: 'msg', timestamp: 0, error: err });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[T] msg'), err);
  });

  it('includes category in the formatted message', () => {
    new ConsoleLogProvider().log({ level: 'info', category: 'TypeMVC.Router', message: 'nav', timestamp: 0 });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[TypeMVC.Router]'));
  });

  it('does not call any console method for silent entries', () => {
    new ConsoleLogProvider().log({ level: 'silent', category: 'T', message: 'msg', timestamp: 0 });
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// LOGGER_FACTORY DI token
// ---------------------------------------------------------------------------

describe('LOGGER_FACTORY token', () => {
  it('is a unique symbol', () => {
    expect(typeof LOGGER_FACTORY).toBe('symbol');
  });

  it('has a descriptive name', () => {
    expect(LOGGER_FACTORY.description).toBe('TypeMVC.ILoggerFactory');
  });
});
