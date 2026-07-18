// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { persisted } from '../../src/behaviors/persisted.js';
import { effect, _withOwner } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';

// Every persisted() call outside a component owner scope registers teardown with
// onCleanup, which warns that it has no owner. Suppress console.warn here and let
// individual tests inspect the spy for the specific message they assert on.
let warnSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  localStorage.clear();
  flush();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fireStorage(key: string, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

function warnedWith(substring: string): boolean {
  return warnSpy.mock.calls.some(
    (call) => typeof call[0] === 'string' && call[0].includes(substring),
  );
}

describe('persisted: seeding', () => {
  it('seeds from the stored value when one exists', () => {
    localStorage.setItem('theme', JSON.stringify('dark'));
    const theme = persisted<'light' | 'dark'>('theme', 'light');
    expect(theme.get()).toBe('dark');
  });

  it('seeds from the initial value when nothing is stored', () => {
    const theme = persisted<'light' | 'dark'>('theme', 'light');
    expect(theme.get()).toBe('light');
  });
});

describe('persisted: writing', () => {
  it('writes to storage on set and the value round-trips', () => {
    const count = persisted('count', 0);
    count.set(7);
    expect(localStorage.getItem('count')).toBe('7');

    const reloaded = persisted('count', 0);
    expect(reloaded.get()).toBe(7);
  });

  it('writes on update as well', () => {
    const count = persisted('count', 1);
    count.update((n) => n + 4);
    expect(count.get()).toBe(5);
    expect(localStorage.getItem('count')).toBe('5');
  });

  it('drives an effect when the value changes', () => {
    const count = persisted('count', 0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count.get());
    });
    count.set(1);
    flush();
    expect(seen).toEqual([0, 1]);
  });
});

describe('persisted: cross-tab sync', () => {
  it('updates the signal on a storage event from another tab', () => {
    const theme = persisted('theme', 'light');
    fireStorage('theme', JSON.stringify('dark'));
    expect(theme.get()).toBe('dark');
  });

  it('ignores a storage event for a different key', () => {
    const theme = persisted('theme', 'light');
    fireStorage('other', JSON.stringify('dark'));
    expect(theme.get()).toBe('light');
  });

  it('resets to the initial value when the key is cleared elsewhere', () => {
    const theme = persisted('theme', 'light');
    theme.set('dark');
    fireStorage('theme', null);
    expect(theme.get()).toBe('light');
  });
});

describe('persisted: corrupt value', () => {
  it('falls back to the initial value and warns without throwing', () => {
    localStorage.setItem('theme', 'this is not json');
    const theme = persisted('theme', 'light');
    expect(theme.get()).toBe('light');
    expect(warnedWith('deserialize')).toBe(true);
  });
});

describe('persisted: storage unavailable', () => {
  it('degrades to an in-memory signal with a warning and keeps running', () => {
    vi.stubGlobal('localStorage', undefined);

    const theme = persisted('theme', 'light');
    expect(theme.get()).toBe('light');
    theme.set('dark');
    expect(theme.get()).toBe('dark');
    expect(warnedWith('no localStorage')).toBe(true);
  });
});

describe('persisted: custom serialiser', () => {
  const opts = {
    serialize: (v: { x: number; y: number }): string => `${String(v.x)},${String(v.y)}`,
    deserialize: (raw: string): { x: number; y: number } => {
      const [x, y] = raw.split(',');
      return { x: Number(x), y: Number(y) };
    },
  };

  it('uses a supplied serialize and deserialize pair', () => {
    const point = persisted('point', { x: 1, y: 2 }, opts);
    point.set({ x: 3, y: 4 });
    expect(localStorage.getItem('point')).toBe('3,4');

    const reloaded = persisted('point', { x: 0, y: 0 }, opts);
    expect(reloaded.get()).toEqual({ x: 3, y: 4 });
  });
});

describe('persisted: disposal', () => {
  it('removes the storage listener on the returned dispose', () => {
    const theme = persisted('theme', 'light');
    theme.dispose();
    fireStorage('theme', JSON.stringify('dark'));
    expect(theme.get()).toBe('light');
  });

  it('registers teardown with onCleanup so the owner scope disposes it', () => {
    let captured: ReturnType<typeof persisted<string>> | null = null;
    const { disposes } = _withOwner(() => {
      captured = persisted('theme', 'light');
    });
    const theme = captured as unknown as ReturnType<typeof persisted<string>>;

    for (const dispose of disposes) dispose();
    fireStorage('theme', JSON.stringify('dark'));
    expect(theme.get()).toBe('light');
  });

  it('is usable from a service with no owner scope: it returns a dispose and does not warn', () => {
    const theme = persisted('theme', 'light');
    expect(typeof theme.dispose).toBe('function');
    // No owner scope, but a clean call (storage present, value valid) is silent:
    // the service holds the dispose and does not trip the no-owner warning.
    expect(warnSpy).not.toHaveBeenCalled();
    theme.dispose();
  });
});
