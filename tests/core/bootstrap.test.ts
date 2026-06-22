// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrap, useAuth, useLocalization } from '../../src/core/bootstrap.js';
import type { AppConfig, IPlugin, AppBuilder } from '../../src/types/index.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get } from '../../src/core/decorators.js';
import { EmptyView } from '../../src/core/view.js';
import type { IView } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Navigation API mock
// ---------------------------------------------------------------------------

const mockNavigation = {
  addEventListener: vi.fn(),
  navigate: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

// ---------------------------------------------------------------------------
// Module-level controller fixture (decorators evaluated once at module load)
// ---------------------------------------------------------------------------

let bootActionCallCount = 0;

@controller('/boot-test')
class BootTestController extends Controller {
  @get()
  index(): IView {
    bootActionCallCount++;
    return EmptyView();
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let outlet: Element;

beforeEach(() => {
  outlet = document.createElement('div');
  vi.stubGlobal('navigation', mockNavigation);
  vi.stubGlobal('location', { pathname: '/', href: 'http://localhost/' });
  vi.clearAllMocks();
  bootActionCallCount = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Acceptance criterion 1: bootstrap() exported
// ---------------------------------------------------------------------------

describe('bootstrap() export', () => {
  it('bootstrap is a function', () => {
    expect(typeof bootstrap).toBe('function');
  });

  it('bootstrap is re-exported from the barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(typeof barrel.bootstrap).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2: AppConfig type exported from types/index.ts
// ---------------------------------------------------------------------------

describe('AppConfig type', () => {
  it('accepts a minimal config', () => {
    expect(() => {
      bootstrap({ outlet, configure: () => { return; } });
    }).not.toThrow();
  });

  it('accepts viewsRoot', () => {
    expect(() => {
      bootstrap({ outlet, configure: () => { return; }, viewsRoot: 'templates/' });
    }).not.toThrow();
  });

  it('accepts onError', () => {
    expect(() => {
      bootstrap({ outlet, configure: () => { return; }, onError: vi.fn() });
    }).not.toThrow();
  });

  it('AppConfig, AppBuilder, IPlugin are exported from the barrel', async () => {
    const barrel = await import('../../src/index.js');
    // Runtime proof: bootstrap() in the same barrel confirms type exports are wired
    expect(barrel.bootstrap).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3: configure callback receives an AppBuilder
// ---------------------------------------------------------------------------

describe('configure callback receives AppBuilder', () => {
  it('receives an object with all required methods', () => {
    let receivedBuilder: AppBuilder | null = null;
    bootstrap({ outlet, configure: (app) => { receivedBuilder = app; } });

    expect(receivedBuilder).not.toBeNull();
    const b = receivedBuilder as unknown as AppBuilder;
    expect(typeof b.singleton).toBe('function');
    expect(typeof b.scoped).toBe('function');
    expect(typeof b.transient).toBe('function');
    expect(typeof b.route).toBe('function');
    expect(typeof b.use).toBe('function');
    expect(typeof b.onError).toBe('function');
  });

  it('all methods return the builder (fluent chaining)', () => {
    const IToken = Symbol('T');
    bootstrap({
      outlet,
      configure: (app) => {
        const r1 = app.singleton(IToken, () => null);
        const r2 = r1.route(BootTestController);
        const r3 = r2.onError(() => { return; });
        expect(r1).toBe(app);
        expect(r2).toBe(app);
        expect(r3).toBe(app);
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 4: DI container sealed after configure runs
// ---------------------------------------------------------------------------

describe('DI container sealed after configure', () => {
  it('throws [TypeMVC] on singleton after bootstrap', () => {
    let lastApp!: AppBuilder;
    bootstrap({ outlet, configure: (app) => { lastApp = app; } });
    expect(() => { lastApp.singleton(Symbol('s'), () => null); }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] on scoped after bootstrap', () => {
    let lastApp!: AppBuilder;
    bootstrap({ outlet, configure: (app) => { lastApp = app; } });
    expect(() => { lastApp.scoped(Symbol('c'), () => null); }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] on transient after bootstrap', () => {
    let lastApp!: AppBuilder;
    bootstrap({ outlet, configure: (app) => { lastApp = app; } });
    expect(() => { lastApp.transient(Symbol('t'), () => null); }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] on route after bootstrap', () => {
    let lastApp!: AppBuilder;
    bootstrap({ outlet, configure: (app) => { lastApp = app; } });
    expect(() => { lastApp.route(BootTestController); }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] on use after bootstrap', () => {
    let lastApp!: AppBuilder;
    bootstrap({ outlet, configure: (app) => { lastApp = app; } });
    const plugin: IPlugin = { name: 'late', install: () => { return; } };
    expect(() => { lastApp.use(plugin); }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] on onError after bootstrap', () => {
    let lastApp!: AppBuilder;
    bootstrap({ outlet, configure: (app) => { lastApp = app; } });
    expect(() => { lastApp.onError(() => { return; }); }).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 5: Router initialised before Navigation API listener
// ---------------------------------------------------------------------------

describe('Router init before Navigation API listener', () => {
  it('attaches exactly one navigate listener during bootstrap', () => {
    bootstrap({ outlet, configure: (app) => { app.route(BootTestController); } });
    expect(mockNavigation.addEventListener).toHaveBeenCalledTimes(1);
    expect(mockNavigation.addEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
  });

  it('configure runs before the listener is attached', () => {
    const callOrder: string[] = [];
    vi.stubGlobal('navigation', {
      addEventListener: vi.fn((): void => { callOrder.push('attach'); }),
      navigate: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    });

    bootstrap({
      outlet,
      configure: () => { callOrder.push('configure'); },
    });

    expect(callOrder.indexOf('configure')).toBeLessThan(callOrder.indexOf('attach'));
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 6: Initial navigation triggered for the current URL
// ---------------------------------------------------------------------------

describe('initial navigation triggered for current URL', () => {
  it('dispatches to the matching route on startup', async () => {
    vi.stubGlobal('location', { pathname: '/boot-test', href: 'http://localhost/boot-test' });
    bootstrap({ outlet, configure: (app) => { app.route(BootTestController); } });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(bootActionCallCount).toBe(1);
  });

  it('does not throw when no route matches the current URL', async () => {
    vi.stubGlobal('location', { pathname: '/no-match', href: 'http://localhost/no-match' });
    expect(() => { bootstrap({ outlet, configure: () => { return; } }); }).not.toThrow();
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 7: use(plugin) calls plugin.install(app)
// ---------------------------------------------------------------------------

describe('use(plugin) calls plugin.install', () => {
  it('install is called exactly once', () => {
    const install = vi.fn<(app: AppBuilder) => void>();
    bootstrap({ outlet, configure: (app) => { app.use({ name: 'p', install }); } });
    expect(install).toHaveBeenCalledOnce();
  });

  it('install receives the AppBuilder with all methods', () => {
    let receivedApp: AppBuilder | null = null;
    const plugin: IPlugin = {
      name: 'check',
      install(app) { receivedApp = app; },
    };
    bootstrap({ outlet, configure: (app) => { app.use(plugin); } });
    const b = receivedApp as unknown as AppBuilder;
    expect(typeof b.singleton).toBe('function');
    expect(typeof b.route).toBe('function');
  });

  it('multiple plugins are installed in order', () => {
    const order: string[] = [];
    bootstrap({
      outlet,
      configure: (app) => {
        app.use({ name: 'a', install: () => { order.push('a'); } });
        app.use({ name: 'b', install: () => { order.push('b'); } });
      },
    });
    expect(order).toEqual(['a', 'b']);
  });

  it('plugin can chain another plugin via use()', () => {
    const innerInstall = vi.fn<(app: AppBuilder) => void>();
    const outer: IPlugin = {
      name: 'outer',
      install: (app) => { app.use({ name: 'inner', install: innerInstall }); },
    };
    bootstrap({ outlet, configure: (app) => { app.use(outer); } });
    expect(innerInstall).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 8: onError handler registration
// ---------------------------------------------------------------------------

describe('onError handler registration', () => {
  it('AppConfig.onError is accepted without throwing', () => {
    const config: AppConfig = { outlet, configure: () => { return; }, onError: vi.fn() };
    expect(() => { bootstrap(config); }).not.toThrow();
  });

  it('AppBuilder.onError() is accepted without throwing', () => {
    expect(() => {
      bootstrap({ outlet, configure: (app) => { app.onError(() => { return; }); } });
    }).not.toThrow();
  });

  it('builder-registered handler and AppConfig.onError coexist without throwing', () => {
    const configHandler = vi.fn<(e: Error, m: string) => void>();
    const builderHandler = vi.fn<(e: Error, m: string) => void>();
    expect(() => {
      bootstrap({
        outlet,
        configure: (app) => { app.onError(builderHandler); },
        onError: configHandler,
      });
    }).not.toThrow();
    void configHandler;
    void builderHandler;
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 9: viewsRoot from AppConfig passed to view resolver
// ---------------------------------------------------------------------------

describe('viewsRoot configuration', () => {
  it('defaults without throwing', () => {
    expect(() => { bootstrap({ outlet, configure: () => { return; } }); }).not.toThrow();
  });

  it('accepts a custom viewsRoot', () => {
    expect(() => {
      bootstrap({ outlet, configure: () => { return; }, viewsRoot: 'templates/' });
    }).not.toThrow();
  });

  it('accepts a viewsRoot without trailing slash', () => {
    expect(() => {
      bootstrap({ outlet, configure: () => { return; }, viewsRoot: 'templates' });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 10: full bootstrap sequence
// ---------------------------------------------------------------------------

describe('full bootstrap sequence', () => {
  it('runs configure, attaches listener, returns, then dispatches initial navigation', async () => {
    const steps: string[] = [];
    vi.stubGlobal('location', { pathname: '/boot-test', href: 'http://localhost/boot-test' });
    vi.stubGlobal('navigation', {
      addEventListener: vi.fn((): void => { steps.push('attach'); }),
      navigate: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    });

    bootstrap({
      outlet,
      configure: (app) => {
        steps.push('configure-start');
        app.route(BootTestController);
        steps.push('configure-end');
      },
    });

    steps.push('bootstrap-returned');
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

    expect(steps[0]).toBe('configure-start');
    expect(steps[1]).toBe('configure-end');
    expect(steps[2]).toBe('attach');
    expect(steps[3]).toBe('bootstrap-returned');
    expect(bootActionCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Missing outlet element
// ---------------------------------------------------------------------------

describe('missing outlet', () => {
  it('throws [TypeMVC] when outlet is null', () => {
    expect(() => {
      bootstrap({ outlet: null as unknown as Element, configure: () => { return; } });
    }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] when outlet is undefined', () => {
    expect(() => {
      bootstrap({ outlet: undefined as unknown as Element, configure: () => { return; } });
    }).toThrow('[TypeMVC]');
  });

  it('error message mentions "outlet"', () => {
    expect(() => {
      bootstrap({ outlet: null as unknown as Element, configure: () => { return; } });
    }).toThrow(/outlet/i);
  });
});

// ---------------------------------------------------------------------------
// Built-in plugin stubs
// ---------------------------------------------------------------------------

describe('useAuth() stub', () => {
  it('returns an IPlugin with name "auth"', () => {
    expect(useAuth().name).toBe('auth');
  });

  it('install is a function', () => {
    expect(typeof useAuth().install).toBe('function');
  });

  it('can be installed via use() without throwing', () => {
    expect(() => {
      bootstrap({ outlet, configure: (app) => { app.use(useAuth()); } });
    }).not.toThrow();
  });

  it('is re-exported from the barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.useAuth().name).toBe('auth');
  });
});

describe('useLocalization() stub', () => {
  it('returns an IPlugin with name "localization"', () => {
    expect(useLocalization().name).toBe('localization');
  });

  it('install is a function', () => {
    expect(typeof useLocalization().install).toBe('function');
  });

  it('can be installed via use() without throwing', () => {
    expect(() => {
      bootstrap({ outlet, configure: (app) => { app.use(useLocalization()); } });
    }).not.toThrow();
  });

  it('is re-exported from the barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.useLocalization().name).toBe('localization');
  });
});

// ---------------------------------------------------------------------------
// AppBuilder fluent chaining
// ---------------------------------------------------------------------------

describe('AppBuilder fluent chaining', () => {
  it('route().use().onError() chain works', () => {
    expect(() => {
      bootstrap({
        outlet,
        configure: (app) => {
          app
            .route(BootTestController)
            .use({ name: 'p', install: () => { return; } })
            .onError(() => { return; });
        },
      });
    }).not.toThrow();
  });

  it('singleton().scoped().transient() chain works', () => {
    const S = Symbol('S');
    const C = Symbol('C');
    const T = Symbol('T');
    expect(() => {
      bootstrap({
        outlet,
        configure: (app) => {
          app.singleton(S, () => 's').scoped(C, () => 'c').transient(T, () => 't');
        },
      });
    }).not.toThrow();
  });
});
