# TypeMVC

[![npm](https://img.shields.io/npm/v/@typemvc/core.svg)](https://www.npmjs.com/package/@typemvc/core)
[![CI](https://github.com/coretravis/typemvc/actions/workflows/ci.yml/badge.svg)](https://github.com/coretravis/typemvc/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@typemvc/core.svg)](./LICENSE)

TypeMVC is a client-side MVC framework for TypeScript. You write controllers as
classes that map routes to actions and return views, and views as plain `.tmvc`
documents that render a typed model. Controller state is held in signals, so when
it changes the framework updates only the DOM nodes that depend on it. No JSX, no
virtual DOM, no server-side rendering.

> Published on npm as `@typemvc/core`.

```ts
import { Controller, controller, get, View } from '@typemvc/core';

@controller('home')
class HomeController extends Controller {
  @get()
  index() {
    return View({ title: 'Hello, TypeMVC' });
  }
}
```

```html
@model from HomeController.index

<h1>${context.model.title}</h1>
```

## Quick start

Scaffold a new app into a fresh folder, then run it:

```bash
npm create @typemvc@latest my-app
# or: pnpm create @typemvc my-app
# or: yarn create @typemvc my-app

cd my-app
npm install
npm run dev
```

Requires Node.js >= 20. The generated app is a Vite SPA already wired with the
`@typemvc/core/vite` plugin, a typed `tsconfig.json`, a bootstrap entry, a Home
controller with a reactive counter, a 404 catch-all, and matching `.tmvc` views.
Open the dev URL and start editing `src/`.

To grow it: add a controller as a class that extends `Controller` and register
it with `app.route()` in `src/main.ts`; add a view, layout, or component by
creating a `.tmvc` file in the matching folder. See [Editor support](#editor-support)
for typed `.tmvc` intelligence in VS Code.

## How it works

TypeMVC keeps the three MVC roles separate and gives each one a single job.

- **Controllers own the complexity.** Dependency injection, data fetching,
  business logic, and state all live in the controller. A controller is a long
  lived TypeScript class; its fields are signals, and the actions it exposes map
  routes to view results.
- **Views are documents.** A `.tmvc` view is markup with `${...}` expressions.
  It has no imports, no exports, no class, and no awareness of services. It
  receives a typed context and renders it.
- **The model is typed end to end.** A view declares which action it belongs to,
  and its `context.model` is inferred from that action's return type. Model
  access is checked in your editor and at build time.

Because controller state is reactive, a change from a timer, a socket, or a user
action updates the live DOM on its own. There is no re-render and no diff.

## Why TypeMVC

- **A familiar shape.** Controllers, actions, and views are an established way to
  structure an application. TypeMVC brings that structure to the browser.
- **Reactivity you do not have to manage.** A signals runtime tracks
  dependencies and updates only what changed. Views never opt in to reactivity;
  the framework wires signals to DOM nodes for them.
- **Secure by default.** Every dynamic value is HTML escaped. Raw HTML, raw
  URLs, and raw attributes require an explicit opt in.
- **Batteries included.** Routing, dependency injection, validation, layouts,
  partials, components, logging, and a first-party testing kit ship in the box,
  and every part is tree shakeable.

## Add to an existing project

If you are not starting from `npm create @typemvc` (see [Quick start](#quick-start)),
install the package into an existing Vite project:

```bash
pnpm add @typemvc/core
# or: npm install @typemvc/core
```

Requires Node.js >= 20. Register the Vite plugin that compiles `.tmvc` views:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { typemvcPlugin } from '@typemvc/core/vite';

export default defineConfig({
  plugins: [typemvcPlugin()],
});
```

## Package entry points

| Import | Purpose |
| --- | --- |
| `@typemvc/core` | Framework runtime: controllers, views, signals, DI, validation |
| `@typemvc/core/vite` | Vite plugin that compiles `.tmvc` files |
| `@typemvc/core/parser` | Runtime `.tmvc` parser |
| `@typemvc/core/testing` | Testing helpers (render, controllers, forms, guards) |
| `@typemvc/core/testing/vitest` | Vitest matchers (`toBeView`, etc.) |
| `@typemvc/core/volar` | Volar language plugin (used by the VS Code extension) |

## Editor support

Install the TypeMVC VS Code extension for `.tmvc` syntax highlighting and
language intelligence: typed `context.model`, completions, go-to-definition, and
inline diagnostics. It bundles `@typemvc/core/volar`.

## Documentation

The `.tmvc` file format is documented in
[docs/tmvc-file-format.md](./docs/tmvc-file-format.md), and the testing guide
lives in [docs/guide/testing.md](./docs/guide/testing.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The full local pipeline is:

```bash
pnpm run ci   # lint + typecheck + test + build
```

## License

[MIT](./LICENSE) (c) coretravis
