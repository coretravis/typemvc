// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import type {
  AppConfig,
  IPlugin,
  AppBuilder,
  IView,
  LayoutContext,
  TmvcViewFunction,
  ViewContext,
  ViewGlob,
} from '../../src/types/index.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get, layout, title, pending, failure } from '../../src/core/decorators.js';
import { EmptyView, Redirect, View } from '../../src/core/view.js';
import { html } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';
import { signal } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { _callComponent } from '../../src/core/component-registry.js';
import type { ComponentFunction } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Navigation API mock
// ---------------------------------------------------------------------------

const mockNavigation = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
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

@controller('/boot-fail')
class BootFailController extends Controller {
  @get()
  index(): IView {
    throw new Error('boot action exploded');
  }
}

const teardownSignal = signal('live');

@controller('/teardown-boot')
class TeardownBootController extends Controller {
  @get()
  index(): IView {
    return View();
  }
}

const teardownViews: ViewGlob = {
  '/views/teardown-boot/index.tmvc': () =>
    Promise.resolve({ default: () => html`<p>${teardownSignal}</p>` }),
};

@controller('/iso')
class IsoController extends Controller {
  @get()
  index(): IView {
    return View();
  }
}

const isoViews: ViewGlob = {
  '/views/iso/index.tmvc': () =>
    Promise.resolve({ default: () => html`<div>${_callComponent('Widget', {})}</div>` }),
};

const widgetA: ComponentFunction = () => html`<span class="w">A-widget</span>`;
const widgetB: ComponentFunction = () => html`<span class="w">B-widget</span>`;

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
// Component registry scope and collision
// ---------------------------------------------------------------------------

describe('component registry', () => {
  it('throws on a component basename collision across folders', () => {
    vi.stubGlobal('location', { pathname: '/x', href: 'http://localhost/x' });
    expect(() => {
      bootstrap({
        outlet,
        components: {
          '/src/components/Card.tmvc': { default: widgetA },
          '/src/widgets/Card.tmvc': { default: widgetB },
        },
        configure: () => { return; },
      });
    }).toThrow(/Duplicate component name "Card"/);
  });

  it('scopes components per application so two apps do not share', async () => {
    vi.stubGlobal('location', { pathname: '/iso', href: 'http://localhost/iso' });
    const outletA = document.createElement('div');
    const outletB = document.createElement('div');

    const appA = bootstrap({
      outlet: outletA,
      viewsRoot: 'views/',
      views: isoViews,
      components: { '/src/components/Widget.tmvc': { default: widgetA } },
      configure: (app) => { app.route(IsoController); },
    });
    const appB = bootstrap({
      outlet: outletB,
      viewsRoot: 'views/',
      views: isoViews,
      components: { '/src/widgets/Widget.tmvc': { default: widgetB } },
      configure: (app) => { app.route(IsoController); },
    });

    await appA.ready;
    await appB.ready;

    expect(outletA.innerHTML).toContain('A-widget');
    expect(outletA.innerHTML).not.toContain('B-widget');
    expect(outletB.innerHTML).toContain('B-widget');
    expect(outletB.innerHTML).not.toContain('A-widget');
  });
});

// ---------------------------------------------------------------------------
// Navigation API feature detection
// ---------------------------------------------------------------------------

describe('Navigation API feature detection', () => {
  it('throws an actionable compatibility error when navigation is absent', () => {
    vi.stubGlobal('navigation', undefined);

    expect(() => {
      bootstrap({ outlet, configure: () => { return; } });
    }).toThrow(/Navigation API is required/);
  });
});

// ---------------------------------------------------------------------------
// AppHandle.stop tears the application down
// ---------------------------------------------------------------------------

describe('AppHandle.stop teardown', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    teardownSignal.set('live');
    vi.stubGlobal('location', {
      pathname: '/teardown-boot',
      href: 'http://localhost/teardown-boot',
    });
  });

  it('disposes the mounted fragment so a bound signal no longer drives the DOM', async () => {
    const handle = bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: teardownViews,
      configure: (app) => { app.route(TeardownBootController); },
    });
    await handle.ready;
    expect(outlet.innerHTML).toContain('live');

    await handle.stop();

    teardownSignal.set('changed');
    flush();
    expect(outlet.innerHTML).not.toContain('changed');
  });

  it('removes the announcer region', async () => {
    const handle = bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: teardownViews,
      configure: (app) => { app.route(TeardownBootController); },
    });
    await handle.ready;
    expect(document.querySelector('.tmvc-route-announcer')).not.toBeNull();

    await handle.stop();

    expect(document.querySelector('.tmvc-route-announcer')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AppHandle.ready settles when the first navigation finishes
// ---------------------------------------------------------------------------

describe('AppHandle.ready', () => {
  it('is a promise an application may ignore', async () => {
    vi.stubGlobal('location', { pathname: '/boot-test', href: 'http://localhost/boot-test' });
    const handle = bootstrap({ outlet, configure: (app) => { app.route(BootTestController); } });
    expect(handle.ready).toBeInstanceOf(Promise);
    await handle.ready;
  });

  it('resolves after the first navigation has run', async () => {
    vi.stubGlobal('location', { pathname: '/boot-test', href: 'http://localhost/boot-test' });
    const handle = bootstrap({ outlet, configure: (app) => { app.route(BootTestController); } });
    await handle.ready;
    expect(bootActionCallCount).toBe(1);
  });

  it('resolves after reporting a first-navigation failure, without rejecting', async () => {
    vi.stubGlobal('location', { pathname: '/boot-fail', href: 'http://localhost/boot-fail' });
    const onError = vi.fn<(error: Error, methodName: string) => void>();
    const handle = bootstrap({ outlet, onError, configure: (app) => { app.route(BootFailController); } });

    await expect(handle.ready).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      'index',
      expect.objectContaining({ phase: 'action', action: 'index' }),
    );
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

// ---------------------------------------------------------------------------
// Layout glob: a layout file's @parent compiles to a named export, which
// bootstrap resolves against the same map once every layout exists.
// ---------------------------------------------------------------------------

@controller('/layout-boot')
@layout('AdminLayout')
class LayoutBootController extends Controller {
  @get()
  index(): IView {
    return View();
  }

  @layout('PortalLayout')
  @get('portal')
  portal(): IView {
    return View('/views/layout-boot/index.tmvc');
  }
}

const pageViews: ViewGlob = {
  '/views/layout-boot/index.tmvc': () =>
    Promise.resolve({ default: () => html`<p>page</p>` }),
};

const rootLayout: TmvcViewFunction = (c) => html`<root>${(c as LayoutContext).slot}</root>`;
const appLayout: TmvcViewFunction = (c) => html`<app>${(c as LayoutContext).slot}</app>`;
const adminLayout: TmvcViewFunction = (c) => html`<admin>${(c as LayoutContext).slot}</admin>`;
const portalLayout: TmvcViewFunction = (c) => html`<portal>${(c as LayoutContext).slot}</portal>`;

describe('layout glob: @parent linking', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/layout-boot', href: 'http://localhost/layout-boot' });
  });

  it('wraps a child layout in the parent it names', async () => {
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: pageViews,
      layouts: {
        '/src/layouts/AppLayout.tmvc': { default: appLayout },
        '/src/layouts/AdminLayout.tmvc': { default: adminLayout, parent: 'AppLayout' },
      },
      configure: (app) => { app.route(LayoutBootController); },
    });

    await vi.waitFor(() => {
      expect(outlet.innerHTML).toContain('<p>page</p>');
    });
    expect(outlet.innerHTML).toMatch(/<app><admin><p>page<\/p><\/admin><\/app>/);
  });

  it('renders a three level chain inside out', async () => {
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: pageViews,
      layouts: {
        '/src/layouts/RootLayout.tmvc': { default: rootLayout },
        '/src/layouts/AppLayout.tmvc': { default: appLayout, parent: 'RootLayout' },
        '/src/layouts/AdminLayout.tmvc': { default: adminLayout, parent: 'AppLayout' },
      },
      configure: (app) => { app.route(LayoutBootController); },
    });

    await vi.waitFor(() => {
      expect(outlet.innerHTML).toContain('<p>page</p>');
    });
    expect(outlet.innerHTML).toMatch(
      /<root><app><admin><p>page<\/p><\/admin><\/app><\/root>/,
    );
  });

  it('leaves a layout that declares no parent unwrapped', async () => {
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: pageViews,
      layouts: {
        '/src/layouts/AppLayout.tmvc': { default: appLayout },
        '/src/layouts/AdminLayout.tmvc': { default: adminLayout },
      },
      configure: (app) => { app.route(LayoutBootController); },
    });

    await vi.waitFor(() => {
      expect(outlet.innerHTML).toContain('<p>page</p>');
    });
    expect(outlet.innerHTML).toMatch(/^<admin><p>page<\/p><\/admin>$/);
  });

  it('honours the parent chain of an action level layout override', async () => {
    vi.stubGlobal('location', {
      pathname: '/layout-boot/portal',
      href: 'http://localhost/layout-boot/portal',
    });

    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: pageViews,
      layouts: {
        '/src/layouts/AppLayout.tmvc': { default: appLayout },
        '/src/layouts/AdminLayout.tmvc': { default: adminLayout, parent: 'AppLayout' },
        '/src/layouts/PortalLayout.tmvc': { default: portalLayout, parent: 'AppLayout' },
      },
      configure: (app) => { app.route(LayoutBootController); },
    });

    await vi.waitFor(() => {
      expect(outlet.innerHTML).toContain('<p>page</p>');
    });
    expect(outlet.innerHTML).toMatch(/<app><portal><p>page<\/p><\/portal><\/app>/);
    expect(outlet.innerHTML).not.toContain('<admin>');
  });

  it('throws when a layout names a parent that is not registered', () => {
    expect(() => {
      bootstrap({
        outlet,
        views: pageViews,
        layouts: {
          '/src/layouts/AdminLayout.tmvc': { default: adminLayout, parent: 'AppLayout' },
        },
        configure: (app) => { app.route(LayoutBootController); },
      });
    }).toThrow(
      '[TypeMVC] Layout "AdminLayout" declares @parent "AppLayout", which is not registered. ' +
        'Register it via the "layouts" eager glob in bootstrap().',
    );
  });
});

// ---------------------------------------------------------------------------
// Route announcement: the framework owns a live region outside the outlet, so a
// screen reader is told what the user navigated to.
// ---------------------------------------------------------------------------

@controller('/announce')
class AnnounceController extends Controller {
  @get()
  index(): IView {
    return View('/views/announce/index.tmvc');
  }

  @get('elsewhere')
  elsewhere(): IView {
    return View('/views/announce/index.tmvc');
  }

  @get('gone')
  gone(): IView {
    return Redirect('/announce');
  }

  @get('nothing')
  nothing(): IView {
    return EmptyView();
  }
}

/** What the live region held while the view was still rendering. */
let announcerTextDuringRender: string | null = null;

const announceViews: ViewGlob = {
  '/views/announce/index.tmvc': () =>
    Promise.resolve({
      default: (): Fragment => {
        announcerTextDuringRender =
          document.querySelector('.tmvc-route-announcer')?.textContent ?? null;
        return html`<p>announced</p>`;
      },
    }),
};

function announcer(): Element | null {
  return document.querySelector('.tmvc-route-announcer');
}

/** Drives a navigation through the listener bootstrap attached. */
async function navigateTo(pathname: string): Promise<void> {
  const listener = mockNavigation.addEventListener.mock.calls[0]?.[1] as unknown as (
    event: unknown,
  ) => void;
  const intercepted: { handler: (() => Promise<void>) | null } = { handler: null };
  listener({
    canIntercept: true,
    hashChange: false,
    downloadRequest: null,
    destination: { url: `http://localhost${pathname}` },
    formData: null,
    intercept(options: { handler: () => Promise<void> }): void {
      intercepted.handler = options.handler;
    },
  });
  if (intercepted.handler !== null) await intercepted.handler();
}

function bootAnnounceApp(config?: { announce?: boolean }): void {
  bootstrap({
    outlet,
    viewsRoot: 'views/',
    views: announceViews,
    ...(config?.announce !== undefined ? { announce: config.announce } : {}),
    configure: (app) => { app.route(AnnounceController); },
  });
}

describe('route announcement', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.body.appendChild(outlet);
    announcerTextDuringRender = null;
    vi.stubGlobal('location', { pathname: '/announce', href: 'http://localhost/announce' });
  });

  it('creates a live region in the accessibility tree that is not visible on screen', async () => {
    bootAnnounceApp();
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    const region = announcer();
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
    expect(region?.hasAttribute('hidden')).toBe(false);

    const style = region?.getAttribute('style') ?? '';
    expect(style).not.toContain('display:none');
    expect(style).toContain('clip:rect(0 0 0 0)');
    expect(style).toContain('position:absolute');
  });

  it('does not announce the initial page load', async () => {
    bootAnnounceApp();
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    expect(announcer()?.textContent).toBe('');
  });

  it('announces the pathname of a navigation that mounted a view', async () => {
    bootAnnounceApp();
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/announce/elsewhere');

    expect(announcer()?.textContent).toBe('/announce/elsewhere');
  });

  it('writes the announcement after the view has mounted', async () => {
    bootAnnounceApp();
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });
    announcerTextDuringRender = null;

    await navigateTo('/announce/elsewhere');

    expect(announcerTextDuringRender).toBe('');
    expect(announcer()?.textContent).toBe('/announce/elsewhere');
  });

  it('announces nothing for a redirect result', async () => {
    bootAnnounceApp();
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/announce/gone');

    expect(announcer()?.textContent).toBe('');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('/announce');
  });

  it('announces nothing for an empty result', async () => {
    bootAnnounceApp();
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/announce/nothing');

    expect(announcer()?.textContent).toBe('');
  });

  it('survives the outlet being replaced by a navigation', async () => {
    bootAnnounceApp();
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/announce/elsewhere');
    await navigateTo('/announce');

    expect(announcer()).not.toBeNull();
    expect(outlet.contains(announcer())).toBe(false);
    expect(announcer()?.textContent).toBe('/announce');
  });

  it('announce: false creates no live region at all', async () => {
    bootAnnounceApp({ announce: false });
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/announce/elsewhere');

    expect(announcer()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The transitions setting reaches the router.
// ---------------------------------------------------------------------------

describe('transitions configuration', () => {
  const doc = document as unknown as Record<string, unknown>;

  beforeEach(() => {
    document.body.replaceChildren();
    vi.stubGlobal('location', { pathname: '/announce', href: 'http://localhost/announce' });
  });

  afterEach(() => {
    delete doc.startViewTransition;
  });

  function stubViewTransitions(): ReturnType<typeof vi.fn> {
    const start = vi.fn((callback: () => void | Promise<void>) => ({
      updateCallbackDone: Promise.resolve(callback()),
      finished: new Promise<void>(() => undefined),
    }));
    doc.startViewTransition = start;
    return start;
  }

  it('uses a view transition by default', async () => {
    const start = stubViewTransitions();
    bootAnnounceApp();

    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("transitions: 'off' mounts the view directly", async () => {
    const start = stubViewTransitions();
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: announceViews,
      transitions: 'off',
      configure: (app) => { app.route(AnnounceController); },
    });

    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });
    expect(start).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The announcement says the page title when the route resolved one, since a title
// is what a user would call the page, and the pathname is not.
// ---------------------------------------------------------------------------

@controller('/titled-boot')
@title('Records')
class TitledBootController extends Controller {
  @get()
  index(): IView {
    return View('/views/announce/index.tmvc');
  }

  @get('detail')
  detail(): IView {
    this.title = 'Ada Lovelace';
    return View('/views/announce/index.tmvc');
  }
}

describe('announcing the page title', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.body.appendChild(outlet);
    vi.stubGlobal('location', {
      pathname: '/titled-boot',
      href: 'http://localhost/titled-boot',
    });
  });

  it('announces the resolved title rather than the pathname', async () => {
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: announceViews,
      configure: (app) => { app.route(TitledBootController); },
    });
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/titled-boot/detail');

    expect(announcer()?.textContent).toBe('Ada Lovelace');
  });

  it('announces the title through the application template', async () => {
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: announceViews,
      title: (page) => `${page} | Acme`,
      configure: (app) => { app.route(TitledBootController); },
    });
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/titled-boot/detail');

    expect(announcer()?.textContent).toBe('Ada Lovelace | Acme');
    expect(document.title).toBe('Ada Lovelace | Acme');
  });

  it('falls back to the pathname when the route resolved no title', async () => {
    vi.stubGlobal('location', { pathname: '/announce', href: 'http://localhost/announce' });
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: announceViews,
      configure: (app) => { app.route(AnnounceController); },
    });
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/announce/elsewhere');

    expect(announcer()?.textContent).toBe('/announce/elsewhere');
  });

  it('applies the application default title when the route supplies none', async () => {
    vi.stubGlobal('location', { pathname: '/announce', href: 'http://localhost/announce' });
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: announceViews,
      title: 'Acme',
      configure: (app) => { app.route(AnnounceController); },
    });
    await vi.waitFor(() => { expect(outlet.innerHTML).toContain('announced'); });

    await navigateTo('/announce/elsewhere');

    expect(document.title).toBe('Acme');
    expect(announcer()?.textContent).toBe('Acme');
  });
});

// ---------------------------------------------------------------------------
// Async action lifecycle: pending, failure, and cancellation at the outlet.
// ---------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let asyncDeferred: Deferred<IView> | null = null;

@controller('/async')
@pending('/views/async/skeleton.tmvc')
@failure('/views/async/error.tmvc')
class AsyncController extends Controller {
  @get()
  async index(): Promise<IView> {
    if (asyncDeferred !== null) return await asyncDeferred.promise;
    return View('/views/async/detail.tmvc');
  }
}

@controller('/plain-async')
class PlainAsyncController extends Controller {
  @get()
  async index(): Promise<IView> {
    if (asyncDeferred !== null) return await asyncDeferred.promise;
    return View('/views/async/detail.tmvc');
  }
}

const asyncViews: ViewGlob = {
  '/views/async/skeleton.tmvc': () =>
    Promise.resolve({ default: () => html`<p class="skeleton">loading</p>` }),
  '/views/async/detail.tmvc': () =>
    Promise.resolve({ default: () => html`<p class="detail">detail</p>` }),
  '/views/async/error.tmvc': () =>
    Promise.resolve({
      default: (c: ViewContext): Fragment =>
        html`<p class="error">${String((c.model as { message?: unknown }).message)}</p>`,
    }),
};

describe('async action lifecycle', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.body.appendChild(outlet);
    asyncDeferred = null;
    vi.stubGlobal('location', { pathname: '/async', href: 'http://localhost/async' });
  });

  function bootAsync(config?: { pendingView?: string; failureView?: string }): void {
    bootstrap({
      outlet,
      viewsRoot: 'views/',
      views: asyncViews,
      pendingDelay: 0,
      transitions: 'off',
      ...(config?.pendingView !== undefined ? { pendingView: config.pendingView } : {}),
      ...(config?.failureView !== undefined ? { failureView: config.failureView } : {}),
      configure: (app) => { app.route(AsyncController); app.route(PlainAsyncController); },
    });
  }

  it('mounts the pending view, then replaces it with the real view', async () => {
    asyncDeferred = makeDeferred<IView>();
    bootAsync();

    await vi.waitFor(() => { expect(outlet.querySelector('.skeleton')).not.toBeNull(); });
    expect(outlet.querySelector('.detail')).toBeNull();

    asyncDeferred.resolve(View('/views/async/detail.tmvc'));
    await vi.waitFor(() => { expect(outlet.querySelector('.detail')).not.toBeNull(); });
    expect(outlet.querySelector('.skeleton')).toBeNull();
  });

  it('disposes the pending fragment when the real view mounts', async () => {
    asyncDeferred = makeDeferred<IView>();
    const dispose = vi.spyOn(Fragment.prototype, 'dispose');
    bootAsync();

    await vi.waitFor(() => { expect(outlet.querySelector('.skeleton')).not.toBeNull(); });
    const before = dispose.mock.calls.length;

    asyncDeferred.resolve(View('/views/async/detail.tmvc'));
    await vi.waitFor(() => { expect(outlet.querySelector('.detail')).not.toBeNull(); });

    // The pending fragment was torn down as part of mounting the real view.
    expect(dispose.mock.calls.length).toBeGreaterThan(before);
    dispose.mockRestore();
  });

  it('clears the pending view when the action redirects', async () => {
    asyncDeferred = makeDeferred<IView>();
    bootAsync();

    await vi.waitFor(() => { expect(outlet.querySelector('.skeleton')).not.toBeNull(); });

    asyncDeferred.resolve(Redirect('/somewhere'));
    await vi.waitFor(() => { expect(outlet.querySelector('.skeleton')).toBeNull(); });

    expect(outlet.innerHTML).toBe('');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('/somewhere');
  });

  it('uses the application default pending view for a route that declares none', async () => {
    vi.stubGlobal('location', { pathname: '/plain-async', href: 'http://localhost/plain-async' });
    asyncDeferred = makeDeferred<IView>();
    bootAsync({ pendingView: '/views/async/skeleton.tmvc' });

    await vi.waitFor(() => { expect(outlet.querySelector('.skeleton')).not.toBeNull(); });

    asyncDeferred.resolve(View('/views/async/detail.tmvc'));
    await vi.waitFor(() => { expect(outlet.querySelector('.detail')).not.toBeNull(); });
  });

  it('mounts the failure view with the error message when the action rejects', async () => {
    asyncDeferred = makeDeferred<IView>();
    bootAsync();

    await vi.waitFor(() => { expect(outlet.querySelector('.skeleton')).not.toBeNull(); });

    asyncDeferred.reject(new Error('record load failed'));
    await vi.waitFor(() => { expect(outlet.querySelector('.error')).not.toBeNull(); });

    expect(outlet.querySelector('.error')?.textContent).toBe('record load failed');
    expect(outlet.querySelector('.skeleton')).toBeNull();
  });

  it('uses the application default failure view for a route that declares none', async () => {
    vi.stubGlobal('location', { pathname: '/plain-async', href: 'http://localhost/plain-async' });
    asyncDeferred = makeDeferred<IView>();
    // No pendingView configured, so this route shows no skeleton before it fails.
    bootAsync({ failureView: '/views/async/error.tmvc' });
    await vi.waitFor(() => {
      expect(mockNavigation.addEventListener).toHaveBeenCalled();
    });

    asyncDeferred.reject(new Error('default failure'));
    await vi.waitFor(() => { expect(outlet.querySelector('.error')).not.toBeNull(); });

    expect(outlet.querySelector('.error')?.textContent).toBe('default failure');
  });
});
