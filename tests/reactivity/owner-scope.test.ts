import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal, effect, onCleanup, _withOwner } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';

beforeEach(() => {
  flush();
});

// ---------------------------------------------------------------------------
// _withOwner -- collection of effects and cleanups
// ---------------------------------------------------------------------------

describe('_withOwner', () => {
  it('collects effects created during the call and disposes them (AC1)', () => {
    const s = signal(0);
    let runs = 0;
    const { disposes } = _withOwner(() => {
      effect(() => {
        s.get();
        runs++;
      });
    });

    expect(runs).toBe(1);
    s.set(1);
    flush();
    expect(runs).toBe(2);

    for (const dispose of disposes) dispose();
    s.set(2);
    flush();
    expect(runs).toBe(2);
  });

  it('collects onCleanup callbacks registered during the call', () => {
    let cleaned = 0;
    const { disposes } = _withOwner(() => {
      onCleanup(() => {
        cleaned++;
      });
    });

    expect(cleaned).toBe(0);
    for (const dispose of disposes) dispose();
    expect(cleaned).toBe(1);
  });

  it('returns the function result as value', () => {
    const { value } = _withOwner(() => 42);
    expect(value).toBe(42);
  });

  it('restores the previous owner after the call so nested scopes are isolated (AC6)', () => {
    let innerCollected = 0;
    const outer = _withOwner(() => {
      const inner = _withOwner(() => {
        effect(() => {
          /* tracked by the inner owner only */
          void 0;
        });
      });
      innerCollected = inner.disposes.length;
      effect(() => {
        /* tracked by the outer owner */
        void 0;
      });
    });

    expect(innerCollected).toBe(1);
    expect(outer.disposes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Effects created outside an owner scope are unaffected (AC3)
// ---------------------------------------------------------------------------

describe('effects outside an owner scope (AC3)', () => {
  it('are not collected and behave normally', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });

    s.set(1);
    flush();
    expect(runs).toBe(2);

    dispose();
    s.set(2);
    flush();
    expect(runs).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// onCleanup outside an owner scope (AC5)
// ---------------------------------------------------------------------------

describe('onCleanup outside an owner scope (AC5)', () => {
  it('is a no-op and warns in DEV', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* suppress */
    });
    let called = 0;
    onCleanup(() => {
      called++;
    });

    expect(called).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('onCleanup'));
    warn.mockRestore();
  });
});
