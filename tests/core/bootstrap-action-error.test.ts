// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get } from '../../src/core/decorators.js';
import { inject } from '../../src/di/decorators.js';
import { ROUTER } from '../../src/router/tokens.js';
import { View } from '../../src/core/view.js';
import { html } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';
import type { IRouter, IView } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Navigation API mock
// ---------------------------------------------------------------------------

type NavigateListener = (event: MockNavigateEvent) => void;

class MockNavigateEvent {
  readonly canIntercept = true;
  readonly hashChange = false;
  readonly downloadRequest: string | null = null;
  readonly formData: FormData | null = null;
  readonly destination: { url: string };
  #handler: (() => Promise<void>) | null = null;

  constructor(url: string) {
    this.destination = { url };
  }

  intercept(options: { handler: () => Promise<void> }): void {
    this.#handler = options.handler;
  }

  async run(): Promise<void> {
    await this.#handler?.();
  }
}

let capturedListener: NavigateListener | null = null;

const mockNavigation = {
  addEventListener: vi.fn((_event: string, listener: NavigateListener): void => {
    capturedListener = listener;
  }),
  removeEventListener: vi.fn(),
  navigate: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

async function navigateTo(url: string): Promise<void> {
  const event = new MockNavigateEvent(url);
  capturedListener?.(event);
  await event.run();
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

@controller('/home')
class HomeController extends Controller {
  @get()
  index(): IView {
    return View();
  }
}

@controller('/boom')
class BoomController extends Controller {
  @get()
  index(): IView {
    throw new Error('service unavailable');
  }
}

let injectedRouter: IRouter | null = null;
const PALETTE = Symbol('PaletteService');

class PaletteService {
  constructor(@inject(ROUTER) readonly router: IRouter) {
    injectedRouter = router;
  }
}

@controller('/palette')
class PaletteController extends Controller {
  constructor(@inject(PALETTE) private readonly palette: PaletteService) {
    super();
  }

  @get()
  index(): IView {
    this.palette.router.navigateTo('/home');
    return View();
  }
}

const views = {
  '/views/home/index.tmvc': () => Promise.resolve({ default: () => html`<p>home</p>` }),
  '/views/palette/index.tmvc': () => Promise.resolve({ default: () => html`<p>palette</p>` }),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let outlet: Element;

beforeEach(() => {
  capturedListener = null;
  injectedRouter = null;
  outlet = document.createElement('div');
  vi.stubGlobal('navigation', mockNavigation);
  vi.stubGlobal('location', { pathname: '/home', href: 'http://localhost/home' });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function start(): void {
  bootstrap({
    outlet,
    views,
    configure(app) {
      app.singleton(PALETTE, (c) => new PaletteService(c.resolve(ROUTER)));
      app.route(HomeController);
      app.route(BoomController);
      app.route(PaletteController);
    },
  });
}

// ---------------------------------------------------------------------------
// Outlet takeover on a throwing action
// ---------------------------------------------------------------------------

describe('a throwing action in a bootstrapped app', () => {
  it('replaces the outlet with a message naming the controller, the action and the error', async () => {
    start();
    await navigateTo('http://localhost/home');
    expect(outlet.textContent).toContain('home');

    await navigateTo('http://localhost/boom');

    const text = outlet.textContent;
    expect(text).toContain('[TypeMVC]');
    expect(text).toContain('BoomController.index');
    expect(text).toContain('service unavailable');
    expect(text).not.toContain('home');
  });

  it('disposes the mounted fragment before clearing the outlet', async () => {
    const dispose = vi.spyOn(Fragment.prototype, 'dispose');
    start();
    await navigateTo('http://localhost/home');
    dispose.mockClear();

    await navigateTo('http://localhost/boom');

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ROUTER token registration
// ---------------------------------------------------------------------------

describe('the ROUTER token', () => {
  it('is registered by bootstrap, so a service can take the router with no registration of its own', async () => {
    start();

    await navigateTo('http://localhost/palette');

    expect(injectedRouter).not.toBeNull();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('/home');
  });
});
