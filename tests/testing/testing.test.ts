import { describe, it, expect } from 'vitest';
import {
  createControllerTest,
  submitForm,
  createFormData,
  bindForm,
  testGuard,
  createRoute,
  flushEffects,
  isView,
  isPartialView,
  isRedirect,
  isRedirectReplace,
  isEmpty,
} from '../../src/testing/index.js';
import '../../src/testing/vitest.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get, post, body } from '../../src/core/decorators.js';
import { inject } from '../../src/di/decorators.js';
import { View, Redirect, EmptyView, PartialView } from '../../src/core/view.js';
import { dataType, required, email } from '../../src/validation/decorators.js';
import { signal, effect } from '../../src/reactivity/signal.js';
import type { IView, IRouteGuard, ResolvedRoute } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_SERVICE = Symbol('UserService');
const AUTH = Symbol('Auth');

interface UserService {
  getAll(): { id: string; name: string }[];
  add(name: string): void;
}

function fakeUserService(seed: { id: string; name: string }[] = []): UserService & { added: string[] } {
  const users = [...seed];
  const added: string[] = [];
  return {
    added,
    getAll: () => users,
    add: (name: string) => { added.push(name); },
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
    this.data.set('users', this.#svc.getAll());
    return View('users/index', { count: this.#svc.getAll().length });
  }

  @post()
  create(@body(CreateUserDto) dto: CreateUserDto): IView {
    if (this.hasErrors()) return View('users/create');
    this.#svc.add(dto.name);
    return Redirect('/users');
  }

  @post()
  rawCreate(formData: FormData): IView {
    void formData;
    return EmptyView();
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

// ---------------------------------------------------------------------------
// createControllerTest (AC2)
// ---------------------------------------------------------------------------

describe('createControllerTest', () => {
  it('builds the controller with mocked dependencies and runs an action', async () => {
    const t = createControllerTest(UsersController).mock(
      USER_SERVICE,
      fakeUserService([{ id: '1', name: 'Alice' }]),
    );
    const { result, viewBag } = await t.action((c) => c.index());

    expect(isView(result, 'users/index')).toBe(true);
    expect((viewBag.users as unknown[]).length).toBe(1);
  });

  it('exposes the controller instance and its error state', async () => {
    const t = createControllerTest(UsersController).mock(USER_SERVICE, fakeUserService());
    const { controller: c, hasErrors } = await t.action((ctrl) => ctrl.index());
    expect(c).toBeInstanceOf(UsersController);
    expect(hasErrors).toBe(false);
  });

  it('build() returns the same instance across calls', () => {
    const t = createControllerTest(UsersController).mock(USER_SERVICE, fakeUserService());
    expect(t.build()).toBe(t.build());
  });
});

// ---------------------------------------------------------------------------
// submitForm (AC3)
// ---------------------------------------------------------------------------

describe('submitForm', () => {
  it('binds a valid form, runs the action, and reports no errors', async () => {
    const svc = fakeUserService();
    const { result, hasErrors } = await submitForm(UsersController, 'create', {
      name: 'Alice',
      emailAddress: 'alice@example.com',
    }).mock(USER_SERVICE, svc).run();

    expect(hasErrors).toBe(false);
    expect(isRedirect(result, '/users')).toBe(true);
    expect(svc.added).toEqual(['Alice']);
  });

  it('primes validation errors and re-renders on invalid input', async () => {
    const { result, errors } = await submitForm(UsersController, 'create', {
      name: '',
      emailAddress: 'not-an-email',
    }).mock(USER_SERVICE, fakeUserService()).run();

    expect(errors.name).toBe('This field is required.');
    expect(errors.emailAddress).toBe('Must be a valid email address.');
    expect(isView(result, 'users/create')).toBe(true);
  });

  it('throws a clear error when the action has no @body parameter', async () => {
    await expect(
      submitForm(UsersController, 'rawCreate', {}).mock(USER_SERVICE, fakeUserService()).run(),
    ).rejects.toThrow(/no.*@body parameter/u);
  });
});

// ---------------------------------------------------------------------------
// createFormData / bindForm (AC4)
// ---------------------------------------------------------------------------

describe('createFormData and bindForm', () => {
  it('createFormData appends scalar and array values', () => {
    const fd = createFormData({ name: 'Alice', tags: ['a', 'b'] });
    expect(fd.get('name')).toBe('Alice');
    expect(fd.getAll('tags')).toEqual(['a', 'b']);
  });

  it('bindForm binds and validates a record like bindFormData', () => {
    const ok = bindForm(CreateUserDto, { name: 'Alice', emailAddress: 'a@b.co' });
    expect(Object.keys(ok.fieldErrors)).toHaveLength(0);

    const bad = bindForm(CreateUserDto, { name: '', emailAddress: 'x' });
    expect(bad.fieldErrors.name).toBe('This field is required.');
  });
});

// ---------------------------------------------------------------------------
// testGuard / createRoute (AC5)
// ---------------------------------------------------------------------------

describe('testGuard and createRoute', () => {
  it('resolves the guard from the container and returns its decision', async () => {
    const denied = await testGuard(AuthGuard)
      .mock(AUTH, { isAuthenticated: false })
      .canActivate(createRoute('/admin'));
    expect(denied).toBe(false);

    const allowed = await testGuard(AuthGuard)
      .mock(AUTH, { isAuthenticated: true })
      .canActivate(createRoute('/admin'));
    expect(allowed).toBe(true);
  });

  it('createRoute parses pathname, params, and query', () => {
    const route: ResolvedRoute = createRoute('/users?page=2', { params: { id: '42' } });
    expect(route.pathname).toBe('/users');
    expect(route.params.id).toBe('42');
    expect(route.query.get('page')).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// flushEffects (AC6)
// ---------------------------------------------------------------------------

describe('flushEffects', () => {
  it('synchronously flushes pending reactive effects', () => {
    const count = signal(0);
    let observed = -1;
    effect(() => { observed = count.get(); });
    expect(observed).toBe(0);

    count.set(5);
    flushEffects();
    expect(observed).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Result predicates (AC7)
// ---------------------------------------------------------------------------

describe('IView predicates', () => {
  it('discriminate every IView kind', () => {
    expect(isView(View('a'), 'a')).toBe(true);
    expect(isView(View('a'), 'b')).toBe(false);
    expect(isPartialView(PartialView('p'), 'p')).toBe(true);
    expect(isRedirect(Redirect('/x'), '/x')).toBe(true);
    expect(isRedirectReplace(Redirect('/x'))).toBe(false);
    expect(isEmpty(EmptyView())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vitest matchers (AC1 surface)
// ---------------------------------------------------------------------------

describe('vitest matchers', () => {
  it('toBeView / toRedirectTo / toBeEmptyView on IView results', () => {
    expect(View('users/index')).toBeView('users/index');
    expect(View('users/index')).not.toBeView('other');
    expect(Redirect('/users')).toRedirectTo('/users');
    expect(EmptyView()).toBeEmptyView();
  });

  it('unwraps a harness result and asserts validation errors', async () => {
    const outcome = await submitForm(UsersController, 'create', {
      name: '',
      emailAddress: 'x',
    }).mock(USER_SERVICE, fakeUserService()).run();

    expect(outcome).toBeView('users/create');
    expect(outcome).toHaveValidationError('name');
    expect(outcome).toHaveValidationError('name', 'This field is required.');
  });
});
