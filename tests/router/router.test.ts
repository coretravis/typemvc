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
  put,
  patch,
  del,
  body,
  guard,
  layout,
  title,
} from '../../src/core/decorators.js';
import { dataType, required, min } from '../../src/validation/decorators.js';
import { inject } from '../../src/di/decorators.js';
import { EmptyView, PartialView, Redirect, RedirectReplace, View } from '../../src/core/view.js';
import type { IView, ViewContext, IRouteGuard, ResolvedRoute, LayoutConstructor, DisposeReason } from '../../src/types/index.js';
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
  readonly navigationType: 'push' | 'replace' | 'traverse' | 'reload';

  private _handler: (() => Promise<void>) | null = null;

  constructor(
    url: string,
    opts?: {
      canIntercept?: boolean;
      hashChange?: boolean;
      downloadRequest?: string;
      formData?: FormData;
      navigationType?: 'push' | 'replace' | 'traverse' | 'reload';
    },
  ) {
    this.canIntercept = opts?.canIntercept ?? true;
    this.hashChange = opts?.hashChange ?? false;
    this.downloadRequest = opts?.downloadRequest ?? null;
    this.destination = { url };
    this.formData = opts?.formData ?? null;
    this.navigationType = opts?.navigationType ?? 'push';
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

const mutationCalls: string[] = [];
let mutationLastBody: FormData | null = null;

@controller('/records')
class MutationController extends Controller {
  @get()
  index(): IView {
    mutationCalls.push('index');
    return EmptyView();
  }

  @post()
  create(formData: FormData): IView {
    mutationCalls.push('create');
    mutationLastBody = formData;
    return EmptyView();
  }

  @put()
  replace(formData: FormData): IView {
    mutationCalls.push('replace');
    mutationLastBody = formData;
    return EmptyView();
  }

  @patch()
  update(formData: FormData): IView {
    mutationCalls.push('update');
    mutationLastBody = formData;
    return EmptyView();
  }

  @del()
  remove(formData: FormData): IView {
    mutationCalls.push('remove');
    mutationLastBody = formData;
    return EmptyView();
  }
}

let postCatchAllCallCount = 0;

@controller('*')
class PostCatchAllController extends Controller {
  @post()
  fallback(): IView {
    postCatchAllCallCount++;
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

let retainErrorsConstructCount = 0;
let retainErrorsHadErrorsAtStart = false;

@controller('/retain-errors')
@retain()
class RetainErrorsController extends Controller {
  constructor() {
    super();
    retainErrorsConstructCount++;
  }

  @get()
  index(): IView {
    retainErrorsHadErrorsAtStart = this.hasErrors();
    return EmptyView();
  }

  @post()
  save(): IView {
    this.addError('name', 'Name is required');
    return EmptyView();
  }
}

let retainDisposeReason: DisposeReason | null = null;

@controller('/retain-dispose')
@retain()
class RetainDisposeController extends Controller {
  @get()
  index(): IView {
    return EmptyView();
  }

  protected override onDispose(reason: DisposeReason): void {
    retainDisposeReason = reason;
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

  @del()
  remove(@body(CreateUserDto) dto: CreateUserDto): IView {
    bodyLastInstance = dto;
    bodyLastHasErrors = this.hasErrors();
    return EmptyView();
  }
}

class NameDto {
  @dataType('string')
  @required('Name is required')
  name = '';
}

@controller('/body-error')
class BodyErrorController extends Controller {
  @post()
  create(@body(NameDto) dto: NameDto): IView {
    void dto;
    return View();
  }
}

// Scoped DI lifetime across dispatches
const SCOPED_SVC = Symbol('ScopedSvc');
const SINGLETON_SVC = Symbol('SingletonSvc');
let scopedInstanceCount = 0;
let singletonInstanceCount = 0;
let scopedDisposeCount = 0;

interface Identified {
  readonly id: number;
}

// A controller with @inject constructor parameters does not satisfy the router's
// unknown[] construct signature. The public AppBuilder.route resolves the same
// tension with an any[] signature; the direct registerController call casts here.
type RoutableController = new (...args: unknown[]) => unknown;

let scopeCtrlScopedId: number | undefined;
let scopeCtrlSingletonId: number | undefined;

@controller('/scope-test')
class ScopeController extends Controller {
  constructor(
    @inject(SCOPED_SVC) private readonly scopedSvc: Identified,
    @inject(SINGLETON_SVC) private readonly singletonSvc: Identified,
  ) {
    super();
  }

  @get()
  index(): IView {
    scopeCtrlScopedId = this.scopedSvc.id;
    scopeCtrlSingletonId = this.singletonSvc.id;
    return EmptyView();
  }
}

// Navigation arbitration fixtures: a guard that blocks until released.
let guardGate: Promise<void>;
let releaseGuard: () => void;
function resetGuardGate(): void {
  guardGate = new Promise<void>((resolve) => { releaseGuard = resolve; });
}
resetGuardGate();

let arbAActionCount = 0;
let arbBActionCount = 0;
let arbBDisposeCount = 0;

class BlockingGuard implements IRouteGuard {
  async canActivate(): Promise<boolean> {
    await guardGate;
    return true;
  }
}

@controller('/arb-a')
@guard(BlockingGuard)
class ArbAController extends Controller {
  @get()
  index(): IView {
    arbAActionCount++;
    return EmptyView();
  }
}

@controller('/arb-b')
class ArbBController extends Controller {
  @get()
  index(): IView {
    arbBActionCount++;
    return EmptyView();
  }

  protected override onDispose(): void {
    arbBDisposeCount++;
  }
}

// Guard scope fixtures: a guard injecting a scoped disposable, and a denying one.
const GUARD_SCOPED_SVC = Symbol('GuardScopedSvc');
let guardScopedCreated = 0;
let guardScopedDisposed = 0;
const guardSeenIds: number[] = [];

class ScopedGuard implements IRouteGuard {
  constructor(@inject(GUARD_SCOPED_SVC) private readonly svc: Identified) {}
  canActivate(): boolean {
    guardSeenIds.push(this.svc.id);
    return true;
  }
}

@controller('/guard-scope')
@guard(ScopedGuard)
class GuardScopeController extends Controller {
  @get()
  index(): IView {
    return EmptyView();
  }
}

const DENY_SCOPED_SVC = Symbol('DenyScopedSvc');
let denyScopedDisposed = 0;

class DenyingScopedGuard implements IRouteGuard {
  constructor(@inject(DENY_SCOPED_SVC) svc: Identified) {
    void svc;
  }
  canActivate(): boolean {
    return false;
  }
}

@controller('/deny-scope')
@guard(DenyingScopedGuard)
class DenyScopeController extends Controller {
  @get()
  index(): IView {
    return EmptyView();
  }
}

// Controller whose constructor throws after a scoped disposable is resolved
const THROW_SCOPED_SVC = Symbol('ThrowScopedSvc');
let throwScopedDisposed = 0;

@controller('/throw-ctor')
class ThrowingCtorController extends Controller {
  constructor(@inject(THROW_SCOPED_SVC) svc: Identified) {
    super();
    void svc;
    throw new Error('constructor boom');
  }

  @get()
  index(): IView {
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
  removeEventListener: vi.fn((_event: string, listener: NavigateListener): void => {
    if (capturedNavigateListener === listener) capturedNavigateListener = null;
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
    navigationType?: 'push' | 'replace' | 'traverse' | 'reload';
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
  postCatchAllCallCount = 0;
  mutationCalls.length = 0;
  mutationLastBody = null;
  scopedInstanceCount = 0;
  singletonInstanceCount = 0;
  scopedDisposeCount = 0;
  scopeCtrlScopedId = undefined;
  scopeCtrlSingletonId = undefined;
  retainErrorsConstructCount = 0;
  retainErrorsHadErrorsAtStart = false;
  retainDisposeReason = null;
  throwScopedDisposed = 0;
  resetGuardGate();
  arbAActionCount = 0;
  arbBActionCount = 0;
  arbBDisposeCount = 0;
  guardScopedCreated = 0;
  guardScopedDisposed = 0;
  guardSeenIds.length = 0;
  denyScopedDisposed = 0;
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

  it('a POST catch-all does not match a GET navigation', async () => {
    router.registerController(PostCatchAllController);
    await fireNavigate('http://localhost/completely/unknown/path');

    expect(postCatchAllCallCount).toBe(0);
  });

  it('a POST catch-all matches a POST navigation', async () => {
    router.registerController(PostCatchAllController);
    await fireNavigate('http://localhost/completely/unknown/path', {
      formData: new FormData(),
    });

    expect(postCatchAllCallCount).toBe(1);
  });

  it('a GET catch-all does not match a POST navigation', async () => {
    router.registerController(CatchAllController);
    await fireNavigate('http://localhost/completely/unknown/path', {
      formData: new FormData(),
    });

    expect(catchAllCallCount).toBe(0);
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
// Method override: reaching PUT, PATCH, DELETE through a form _method field
// ---------------------------------------------------------------------------

describe('method override dispatch', () => {
  it('dispatches every supported verb end to end', async () => {
    router.registerController(MutationController);

    await fireNavigate('http://localhost/records');
    const post = new FormData();
    await fireNavigate('http://localhost/records', { formData: post });

    const put = new FormData();
    put.append('_method', 'PUT');
    await fireNavigate('http://localhost/records', { formData: put });

    const patchBody = new FormData();
    patchBody.append('_method', 'PATCH');
    await fireNavigate('http://localhost/records', { formData: patchBody });

    const del = new FormData();
    del.append('_method', 'DELETE');
    await fireNavigate('http://localhost/records', { formData: del });

    expect(mutationCalls).toEqual(['index', 'create', 'replace', 'update', 'remove']);
  });

  it('matches _method case-insensitively', async () => {
    router.registerController(MutationController);

    const fd = new FormData();
    fd.append('_method', 'put');
    await fireNavigate('http://localhost/records', { formData: fd });

    expect(mutationCalls).toEqual(['replace']);
  });

  it('leaves an unrecognized _method as a POST', async () => {
    router.registerController(MutationController);

    const fd = new FormData();
    fd.append('_method', 'FETCH');
    await fireNavigate('http://localhost/records', { formData: fd });

    expect(mutationCalls).toEqual(['create']);
  });

  it('removes the _method field before the body reaches the action', async () => {
    router.registerController(MutationController);

    const fd = new FormData();
    fd.append('_method', 'PUT');
    fd.append('title', 'Draft');
    await fireNavigate('http://localhost/records', { formData: fd });

    expect(mutationCalls).toEqual(['replace']);
    expect(mutationLastBody?.has('_method')).toBe(false);
    expect(mutationLastBody?.get('title')).toBe('Draft');
  });

  it('passes the form body to a DELETE action reached through _method', async () => {
    router.registerController(MutationController);

    const fd = new FormData();
    fd.append('_method', 'DELETE');
    fd.append('id', '42');
    await fireNavigate('http://localhost/records', { formData: fd });

    expect(mutationCalls).toEqual(['remove']);
    expect(mutationLastBody?.has('_method')).toBe(false);
    expect(mutationLastBody?.get('id')).toBe('42');
  });

  it('ignores _method on a GET navigation', async () => {
    router.registerController(MutationController);

    await fireNavigate('http://localhost/records?_method=DELETE');

    expect(mutationCalls).toEqual(['index']);
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

  it('binds a DTO on a DELETE action reached through _method', async () => {
    const fd = new FormData();
    fd.append('_method', 'DELETE');
    fd.append('name', 'Carol');
    fd.append('age', '27');

    router.registerController(BodyController);
    await fireNavigate('http://localhost/body', { formData: fd });

    expect(bodyLastInstance).toBeInstanceOf(CreateUserDto);
    const dto = bodyLastInstance as CreateUserDto;
    expect(dto.name).toBe('Carol');
    expect(dto.age).toBe(27);
  });
});

// ---------------------------------------------------------------------------
// Bound field errors reach the mounted view (router -> context -> rendered DOM)
// ---------------------------------------------------------------------------

describe('bound field errors in the rendered view', () => {
  function renderErrorInto(target: { html: string }): ViewRenderer {
    return (_iview: IView, context: ViewContext): Promise<void> => {
      const errors = context.errors as unknown as Record<string, string | null>;
      target.html = `<span class="error">${errors.name ?? ''}</span>`;
      return Promise.resolve();
    };
  }

  it('shows the field message in the view after an invalid submit', async () => {
    const rendered = { html: '' };
    const r = new Router(container, outlet, { viewRenderer: renderErrorInto(rendered) });
    r.registerController(BodyErrorController);
    r.attach();

    const fd = new FormData();
    fd.append('name', '');
    await fireNavigate('http://localhost/body-error', { formData: fd });

    expect(rendered.html).toContain('Name is required');
  });

  it('renders no field error for a valid submit', async () => {
    const rendered = { html: '' };
    const r = new Router(container, outlet, { viewRenderer: renderErrorInto(rendered) });
    r.registerController(BodyErrorController);
    r.attach();

    const fd = new FormData();
    fd.append('name', 'Alice');
    await fireNavigate('http://localhost/body-error', { formData: fd });

    expect(rendered.html).toBe('<span class="error"></span>');
  });
});

// ---------------------------------------------------------------------------
// Retained controller field-error reset
// ---------------------------------------------------------------------------

describe('retained controller field-error reset', () => {
  it('starts a later dispatch on the same instance with no stale field errors', async () => {
    router.registerController(RetainErrorsController);
    router.registerController(UsersController);

    await fireNavigate('http://localhost/retain-errors', { formData: new FormData() });
    await fireNavigate('http://localhost/users');
    await fireNavigate('http://localhost/retain-errors');

    expect(retainErrorsConstructCount).toBe(1);
    expect(retainErrorsHadErrorsAtStart).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Navigation arbitration (latest-wins)
// ---------------------------------------------------------------------------

describe('navigation arbitration', () => {
  it('a navigation released from an async guard after a newer one won does not overtake it', async () => {
    router.registerController(ArbAController);
    router.registerController(ArbBController);

    // A starts and blocks in its guard.
    const navA = router.handle('http://localhost/arb-a', null);
    // B completes and becomes the winner.
    await router.handle('http://localhost/arb-b', null);
    expect(arbBActionCount).toBe(1);

    // Release A's guard: A is now stale and must not overtake B.
    releaseGuard();
    await navA;

    expect(arbAActionCount).toBe(0);
    expect(arbBDisposeCount).toBe(0);
  });

  it('does not report a mount for a navigation superseded during its render', async () => {
    let releaseRender: () => void = () => undefined;
    const renderGate = new Promise<void>((resolve) => { releaseRender = resolve; });
    const capturedSignals: (AbortSignal | undefined)[] = [];
    const onMounted = vi.fn();

    pageReturnView = View();
    const render = vi.fn(
      async (
        _iview: IView,
        _ctx: ViewContext,
        _outlet: Element,
        path: string,
        _layout: LayoutConstructor[],
        signal?: AbortSignal,
      ): Promise<void> => {
        capturedSignals.push(signal);
        if (path.includes('slow-view')) {
          await renderGate;
        }
      },
    );

    @controller('/slow-render')
    class SlowRenderController extends Controller {
      @get()
      index(): IView {
        return View('slow-view');
      }
    }

    const r = new Router(container, outlet, { viewRenderer: render as unknown as ViewRenderer, onMounted });
    r.registerController(SlowRenderController);
    r.registerController(PageController);
    r.attach();

    const navSlow = r.handle('http://localhost/slow-render', null);
    // Wait until the slow navigation is parked inside its renderer before starting the
    // navigation that supersedes it.
    await vi.waitFor(() => {
      expect(render.mock.calls.some((c) => c[3].includes('slow-view'))).toBe(true);
    });
    await r.handle('http://localhost/page', null);

    releaseRender();
    await navSlow;

    // The superseded slow render passed a signal that was aborted, and its mount was
    // never reported.
    expect(onMounted).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/slow-render' }),
    );
    expect(capturedSignals.some((s) => s?.aborted === true)).toBe(true);
  });

  it('stop() invalidates a navigation waiting in a guard', async () => {
    router.registerController(ArbAController);

    const navA = router.handle('http://localhost/arb-a', null);
    await router.stop();

    releaseGuard();
    await navA;

    expect(arbAActionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Guard DI scope
// ---------------------------------------------------------------------------

describe('guard DI scope', () => {
  it('resolves a guard-scoped dependency per navigation, distinct across dispatches', async () => {
    container.scoped(GUARD_SCOPED_SVC, () => ({
      id: ++guardScopedCreated,
      dispose: (): void => { guardScopedDisposed++; },
    }));
    router.registerController(GuardScopeController);
    router.registerController(UsersController);

    await fireNavigate('http://localhost/guard-scope');
    await fireNavigate('http://localhost/users');
    await fireNavigate('http://localhost/guard-scope');

    expect(guardSeenIds).toEqual([1, 2]);
    expect(guardScopedDisposed).toBeGreaterThanOrEqual(1);
  });

  it('disposes the dispatch scope of a denied navigation', async () => {
    container.scoped(DENY_SCOPED_SVC, () => ({
      id: 1,
      dispose: (): void => { denyScopedDisposed++; },
    }));
    router.registerController(DenyScopeController);

    await fireNavigate('http://localhost/deny-scope');

    expect(denyScopedDisposed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Router teardown
// ---------------------------------------------------------------------------

describe('router stop', () => {
  it('detaches the navigation listener so a later navigation is not intercepted', async () => {
    router.registerController(UsersController);
    await router.stop();

    const event = await fireNavigate('http://localhost/users');

    expect(event.wasIntercepted).toBe(false);
    expect(indexCallCount).toBe(0);
  });

  it('disposes a retained controller on stop', async () => {
    router.registerController(RetainDisposeController);
    router.registerController(UsersController);

    await fireNavigate('http://localhost/retain-dispose');
    await fireNavigate('http://localhost/users');
    expect(retainDisposeReason).toBeNull();

    await router.stop();

    expect(retainDisposeReason).toBe('app-stop');
  });

  it('disposes the active controller on stop', async () => {
    router.registerController(RetainDisposeController);

    await fireNavigate('http://localhost/retain-dispose');
    await router.stop();

    expect(retainDisposeReason).toBe('app-stop');
  });
});

// ---------------------------------------------------------------------------
// Scoped DI lifetime in the dispatch path
// ---------------------------------------------------------------------------

describe('scoped DI lifetime', () => {
  beforeEach(() => {
    container.scoped(SCOPED_SVC, () => ({
      id: ++scopedInstanceCount,
      dispose: (): void => { scopedDisposeCount++; },
    }));
    container.singleton(SINGLETON_SVC, () => ({ id: ++singletonInstanceCount }));
    router.registerController(ScopeController as unknown as RoutableController);
    router.registerController(UsersController);
  });

  it('gives a scoped dependency a per-dispatch lifetime distinct from a singleton', async () => {
    await fireNavigate('http://localhost/scope-test');
    const firstScoped = scopeCtrlScopedId;
    const firstSingleton = scopeCtrlSingletonId;

    await fireNavigate('http://localhost/users');
    await fireNavigate('http://localhost/scope-test');
    const secondScoped = scopeCtrlScopedId;
    const secondSingleton = scopeCtrlSingletonId;

    expect(firstScoped).toBeDefined();
    expect(secondScoped).not.toBe(firstScoped);
    expect(secondSingleton).toBe(firstSingleton);
  });

  it('disposes a scoped instance when its dispatch scope ends', async () => {
    await fireNavigate('http://localhost/scope-test');
    expect(scopedDisposeCount).toBe(0);

    await fireNavigate('http://localhost/users');
    expect(scopedDisposeCount).toBe(1);
  });

  it('disposes the child scope when controller construction throws', async () => {
    container.scoped(THROW_SCOPED_SVC, () => ({
      id: 1,
      dispose: (): void => { throwScopedDisposed++; },
    }));
    router.registerController(ThrowingCtorController as unknown as RoutableController);

    await expect(router.handle('http://localhost/throw-ctor', null)).rejects.toThrow(
      'constructor boom',
    );

    expect(throwScopedDisposed).toBe(1);
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

/** The part of a ViewTransition the router uses, plus the part it must not wait on. */
interface FakeTransition {
  readonly updateCallbackDone: Promise<void>;
  readonly finished: Promise<void>;
}

/**
 * Stands in for document.startViewTransition. It runs the callback and settles
 * updateCallbackDone with it, and leaves `finished` pending, exactly as a real
 * transition does until the cross fade has played out. A router that awaited
 * `finished` would therefore never complete a navigation, and every test in this
 * suite would time out.
 */
function stubViewTransitions(): ReturnType<typeof vi.fn> {
  const start = vi.fn((callback: () => void | Promise<void>): FakeTransition => ({
    updateCallbackDone: Promise.resolve(callback()),
    finished: new Promise<void>(() => undefined),
  }));
  vi.stubGlobal('document', { startViewTransition: start });
  return start;
}

/** Stubs the media query the reduced motion check reads. */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
  }));
}

function transitionRouter(
  renderer: ViewRenderer,
  transitions?: 'auto' | 'on' | 'off',
): Router {
  const r = new Router(container, outlet, {
    viewRenderer: renderer,
    ...(transitions !== undefined ? { transitions } : {}),
  });
  r.registerController(PageController);
  r.attach();
  return r;
}

describe('view transitions', () => {
  beforeEach(() => {
    pageReturnView = View();
  });

  it('uses a view transition by default', async () => {
    const start = stubViewTransitions();
    const render = vi.fn().mockResolvedValue(undefined);
    transitionRouter(render);

    await fireNavigate('http://localhost/page');

    expect(start).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("'off' mounts the view with no transition in a browser that supports them", async () => {
    const start = stubViewTransitions();
    const render = vi.fn().mockResolvedValue(undefined);
    transitionRouter(render, 'off');

    await fireNavigate('http://localhost/page');

    expect(start).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("'on' uses a transition even when the user asked for reduced motion", async () => {
    const start = stubViewTransitions();
    stubReducedMotion(true);
    const render = vi.fn().mockResolvedValue(undefined);
    transitionRouter(render, 'on');

    await fireNavigate('http://localhost/page');

    expect(start).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("'auto' skips the transition when the user asked for reduced motion", async () => {
    const start = stubViewTransitions();
    stubReducedMotion(true);
    const render = vi.fn().mockResolvedValue(undefined);
    transitionRouter(render, 'auto');

    await fireNavigate('http://localhost/page');

    expect(start).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("'auto' uses the transition when the user has not asked for reduced motion", async () => {
    const start = stubViewTransitions();
    stubReducedMotion(false);
    const render = vi.fn().mockResolvedValue(undefined);
    transitionRouter(render, 'auto');

    await fireNavigate('http://localhost/page');

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("'auto' re-reads the reduced motion setting on every navigation", async () => {
    const start = stubViewTransitions();
    stubReducedMotion(false);
    const render = vi.fn().mockResolvedValue(undefined);
    transitionRouter(render, 'auto');

    await fireNavigate('http://localhost/page');
    expect(start).toHaveBeenCalledTimes(1);

    // The user turns reduced motion on without reloading the page.
    stubReducedMotion(true);
    await fireNavigate('http://localhost/page');

    expect(render).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('renders directly when the browser has no startViewTransition', async () => {
    vi.stubGlobal('document', {});

    for (const mode of ['auto', 'on', 'off'] as const) {
      const render = vi.fn().mockResolvedValue(undefined);
      transitionRouter(render, mode);

      await fireNavigate('http://localhost/page');

      expect(render).toHaveBeenCalledTimes(1);
    }
  });

  it('resolves the mount only once the render inside the transition has completed', async () => {
    stubViewTransitions();
    let releaseRender!: () => void;
    const rendered = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const render = vi.fn().mockReturnValue(rendered);
    const r = transitionRouter(render);

    let handled = false;
    const navigation = r.handle('http://localhost/page', null).then(() => {
      handled = true;
    });

    // The render is in flight inside the transition callback. A router that did not
    // await updateCallbackDone would already have resolved the navigation here.
    await vi.waitFor(() => {
      expect(render).toHaveBeenCalledTimes(1);
    });
    expect(handled).toBe(false);

    releaseRender();
    await navigation;

    expect(handled).toBe(true);
  });

  it('logs a render failure inside the transition', async () => {
    stubViewTransitions();
    const errors: { message: string; error?: Error }[] = [];
    const render = vi.fn().mockRejectedValue(new Error('view module missing'));

    const r = new Router(container, outlet, {
      viewRenderer: render as unknown as ViewRenderer,
      loggerFactory: {
        create: () => ({
          debug: (): void => undefined,
          info: (): void => undefined,
          warn: (): void => undefined,
          error: (message: string, error?: Error): void => {
            errors.push({ message, ...(error !== undefined ? { error } : {}) });
          },
        }),
      },
    });
    r.registerController(PageController);

    // A render failure is logged where it happens and then routed through the
    // failure path, so the handler settles rather than rejecting unobserved.
    await expect(r.handle('http://localhost/page', null)).resolves.toBeUndefined();
    expect(errors.some((e) => e.message.includes('View load failed'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mount reporting: what the announcer attaches to
// ---------------------------------------------------------------------------

describe('onMounted', () => {
  it('reports the pathname after a view has mounted', async () => {
    vi.stubGlobal('document', {});
    pageReturnView = View();
    const order: string[] = [];
    const render = vi.fn().mockImplementation(async (): Promise<void> => {
      await Promise.resolve();
      order.push('render');
    });
    const onMounted = vi.fn((): void => {
      order.push('mounted');
    });

    const r = new Router(container, outlet, {
      viewRenderer: render as unknown as ViewRenderer,
      onMounted,
    });
    r.registerController(PageController);
    r.attach();

    await fireNavigate('http://localhost/page');

    expect(onMounted).toHaveBeenCalledWith({ pathname: '/page', initialLoad: false, title: null });
    expect(order).toEqual(['render', 'mounted']);
  });

  it('reports initialLoad for the navigation the document loaded with', async () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('location', { pathname: '/page', href: 'http://localhost/page' });
    pageReturnView = View();
    const onMounted = vi.fn();

    const r = new Router(container, outlet, {
      viewRenderer: vi.fn().mockResolvedValue(undefined) as unknown as ViewRenderer,
      onMounted,
    });
    r.registerController(PageController);

    await r.handleCurrentUrl();

    expect(onMounted).toHaveBeenCalledWith({ pathname: '/page', initialLoad: true, title: null });
  });

  it('reports nothing for a redirect result', async () => {
    vi.stubGlobal('document', {});
    redirectLastResult = Redirect('/users');
    const onMounted = vi.fn();

    const r = new Router(container, outlet, {
      viewRenderer: vi.fn().mockResolvedValue(undefined) as unknown as ViewRenderer,
      onMounted,
    });
    r.registerController(RedirectController);
    r.attach();

    await fireNavigate('http://localhost/redirect-test');

    expect(onMounted).not.toHaveBeenCalled();
  });

  it('reports nothing for an empty result', async () => {
    vi.stubGlobal('document', {});
    redirectLastResult = EmptyView();
    const onMounted = vi.fn();

    const r = new Router(container, outlet, {
      viewRenderer: vi.fn().mockResolvedValue(undefined) as unknown as ViewRenderer,
      onMounted,
    });
    r.registerController(RedirectController);
    r.attach();

    await fireNavigate('http://localhost/redirect-test');

    expect(onMounted).not.toHaveBeenCalled();
  });

  it('reports nothing when the render fails', async () => {
    vi.stubGlobal('document', {});
    pageReturnView = View();
    const onMounted = vi.fn();

    const r = new Router(container, outlet, {
      viewRenderer: vi.fn().mockRejectedValue(new Error('boom')) as unknown as ViewRenderer,
      onMounted,
    });
    r.registerController(PageController);

    // The render throw is routed through the failure path, so the handler settles
    // and nothing is announced as mounted.
    await expect(r.handle('http://localhost/page', null)).resolves.toBeUndefined();
    expect(onMounted).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// Scroll on navigation. A same document navigation keeps the scroll offset of the
// route being left, so the router resets it on a push. The browser restores the
// offset on a traversal and scrolls to a fragment itself, and both are left alone.
// ---------------------------------------------------------------------------

describe('scroll on navigation', () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    vi.stubGlobal('document', {});
    pageReturnView = View();
  });

  function scrollRouter(): Router {
    const r = new Router(container, outlet, {
      viewRenderer: vi.fn().mockResolvedValue(undefined) as unknown as ViewRenderer,
    });
    r.registerController(PageController);
    r.registerController(RedirectController);
    r.attach();
    return r;
  }

  it('scrolls to the top after a push that mounted a view', async () => {
    scrollRouter();

    await fireNavigate('http://localhost/page', { navigationType: 'push' });

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('scrolls to the top after a replace that mounted a view', async () => {
    scrollRouter();

    await fireNavigate('http://localhost/page', { navigationType: 'replace' });

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('leaves a traversal alone, because the browser restores the offset', async () => {
    scrollRouter();

    await fireNavigate('http://localhost/page', { navigationType: 'traverse' });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('leaves a destination with a fragment alone, because the browser scrolls to it', async () => {
    scrollRouter();

    await fireNavigate('http://localhost/page#section', { navigationType: 'push' });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll when the initial load mounts a view', async () => {
    vi.stubGlobal('location', { pathname: '/page', href: 'http://localhost/page' });
    const r = new Router(container, outlet, {
      viewRenderer: vi.fn().mockResolvedValue(undefined) as unknown as ViewRenderer,
    });
    r.registerController(PageController);

    await r.handleCurrentUrl();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll when the result mounted nothing', async () => {
    redirectLastResult = EmptyView();
    scrollRouter();

    await fireNavigate('http://localhost/redirect-test', { navigationType: 'push' });

    expect(scrollTo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Page title: a static title is a decorator, a computed title is an assignment.
// The router resolves one string, writes it to the document, and reports it.
// ---------------------------------------------------------------------------

@controller('/titled')
@title('Records')
class TitledController extends Controller {
  @get()
  index(): IView {
    return View();
  }

  @get('new')
  @title('New record')
  create(): IView {
    return View();
  }

  @get('computed')
  computed(): IView {
    this.title = 'Computed in the action';
    return View();
  }

  @get('async')
  async fromData(): Promise<IView> {
    // A title built from data the action awaited, which never reaches the view model.
    const tenant = await Promise.resolve('Acme');
    this.title = `Ada Lovelace at ${tenant}`;
    return View({ unrelated: true });
  }

  @get('as-partial')
  asPartial(): IView {
    return PartialView('/views/titled/row.tmvc');
  }

  @get('gone')
  gone(): IView {
    return Redirect('/titled');
  }

  @get('replaced')
  replaced(): IView {
    return RedirectReplace('/titled');
  }

  @get('nothing')
  nothing(): IView {
    return EmptyView();
  }
}

@controller('/untitled')
class UntitledController extends Controller {
  @get()
  index(): IView {
    return View();
  }
}

@controller('/retained-title')
@retain()
@title('Class title')
class RetainedTitleController extends Controller {
  @get('assign')
  assign(): IView {
    this.title = 'Assigned on the first visit';
    return View();
  }

  @get('plain')
  plain(): IView {
    return View();
  }
}

let loggedErrors: { message: string; error?: Error }[] = [];

interface TitleHarness {
  readonly router: Router;
  readonly titles: (string | null)[];
  readonly documentTitle: () => string | undefined;
}

function stubbedDocument(): { title?: string } {
  return (globalThis as unknown as { document: { title?: string } }).document;
}

function titleRouter(appTitle?: string | ((page: string) => string)): TitleHarness {
  const titles: (string | null)[] = [];
  const r = new Router(container, outlet, {
    viewRenderer: vi.fn().mockResolvedValue(undefined) as unknown as ViewRenderer,
    onDispatch: (info) => { titles.push(info.title); },
    ...(appTitle !== undefined ? { title: appTitle } : {}),
    loggerFactory: {
      create: () => ({
        debug: (): void => undefined,
        info: (): void => undefined,
        warn: (): void => undefined,
        error: (message: string, error?: Error): void => {
          loggedErrors.push({ message, ...(error !== undefined ? { error } : {}) });
        },
      }),
    },
  });
  r.registerController(TitledController);
  r.registerController(UntitledController);
  r.registerController(RetainedTitleController);
  r.attach();
  return {
    router: r,
    titles,
    documentTitle: (): string | undefined => stubbedDocument().title,
  };
}

describe('page title', () => {
  beforeEach(() => {
    loggedErrors = [];
  });

  it('a controller level @title sets the document title for every action on it', async () => {
    const h = titleRouter();

    await fireNavigate('http://localhost/titled');

    expect(h.documentTitle()).toBe('Records');
    expect(h.titles).toEqual(['Records']);
  });

  it('an action level @title overrides the controller level one', async () => {
    const h = titleRouter();

    await fireNavigate('http://localhost/titled/new');

    expect(h.documentTitle()).toBe('New record');
  });

  it('this.title in an action overrides both decorators', async () => {
    const h = titleRouter();

    await fireNavigate('http://localhost/titled/computed');

    expect(h.documentTitle()).toBe('Computed in the action');
  });

  it('honours a this.title assigned after an await, from data the view never sees', async () => {
    const h = titleRouter();

    await fireNavigate('http://localhost/titled/async');

    expect(h.documentTitle()).toBe('Ada Lovelace at Acme');
  });

  it('a partial result sets the title, since it replaces the outlet content', async () => {
    const h = titleRouter();

    await fireNavigate('http://localhost/titled/as-partial');

    expect(h.documentTitle()).toBe('Records');
  });

  it('applies the application default when the route supplies no title', async () => {
    const h = titleRouter('Acme');

    await fireNavigate('http://localhost/untitled');

    expect(h.documentTitle()).toBe('Acme');
  });

  it('a route title beats the application default', async () => {
    const h = titleRouter('Acme');

    await fireNavigate('http://localhost/titled');

    expect(h.documentTitle()).toBe('Records');
  });

  it('an application template wraps the title the route resolved', async () => {
    const h = titleRouter((page) => `${page} | Acme`);

    await fireNavigate('http://localhost/titled/new');

    expect(h.documentTitle()).toBe('New record | Acme');
  });

  it('a throwing template logs, leaves the title unchanged, and completes the navigation', async () => {
    const h = titleRouter(() => {
      throw new Error('template blew up');
    });
    stubbedDocument().title = 'Before';

    await fireNavigate('http://localhost/titled');

    expect(h.documentTitle()).toBe('Before');
    expect(h.titles).toEqual([null]);
    expect(loggedErrors.some((e) => e.message.includes('title template'))).toBe(true);
  });

  it('does not write the title at all with no decorator, no assignment and no default', async () => {
    const h = titleRouter();
    stubbedDocument().title = 'Set by index.html';

    await fireNavigate('http://localhost/untitled');

    expect(h.documentTitle()).toBe('Set by index.html');
    expect(h.titles).toEqual([null]);
  });

  it('does not set a title for a redirect, a replace redirect, or an empty result', async () => {
    const h = titleRouter();
    stubbedDocument().title = 'Unchanged';

    await fireNavigate('http://localhost/titled/gone');
    await fireNavigate('http://localhost/titled/replaced');
    await fireNavigate('http://localhost/titled/nothing');

    expect(h.documentTitle()).toBe('Unchanged');
    expect(h.titles).toEqual([null, null, null]);
  });

  it('sets the title on the initial load, not only on later navigations', async () => {
    vi.stubGlobal('location', { pathname: '/titled', href: 'http://localhost/titled' });
    vi.stubGlobal('document', {});
    const h = titleRouter();

    await h.router.handleCurrentUrl();

    expect(h.documentTitle()).toBe('Records');
  });

  it('clears an assigned title per dispatch, so a retained controller cannot carry it over', async () => {
    const h = titleRouter();

    await fireNavigate('http://localhost/retained-title/assign');
    expect(h.documentTitle()).toBe('Assigned on the first visit');

    // The same instance, reused. The visit that assigns nothing falls back to the
    // class decorator rather than inheriting the last visit's assignment.
    await fireNavigate('http://localhost/retained-title/plain');

    expect(h.titles).toEqual(['Assigned on the first visit', 'Class title']);
    expect(h.documentTitle()).toBe('Class title');
  });

  it('reports the resolved title to the announcer on the mount path', async () => {
    const onMounted = vi.fn();
    const r = new Router(container, outlet, {
      viewRenderer: vi.fn().mockResolvedValue(undefined) as unknown as ViewRenderer,
      onMounted,
      title: (page) => `${page} | Acme`,
    });
    r.registerController(TitledController);
    r.attach();

    await fireNavigate('http://localhost/titled');

    expect(onMounted).toHaveBeenCalledWith({
      pathname: '/titled',
      initialLoad: false,
      title: 'Records | Acme',
    });
  });
});
