// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mediaQuery, matchesMedia } from '../../src/behaviors/media-query.js';
import { effect, _withOwner } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';

// A controllable matchMedia fake: it records the change listener so a test can
// flip the match and fire it, and counts add/remove so disposal is assertable.
interface FakeList {
  query: string;
  matches: boolean;
  listeners: ((event: { matches: boolean }) => void)[];
  added: number;
  removed: number;
}

let fake: FakeList;

function installMatchMedia(initial: boolean): void {
  fake = { query: '', matches: initial, listeners: [], added: 0, removed: 0 };
  vi.stubGlobal('matchMedia', (query: string) => {
    fake.query = query;
    return {
      matches: fake.matches,
      addEventListener: (_type: string, cb: (event: { matches: boolean }) => void): void => {
        fake.listeners.push(cb);
        fake.added++;
      },
      removeEventListener: (_type: string, cb: (event: { matches: boolean }) => void): void => {
        fake.listeners = fake.listeners.filter((l) => l !== cb);
        fake.removed++;
      },
    };
  });
}

function fireChange(matches: boolean): void {
  fake.matches = matches;
  for (const l of [...fake.listeners]) l({ matches });
}

beforeEach(() => {
  flush();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mediaQuery: current match', () => {
  it('reflects the current match on creation', () => {
    installMatchMedia(true);
    const narrow = mediaQuery('(max-width: 640px)');
    expect(narrow.get()).toBe(true);
    expect(fake.query).toBe('(max-width: 640px)');
  });

  it('updates when the match changes', () => {
    installMatchMedia(false);
    const narrow = mediaQuery('(max-width: 640px)');
    const seen: boolean[] = [];
    effect(() => {
      seen.push(narrow.get());
    });
    fireChange(true);
    flush();
    expect(narrow.get()).toBe(true);
    expect(seen).toEqual([false, true]);
  });
});

describe('mediaQuery: disposal', () => {
  it('removes the change listener on the returned dispose', () => {
    installMatchMedia(false);
    const narrow = mediaQuery('(max-width: 640px)');
    expect(fake.added).toBe(1);
    narrow.dispose();
    expect(fake.removed).toBe(1);
    fireChange(true);
    expect(narrow.get()).toBe(false);
  });

  it('registers teardown with onCleanup so the owner scope disposes it', () => {
    installMatchMedia(false);
    let captured: ReturnType<typeof mediaQuery> | null = null;
    const { disposes } = _withOwner(() => {
      captured = mediaQuery('(max-width: 640px)');
    });
    const narrow = captured as unknown as ReturnType<typeof mediaQuery>;

    for (const dispose of disposes) dispose();
    expect(fake.removed).toBe(1);
    fireChange(true);
    expect(narrow.get()).toBe(false);
  });
});

describe('mediaQuery: matchMedia absent', () => {
  it('holds false and never updates', () => {
    vi.stubGlobal('matchMedia', undefined);
    const narrow = mediaQuery('(max-width: 640px)');
    expect(narrow.get()).toBe(false);
    expect(() => {
      narrow.dispose();
    }).not.toThrow();
  });
});

describe('matchesMedia: one-shot read shared with the router', () => {
  it('reports the current match', () => {
    installMatchMedia(true);
    expect(matchesMedia('(prefers-reduced-motion: reduce)')).toBe(true);
  });

  it('returns false when matchMedia is absent', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(matchesMedia('(prefers-reduced-motion: reduce)')).toBe(false);
  });
});
