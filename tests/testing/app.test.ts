// Route simulation runs in the default `node` environment: it is DOM-free.
import { describe, it, expect } from 'vitest';
import { createTestApp, renderTemplate } from '../../src/testing/index.js';
import '../../src/testing/vitest.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get, post, body, guard } from '../../src/core/decorators.js';
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
});
