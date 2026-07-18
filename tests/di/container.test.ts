import { describe, it, expect } from 'vitest';
import { Container } from '../../src/di/container.js';
import { inject, getInjectTokens } from '../../src/di/decorators.js';

// ---------------------------------------------------------------------------
// Singleton lifetime
// ---------------------------------------------------------------------------

describe('Container: singleton lifetime', () => {
  it('returns the same instance on every resolve from root', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let calls = 0;
    container.singleton(IFoo, () => {
      calls++;
      return { id: calls };
    });
    const a = container.resolve<{ id: number }>(IFoo);
    const b = container.resolve<{ id: number }>(IFoo);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('returns the same instance from a child scope as from root', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.singleton(IFoo, () => ({ value: 42 }));
    const scope = container.createScope();
    const fromRoot = container.resolve<{ value: number }>(IFoo);
    const fromScope = scope.resolve<{ value: number }>(IFoo);
    expect(fromRoot).toBe(fromScope);
  });

  it('caches the singleton in root even when first resolved from a scope', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let calls = 0;
    container.singleton(IFoo, () => {
      calls++;
      return {};
    });
    const scope = container.createScope();
    scope.resolve(IFoo);
    scope.resolve(IFoo);
    container.resolve(IFoo);
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scoped lifetime
// ---------------------------------------------------------------------------

describe('Container: scoped lifetime', () => {
  it('returns the same instance within a single scope', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let calls = 0;
    container.scoped(IFoo, () => {
      calls++;
      return {};
    });
    const scope = container.createScope();
    const a = scope.resolve(IFoo);
    const b = scope.resolve(IFoo);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('returns different instances in different scopes', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.scoped(IFoo, () => ({}));
    const scope1 = container.createScope();
    const scope2 = container.createScope();
    const a = scope1.resolve(IFoo);
    const b = scope2.resolve(IFoo);
    expect(a).not.toBe(b);
  });

  it('does not share scoped instance with parent container', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.scoped(IFoo, () => ({}));
    const scope = container.createScope();
    const fromScope = scope.resolve(IFoo);
    const fromRoot = container.resolve(IFoo);
    expect(fromScope).not.toBe(fromRoot);
  });
});

// ---------------------------------------------------------------------------
// Duplicate registration
// ---------------------------------------------------------------------------

describe('Container: duplicate registration', () => {
  it('throws naming the token when a singleton token is registered twice', () => {
    const container = new Container();
    const IFoo = Symbol('IFooService');
    container.singleton(IFoo, () => ({}));
    expect(() => { container.singleton(IFoo, () => ({})); }).toThrow('IFooService');
  });

  it('throws for a duplicate across different lifetimes', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.singleton(IFoo, () => ({}));
    expect(() => { container.scoped(IFoo, () => ({})); }).toThrow('[TypeMVC]');
    expect(() => { container.transient(IFoo, () => ({})); }).toThrow('[TypeMVC]');
  });

  it('throws for a duplicate scoped registration', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.scoped(IFoo, () => ({}));
    expect(() => { container.scoped(IFoo, () => ({})); }).toThrow('[TypeMVC]');
  });

  it('throws for a duplicate transient registration', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.transient(IFoo, () => ({}));
    expect(() => { container.transient(IFoo, () => ({})); }).toThrow('[TypeMVC]');
  });

  it('allows the same token to be registered on a child scope', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.singleton(IFoo, () => ({}));
    const scope = container.createScope();
    expect(() => { scope.scoped(IFoo, () => ({})); }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scope disposal
// ---------------------------------------------------------------------------

describe('Container: scope disposal', () => {
  it('calls dispose() on scoped instances that implement it', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let disposed = 0;
    container.scoped(IFoo, () => ({ dispose: (): void => { disposed++; } }));
    const scope = container.createScope();
    scope.resolve(IFoo);
    scope.dispose();
    expect(disposed).toBe(1);
  });

  it('clears the scoped cache so a later resolve rebuilds', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let calls = 0;
    container.scoped(IFoo, () => { calls++; return {}; });
    const scope = container.createScope();
    scope.resolve(IFoo);
    scope.dispose();
    scope.resolve(IFoo);
    expect(calls).toBe(2);
  });

  it('does not dispose singletons, which live on the root', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let disposed = 0;
    container.singleton(IFoo, () => ({ dispose: (): void => { disposed++; } }));
    const scope = container.createScope();
    scope.resolve(IFoo);
    scope.dispose();
    expect(disposed).toBe(0);
  });

  it('isolates a throwing dispose so later instances still dispose', () => {
    const container = new Container();
    const IBad = Symbol('IBad');
    const IGood = Symbol('IGood');
    let goodDisposed = 0;
    container.scoped(IBad, () => ({ dispose: (): void => { throw new Error('boom'); } }));
    container.scoped(IGood, () => ({ dispose: (): void => { goodDisposed++; } }));
    const scope = container.createScope();
    scope.resolve(IBad);
    scope.resolve(IGood);
    expect(() => { scope.dispose(); }).not.toThrow();
    expect(goodDisposed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Undefined factory result is cached once
// ---------------------------------------------------------------------------

describe('Container: undefined factory result', () => {
  it('runs a singleton factory returning undefined exactly once', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let calls = 0;
    container.singleton(IFoo, () => { calls++; return undefined; });

    container.resolve(IFoo);
    container.resolve(IFoo);
    container.resolve(IFoo);

    expect(calls).toBe(1);
  });

  it('runs a scoped factory returning undefined once within a scope', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    let calls = 0;
    container.scoped(IFoo, () => { calls++; return undefined; });
    const scope = container.createScope();

    scope.resolve(IFoo);
    scope.resolve(IFoo);

    expect(calls).toBe(1);
  });

  it('returns the cached undefined value', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.singleton(IFoo, () => undefined);
    expect(container.resolve(IFoo)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Transient lifetime
// ---------------------------------------------------------------------------

describe('Container: transient lifetime', () => {
  it('returns a new instance on every resolve', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.transient(IFoo, () => ({}));
    const a = container.resolve(IFoo);
    const b = container.resolve(IFoo);
    expect(a).not.toBe(b);
  });

  it('returns a new instance on every resolve from a scope', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.transient(IFoo, () => ({}));
    const scope = container.createScope();
    const a = scope.resolve(IFoo);
    const b = scope.resolve(IFoo);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// createScope: child inherits parent registrations
// ---------------------------------------------------------------------------

describe('Container: createScope inheritance', () => {
  it('child scope can resolve tokens registered on parent', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.singleton(IFoo, () => ({ ok: true }));
    const scope = container.createScope();
    expect(() => scope.resolve(IFoo)).not.toThrow();
    expect(scope.resolve<{ ok: boolean }>(IFoo).ok).toBe(true);
  });

  it('child scope can resolve tokens registered directly on itself', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    const scope = container.createScope();
    scope.singleton(IFoo, () => ({ ok: true }));
    expect(scope.resolve<{ ok: boolean }>(IFoo).ok).toBe(true);
  });

  it('grandchild scope inherits from root through chain', () => {
    const root = new Container();
    const IFoo = Symbol('IFoo');
    root.singleton(IFoo, () => ({ level: 'root' }));
    const child = root.createScope();
    const grandchild = child.createScope();
    const fromGrand = grandchild.resolve<{ level: string }>(IFoo);
    const fromRoot = root.resolve<{ level: string }>(IFoo);
    expect(fromGrand).toBe(fromRoot);
  });
});

// ---------------------------------------------------------------------------
// resolve: unregistered token error
// ---------------------------------------------------------------------------

describe('Container: resolve error for unregistered token', () => {
  it('throws with [TypeMVC] prefix', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    expect(() => container.resolve(IFoo)).toThrow('[TypeMVC]');
  });

  it('includes the token description in the error message', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    expect(() => container.resolve(IFoo)).toThrow('IFoo');
  });

  it('error message from child scope includes the token description', () => {
    const container = new Container();
    const IUnknown = Symbol('IUnknown');
    const scope = container.createScope();
    expect(() => scope.resolve(IUnknown)).toThrow('IUnknown');
  });
});

// ---------------------------------------------------------------------------
// resolveOptional: undefined for unregistered token
// ---------------------------------------------------------------------------

describe('Container: resolveOptional', () => {
  it('returns undefined for an unregistered token', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    expect(container.resolveOptional(IFoo)).toBeUndefined();
  });

  it('returns the resolved value for a registered token', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    container.singleton(IFoo, () => ({ ok: true }));
    expect(container.resolveOptional<{ ok: boolean }>(IFoo)?.ok).toBe(true);
  });

  it('returns undefined from a child scope when token is not registered anywhere', () => {
    const container = new Container();
    const IFoo = Symbol('IFoo');
    const scope = container.createScope();
    expect(scope.resolveOptional(IFoo)).toBeUndefined();
  });

  it('still throws on circular dependency even through resolveOptional', () => {
    const container = new Container();
    const IA = Symbol('IA');
    const IB = Symbol('IB');
    container.singleton(IA, (c) => c.resolve(IB));
    container.singleton(IB, (c) => c.resolve(IA));
    expect(() => container.resolveOptional(IA)).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// Circular dependency detection
// ---------------------------------------------------------------------------

describe('Container: circular dependency detection', () => {
  it('detects a 2-token cycle and throws with [TypeMVC] prefix', () => {
    const container = new Container();
    const IA = Symbol('IA');
    const IB = Symbol('IB');
    container.singleton(IA, (c) => c.resolve(IB));
    container.singleton(IB, (c) => c.resolve(IA));
    expect(() => container.resolve(IA)).toThrow('[TypeMVC]');
  });

  it('circular dependency error mentions "circular"', () => {
    const container = new Container();
    const IA = Symbol('IA');
    const IB = Symbol('IB');
    container.singleton(IA, (c) => c.resolve(IB));
    container.singleton(IB, (c) => c.resolve(IA));
    expect(() => container.resolve(IA)).toThrow(/[Cc]ircular/);
  });

  it('circular dependency error includes token descriptions', () => {
    const container = new Container();
    const IA = Symbol('ServiceA');
    const IB = Symbol('ServiceB');
    container.singleton(IA, (c) => c.resolve(IB));
    container.singleton(IB, (c) => c.resolve(IA));
    expect(() => container.resolve(IA)).toThrow('ServiceA');
  });

  it('detects a 3-token cycle', () => {
    const container = new Container();
    const IA = Symbol('IA');
    const IB = Symbol('IB');
    const IC = Symbol('IC');
    container.singleton(IA, (c) => c.resolve(IB));
    container.singleton(IB, (c) => c.resolve(IC));
    container.singleton(IC, (c) => c.resolve(IA));
    expect(() => container.resolve(IA)).toThrow('[TypeMVC]');
  });

  it('allows resolution to succeed after a previous circular dep error', () => {
    const container = new Container();
    const IA = Symbol('IA');
    const IB = Symbol('IB');
    const IOk = Symbol('IOk');
    container.singleton(IA, (c) => c.resolve(IB));
    container.singleton(IB, (c) => c.resolve(IA));
    container.singleton(IOk, () => ({ fine: true }));

    expect(() => container.resolve(IA)).toThrow();
    expect(() => container.resolve(IOk)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Factory: receives the container for further resolution
// ---------------------------------------------------------------------------

describe('Container: factory dependency resolution', () => {
  it('singleton factory can resolve another singleton', () => {
    const container = new Container();
    const IConfig = Symbol('IConfig');
    const IService = Symbol('IService');
    container.singleton(IConfig, () => ({ baseUrl: '/api' }));
    container.singleton(IService, (c) => {
      const cfg = c.resolve<{ baseUrl: string }>(IConfig);
      return { url: cfg.baseUrl + '/users' };
    });
    expect(container.resolve<{ url: string }>(IService).url).toBe('/api/users');
  });

  it('scoped factory can resolve a singleton from parent', () => {
    const container = new Container();
    const IConfig = Symbol('IConfig');
    const IRepo = Symbol('IRepo');
    container.singleton(IConfig, () => ({ version: 2 }));
    container.scoped(IRepo, (c) => {
      const cfg = c.resolve<{ version: number }>(IConfig);
      return { version: cfg.version };
    });
    const scope = container.createScope();
    expect(scope.resolve<{ version: number }>(IRepo).version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// @inject decorator
// ---------------------------------------------------------------------------

describe('@inject decorator', () => {
  it('stores injection tokens at the correct constructor parameter positions', () => {
    const IFoo = Symbol('IFoo');
    const IBar = Symbol('IBar');

    /* eslint-disable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function -- test fixture class for parameter decorator verification */
    class MyService {
      constructor(
        @inject(IFoo) _foo: unknown, // eslint-disable-line @typescript-eslint/no-unused-vars -- decorator test param
        @inject(IBar) _bar: unknown, // eslint-disable-line @typescript-eslint/no-unused-vars -- decorator test param
      ) {}
    }
    /* eslint-enable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function */

    const tokens = getInjectTokens(MyService);
    expect(tokens[0]).toBe(IFoo);
    expect(tokens[1]).toBe(IBar);
  });

  it('returns an empty array for a class with no @inject decorators', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- test fixture for empty injection metadata
    class Plain {}
    const tokens = getInjectTokens(Plain);
    expect(tokens).toHaveLength(0);
  });

  it('index without @inject is undefined in the returned array', () => {
    const IFoo = Symbol('IFoo');

    /* eslint-disable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function -- test fixture for partial injection metadata */
    class Partial {
      constructor(
        @inject(IFoo) _foo: unknown, // eslint-disable-line @typescript-eslint/no-unused-vars -- decorator test param
        _plain: unknown, // eslint-disable-line @typescript-eslint/no-unused-vars -- unannotated param for index-gap test
      ) {}
    }
    /* eslint-enable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function */

    const tokens = getInjectTokens(Partial);
    expect(tokens[0]).toBe(IFoo);
    expect(tokens[1]).toBeUndefined();
  });

  it('does not share metadata between different classes', () => {
    const IFoo = Symbol('IFoo');
    const IBar = Symbol('IBar');

    /* eslint-disable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function -- test fixtures for per-class metadata isolation */
    class ClassA {
      constructor(@inject(IFoo) _x: unknown) {} // eslint-disable-line @typescript-eslint/no-unused-vars -- decorator test param
    }

    class ClassB {
      constructor(@inject(IBar) _x: unknown) {} // eslint-disable-line @typescript-eslint/no-unused-vars -- decorator test param
    }
    /* eslint-enable @typescript-eslint/no-extraneous-class, @typescript-eslint/no-empty-function */

    expect(getInjectTokens(ClassA)[0]).toBe(IFoo);
    expect(getInjectTokens(ClassB)[0]).toBe(IBar);
  });

  it('inject is exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.inject).toBeDefined();
  });
});
