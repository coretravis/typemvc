import { describe, it, expect, vi } from 'vitest';
import { assembleContext } from '../../src/core/context.js';
import { ContextData } from '../../src/core/context-data.js';
import { Fragment } from '../../src/renderer/fragment.js';
import type { ActionErrorTarget, IRouter } from '../../src/types/index.js';
import { signal } from '../../src/reactivity/signal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRouter(overrides?: Partial<IRouter>): IRouter {
  return {
    navigateTo: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    current: '/test',
    ...overrides,
  };
}

function makeErrors(): ActionErrorTarget {
  return { action: null };
}

// ---------------------------------------------------------------------------
// context.data
// ---------------------------------------------------------------------------

describe('context.data', () => {
  it('exposes values set on ContextData', () => {
    const data = new ContextData();
    data.set('title', 'Hello');
    data.set('count', 42);
    const ctx = assembleContext(null, data, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(ctx.data.title).toBe('Hello');
    expect(ctx.data.count).toBe(42);
  });

  it('exposes signal values by reference', () => {
    const data = new ContextData();
    const count = signal(0);
    data.set('count', count);
    const ctx = assembleContext(null, data, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(ctx.data.count).toBe(count);
  });

  it('returns an empty record when ContextData is null', () => {
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(Object.keys(ctx.data)).toHaveLength(0);
  });

  it('returns an empty record when ContextData has no entries', () => {
    const data = new ContextData();
    const ctx = assembleContext(null, data, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(Object.keys(ctx.data)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// context.errors
// ---------------------------------------------------------------------------

describe('context.errors', () => {
  it('exposes action: null initially', () => {
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(ctx.errors.action).toBeNull();
  });

  it('reflects errorsTarget.action changes after assembly (live reference)', () => {
    const errorsTarget = makeErrors();
    const ctx = assembleContext(null, null, errorsTarget, makeRouter(), {}, new URLSearchParams(), {});
    const err = new Error('async failure');
    errorsTarget.action = err;
    expect(ctx.errors.action).toBe(err);
  });

  it('reflects errorsTarget.action being cleared back to null', () => {
    const errorsTarget = makeErrors();
    errorsTarget.action = new Error('previous');
    const ctx = assembleContext(null, null, errorsTarget, makeRouter(), {}, new URLSearchParams(), {});
    errorsTarget.action = null;
    expect(ctx.errors.action).toBeNull();
  });

  it('field errors are undefined for unknown keys (validation not yet populated)', () => {
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(ctx.errors.name).toBeUndefined();
    expect(ctx.errors.email).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// context.router
// ---------------------------------------------------------------------------

describe('context.router', () => {
  it('exposes the router navigateTo method', () => {
    const navigateSpy = vi.fn();
    const router = makeRouter({ navigateTo: navigateSpy });
    const ctx = assembleContext(null, null, makeErrors(), router, {}, new URLSearchParams(), {});
    ctx.router.navigateTo('/users');
    expect(navigateSpy).toHaveBeenCalledWith('/users');
  });

  it('exposes the router replace method', () => {
    const replaceSpy = vi.fn();
    const router = makeRouter({ replace: replaceSpy });
    const ctx = assembleContext(null, null, makeErrors(), router, {}, new URLSearchParams(), {});
    ctx.router.replace('/login');
    expect(replaceSpy).toHaveBeenCalledWith('/login');
  });

  it('exposes the router back method', () => {
    const backSpy = vi.fn();
    const router = makeRouter({ back: backSpy });
    const ctx = assembleContext(null, null, makeErrors(), router, {}, new URLSearchParams(), {});
    ctx.router.back();
    expect(backSpy).toHaveBeenCalled();
  });

  it('exposes the router forward method', () => {
    const forwardSpy = vi.fn();
    const router = makeRouter({ forward: forwardSpy });
    const ctx = assembleContext(null, null, makeErrors(), router, {}, new URLSearchParams(), {});
    ctx.router.forward();
    expect(forwardSpy).toHaveBeenCalled();
  });

  it('exposes router.current', () => {
    const router = makeRouter({ current: '/dashboard' });
    const ctx = assembleContext(null, null, makeErrors(), router, {}, new URLSearchParams(), {});
    expect(ctx.router.current).toBe('/dashboard');
  });

  it('exposes the same router instance passed in', () => {
    const router = makeRouter();
    const ctx = assembleContext(null, null, makeErrors(), router, {}, new URLSearchParams(), {});
    expect(ctx.router).toBe(router);
  });
});

// ---------------------------------------------------------------------------
// context.params
// ---------------------------------------------------------------------------

describe('context.params', () => {
  it('exposes named route parameters from the URL match', () => {
    const params = { id: '42', tab: 'settings' };
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), params, new URLSearchParams(), {});
    expect(ctx.params.id).toBe('42');
    expect(ctx.params.tab).toBe('settings');
  });

  it('is an empty record when the route has no parameters', () => {
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(Object.keys(ctx.params)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// context.query
// ---------------------------------------------------------------------------

describe('context.query', () => {
  it('exposes the URLSearchParams instance', () => {
    const query = new URLSearchParams('page=2&sort=name');
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, query, {});
    expect(ctx.query).toBe(query);
  });

  it('allows reading query parameters via URLSearchParams API', () => {
    const query = new URLSearchParams('page=2&sort=name');
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, query, {});
    expect(ctx.query.get('page')).toBe('2');
    expect(ctx.query.get('sort')).toBe('name');
  });

  it('is an empty URLSearchParams when no query string is present', () => {
    const query = new URLSearchParams('');
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, query, {});
    expect([...ctx.query.entries()]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Non-route methods
// ---------------------------------------------------------------------------

describe('non-route methods', () => {
  it('exposes non-route methods at their method name', () => {
    const addItem = vi.fn();
    const removeItem = vi.fn();
    const ctx = assembleContext(
      null,
      null,
      makeErrors(),
      makeRouter(),
      {},
      new URLSearchParams(),
      { addItem, removeItem },
    );
    expect(ctx.addItem).toBe(addItem);
    expect(ctx.removeItem).toBe(removeItem);
  });

  it('non-route methods are callable from the context', () => {
    const fn = vi.fn();
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {
      doSomething: fn,
    });
    (ctx.doSomething as (...args: unknown[]) => void)('arg1');
    expect(fn).toHaveBeenCalledWith('arg1');
  });

  it('exposes no non-route methods when none are provided', () => {
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    const keys = Object.keys(ctx);
    const reservedKeys = ['data', 'model', 'errors', 'router', 'params', 'query', 'partial'];
    for (const key of keys) {
      expect(reservedKeys).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Reserved key collision guard
// ---------------------------------------------------------------------------

describe('reserved key collision guard', () => {
  const RESERVED = ['data', 'errors', 'router', 'params', 'query', 'partial', 'auth', 'model'] as const;

  for (const key of RESERVED) {
    it(`does not allow non-route method "${key}" to overwrite reserved context key`, () => {
      const imposter = vi.fn();
      // Build a methods map that includes a reserved key, bypassing the compile-time guard
      // that already blocks this at @controller decoration time.
      const methods: Record<string, (...args: unknown[]) => void> = {};
      methods[key] = imposter;
      const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), methods);
      // The framework value must not have been overwritten
      expect(ctx[key]).not.toBe(imposter);
    });
  }

  it('preserves context.errors after attempted reserved-key override', () => {
    const imposter = vi.fn();
    const errorsTarget = makeErrors();
    const methods: Record<string, (...args: unknown[]) => void> = { errors: imposter };
    const ctx = assembleContext(null, null, errorsTarget, makeRouter(), {}, new URLSearchParams(), methods);
    expect(ctx.errors.action).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Public barrel exports
// ---------------------------------------------------------------------------

describe('public barrel exports', () => {
  it('IRouter, ContextErrors, and ViewContext are exported from the public barrel', async () => {
    // Type-level check: if the import fails, the test won't compile.
    // Runtime check: ensure the barrel module loads without error.
    const barrel = await import('../../src/index.js');
    // These are type exports, so we just verify the module loads.
    expect(barrel).toBeDefined();
  });

  it('assembleContext is importable from core/context', async () => {
    const mod = await import('../../src/core/context.js');
    expect(mod.assembleContext).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// context.partial
// ---------------------------------------------------------------------------

describe('context.partial', () => {
  it('throws when no renderPartial is provided', () => {
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    expect(() => ctx.partial('shared/nav')).toThrow('[TypeMVC]');
  });

  it('calls the renderPartial function with the name and data', () => {
    const fakeFragment = new Fragment([]);
    const renderPartial = vi.fn().mockReturnValue(fakeFragment);
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, undefined, renderPartial);
    const result = ctx.partial('shared/nav', { title: 'Hello' });
    expect(renderPartial).toHaveBeenCalledWith('shared/nav', { title: 'Hello' });
    expect(result).toBe(fakeFragment);
  });

  it('passes undefined data when no data argument given', () => {
    const fakeFragment = new Fragment([]);
    const renderPartial = vi.fn().mockReturnValue(fakeFragment);
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, undefined, renderPartial);
    ctx.partial('shared/nav');
    expect(renderPartial).toHaveBeenCalledWith('shared/nav');
  });

  it('partial key cannot be overwritten by a non-route method', () => {
    const imposter = vi.fn();
    const methods: Record<string, (...args: unknown[]) => void> = { partial: imposter };
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), methods);
    expect(ctx.partial).not.toBe(imposter);
  });
});

// ---------------------------------------------------------------------------
// context components
// ---------------------------------------------------------------------------

describe('context components', () => {
  function makeComponent() {
    return vi.fn().mockReturnValue(new Fragment([]));
  }

  it('injects component functions onto the context by name', () => {
    const StatBadge = makeComponent();
    const componentMap = { StatBadge };
    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, undefined, undefined, componentMap,
    );
    expect(ctx.StatBadge).toBe(StatBadge);
  });

  it('component is callable and receives props', () => {
    const Button = vi.fn().mockReturnValue(new Fragment([]));
    const componentMap = { Button };
    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, undefined, undefined, componentMap,
    );
    (ctx.Button as (props: unknown) => Fragment)({ label: 'Click' });
    expect(Button).toHaveBeenCalledWith({ label: 'Click' });
  });

  it('injects multiple components independently', () => {
    const A = makeComponent();
    const B = makeComponent();
    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, undefined, undefined, { A, B },
    );
    expect(ctx.A).toBe(A);
    expect(ctx.B).toBe(B);
  });

  it('no component keys when componentMap is undefined', () => {
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
    const keys = Object.keys(ctx);
    expect(keys).not.toContain('StatBadge');
  });

  it('reserved key blocks component injection', () => {
    const dataComp = makeComponent();
    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, undefined, undefined, { data: dataComp },
    );
    expect(ctx.data).not.toBe(dataComp);
    expect(typeof ctx.data).toBe('object');
  });

  it('non-route method takes precedence over component with same name', () => {
    const methodFn = vi.fn();
    const compFn = makeComponent();
    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(),
      { doAction: methodFn }, undefined, undefined, { doAction: compFn },
    );
    expect(ctx.doAction).toBe(methodFn);
    expect(ctx.doAction).not.toBe(compFn);
  });
});
