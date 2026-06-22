# Testing TypeMVC applications

TypeMVC ships first-party testing helpers in the `@typemvc/core/testing` subpath. They
let you test the parts of an app that hold behavior (controllers, forms,
validation, guards, dependency injection, reactivity, routing, and views)
without fighting the framework, using the test runner you already use.

The package does not replace your runner. It provides TypeMVC-aware helpers and
optional matchers that work with Vitest (and any runner with a compatible
`expect`).

## Contents

- [Why testing is straightforward here](#why-testing-is-straightforward-here)
- [Setup](#setup)
- [Headless versus DOM tests](#headless-versus-dom-tests)
- [Testing controllers](#testing-controllers)
- [Testing forms and validation](#testing-forms-and-validation)
- [Testing dependency injection](#testing-dependency-injection)
- [Testing guards](#testing-guards)
- [Testing reactivity](#testing-reactivity)
- [Asserting view results](#asserting-view-results)
- [Route simulation](#route-simulation)
- [Rendering views](#rendering-views)
- [Matchers reference](#matchers-reference)
- [API reference](#api-reference)
- [End-to-end testing](#end-to-end-testing)

## Why testing is straightforward here

The framework's architecture provides the seams a testing story needs:

- Controllers are plain classes. You construct one and call an action.
- Dependencies are injected explicitly, so mocks are just registrations.
- Action results are a discriminated union (`IView`), so assertions are exact.
- Form binding and validation run through a single binder.
- Reactivity has a deterministic, synchronous flush for tests.
- Routing maps a URL to a controller, action, and result you can inspect.

The helpers expose these seams. Most controller, form, guard, DI, and reactivity
tests run with no DOM at all.

## Setup

The headless helpers live in the framework package; there is nothing extra to
install beyond your existing test runner. DOM-rendering tests additionally need
a DOM environment such as `happy-dom` or `jsdom` installed as a development
dependency in the consuming application.

```ts
// TypeMVC-aware test helpers
import {
  createControllerTest,
  submitForm,
  createTestApp,
  renderTemplate,
  flushEffects,
} from '@typemvc/core/testing';

// Optional: register custom matchers (toBeView, toRedirectTo, ...)
import '@typemvc/core/testing/vitest';
```

Import `@typemvc/core/testing/vitest` once, in the test file or a Vitest setup file.
It registers the matchers and augments the types so `expect(...).toBeView()` is
type-checked.

```ts
// vitest.config.ts (optional global setup)
export default defineConfig({
  test: { setupFiles: ['@typemvc/core/testing/vitest'] },
});
```

## Headless versus DOM tests

Two groups of helpers, split by whether they touch the DOM:

| Helper | Needs a DOM? | Environment |
|---|---|---|
| `createControllerTest`, `submitForm`, `bindForm`, `testGuard`, `flushEffects`, the `IView` predicates | No | `node` (default) |
| `createTestApp().navigate()` / `.submit()` | No | `node` (default) |
| `renderTemplate`, `renderView` | Yes | `happy-dom` or `jsdom` |

Route simulation is DOM-free: it runs the real router and returns the `IView`
result plus metadata, without mounting the view. Only the rendering helpers need
a DOM. Declare the environment per file when you render:

```ts
// @vitest-environment happy-dom
import { renderTemplate } from '@typemvc/core/testing';
```

A render helper called without a DOM throws a clear error naming the environment
to add.

## Testing controllers

`createControllerTest(Ctor)` builds a controller with mocked dependencies and
invokes an action. The result exposes the returned `IView`, the controller
instance, the ViewBag, and the error state.

```ts
import { describe, it, expect } from 'vitest';
import { createControllerTest } from '@typemvc/core/testing';
import '@typemvc/core/testing/vitest';
import { UsersController, USER_SERVICE } from '../src/controllers/UsersController';

describe('UsersController', () => {
  it('lists users', async () => {
    const fakeUsers = { getAll: () => [{ id: '1', name: 'Alice' }] };

    const { result, viewBag } = await createControllerTest(UsersController)
      .mock(USER_SERVICE, fakeUsers)
      .action((c) => c.index());

    expect(result).toBeView('users/index');
    expect((viewBag.users as unknown[]).length).toBe(1);
  });
});
```

The object returned from `.action()` has:

- `result`: the value the action returned (an `IView`).
- `controller`: the controller instance (call its public methods, read public
  fields).
- `viewBag`: the ViewBag contents (`this.data`) after the action ran, as a plain
  record. The `data` field itself is `protected`, so read the ViewBag through
  this record rather than `controller.data`.
- `errors`: field errors accumulated on the controller, as a record.
- `hasErrors`: whether any field error is present.

```ts
const { controller, viewBag, errors, hasErrors } = await createControllerTest(C)
  .mock(TOKEN, fake)
  .action((c) => c.someAction());

expect(controller).toBeInstanceOf(C);
expect(hasErrors).toBe(false);
```

`.mock(token, impl)` registers a value for a DI token; `.provide(token, factory)`
registers a factory. `.build()` returns the controller instance directly (the
same instance `.action()` uses), for cases where you want to set up state first.

Note: `.action()` calls the action method directly. It does not run the
controller lifecycle hooks (`onInit`, `onActivate`). To exercise the full
lifecycle (resolution, guards, activation, binding), use
[route simulation](#route-simulation) instead.

## Testing forms and validation

`submitForm(Ctor, actionName, record)` drives a POST action end to end without a
router: it binds the record to the action's `@body` DTO, runs validation, primes
`context.errors`, and invokes the action. The action must declare a `@body`
parameter.

```ts
import { submitForm } from '@typemvc/core/testing';
import '@typemvc/core/testing/vitest';

it('rejects an invalid registration', async () => {
  const { result, errors } = await submitForm(UsersController, 'create', {
    name: '',
    emailAddress: 'not-an-email',
  })
    .mock(USER_SERVICE, fakeUsers)
    .run();

  expect(errors.name).toBe('This field is required.');
  expect(errors.emailAddress).toBe('Must be a valid email address.');
  expect(result).toBeView('users/create');
});

it('accepts a valid registration and redirects', async () => {
  const { result, hasErrors } = await submitForm(UsersController, 'create', {
    name: 'Alice',
    emailAddress: 'alice@example.com',
  })
    .mock(USER_SERVICE, fakeUsers)
    .run();

  expect(hasErrors).toBe(false);
  expect(result).toRedirectTo('/users');
});
```

To test the binder in isolation (no controller), use `bindForm`:

```ts
import { bindForm } from '@typemvc/core/testing';
import { CreateUserDto } from '../src/models/CreateUserDto';

const { instance, fieldErrors } = bindForm(CreateUserDto, {
  name: 'Alice',
  emailAddress: 'alice@example.com',
});

expect(fieldErrors).toEqual({});
expect(instance.name).toBe('Alice');
```

`createFormData(record)` builds a `FormData` from a record; array values append
repeated entries (for multi-value fields):

```ts
import { createFormData } from '@typemvc/core/testing';

const fd = createFormData({ name: 'Alice', tags: ['a', 'b'] });
fd.get('name');     // 'Alice'
fd.getAll('tags');  // ['a', 'b']
```

Custom validation messages (from `@required('...')`, `@dataType('number', '...')`,
and friends) flow through unchanged, so you can assert the exact strings your
users see:

```ts
expect(errors.age).toBe('You must be 18 or older');
```

## Testing dependency injection

Mocks are registrations. `.mock(token, impl)` resolves the token to a value;
`.provide(token, factory)` resolves it to a factory result. The harness builds
the controller (or guard) by resolving each `@inject` token from the container.

```ts
const test = createControllerTest(UsersController)
  .mock(USER_SERVICE, fakeUserService)
  .mock(LOGGER_FACTORY, fakeLoggerFactory);
```

The underlying container is available as `.container` for advanced assertions:

```ts
const test = createControllerTest(UsersController).mock(USER_SERVICE, fake);
test.build();
const resolved = test.container.resolve(USER_SERVICE);
expect(resolved).toBe(fake);
```

Because services are injected, you can use spies freely:

```ts
import { vi } from 'vitest';

const fake = { add: vi.fn(), getAll: () => [] };
await submitForm(UsersController, 'create', validForm).mock(USER_SERVICE, fake).run();
expect(fake.add).toHaveBeenCalledWith('Alice');
```

## Testing guards

`testGuard(GuardCtor)` resolves a guard from a container with mocks and evaluates
it against a route. `createRoute(path, options)` builds the `ResolvedRoute`.

```ts
import { testGuard, createRoute } from '@typemvc/core/testing';
import { AuthGuard, AUTH } from '../src/guards/AuthGuard';

it('denies anonymous users', async () => {
  const allowed = await testGuard(AuthGuard)
    .mock(AUTH, { isAuthenticated: false })
    .canActivate(createRoute('/admin'));

  expect(allowed).toBe(false);
});

it('allows authenticated users', async () => {
  const allowed = await testGuard(AuthGuard)
    .mock(AUTH, { isAuthenticated: true })
    .canActivate(createRoute('/admin/users?page=2', { params: { section: 'users' } }));

  expect(allowed).toBe(true);
});
```

`canActivate` returns whatever the guard returns (a boolean or a promise), so
`await` it to normalize. Guards with injected dependencies are resolved the same
way controllers are.

`createRoute` parses the query from the path and merges `options.query`;
`options.params` supplies named route segments:

```ts
const route = createRoute('/users?page=2', { params: { id: '42' } });
route.pathname;        // '/users'
route.params.id;       // '42'
route.query.get('page'); // '2'
```

To test a guard in the context of a full navigation (resolution, ordering with
other guards, the controller it protects), use
[route simulation](#route-simulation) and assert `cancelled`.

## Testing reactivity

The signals engine flushes effects on a microtask. In tests, `flushEffects()`
runs the pending effects synchronously so you can assert the result immediately.

```ts
import { signal, effect } from '@typemvc/core';
import { flushEffects } from '@typemvc/core/testing';

it('recomputes on change', () => {
  const count = signal(0);
  let observed = -1;
  effect(() => { observed = count.get(); });
  expect(observed).toBe(0);

  count.set(5);
  flushEffects();
  expect(observed).toBe(5);
});
```

When testing a rendered view that binds a signal, write the signal, then
`flushEffects()`, then assert the DOM (see [Rendering views](#rendering-views)).

## Asserting view results

Every action returns an `IView`. Assert it with matchers (after importing
`@typemvc/core/testing/vitest`) or with the plain predicate helpers.

Matchers:

```ts
expect(result).toBeView();             // any view
expect(result).toBeView('users/index'); // a view at a specific path
expect(result).toBePartialView('users/row');
expect(result).toRedirectTo('/login');
expect(result).toRedirectReplace('/dashboard');
expect(result).toBeEmptyView();
```

Predicates (no matcher import required):

```ts
import { isView, isRedirect, isEmpty } from '@typemvc/core/testing';

expect(isView(result, 'users/index')).toBe(true);
expect(isRedirect(result, '/login')).toBe(true);
expect(isEmpty(result)).toBe(true);
```

The matchers also accept a harness result and unwrap its `result` field, so both
of these work:

```ts
const outcome = await createControllerTest(C).mock(T, fake).action((c) => c.index());
expect(outcome.result).toBeView('users/index'); // explicit
expect(outcome).toBeView('users/index');         // unwrapped
```

## Route simulation

`createTestApp()` drives the real router headlessly. Register controllers with
`.route()` and dependencies with `.mock()`, then `navigate` or `submit`. This
exercises the full pipeline: route matching, guards, controller resolution, the
lifecycle hooks, parameter binding, and the action. It is DOM-free and returns an
inspectable result; it does not mount the view.

```ts
import { createTestApp } from '@typemvc/core/testing';
import '@typemvc/core/testing/vitest';

it('resolves a route to an action and result', async () => {
  const app = createTestApp()
    .route(UsersController)
    .mock(USER_SERVICE, fakeUsers);

  const r = await app.navigate('/users/42');

  expect(r.controller).toBeInstanceOf(UsersController);
  expect(r.action).toBe('details');
  expect(r.params.id).toBe('42');
  expect(r.view).toBeView('users/details');
});
```

`NavigationResult` fields:

- `controller`: the matched controller instance, or `null` if cancelled or not
  found.
- `action`: the matched action method name, or `null`.
- `params`: route segment parameters.
- `query`: the parsed query string (`URLSearchParams`).
- `view`: the action's `IView` result, or `null`.
- `redirectedTo`: the redirect target when the action redirected, else `null`.
- `redirectReplace`: `true` when the redirect replaced history.
- `cancelled`: `true` when a guard denied the navigation.
- `notFound`: `true` when no route matched.
- `errors`: field errors accumulated on the controller.

Guards:

```ts
it('cancels navigation for anonymous users', async () => {
  const app = createTestApp()
    .route(AdminController)
    .mock(AUTH, { isAuthenticated: false });

  const r = await app.navigate('/admin');

  expect(r).toBeNavigationCancelled();
  expect(r.controller).toBeNull();
});
```

Redirects:

```ts
const r = await createTestApp().route(UsersController).mock(USER_SERVICE, fake)
  .submit('/users', { form: { name: 'Alice', emailAddress: 'alice@example.com' } });

expect(r.redirectedTo).toBe('/users');
expect(r.view).toRedirectTo('/users');
```

Form submissions go through binding and validation, exactly like a real POST:

```ts
const r = await createTestApp().route(UsersController).mock(USER_SERVICE, fake)
  .submit('/users', { form: { name: '', emailAddress: 'nope' } });

expect(r).toHaveValidationError('name');
expect(r.view).toBeView('users/create');
```

Not-found:

```ts
const r = await createTestApp().route(UsersController).navigate('/missing');
expect(r).toBeNotFound();
```

## Rendering views

These helpers render into a detached DOM node and require a DOM environment.

`renderTemplate(fn)` renders an inline `html` template:

```ts
// @vitest-environment happy-dom
import { renderTemplate, flushEffects } from '@typemvc/core/testing';
import '@typemvc/core/testing/vitest';
import { html, signal } from '@typemvc/core';

it('renders a list', () => {
  const view = renderTemplate(() => html`<ul><li>Alice</li><li>Brian</li></ul>`);
  expect(view).toContainText('Alice');
  expect(view.queryAll('li')).toHaveLength(2);
});

it('updates reactively', () => {
  const count = signal(0);
  const view = renderTemplate(() => html`<span>${count}</span>`);
  expect(view).toContainText('0');

  count.set(5);
  flushEffects();
  expect(view).toContainText('5');
});
```

`renderView(viewFn, context?)` renders a compiled view function (the default
export of a `.tmvc` module, or a function from the runtime parser) with a test
context. Use `createTestContext` to supply `model`, `data`, `params`, and other
fields:

```ts
import { renderView, createTestContext } from '@typemvc/core/testing';
import UsersIndex from '../src/views/users/index.tmvc'; // requires the Vite plugin in your test config

const view = renderView(UsersIndex, createTestContext({
  model: { users: [{ id: '1', name: 'Alice' }] },
}));

expect(view.query('h1')).toHaveText('Users');
expect(view.queryAll('li')).toHaveLength(1);
```

If your test setup does not transform `.tmvc` files, compile a template string at
runtime with the parser:

```ts
import { parseTmvc } from '@typemvc/core/parser';

const viewFn = parseTmvc('<h1>${context.model.title}</h1>');
const view = renderView(viewFn, createTestContext({ model: { title: 'Hi' } }));
expect(view).toHaveText('Hi');
```

`RenderedView` query and interaction helpers:

```ts
view.text();              // textContent of the rendered root
view.html();              // innerHTML
view.query('a');          // first matching Element, or null
view.queryAll('li');      // array of matching Elements
view.click('button');     // dispatch a bubbling click
view.input('#name', 'Al'); // set value and dispatch input
view.submit('form');      // dispatch a cancelable submit
```

Interactions dispatch real DOM events, so they drive your bound handlers and
signals:

```ts
let saved = false;
const view = renderTemplate(
  () => html`<button onclick=${() => { saved = true; }}>Save</button>`,
);
view.click('button');
expect(saved).toBe(true);
```

## Matchers reference

Register with `import '@typemvc/core/testing/vitest';`.

| Matcher | Asserts |
|---|---|
| `toBeView(path?)` | result is a view (optionally at `path`) |
| `toBePartialView(path?)` | result is a partial view (optionally at `path`) |
| `toRedirectTo(path)` | result is a redirect to `path` |
| `toRedirectReplace(path)` | result is a replacing redirect to `path` |
| `toBeEmptyView()` | result is the empty view |
| `toHaveValidationError(field, message?)` | errors contain `field` (optionally equal to `message`) |
| `toBeNavigationCancelled()` | a navigation result was cancelled by a guard |
| `toBeNotFound()` | a navigation result had no route match |
| `toContainText(text)` | a rendered view (or element) contains `text` |
| `toHaveText(text)` | a rendered view (or element) text equals `text` |

The view matchers accept an `IView` or a harness/navigation result and unwrap
it. `toHaveValidationError` accepts an errors record or a result with an
`errors` field. `toContainText` / `toHaveText` accept a `RenderedView`, a DOM
element, or a string.

## API reference

From `@typemvc/core/testing`:

```ts
// Controllers and DI
createControllerTest(Ctor)
  .mock(token, impl) .provide(token, factory)
  .build() -> controller
  .action(fn) -> Promise<{ result, controller, viewBag, errors, hasErrors }>

// Forms
submitForm(Ctor, actionName, record)
  .mock(...) .provide(...)
  .run() -> Promise<{ result, controller, viewBag, errors, hasErrors }>
createFormData(record) -> FormData
bindForm(DtoClass, record) -> { instance, fieldErrors }

// Guards and routes
testGuard(GuardCtor).mock(...).canActivate(route) -> boolean | Promise<boolean>
createRoute(path, { params?, query? }) -> ResolvedRoute

// Reactivity
flushEffects()

// Result predicates
isView(r, path?) isPartialView(r, path?) isRedirect(r, path?)
isRedirectReplace(r, path?) isEmpty(r)

// Route simulation
createTestApp()
  .route(Ctor) .mock(...) .provide(...)
  .navigate(path) -> Promise<NavigationResult>
  .submit(path, { form }) -> Promise<NavigationResult>

// Rendering (DOM required)
renderTemplate(fn) -> RenderedView
renderView(viewFn, context?) -> RenderedView
createTestContext(partial?) -> ViewContext
flushNavigation() -> Promise<void>
```

## End-to-end testing

`@typemvc/core/testing` targets unit and integration levels: logic, routing, binding,
guards, reactivity, and view rendering in a simulated DOM. For real-browser,
full-stack end-to-end coverage (a real navigation, real network, multiple
pages), use a browser automation tool such as Playwright directly against your
running app. The two layers are complementary: the testing helpers cover the
framework-shaped logic quickly and deterministically; Playwright covers the real
browser.
