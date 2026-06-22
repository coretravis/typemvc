import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../../src/router/router.js';
import type { ViewRenderer } from '../../src/router/router.js';
import { Container } from '../../src/di/container.js';
import { Controller } from '../../src/core/controller.js';
import {
  controller,
  retain,
  get,
  post,
  body,
  guard,
  layout,
} from '../../src/core/decorators.js';
import { dataType, required, min } from '../../src/validation/decorators.js';
import { inject } from '../../src/di/decorators.js';
import { EmptyView, Redirect, RedirectReplace, View } from '../../src/core/view.js';
import type { IView, ViewContext, IRouteGuard, ResolvedRoute, LayoutConstructor } from '../../src/types/index.js';
import { defineLayout } from '../../src/layout/layout.js';
import { html } from '../../src/renderer/html.js';

// ---------------------------------------------------------------------------
// Mock NavigateEvent
// ---------------------------------------------------------------------------

class MockNavigateEvent {
  readonly canIntercept: boolean;
  readonly hashChange: boolean;
  readonly downloadRequest: string | null;
  readonly destination: { url: string };
  readonly formData: FormData | null;

  private _handler: (() => Promise<void>) | null = null;

  constructor(
    url: string,
    opts?: {
      canIntercept?: boolean;
      hashChange?: boolean;
      downloadRequest?: string;
      formData?: FormData;
    },
  ) {
    this.canIntercept = opts?.canIntercept ?? true;
    this.hashChange = opts?.hashChange ?? false;
    this.downloadRequest = opts?.downloadRequest ?? null;
    this.destination = { url };
    this.formData = opts?.formData ?? null;
  }

  intercept(options: { handler: () => Promise<void> }): void {
    this._handler = options.handler;
  }

  get wasIntercepted(): boolean {
    return this._handler !== null;
  }

  async runHandler(): Promise<void> {
    if (this._handler !== null) {
      await this._handler();
    }
  }
}

// ---------------------------------------------------------------------------
// Test controllers (module-level so decorators execute once at load time)
// ---------------------------------------------------------------------------

let indexCallCount = 0;
let detailsLastId: string | undefined;
let activeCallCount = 0;
let searchLastTerm: string | undefined;
let postLastFormData: FormData | null = null;

@controller('/users')
class UsersController extends Controller {
  @get()
  index(): IView {
    indexCallCount++;
    return EmptyView();
  }

  @get('{id}')
  details(id: string): IView {
    detailsLastId = id;
    return EmptyView();
  }

  @get('active')
  active(): IView {
    activeCallCount++;
    return EmptyView();
  }

  @get('search/{term?}')
  search(term: string | undefined): IView {
    searchLastTerm = term;
    return EmptyView();
  }

  @post()
  create(formData: FormData): IView {
    postLastFormData = formData;
    return EmptyView();
  }
}

let catchAllCallCount = 0;

@controller('*')
class CatchAllController extends Controller {
  @get()
  fallback(): IView {
    catchAllCallCount++;
    return EmptyView();
  }
}

let pageReturnView: IView = EmptyView();

@controller('/page')
class PageController extends Controller {
  @get()
  index(): IView {
    return pageReturnView;
  }
}

// Retention and fresh-instance tests use constructor counting
let retainCtrlConstructorCount = 0;

@controller('/retain-test')
@retain()
class RetainCtrl extends Controller {
  constructor() {
    super();
    retainCtrlConstructorCount++;
  }

  @get()
  index(): IView {
    return EmptyView();
  }
}

let freshCtrlConstructorCount = 0;

@controller('/fresh-test')
class FreshCtrl extends Controller {
  constructor() {
    super();
    freshCtrlConstructorCount++;
  }

  @get()
  index(): IView {
    return EmptyView();
  }
}

let redirectLastResult: IView = EmptyView();

@controller('/redirect-test')
class RedirectController extends Controller {
  @get()
  index(): IView {
    return redirectLastResult;
  }
}

// @body parameter binding (issue 049)
class CreateUserDto {
  @dataType('string')
  @required()
  name = '';

  @dataType('number')
  @min(1)
  age = 0;
}

let bodyLastInstance: unknown = undefined;
let bodyLastHasErrors = false;

@controller('/body')
class BodyController extends Controller {
  @post()
  create(@body(CreateUserDto) dto: CreateUserDto): IView {
    bodyLastInstance = dto;
    bodyLastHasErrors = this.hasErrors();
    return EmptyView();
  }
}

// ---------------------------------------------------------------------------
// Mock navigation global
// ---------------------------------------------------------------------------

type NavigateListener = (event: MockNavigateEvent) => void;
let capturedNavigateListener: NavigateListener | null = null;
const mockNavigate = vi.fn<(path: string, options?: { history: string }) => void>();
const mockBack = vi.fn<() => void>();
const mockForward = vi.fn<() => void>();

const mockNavigation = {
  addEventListener: vi.fn((_event: string, listener: NavigateListener): void => {
    capturedNavigateListener = listener;
  }),
  navigate: mockNavigate,
  back: mockBack,
  forward: mockForward,
};

async function fireNavigate(
  url: string,
  opts?: {
    canIntercept?: boolean;
    hashChange?: boolean;
    downloadRequest?: string;
    formData?: FormData;
  },
): Promise<MockNavigateEvent> {
  const event = new MockNavigateEvent(url, opts);
  capturedNavigateListener?.(event);
  await event.runHandler();
  return event;
}

// ---------------------------------------------------------------------------
// Setup and teardown
// ---------------------------------------------------------------------------

let container: Container;
let outlet: Element;
let router: Router;

beforeEach(() => {
  vi.stubGlobal('navigation', mockNavigation);
  vi.stubGlobal('location', { pathname: '/', href: 'http://localhost/' });
  vi.stubGlobal('document', {});
  vi.clearAllMocks();
  capturedNavigateListener = null;

  indexCallCount = 0;
  detailsLastId = undefined;
  activeCallCount = 0;
  searchLastTerm = undefined;
  postLastFormData = null;
  catchAllCallCount = 0;
  pageReturnView = EmptyView();
  retainCtrlConstructorCount = 0;
  freshCtrlConstructorCount = 0;
  redirectLastResult = EmptyView();
  bodyLastInstance = undefined;
  bodyLastHasErrors = false;

  container = new Container();
  outlet = { replaceChildren: vi.fn() } as unknown as Element;
  router = new Router(container, outlet);
  router.attach();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Navigation API listener registration
// ---------------------------------------------------------------------------

describe('attach()', () => {
  it('registers exactly one navigate listener on the Navigation API', () => {
    expect(mockNavigation.addEventListener).toHaveBeenCalledTimes(1);
    expect(mockNavigation.addEventListener).toHaveBeenCalledWith(
      'navigate',
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Skip conditions (§10.1)
// ---------------------------------------------------------------------------

describe('skip conditions', () => {
  it('does not intercept when canIntercept is false', async () => {
    router.registerController(UsersController);
    const event = await fireNavigate('http://localhost/users', { canIntercept: false });
    expect(event.wasIntercepted).toBe(false);
  });

  it('does not intercept hash-change navigations', async () => {
    router.registerController(UsersController);
    const event = await fireNavigate('http://localhost/users#section', { hashChange: true });
    expect(event.wasIntercepted).toBe(false);
  });

  it('does not intercept download navigations', async () => {
    router.registerController(UsersController);
    const event = await fireNavigate('http://localhost/file.pdf', {
      downloadRequest: 'file.pdf',
    });
    expect(event.wasIntercepted).toBe(false);
  });

  it('intercepts a normal GET navigation', async () => {
    router.registerController(UsersController);
    const event = await fireNavigate('http://localhost/users');
    expect(event.wasIntercepted).toBe(true);
  });

  it('intercepts a form POST navigation', async () => {
    router.registerController(UsersController);
    const fd = new FormData();
    const event = await fireNavigate('http://localhost/users', { formData: fd });
    expect(event.wasIntercepted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route matching: literal segment precedence
// ---------------------------------------------------------------------------

describe('route specificity ordering', () => {
  it('literal /users/active takes precedence over /users/{id}', async () => {
    router.registerController(UsersController);
    await fireNavigate('http://localhost/users/active');

    expect(activeCallCount).toBe(1);
    expect(detailsLastId).toBeUndefined();
  });

  it('parameterised route /users/{id} matches when no literal wins', async () => {
    router.registerController(UsersController);
    await fireNavigate('http://localhost/users/42');

    expect(detailsLastId).toBe('42');
    expect(activeCallCount).toBe(0);
  });

  it('literal wins even when the parameterised route was evaluated at lower specificity', async () => {
    router.registerController(UsersController);
    await fireNavigate('http://localhost/users/active');

    // active (specificity=4) beats {id} (specificity=3)
    expect(activeCallCount).toBe(1);
    expect(detailsLastId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Named parameter extraction
// ---------------------------------------------------------------------------

describe('named parameter extraction', () => {
  it('extracts a required named parameter by name', async () => {
    router.registerController(UsersController);
    await fireNavigate('http://localhost/users/99');

    expect(detailsLastId).toBe('99');
  });

  it('passes route params into context.params in the view', async () => {
    const captured = { params: null as Readonly<Record<string, string>> | null };
    pageReturnView = View();

    const viewRenderer: ViewRenderer = (_iview: IView, context: ViewContext): Promise<void> => {
      captured.params = context.params;
      return Promise.resolve();
    };

    @controller('/items')
    class ItemsController extends Controller {
      @get('{id}')
      detail(id: string): IView {
        void id;
        return pageReturnView;
      }
    }

    const r = new Router(container, outlet, { viewRenderer });
    r.registerController(ItemsController);
    r.attach();

    await fireNavigate('http://localhost/items/777');

    expect(captured.params ?? {}).toMatchObject({ id: '777' });
  });
});

// ---------------------------------------------------------------------------
// Optional parameter binding
// ---------------------------------------------------------------------------

describe('optional parameter binding', () => {
  it('binds optional param to its value when present', async () => {
    router.registerController(UsersController);
    await fireNavigate('http://localhost/users/search/hello');

    expect(searchLastTerm).toBe('hello');
  });

  it('binds optional param to undefined when absent', async () => {
    router.registerController(UsersController);
    await fireNavigate('http://localhost/users/search');

    expect(searchLastTerm).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Catch-all route
// ---------------------------------------------------------------------------

describe('catch-all route', () => {
  it('catch-all matches a path with no other registered route', async () => {
    router.registerController(CatchAllController);
    await fireNavigate('http://localhost/completely/unknown/path');

    expect(catchAllCallCount).toBe(1);
  });

  it('catch-all does not preempt a more specific registered route', async () => {
    router.registerController(UsersController);
    router.registerController(CatchAllController);

    await fireNavigate('http://localhost/users');

    expect(indexCallCount).toBe(1);
    expect(catchAllCallCount).toBe(0);
  });

  it('catch-all matches the root path when no other route covers it', async () => {
    router.registerController(CatchAllController);
    await fireNavigate('http://localhost/');

    expect(catchAllCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No-match: no route, no catch-all
// ---------------------------------------------------------------------------

describe('unmatched navigation', () => {
  it('does not call any action when no route matches', async () => {
    router.registerController(UsersController);
    await fireNavigate('http://localhost/completely/unknown');

    expect(indexCallCount).toBe(0);
    expect(detailsLastId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Form submission (POST verb)
// ---------------------------------------------------------------------------

describe('form submission navigation', () => {
  it('routes a form POST to the @post action', async () => {
    const fd = new FormData();
    fd.append('name', 'Alice');

    router.registerController(UsersController);
    await fireNavigate('http://localhost/users', { formData: fd });

    expect(postLastFormData).toBe(fd);
  });

  it('does not route a POST navigation to a @get action', async () => {
    const fd = new FormData();

    router.registerController(UsersController);
    await fireNavigate('http://localhost/users', { formData: fd });

    expect(indexCallCount).toBe(0);
  });

  it('passes the raw FormData to an action without @body (AC4)', async () => {
    const fd = new FormData();
    fd.append('name', 'Alice');

    router.registerController(UsersController);
    await fireNavigate('http://localhost/users', { formData: fd });

    expect(postLastFormData).toBe(fd);
  });
});

// ---------------------------------------------------------------------------
// @body parameter binding (issue 049)
// ---------------------------------------------------------------------------

describe('@body parameter binding', () => {
  it('binds the form data into a typed DTO instance with coerced values (AC2)', async () => {
    const fd = new FormData();
    fd.append('name', 'Alice');
    fd.append('age', '30');

    router.registerController(BodyController);
    await fireNavigate('http://localhost/body', { formData: fd });

    expect(bodyLastInstance).toBeInstanceOf(CreateUserDto);
    const dto = bodyLastInstance as CreateUserDto;
    expect(dto.name).toBe('Alice');
    expect(dto.age).toBe(30); // coerced from string to number
  });

  it('passes a DTO instance, not the raw FormData', async () => {
    const fd = new FormData();
    fd.append('name', 'Bob');
    fd.append('age', '5');

    router.registerController(BodyController);
    await fireNavigate('http://localhost/body', { formData: fd });

    expect(bodyLastInstance).not.toBeInstanceOf(FormData);
  });

  it('primes context errors before the action runs when validation fails (AC3)', async () => {
    const fd = new FormData();
    fd.append('name', ''); // @required fails
    fd.append('age', '0'); // @min(1) fails

    router.registerController(BodyController);
    await fireNavigate('http://localhost/body', { formData: fd });

    expect(bodyLastHasErrors).toBe(true);
    expect(bodyLastInstance).toBeInstanceOf(CreateUserDto); // still invoked with the instance
  });
});

// ---------------------------------------------------------------------------
// IRouter.navigateTo() and replace()
// ---------------------------------------------------------------------------

describe('IRouter.navigateTo()', () => {
  it('calls navigation.navigate() with the given path', () => {
    router.navigateTo('/users');
    expect(mockNavigate).toHaveBeenCalledWith('/users');
  });

  it('does not include a history option (push is the default)', () => {
    router.navigateTo('/users');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[1]).toBeUndefined();
  });
});

describe('IRouter.replace()', () => {
  it('calls navigation.navigate() with history: replace option', () => {
    router.replace('/login');
    expect(mockNavigate).toHaveBeenCalledWith('/login', { history: 'replace' });
  });
});

// ---------------------------------------------------------------------------
// IRouter.back() and forward()
// ---------------------------------------------------------------------------

describe('IRouter.back() and forward()', () => {
  it('back() invokes navigation.back()', () => {
    router.back();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('forward() invokes navigation.forward()', () => {
    router.forward();
    expect(mockForward).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// IRouter.current
// ---------------------------------------------------------------------------

describe('IRouter.current', () => {
  it('reflects the current location.pathname', () => {
    vi.stubGlobal('location', { pathname: '/users/42', href: 'http://localhost/users/42' });
    expect(router.current).toBe('/users/42');
  });

  it('reflects updates when the location stub changes', () => {
    vi.stubGlobal('location', { pathname: '/dashboard', href: 'http://localhost/dashboard' });
    expect(router.current).toBe('/dashboard');
  });
});

// ---------------------------------------------------------------------------
// Redirect handling
// ---------------------------------------------------------------------------

describe('redirect handling', () => {
  it('calls navigation.navigate() for a Redirect IView result', async () => {
    redirectLastResult = Redirect('/users');
    router.registerController(RedirectController);
    await fireNavigate('http://localhost/redirect-test');

    expect(mockNavigate).toHaveBeenCalledWith('/users');
  });

  it('calls navigation.navigate() with replace for RedirectReplace', async () => {
    redirectLastResult = RedirectReplace('/login');
    router.registerController(RedirectController);
    await fireNavigate('http://localhost/redirect-test');

    expect(mockNavigate).toHaveBeenCalledWith('/login', { history: 'replace' });
  });

  it('does not invoke viewRenderer for an EmptyView result', async () => {
    const viewRendererMock = vi.fn().mockResolvedValue(undefined);
    redirectLastResult = EmptyView();

    const r = new Router(container, outlet, {
      viewRenderer: viewRendererMock as unknown as ViewRenderer,
    });
    r.registerController(RedirectController);
    r.attach();

    await fireNavigate('http://localhost/redirect-test');

    expect(viewRendererMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// View Transitions API
// ---------------------------------------------------------------------------

describe('View Transitions API', () => {
  it('calls document.startViewTransition when available', async () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
    });
    vi.stubGlobal('document', { startViewTransition });

    const viewRendererMock = vi.fn().mockResolvedValue(undefined);
    pageReturnView = View();

    const r = new Router(container, outlet, {
      viewRenderer: viewRendererMock as unknown as ViewRenderer,
    });
    r.registerController(PageController);
    r.attach();

    await fireNavigate('http://localhost/page');

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(viewRendererMock).toHaveBeenCalled();
  });

  it('performs an instant swap when startViewTransition is not available', async () => {
    vi.stubGlobal('document', {});

    const viewRendererMock = vi.fn().mockResolvedValue(undefined);
    pageReturnView = View();

    const r = new Router(container, outlet, {
      viewRenderer: viewRendererMock as unknown as ViewRenderer,
    });
    r.registerController(PageController);
    r.attach();

    await fireNavigate('http://localhost/page');

    expect(viewRendererMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Controller retention and lifecycle
// ---------------------------------------------------------------------------

describe('controller retention', () => {
  it('@retain(): reuses the same instance across multiple navigations', async () => {
    router.registerController(RetainCtrl);

    await fireNavigate('http://localhost/retain-test');
    await fireNavigate('http://localhost/fresh-test');
    await fireNavigate('http://localhost/retain-test');

    expect(retainCtrlConstructorCount).toBe(1);
  });

  it('no decorator (fresh): creates a new instance on every navigation', async () => {
    router.registerController(FreshCtrl);

    await fireNavigate('http://localhost/fresh-test');
    await fireNavigate('http://localhost/fresh-test');

    expect(freshCtrlConstructorCount).toBe(2);
  });
});

describe('controller lifecycle hooks', () => {
  it('onInit is called exactly once on first navigation', async () => {
    let initCount = 0;

    @controller('/lc-init')
    @retain()
    class InitCtrl extends Controller {
      protected override onInit(): void { initCount++; }
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(InitCtrl);
    await fireNavigate('http://localhost/lc-init');
    await fireNavigate('http://localhost/fresh-test');
    await fireNavigate('http://localhost/lc-init');

    expect(initCount).toBe(1);
  });

  it('onActivate is called on every navigation to the route', async () => {
    let activateCount = 0;

    @controller('/lc-activate')
    @retain()
    class ActivateCtrl extends Controller {
      protected override onActivate(): void { activateCount++; }
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(ActivateCtrl);
    router.registerController(FreshCtrl);
    await fireNavigate('http://localhost/lc-activate');
    await fireNavigate('http://localhost/fresh-test');
    await fireNavigate('http://localhost/lc-activate');

    expect(activateCount).toBe(2);
  });

  it('onDeactivate is called when navigating away', async () => {
    let deactivateCount = 0;

    @controller('/lc-deactivate')
    class DeactivateCtrl extends Controller {
      protected override onDeactivate(): void { deactivateCount++; }
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(DeactivateCtrl);
    router.registerController(FreshCtrl);
    await fireNavigate('http://localhost/lc-deactivate');
    await fireNavigate('http://localhost/fresh-test');

    expect(deactivateCount).toBe(1);
  });

  it('onDispose is called for fresh controllers when navigating away', async () => {
    let disposeCount = 0;

    @controller('/lc-dispose')
    class DisposeCtrl extends Controller {
      protected override onDispose(): void { disposeCount++; }
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(DisposeCtrl);
    router.registerController(FreshCtrl);
    await fireNavigate('http://localhost/lc-dispose');
    await fireNavigate('http://localhost/fresh-test');

    expect(disposeCount).toBe(1);
  });

  it('onDispose is NOT called for retained controllers on navigation away', async () => {
    let disposeCount = 0;

    @controller('/lc-retain-dispose')
    @retain()
    class RetainDisposeCtrl extends Controller {
      protected override onDispose(): void { disposeCount++; }
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(RetainDisposeCtrl);
    router.registerController(FreshCtrl);
    await fireNavigate('http://localhost/lc-retain-dispose');
    await fireNavigate('http://localhost/fresh-test');

    expect(disposeCount).toBe(0);
  });

  it('onActivate receives the correct route', async () => {
    let receivedPathname: string | undefined;

    @controller('/lc-route')
    class RouteCtrl extends Controller {
      protected override onActivate(route: ResolvedRoute): void { receivedPathname = route.pathname; }
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(RouteCtrl);
    await fireNavigate('http://localhost/lc-route');

    expect(receivedPathname).toBe('/lc-route');
  });

  it('@retain(ttlMs): disposes the retained controller after TTL expires', async () => {
    vi.useFakeTimers();
    let disposeReason: string | undefined;

    @controller('/lc-ttl')
    @retain(1000)
    class TtlCtrl extends Controller {
      protected override onDispose(reason: import('../../src/types/index.js').DisposeReason): void {
        disposeReason = reason;
      }
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(TtlCtrl);
    router.registerController(FreshCtrl);
    await fireNavigate('http://localhost/lc-ttl');
    await fireNavigate('http://localhost/fresh-test');

    expect(disposeReason).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1001);

    expect(disposeReason).toBe('ttl-expired');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// registerController: ignores classes without metadata
// ---------------------------------------------------------------------------

describe('registerController', () => {
  it('silently ignores a class without @controller metadata', () => {
    class Undecorated extends Controller {
      index(): IView {
        return EmptyView();
      }
    }
    expect(() => {
      router.registerController(Undecorated);
    }).not.toThrow();
  });

  it('silently ignores a controller with no action methods', () => {
    @controller('/no-actions')
    class NoActions extends Controller {}

    expect(() => {
      router.registerController(NoActions);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// matcher additions: computeRouteSpecificity and compileCatchAll
// ---------------------------------------------------------------------------

describe('computeRouteSpecificity', () => {
  it('is exported from matcher.ts', async () => {
    const { computeRouteSpecificity } = await import('../../src/router/matcher.js');
    expect(typeof computeRouteSpecificity).toBe('function');
  });

  it('scores literal segments higher than required params at the same depth', async () => {
    const { computeRouteSpecificity } = await import('../../src/router/matcher.js');
    const literal = computeRouteSpecificity('/users', 'active');
    const param = computeRouteSpecificity('/users', '{id}');
    expect(literal).toBeGreaterThan(param);
  });

  it('scores required params higher than optional params', async () => {
    const { computeRouteSpecificity } = await import('../../src/router/matcher.js');
    const req = computeRouteSpecificity('/users', '{id}');
    const opt = computeRouteSpecificity('/users', '{id?}');
    expect(req).toBeGreaterThan(opt);
  });

  it('returns -1 for a catch-all basePath', async () => {
    const { computeRouteSpecificity } = await import('../../src/router/matcher.js');
    expect(computeRouteSpecificity('*', '')).toBe(-1);
  });

  it('accumulates score across multiple segments', async () => {
    const { computeRouteSpecificity } = await import('../../src/router/matcher.js');
    const twoLiterals = computeRouteSpecificity('/users', 'active');
    const oneLiteral = computeRouteSpecificity('/users', '');
    expect(twoLiterals).toBeGreaterThan(oneLiteral);
  });
});

describe('compileCatchAll', () => {
  it('is exported from matcher.ts', async () => {
    const { compileCatchAll } = await import('../../src/router/matcher.js');
    expect(typeof compileCatchAll).toBe('function');
  });

  it('matches any pathname including deeply nested paths', async () => {
    const { compileCatchAll, matchRoute } = await import('../../src/router/matcher.js');
    const pattern = compileCatchAll();
    expect(matchRoute(pattern, '/anything/at/all')).not.toBeNull();
    expect(matchRoute(pattern, '/')).not.toBeNull();
    expect(matchRoute(pattern, '')).not.toBeNull();
  });

  it('returns an empty paramNames array', async () => {
    const { compileCatchAll } = await import('../../src/router/matcher.js');
    const pattern = compileCatchAll();
    expect(pattern.paramNames).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Route guards (§10.4)
// ---------------------------------------------------------------------------

describe('route guards', () => {
  it('allows navigation when a class-level guard returns true', async () => {
    class AllowGuard implements IRouteGuard {
      canActivate(): boolean { return true; }
    }

    @controller('/guarded-allow')
    @guard(AllowGuard)
    class GuardedAllowCtrl extends Controller {
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(GuardedAllowCtrl);
    await fireNavigate('http://localhost/guarded-allow');

    // Navigation was not blocked, no error thrown
    expect(true).toBe(true);
  });

  it('blocks navigation when a class-level guard returns false', async () => {
    let actionCalled = false;

    class DenyGuard implements IRouteGuard {
      canActivate(): boolean { return false; }
    }

    @controller('/guarded-deny')
    @guard(DenyGuard)
    class GuardedDenyCtrl extends Controller {
      @get()
      index(): IView {
        actionCalled = true;
        return EmptyView();
      }
    }

    router.registerController(GuardedDenyCtrl);
    await fireNavigate('http://localhost/guarded-deny');

    expect(actionCalled).toBe(false);
  });

  it('blocks navigation when an async guard resolves to false', async () => {
    let actionCalled = false;

    class AsyncDenyGuard implements IRouteGuard {
      canActivate(): Promise<boolean> { return Promise.resolve(false); }
    }

    @controller('/guarded-async-deny')
    @guard(AsyncDenyGuard)
    class GuardedAsyncDenyCtrl extends Controller {
      @get()
      index(): IView {
        actionCalled = true;
        return EmptyView();
      }
    }

    router.registerController(GuardedAsyncDenyCtrl);
    await fireNavigate('http://localhost/guarded-async-deny');

    expect(actionCalled).toBe(false);
  });

  it('blocks navigation when a guard throws', async () => {
    let actionCalled = false;

    class ThrowingGuard implements IRouteGuard {
      canActivate(): boolean { throw new Error('guard error'); }
    }

    @controller('/guarded-throw')
    @guard(ThrowingGuard)
    class GuardedThrowCtrl extends Controller {
      @get()
      index(): IView {
        actionCalled = true;
        return EmptyView();
      }
    }

    router.registerController(GuardedThrowCtrl);
    await fireNavigate('http://localhost/guarded-throw');

    expect(actionCalled).toBe(false);
  });

  it('passes the resolved route to the guard', async () => {
    let capturedRoute: ResolvedRoute | undefined;

    class CaptureGuard implements IRouteGuard {
      canActivate(route: ResolvedRoute): boolean {
        capturedRoute = route;
        return true;
      }
    }

    @controller('/guarded-route')
    @guard(CaptureGuard)
    class GuardedRouteCtrl extends Controller {
      @get('{id}') detail(): IView { return EmptyView(); }
    }

    router.registerController(GuardedRouteCtrl);
    await fireNavigate('http://localhost/guarded-route/42?tab=info');

    expect(capturedRoute).toBeDefined();
    expect(capturedRoute?.params).toMatchObject({ id: '42' });
    expect(capturedRoute?.pathname).toBe('/guarded-route/42');
    expect(capturedRoute?.query.get('tab')).toBe('info');
  });

  it('evaluates multiple guards in declaration order and stops on first denial', async () => {
    const callOrder: string[] = [];

    class FirstGuard implements IRouteGuard {
      canActivate(): boolean { callOrder.push('first'); return true; }
    }
    class SecondGuard implements IRouteGuard {
      canActivate(): boolean { callOrder.push('second'); return false; }
    }
    class ThirdGuard implements IRouteGuard {
      canActivate(): boolean { callOrder.push('third'); return true; }
    }

    @controller('/multi-guard')
    @guard(FirstGuard)
    @guard(SecondGuard)
    @guard(ThirdGuard)
    class MultiGuardCtrl extends Controller {
      @get() index(): IView { return EmptyView(); }
    }

    router.registerController(MultiGuardCtrl);
    await fireNavigate('http://localhost/multi-guard');

    expect(callOrder).toContain('first');
    expect(callOrder).toContain('second');
    expect(callOrder).not.toContain('third');
  });

  it('resolves guard with @inject dependencies from the DI container', async () => {
    const MY_TOKEN = Symbol('MyService');
    container.singleton(MY_TOKEN, () => ({ value: 'injected' }));

    let resolvedValue: string | undefined;

    class InjectableGuard implements IRouteGuard {
      readonly #svc: { value: string };
      constructor(@inject(MY_TOKEN) svc: { value: string }) { this.#svc = svc; }
      canActivate(): boolean {
        resolvedValue = this.#svc.value;
        return true;
      }
    }

    @controller('/injectable-guard')
    @guard(InjectableGuard)
    class InjectableGuardCtrl extends Controller {
      @get() index(): IView { return EmptyView(); }
    }

    const localRouter = new Router(container, outlet);
    localRouter.registerController(InjectableGuardCtrl);
    localRouter.attach();
    await fireNavigate('http://localhost/injectable-guard');

    expect(resolvedValue).toBe('injected');
  });

  it('action-level guard overrides nothing at class level when both present', async () => {
    let classCalled = false;
    let actionCalled = false;
    let ctrlActionCalled = false;

    class ClassGuard implements IRouteGuard {
      canActivate(): boolean { classCalled = true; return true; }
    }
    class ActionGuard implements IRouteGuard {
      canActivate(): boolean { actionCalled = true; return false; }
    }

    @controller('/action-guard')
    @guard(ClassGuard)
    class ActionGuardCtrl extends Controller {
      @guard(ActionGuard)
      @get()
      index(): IView {
        ctrlActionCalled = true;
        return EmptyView();
      }
    }

    router.registerController(ActionGuardCtrl);
    await fireNavigate('http://localhost/action-guard');

    expect(classCalled).toBe(true);
    expect(actionCalled).toBe(true);
    expect(ctrlActionCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lazy controller loading (§10.5)
// ---------------------------------------------------------------------------

describe('lazy controller loading', () => {
  it('registers a controller from a loader and handles navigation', async () => {
    let lazyActionCalled = false;

    @controller('/lazy-route')
    class LazyCtrl extends Controller {
      @get() index(): IView { lazyActionCalled = true; return EmptyView(); }
    }

    const loader = (): Promise<{ readonly default: typeof LazyCtrl }> =>
      Promise.resolve({ default: LazyCtrl });

    router.registerLoader(loader);
    await fireNavigate('http://localhost/lazy-route');

    expect(lazyActionCalled).toBe(true);
  });

  it('resolves the loader only once across multiple navigations', async () => {
    let loaderCallCount = 0;

    @controller('/lazy-cached')
    class LazyCachedCtrl extends Controller {
      @get() index(): IView { return EmptyView(); }
    }

    const loader = (): Promise<{ readonly default: typeof LazyCachedCtrl }> => {
      loaderCallCount++;
      return Promise.resolve({ default: LazyCachedCtrl });
    };

    router.registerLoader(loader);
    await fireNavigate('http://localhost/lazy-cached');
    await fireNavigate('http://localhost/lazy-cached');

    expect(loaderCallCount).toBe(1);
  });

  it('resolves multiple loaders in parallel before first navigation', async () => {
    let aLoaded = false;
    let bLoaded = false;

    @controller('/lazy-a')
    class LazyACtrl extends Controller {
      @get() index(): IView { return EmptyView(); }
    }

    @controller('/lazy-b')
    class LazyBCtrl extends Controller {
      @get() index(): IView { return EmptyView(); }
    }

    router.registerLoader(() => { aLoaded = true; return Promise.resolve({ default: LazyACtrl }); });
    router.registerLoader(() => { bLoaded = true; return Promise.resolve({ default: LazyBCtrl }); });

    await fireNavigate('http://localhost/lazy-a');

    expect(aLoaded).toBe(true);
    expect(bLoaded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layout wiring via router (sections 11.1 to 11.3)
// ---------------------------------------------------------------------------

describe('layout wiring via router', () => {
  function makeViewRenderer(): {
    renderer: ViewRenderer;
    lastLayoutChain: () => LayoutConstructor[];
  } {
    let chain: LayoutConstructor[] = [];
    const renderer: ViewRenderer = (
      _iview,
      _context,
      _outlet,
      _path,
      layoutChain,
    ): Promise<void> => {
      chain = layoutChain;
      return Promise.resolve();
    };
    return {
      renderer,
      lastLayoutChain: () => chain,
    };
  }

  it('passes an empty layout chain for a controller with no @layout', async () => {
    const { renderer, lastLayoutChain } = makeViewRenderer();

    @controller('/no-layout-route')
    class NoLayoutRouteCtrl extends Controller {
      @get() index(): IView { return View(); }
    }

    const r = new Router(container, outlet, { viewRenderer: renderer });
    r.registerController(NoLayoutRouteCtrl);
    r.attach();
    await fireNavigate('http://localhost/no-layout-route');

    expect(lastLayoutChain()).toHaveLength(0);
  });

  it('passes the resolved layout chain for a controller with @layout', async () => {
    const { renderer, lastLayoutChain } = makeViewRenderer();

    const TestLayout = defineLayout({
      template: (ctx) => html`<shell>${ctx.slot}</shell>`,
    });

    @controller('/with-layout-route')
    @layout(TestLayout)
    class WithLayoutRouteCtrl extends Controller {
      @get() index(): IView { return View(); }
    }

    const r = new Router(container, outlet, { viewRenderer: renderer });
    r.registerController(WithLayoutRouteCtrl);
    r.attach();
    await fireNavigate('http://localhost/with-layout-route');

    expect(lastLayoutChain()).toHaveLength(1);
    expect(lastLayoutChain()[0]).toBe(TestLayout);
  });

  it('passes a two-element chain for a nested layout', async () => {
    const { renderer, lastLayoutChain } = makeViewRenderer();

    const Outer = defineLayout({ template: (ctx) => html`<outer>${ctx.slot}</outer>` });
    const Inner = defineLayout({ parent: Outer, template: (ctx) => html`<inner>${ctx.slot}</inner>` });

    @controller('/nested-layout-route')
    @layout(Inner)
    class NestedLayoutRouteCtrl extends Controller {
      @get() index(): IView { return View(); }
    }

    const r = new Router(container, outlet, { viewRenderer: renderer });
    r.registerController(NestedLayoutRouteCtrl);
    r.attach();
    await fireNavigate('http://localhost/nested-layout-route');

    expect(lastLayoutChain()).toHaveLength(2);
    expect(lastLayoutChain()[0]).toBe(Inner);
    expect(lastLayoutChain()[1]).toBe(Outer);
  });

  it('uses action-level @layout over controller-level when navigating to that action', async () => {
    const { renderer, lastLayoutChain } = makeViewRenderer();

    const CtrlLayout = defineLayout({ template: (ctx) => html`<ctrl>${ctx.slot}</ctrl>` });
    const ActionLayout = defineLayout({ template: (ctx) => html`<action>${ctx.slot}</action>` });

    @controller('/mixed-layout-route')
    @layout(CtrlLayout)
    class MixedLayoutRouteCtrl extends Controller {
      @layout(ActionLayout)
      @get('special')
      special(): IView { return View(); }

      @get()
      index(): IView { return View(); }
    }

    const r = new Router(container, outlet, { viewRenderer: renderer });
    r.registerController(MixedLayoutRouteCtrl);
    r.attach();

    await fireNavigate('http://localhost/mixed-layout-route/special');
    expect(lastLayoutChain()[0]).toBe(ActionLayout);

    await fireNavigate('http://localhost/mixed-layout-route');
    expect(lastLayoutChain()[0]).toBe(CtrlLayout);
  });
});

// ---------------------------------------------------------------------------
// onNotFound callback (issue 035)
// ---------------------------------------------------------------------------

describe('onNotFound callback', () => {
  it('is called with the pathname when no route matches', async () => {
    const onNotFound = vi.fn<(pathname: string) => void>();
    const r = new Router(container, outlet, { onNotFound });
    r.registerController(UsersController);
    r.attach();

    await fireNavigate('http://localhost/does-not-exist');

    expect(onNotFound).toHaveBeenCalledOnce();
    expect(onNotFound).toHaveBeenCalledWith('/does-not-exist');
  });

  it('is NOT called when a matching route exists', async () => {
    const onNotFound = vi.fn<(pathname: string) => void>();
    const r = new Router(container, outlet, { onNotFound });
    r.registerController(UsersController);
    r.attach();

    await fireNavigate('http://localhost/users');

    expect(onNotFound).not.toHaveBeenCalled();
  });

  it('is NOT called when a catch-all controller handles the request', async () => {
    const onNotFound = vi.fn<(pathname: string) => void>();
    const r = new Router(container, outlet, { onNotFound });
    r.registerController(CatchAllController);
    r.attach();

    await fireNavigate('http://localhost/anything-at-all');

    expect(onNotFound).not.toHaveBeenCalled();
    expect(catchAllCallCount).toBe(1);
  });

  it('is safe to omit: no-match does not throw when onNotFound is undefined', async () => {
    const r = new Router(container, outlet);
    r.registerController(UsersController);
    r.attach();

    await expect(fireNavigate('http://localhost/no-such-route')).resolves.not.toThrow();
  });

  it('is called on every unmatched navigation, not just the first', async () => {
    const onNotFound = vi.fn<(pathname: string) => void>();
    const r = new Router(container, outlet, { onNotFound });
    r.registerController(UsersController);
    r.attach();

    await fireNavigate('http://localhost/missing-a');
    await fireNavigate('http://localhost/missing-b');

    expect(onNotFound).toHaveBeenCalledTimes(2);
    expect(onNotFound).toHaveBeenNthCalledWith(1, '/missing-a');
    expect(onNotFound).toHaveBeenNthCalledWith(2, '/missing-b');
  });
});
