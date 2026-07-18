// Route simulation runs in the default `node` environment: it is DOM-free.
import { describe, it, expect } from 'vitest';
import { createTestApp, createControllerTest, renderComponent, renderTemplate } from '../../src/testing/index.js';
import '../../src/testing/vitest.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get, post, body, guard, title, pending, failure } from '../../src/core/decorators.js';
import { inject } from '../../src/di/decorators.js';
import { View, Redirect } from '../../src/core/view.js';
import { dataType, required, email } from '../../src/validation/decorators.js';
import type { IView, IRouteGuard } from '../../src/types/index.js';

const USER_SERVICE = Symbol('UserService');
const AUTH = Symbol('Auth');

interface UserService {
  getById(id: string): { id: string; name: string } | undefined;
  add(name: string): void;
}

function fakeUserService(): UserService & { added: string[] } {
  const added: string[] = [];
  return {
    added,
    getById: (id) => ({ id, name: 'Alice' }),
    add: (name) => { added.push(name); },
  };
}

class CreateUserDto {
  @dataType('string')
  @required()
  name = '';

  @dataType('string')
  @email()
  emailAddress = '';
}

@controller('/users')
class UsersController extends Controller {
  readonly #svc: UserService;
  constructor(@inject(USER_SERVICE) svc: UserService) {
    super();
    this.#svc = svc;
  }

  @get()
  index(): IView {
    return View('users/index');
  }

  @get('{id}')
  details(id: string): IView {
    return View('users/details', { user: this.#svc.getById(id) });
  }

  @post()
  create(@body(CreateUserDto) dto: CreateUserDto): IView {
    if (this.hasErrors()) return View('users/create');
    this.#svc.add(dto.name);
    return Redirect('/users');
  }
}

class AuthGuard implements IRouteGuard {
  readonly #auth: { isAuthenticated: boolean };
  constructor(@inject(AUTH) auth: { isAuthenticated: boolean }) {
    this.#auth = auth;
  }
  canActivate(): boolean {
    return this.#auth.isAuthenticated;
  }
}

@controller('/admin')
@guard(AuthGuard)
class AdminController extends Controller {
  @get()
  index(): IView {
    return View('admin/index');
  }
}

function app() {
  return createTestApp().mock(USER_SERVICE, fakeUserService());
}

// ---------------------------------------------------------------------------
// Route resolution (AC1)
// ---------------------------------------------------------------------------

describe('createTestApp navigation', () => {
  it('resolves a route to a controller, action, params, and view', async () => {
    const r = await app().route(UsersController).navigate('/users/42');
    expect(r.controller).toBeInstanceOf(UsersController);
    expect(r.action).toBe('details');
    expect(r.params.id).toBe('42');
    expect(r.view).toBeView('users/details');
    expect(r.notFound).toBe(false);
    expect(r.cancelled).toBe(false);
  });

  it('reports notFound for an unmatched path (AC2)', async () => {
    const r = await app().route(UsersController).navigate('/nope');
    expect(r).toBeNotFound();
    expect(r.controller).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Guards (AC2)
// ---------------------------------------------------------------------------

describe('guards via navigation', () => {
  it('cancels navigation when a guard denies it', async () => {
    const r = await createTestApp()
      .route(AdminController)
      .mock(AUTH, { isAuthenticated: false })
      .navigate('/admin');
    expect(r).toBeNavigationCancelled();
    expect(r.controller).toBeNull();
  });

  it('allows navigation when the guard permits it', async () => {
    const r = await createTestApp()
      .route(AdminController)
      .mock(AUTH, { isAuthenticated: true })
      .navigate('/admin');
    expect(r.cancelled).toBe(false);
    expect(r.controller).toBeInstanceOf(AdminController);
    expect(r.view).toBeView('admin/index');
  });
});

// ---------------------------------------------------------------------------
// Form submission and redirects (AC3, AC4)
// ---------------------------------------------------------------------------

describe('submit via navigation', () => {
  it('binds a valid form and follows the redirect', async () => {
    const r = await app().route(UsersController).submit('/users', {
      form: { name: 'Alice', emailAddress: 'alice@example.com' },
    });
    expect(Object.keys(r.errors)).toHaveLength(0);
    expect(r.redirectedTo).toBe('/users');
    expect(r.view).toRedirectTo('/users');
  });

  it('surfaces validation errors and re-renders the form', async () => {
    const r = await app().route(UsersController).submit('/users', {
      form: { name: '', emailAddress: 'nope' },
    });
    expect(r).toHaveValidationError('name');
    expect(r.errors.emailAddress).toBe('Must be a valid email address.');
    expect(r.view).toBeView('users/create');
    expect(r.redirectedTo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DOM guard (AC6) -- proven here because this file runs in node (no DOM)
// ---------------------------------------------------------------------------

describe('DOM-render helpers require a DOM environment', () => {
  it('renderTemplate throws a clear error without a DOM', () => {
    expect(() => renderTemplate(() => { throw new Error('should not run'); })).toThrow(/DOM environment/u);
  });

  it('renderComponent throws a clear error naming the happy-dom fix without a DOM', () => {
    expect(() =>
      renderComponent(() => {
        throw new Error('should not run');
      }),
    ).toThrow(/\[TypeMVC\][\s\S]*DOM environment[\s\S]*happy-dom/u);
  });
});

// ---------------------------------------------------------------------------
// Page title: a controller test asserts it with no DOM.
// ---------------------------------------------------------------------------

@controller('/reports')
@title('Reports')
class ReportController extends Controller {
  @get()
  index(): IView {
    return View('reports/index');
  }

  @get('{id}')
  detail(id: string): IView {
    this.title = `Report ${id}`;
    return View('reports/detail');
  }

  @get('away')
  away(): IView {
    return Redirect('/reports');
  }
}

@controller('/plain')
class PlainController extends Controller {
  @get()
  index(): IView {
    return View('plain/index');
  }
}

describe('NavigationResult.title', () => {
  it('exposes the title a @title decorator resolved', async () => {
    const r = await createTestApp().route(ReportController).navigate('/reports');
    expect(r.title).toBe('Reports');
  });

  it('exposes a title the action computed', async () => {
    const r = await createTestApp().route(ReportController).navigate('/reports/42');
    expect(r.title).toBe('Report 42');
  });

  it('is null when the route resolved no title', async () => {
    const r = await createTestApp().route(PlainController).navigate('/plain');
    expect(r.title).toBeNull();
  });

  it('is null for a result that renders no view', async () => {
    const r = await createTestApp().route(ReportController).navigate('/reports/away');
    expect(r.title).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Async action lifecycle: the helpers drive an async action to a pending state,
// to resolution, to failure, and to cancellation.
// ---------------------------------------------------------------------------

function makeAbortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function afterMacrotask<T>(value: T): Promise<T> {
  return new Promise<T>((resolve) => { setTimeout(() => { resolve(value); }, 5); });
}

@controller('/records')
@pending('records/skeleton')
@failure('records/error')
class RecordsController extends Controller {
  @get('{id}')
  async detail(id: string): Promise<IView> {
    // Yields to a macrotask, so the pending view can show before it resolves.
    return await afterMacrotask(View('records/detail', { id }));
  }

  @get('boom')
  boom(): Promise<IView> {
    return Promise.reject(new Error('records unavailable'));
  }

  @get('cancel')
  async cancel(): Promise<IView> {
    return await new Promise<IView>((_resolve, reject) => {
      if (this.signal.aborted) { reject(makeAbortError()); return; }
      this.signal.addEventListener('abort', () => { reject(makeAbortError()); }, { once: true });
    });
  }
}

describe('async action lifecycle via the helpers', () => {
  it('drives an async action through a pending state to resolution', async () => {
    const r = await createTestApp()
      .route(RecordsController)
      .pendingDelay(0)
      .navigate('/records/7');

    expect(r.pending).not.toBeNull();
    expect(r.pending?.kind === 'view' ? r.pending.path : null).toBe('records/skeleton');
    expect(r.view).toBeView('records/detail');
    expect(r.failed).toBe(false);
  });

  it('does not show a pending view when the action settles first', async () => {
    const r = await createTestApp()
      .route(RecordsController)
      .navigate('/records/7');

    expect(r.pending).toBeNull();
    expect(r.view).toBeView('records/detail');
  });

  it('drives an async action to failure and reports the failure view', async () => {
    const r = await createTestApp()
      .route(RecordsController)
      .navigate('/records/boom');

    expect(r.failed).toBe(true);
    expect(r.error?.message).toBe('records unavailable');
    expect(r.failureView?.kind === 'view' ? r.failureView.path : null).toBe('records/error');
  });

  it('hands a controller test a fresh, unaborted signal', () => {
    const t = createControllerTest(RecordsController);
    t.build();

    expect(t.signal).toBeInstanceOf(AbortSignal);
    expect(t.signal.aborted).toBe(false);
  });

  it('drives an action to cancellation with abort()', async () => {
    const t = createControllerTest(RecordsController);
    const controller = t.build();

    const running = controller.cancel();
    t.abort();

    await expect(running).rejects.toThrow(/aborted/i);
    expect(t.signal.aborted).toBe(true);
  });
});
