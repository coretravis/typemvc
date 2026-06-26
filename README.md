# TypeMVC

[![npm](https://img.shields.io/npm/v/@typemvc/core.svg)](https://www.npmjs.com/package/@typemvc/core)
[![CI](https://github.com/coretravis/typemvc/actions/workflows/ci.yml/badge.svg)](https://github.com/coretravis/typemvc/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@typemvc/core.svg)](./LICENSE)

TypeMVC is a browser-first TypeScript framework for controller-led applications,
document-style `.tmvc` views, typed models, dependency injection, validation, and
fine-grained reactive DOM updates.

A route selects a controller action. The action coordinates application work and
returns a view result. The view receives a typed context and renders a document.
Signals keep the DOM current by updating only the bindings that depend on a
changed value. No JSX, no virtual DOM, no server-side rendering.

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

TypeMVC is opinionated about where work belongs.

- **Controllers own route workflows.** Dependencies, validation decisions, state
  coordination, and view results live in controller actions where application
  flow is easiest to reason about.
- **Services own reusable application work.** Data access, persistence adapters,
  domain behavior, and cross-feature logic stay outside the view layer and are
  resolved through explicit dependency injection.
- **Views are documents.** A `.tmvc` view is markup with `${...}` expressions.
  It receives `context`, renders a typed model, and does not fetch data, resolve
  services, or become a workflow container.
- **Components own reusable UI.** Components receive `props`, render slots, and
  may use `@local` for small instance-scoped interaction state such as open
  state, selected tabs, temporary input text, or event-listener cleanup.
- **Signals own fine-grained updates.** When a signal changes, TypeMVC updates
  the text node, attribute, fragment, or keyed list that depends on it.

The result is a frontend codebase with a clear home for every concern: route
workflow in controllers, reusable behavior in services, document markup in
views, reusable UI in components, and live DOM updates handled by the renderer.

## Why TypeMVC

- **Application structure first.** TypeMVC gives browser applications a clear
  architectural spine instead of making every concern orbit the component tree.
- **Document views stay readable.** Views are documents with typed expressions,
  not classes, hooks, providers, or service containers.
- **Reactivity stays focused.** Signals update only the DOM bindings that depend
  on changed values. Views do not manually subscribe, diff, or re-render.
- **Secure by default.** Every dynamic value is HTML escaped. Raw HTML, raw
  URLs, and raw attributes require an explicit opt in.
- **Typed boundaries.** Controller return types, `@model`, `@props`, DTO binding,
  validation, and Volar tooling make application contracts visible in the
  editor.
- **A cohesive runtime.** Routing, dependency injection, validation, layouts,
  partials, components, `@local` component state, logging, and first-party
  testing helpers are designed as one framework surface.

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
