import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../../src/router/router.js';
import type { ViewRenderer } from '../../src/router/router.js';
import { ROUTER } from '../../src/router/tokens.js';
import { Container } from '../../src/di/container.js';
import { inject } from '../../src/di/decorators.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get, guard } from '../../src/core/decorators.js';
import { EmptyView, View } from '../../src/core/view.js';
import type { ILogger, ILoggerFactory } from '../../src/logging/types.js';
import type { IRouteGuard, IRouter, IView } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Navigation API mock
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn<(path: string, options?: { history: string }) => void>();

const mockNavigation = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  navigate: mockNavigate,
  back: vi.fn(),
  forward: vi.fn(),
};

// ---------------------------------------------------------------------------
// Logger capture
// ---------------------------------------------------------------------------

interface LoggedError {
  readonly message: string;
  readonly error: Error | undefined;
}

function makeLoggerFactory(sink: LoggedError[]): ILoggerFactory {
  const logger: ILogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message: string, error?: Error): void => {
      sink.push({ message, error });
    },
  };
  return { create: () => logger };
}

// ---------------------------------------------------------------------------
// Controllers, services and guards (module level: decorators run once)
// ---------------------------------------------------------------------------

const SHELL_SERVICE = Symbol('ShellService');
const PALETTE_SERVICE = Symbol('CommandPaletteService');

class ShellService {
  readonly name = 'shell';
}

class ShellBase extends Controller {
  constructor(@inject(SHELL_SERVICE) protected readonly shell: ShellService) {
    super();
  }
}

let inheritedShellName: string | undefined;

@controller('/inherited')
class InheritedController extends ShellBase {
  @get()
  index(): IView {
    inheritedShellName = this.shell.name;
    return EmptyView();
  }
}

@controller('/undecorated')
class UndecoratedController extends Controller {
  constructor(readonly service: unknown) {
    super();
  }

  @get()
  index(): IView {
    return EmptyView();
  }
}

function rejectWith(reason: unknown): Promise<never> {
  return new Promise((_resolve, reject: (reason: Error) => void) => {
    reject(reason as Error);
  });
}

let thrownByAction: unknown = new Error('action exploded');
let actionRejects = false;
let handledByController: { error: Error; methodName: string } | null = null;

@controller('/boom')
class BoomController extends Controller {
  @get()
  index(): IView {
    if (actionRejects) {
      return rejectWith(thrownByAction) as unknown as IView;
    }
    throw thrownByAction;
  }

  protected override onActionError(error: Error, methodName: string): void {
    handledByController = { error, methodName };
  }
}

@controller('/bad-return')
class BadReturnController extends Controller {
  @get()
  index(): IView {
    return 42 as unknown as IView;
  }
}

@controller('/render-boom')
class RenderBoomController extends Controller {
  @get()
  index(): IView {
    return View();
  }
}

@controller('/hook-boom')
class HookBoomController extends Controller {
  protected override onInit(): void {
    throw new Error('init exploded');
  }

  @get()
  index(): IView {
    return View();
  }
}

let navigatedFromAction = false;
let navigatedFromHook = false;

@controller('/nav-from-action')
class NavFromActionController extends Controller {
  @get()
  index(): IView {
    this.router.navigateTo('/target');
    navigatedFromAction = true;
    return EmptyView();
  }
}

@controller('/nav-from-hook')
class NavFromHookController extends Controller {
  protected override onActivate(): void {
    this.router.replace('/target');
    navigatedFromHook = true;
  }

  @get()
  index(): IView {
    return EmptyView();
  }
}

class CommandPaletteService {
  constructor(@inject(ROUTER) private readonly router: IRouter) {}

  open(path: string): void {
    this.router.navigateTo(path);
  }
}

@controller('/palette')
class PaletteController extends Controller {
  constructor(@inject(PALETTE_SERVICE) private readonly palette: CommandPaletteService) {
    super();
  }

  @get()
  index(): IView {
    this.palette.open('/target');
    return EmptyView();
  }
}

class RouterGuard implements IRouteGuard {
  constructor(@inject(ROUTER) private readonly router: IRouter) {}

  canActivate(): boolean {
    this.router.replace('/login');
    return false;
  }
}

@controller('/guarded')
@guard(RouterGuard)
class GuardedController extends Controller {
  @get()
  index(): IView {
    return EmptyView();
  }
}

class ThrowingGuard implements IRouteGuard {
  canActivate(): boolean {
    throw new Error('guard exploded');
  }
}

class RejectingGuard implements IRouteGuard {
  canActivate(): Promise<boolean> {
    return Promise.reject(new Error('guard rejected'));
  }
}

class DenyingGuard implements IRouteGuard {
  canActivate(): boolean {
    return false;
  }
}

@controller('/guard-throw')
@guard(ThrowingGuard)
class GuardThrowController extends Controller {
  @get()
  index(): IView {
    return EmptyView();
  }
}

@controller('/guard-reject')
@guard(RejectingGuard)
class GuardRejectController extends Controller {
  @get()
  index(): IView {
    return EmptyView();
  }
}

@controller('/guard-deny')
@guard(DenyingGuard)
class GuardDenyController extends Controller {
  @get()
  index(): IView {
    return EmptyView();
  }
}

@controller('/leaving')
class LeavingController extends Controller {
  @get()
  index(): IView {
    this.router.navigateTo('/page');
    return View();
  }
}

@controller('/page')
class PageController extends Controller {
  @get()
  index(): IView {
    return View();
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let container: Container;
let outlet: Element;

beforeEach(() => {
  vi.stubGlobal('navigation', mockNavigation);
  vi.stubGlobal('location', { pathname: '/', href: 'http://localhost/' });
  vi.stubGlobal('document', {});
  vi.clearAllMocks();

  inheritedShellName = undefined;
  thrownByAction = new Error('action exploded');
  actionRejects = false;
  handledByController = null;
  navigatedFromAction = false;
  navigatedFromHook = false;

  container = new Container();
  container.singleton(SHELL_SERVICE, () => new ShellService());
  container.singleton(PALETTE_SERVICE, (c) => new CommandPaletteService(c.resolve(ROUTER)));
  outlet = { replaceChildren: vi.fn() } as unknown as Element;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeRouter(options?: ConstructorParameters<typeof Router>[2]): Router {
  const router = new Router(container, outlet, options);
  container.singleton(ROUTER, () => router);
  return router;
}

/** registerController takes an unknown-argument constructor; an injected controller's
 * constructor is typed, so the cast is what an application's route registration does. */
function register(router: Router, cls: abstract new (...args: never) => Controller): void {
  router.registerController(cls as unknown as new (...args: unknown[]) => unknown);
}

// ---------------------------------------------------------------------------
// Injection metadata inheritance through the router
// ---------------------------------------------------------------------------

describe('constructor injection through the router', () => {
  it('injects a base class dependency into a subclass that declares no constructor', async () => {
    const router = makeRouter();
    register(router, InheritedController);

    await router.handle('http://localhost/inherited', null);

    expect(inheritedShellName).toBe('shell');
  });

  it('warns when a controller declares more parameters than it has @inject tokens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const router = makeRouter();
    router.registerController(UndecoratedController);

    await router.handle('http://localhost/undecorated', null);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('Controller "UndecoratedController"');
  });
});

// ---------------------------------------------------------------------------
// Action failures
// ---------------------------------------------------------------------------

describe('a throwing action', () => {
  it('logs the controller, the action and the error with no app error handler registered', async () => {
    const logged: LoggedError[] = [];
    const router = makeRouter({ loggerFactory: makeLoggerFactory(logged) });
    router.registerController(BoomController);

    await router.handle('http://localhost/boom', null);

    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toBe('Action BoomController.index threw');
    expect(logged[0]?.error?.message).toBe('action exploded');
  });

  it('calls the app error handler with the error and the method name, and still logs', async () => {
    const logged: LoggedError[] = [];
    const appErrorHandler = vi.fn<(error: Error, methodName: string, event?: unknown) => void>();
    const router = makeRouter({ appErrorHandler, loggerFactory: makeLoggerFactory(logged) });
    router.registerController(BoomController);

    await router.handle('http://localhost/boom', null);

    expect(appErrorHandler).toHaveBeenCalledTimes(1);
    expect(appErrorHandler.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(appErrorHandler.mock.calls[0]?.[1]).toBe('index');
    expect(appErrorHandler.mock.calls[0]?.[2]).toMatchObject({
      controller: 'BoomController',
      action: 'index',
      route: '/boom',
      phase: 'action',
    });
    expect(logged).toHaveLength(1);
  });

  it('reports the controller, the action and the error to onActionError', async () => {
    const onActionError = vi.fn<(controllerName: string, methodName: string, error: Error) => void>();
    const router = makeRouter({ onActionError });
    router.registerController(BoomController);

    await router.handle('http://localhost/boom', null);

    expect(onActionError).toHaveBeenCalledWith('BoomController', 'index', expect.any(Error));
  });

  it('runs the controller own onActionError hook', async () => {
    const router = makeRouter();
    router.registerController(BoomController);

    await router.handle('http://localhost/boom', null);

    expect(handledByController?.methodName).toBe('index');
    expect(handledByController?.error.message).toBe('action exploded');
  });

  it('reports a rejected async action the same way as a synchronous throw', async () => {
    actionRejects = true;
    const onActionError = vi.fn<(controllerName: string, methodName: string, error: Error) => void>();
    const router = makeRouter({ onActionError });
    router.registerController(BoomController);

    await router.handle('http://localhost/boom', null);

    expect(onActionError).toHaveBeenCalledWith('BoomController', 'index', expect.any(Error));
    expect(handledByController?.error.message).toBe('action exploded');
  });

  it('wraps a non-Error throw before reporting it', async () => {
    thrownByAction = 'just a string';
    const onActionError = vi.fn<(controllerName: string, methodName: string, error: Error) => void>();
    const router = makeRouter({ onActionError });
    router.registerController(BoomController);

    await router.handle('http://localhost/boom', null);

    const reported = onActionError.mock.calls[0]?.[2];
    expect(reported).toBeInstanceOf(Error);
    expect(reported?.message).toContain('just a string');
  });

  it('renders no view', async () => {
    const viewRenderer = vi.fn().mockResolvedValue(undefined);
    const router = makeRouter({ viewRenderer: viewRenderer as unknown as ViewRenderer });
    router.registerController(BoomController);

    await router.handle('http://localhost/boom', null);

    expect(viewRenderer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Invalid action result
// ---------------------------------------------------------------------------

describe('an action that returns a non-view value', () => {
  it('routes the invalid return through the failure path with an actionable message', async () => {
    const onActionError = vi.fn<(controllerName: string, methodName: string, error: Error) => void>();
    const router = makeRouter({ onActionError });
    router.registerController(BadReturnController);

    await router.handle('http://localhost/bad-return', null);

    expect(onActionError).toHaveBeenCalledWith('BadReturnController', 'index', expect.any(Error));
    const reported = onActionError.mock.calls[0]?.[2];
    expect(reported?.message).toContain('did not return');
  });

  it('does not reject out of the handler', async () => {
    const router = makeRouter();
    router.registerController(BadReturnController);

    await expect(router.handle('http://localhost/bad-return', null)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Render-time failure on the normal mount path
// ---------------------------------------------------------------------------

describe('a view render that throws', () => {
  it('routes the render throw through the failure path instead of rejecting', async () => {
    const onActionError = vi.fn<(controllerName: string, methodName: string, error: Error) => void>();
    const viewRenderer = vi.fn().mockRejectedValue(new Error('render exploded'));
    const router = makeRouter({
      onActionError,
      viewRenderer: viewRenderer as unknown as ViewRenderer,
    });
    router.registerController(RenderBoomController);

    await expect(router.handle('http://localhost/render-boom', null)).resolves.toBeUndefined();

    expect(onActionError).toHaveBeenCalledWith('RenderBoomController', 'index', expect.any(Error));
  });
});

// ---------------------------------------------------------------------------
// Guard failures
// ---------------------------------------------------------------------------

describe('a throwing guard', () => {
  it('reports a throwing guard with phase guard and cancels', async () => {
    const appErrorHandler = vi.fn<(error: Error, methodName: string, event?: unknown) => void>();
    const router = makeRouter({ appErrorHandler });
    register(router, GuardThrowController);

    await router.handle('http://localhost/guard-throw', null);

    expect(appErrorHandler).toHaveBeenCalledWith(
      expect.any(Error),
      'index',
      expect.objectContaining({
        controller: 'GuardThrowController',
        route: '/guard-throw',
        phase: 'guard',
      }),
    );
  });

  it('reports a rejecting guard the same way', async () => {
    const appErrorHandler = vi.fn<(error: Error, methodName: string, event?: unknown) => void>();
    const router = makeRouter({ appErrorHandler });
    register(router, GuardRejectController);

    await router.handle('http://localhost/guard-reject', null);

    expect(appErrorHandler).toHaveBeenCalledWith(
      expect.any(Error),
      'index',
      expect.objectContaining({ phase: 'guard' }),
    );
  });

  it('does not report a guard that returns false', async () => {
    const appErrorHandler = vi.fn<(error: Error, methodName: string, event?: unknown) => void>();
    const router = makeRouter({ appErrorHandler });
    register(router, GuardDenyController);

    await router.handle('http://localhost/guard-deny', null);

    expect(appErrorHandler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle failures
// ---------------------------------------------------------------------------

describe('a throwing lifecycle hook', () => {
  it('logs the controller and the hook, calls the app error handler, and still renders', async () => {
    const logged: LoggedError[] = [];
    const appErrorHandler = vi.fn<(error: Error, methodName: string, event?: unknown) => void>();
    const onActionError = vi.fn<(controllerName: string, methodName: string, error: Error) => void>();
    const viewRenderer = vi.fn().mockResolvedValue(undefined);
    const router = makeRouter({
      appErrorHandler,
      onActionError,
      loggerFactory: makeLoggerFactory(logged),
      viewRenderer: viewRenderer as unknown as ViewRenderer,
    });
    router.registerController(HookBoomController);

    await router.handle('http://localhost/hook-boom', null);

    expect(logged[0]?.message).toBe('HookBoomController.onInit threw');
    expect(logged[0]?.error?.message).toBe('init exploded');
    expect(appErrorHandler).toHaveBeenCalledWith(
      expect.any(Error),
      'onInit',
      expect.objectContaining({
        controller: 'HookBoomController',
        action: 'onInit',
        route: '/hook-boom',
        phase: 'lifecycle',
      }),
    );
    expect(onActionError).not.toHaveBeenCalled();
    expect(viewRenderer).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Router access
// ---------------------------------------------------------------------------

describe('router access', () => {
  it('lets a controller with no constructor navigate from an action', async () => {
    const router = makeRouter();
    router.registerController(NavFromActionController);

    await router.handle('http://localhost/nav-from-action', null);

    expect(navigatedFromAction).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/target');
  });

  it('lets a controller navigate from a lifecycle hook', async () => {
    const router = makeRouter();
    router.registerController(NavFromHookController);

    await router.handle('http://localhost/nav-from-hook', null);

    expect(navigatedFromHook).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/target', { history: 'replace' });
  });

  it('leaves the @inject contract of a controller that declares a constructor untouched', async () => {
    const router = makeRouter();
    register(router, PaletteController);

    await router.handle('http://localhost/palette', null);

    expect(mockNavigate).toHaveBeenCalledWith('/target');
  });

  it('injects the router into a guard through the ROUTER token', async () => {
    const router = makeRouter();
    router.registerController(GuardedController);

    await router.handle('http://localhost/guarded', null);

    expect(mockNavigate).toHaveBeenCalledWith('/login', { history: 'replace' });
  });

  it('throws a locatable error when a controller is constructed outside the router', () => {
    class Detached extends Controller {
      reachRouter(): IRouter {
        return this.router;
      }
    }

    expect(() => new Detached().reachRouter()).toThrow(/\[TypeMVC\] "Detached" has no router/);
  });
});

// ---------------------------------------------------------------------------
// Navigation ordering
// ---------------------------------------------------------------------------

describe('a navigation started while another is running', () => {
  it('supersedes it, and the abandoned navigation renders no view', async () => {
    const rendered: string[] = [];
    const viewRenderer: ViewRenderer = (
      _iview,
      _context,
      _outletEl,
      resolvedPath,
    ): Promise<void> => {
      rendered.push(resolvedPath);
      return Promise.resolve();
    };

    const router = makeRouter({ viewRenderer });
    router.registerController(LeavingController);
    router.registerController(PageController);

    const started: Promise<void>[] = [];
    mockNavigate.mockImplementation((path: string): void => {
      started.push(router.handle(`http://localhost${path}`, null));
    });

    await router.handle('http://localhost/leaving', null);
    await Promise.all(started);

    expect(rendered).toEqual(['views/page/index.tmvc']);
  });
});
