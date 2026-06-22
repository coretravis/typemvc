# Developing the TypeMVC VS Code extension

This document is about working ON the extension: how to rebuild it, how to get
your changes into the running editor, and the gotchas that will otherwise waste
your time. For the user-facing description, see [README.md](./README.md).

## TL;DR: updating the extension after a code change

Run these in order, from the repository root, every time you change the
framework, the Volar plugin, or the extension itself:

```sh
# 1. Rebuild the framework. build.mjs bundles FROM dist/, so this MUST run first.
pnpm build

# 2. Re-bundle the extension (inlines dist/volar-plugin into out/server.js).
cd extensions/tmvc-syntax
node build.mjs

# 3. Package a .vsix.
npx vsce package

# 4. Overwrite the installed copy that VS Code actually runs.
code --install-extension tmvc-syntax-0.1.0.vsix --force

# 5. In VS Code: Command Palette -> "Developer: Reload Window".
```

Then delete the `.vsix` (it is a build artifact, reproducible from step 3).

If you skip any step the editor keeps running the old code. See the gotchas
below for why each step is load-bearing.

## The #1 gotcha: VS Code runs the INSTALLED copy, not this folder

VS Code does not load the extension from `extensions/tmvc-syntax/`. It loads the
installed copy at:

```
~/.vscode/extensions/typemvc.tmvc-syntax-0.1.0/
```

That installed directory is an independent, real copy (not a symlink). Rebuilding
`out/server.js` in this workspace folder changes nothing that VS Code runs. You
must repackage and reinstall (steps 3 and 4) to update the running server.

This is the trap that makes it look like a correct code fix "does not work": the
fix is real, it just never reached the process. Verify with:

```sh
# Should match the freshly built workspace copy after a reinstall.
grep -c "TypedViewContext" ~/.vscode/extensions/typemvc.tmvc-syntax-0.1.0/out/server.js
grep -c "TypedViewContext" extensions/tmvc-syntax/out/server.js
```

## The #2 gotcha: "Restart Extension Host" is not enough after a reinstall

"Developer: Restart Extension Host" reloads the same on-disk bytes. After a
reinstall the version on disk was replaced, so use "Developer: Reload Window"
(or fully restart VS Code) instead. Restart Extension Host alone may keep the
previous module cached.

Optional belt-and-suspenders: bump `version` in `package.json` before packaging.
A new version number guarantees VS Code treats it as a different extension build
and does not reuse anything cached.

## The #3 gotcha: build order, and where the framework code comes from

`build.mjs` bundles the framework's compiled output into the server via esbuild
aliases:

```
@typemvc/core/volar -> <repo root>/dist/volar-plugin/index.js
@typemvc/core/vite  -> <repo root>/dist/vite-plugin/index.js
```

So `out/server.js` is self-contained: the Volar plugin is inlined at bundle
time. Consequences:

- You must run `pnpm build` at the repo root BEFORE `node build.mjs`, otherwise
  you bundle stale (or missing) `dist/` code.
- Only `vscode` and `typescript` are left external. `vscode` is provided by the
  extension host; `typescript` is loaded at runtime via the TS SDK path (the
  server resolves it with `require.resolve('typescript')`, so it must ship in
  the `.vsix` node_modules). Do not try to bundle either.

## The #4 gotcha: framework types must be exported from the barrel

The generated virtual TypeScript that backs each `.tmvc` file imports framework
types from `'@typemvc/core'`, for example `import type { TypedViewContext }`. At
edit time the language server resolves `'@typemvc/core'` through the example
app's `node_modules/@typemvc/core` symlink, which points at the repo root, whose
`types` entry is `dist/index.d.ts`.

Therefore: any type the generated virtual file imports MUST be re-exported from
`src/index.ts` so it lands in `dist/index.d.ts`. A type that exists in
`src/types/index.ts` but is missing from the `src/index.ts` barrel will not
resolve. The import fails, the whole virtual module fails to type-check, and
`context.model` silently falls back to untyped. This failure is invisible unless
you check (see "Verifying a fix" below). `TypedViewContext` was missing from the
barrel once and cost hours of chasing the wrong layer.

## How typed context.model works (so you know where to look)

1. The plugin maps a `.tmvc` path to its owning controller by convention:
   `views/<segment>/<action>.tmvc` -> `<Segment>Controller`, action method
   `<action>`. See `getControllerCandidatePaths` and `findOwningController` in
   `src/volar-plugin/index.ts` at the repo root. Candidates include the
   workspace-root locations plus a "sibling of `views/`" location, so
   sub-project layouts such as `apps/web/src/views/...` resolve to
   `apps/web/src/controllers/...`.
2. The generated virtual file extracts the model type from the action's
   `IView<T>` return type using a distributive conditional, then types the
   context as `TypedViewContext<ModelType>`. `TypedViewContext` is a standalone
   interface (not derived from `ViewContext` via `Omit`/intersection, because
   `ViewContext` has a string index signature that makes those no-ops).

If `context.model` shows as `Readonly<Record<string, unknown>>`, the cause is
almost always one of: controller not found (convention mismatch or sub-project
path), a framework type missing from the barrel, or a stale installed extension.

## Verifying a fix without clicking around the editor

Do not eyeball the editor to confirm type inference. Reproduce the exact
generated virtual TypeScript and compile it. In a consuming app, write a probe
`.ts` next to the real controller so the relative import resolves, paste the
generated preamble, and add deliberate type errors that only fail if the model
is typed correctly. For a `views/todo/index.tmvc` view owned by `TodoController`:

```ts
// <app>/src/views/todo/__probe.ts
import type { TypedViewContext } from '@typemvc/core';
import type { TodoController as __OwnerController } from '../../controllers/TodoController';

type __ActionReturn = InstanceType<typeof __OwnerController> extends
  { index(...args: any[]): infer R } ? R : never;
type __ExtractModel<V> = V extends
  { readonly kind: 'view' | 'partial'; readonly model: infer M | null } ? NonNullable<M> : never;
type __TmvcData = __ExtractModel<__ActionReturn> extends never
  ? Record<string, unknown> : __ExtractModel<__ActionReturn>;

declare const ctx: TypedViewContext<__TmvcData>;
const _wrong: string = ctx.model.total;          // expect: number not assignable to string
const _missing = ctx.model.nonExistentField123;  // expect: property does not exist
```

```sh
cd <app>
npx tsc --noEmit --strict --experimentalDecorators \
  --moduleResolution bundler --module ESNext --target ES2022 \
  --lib ES2022,dom,dom.iterable --ignoreConfig src/views/todo/__probe.ts
```

If both errors fire, the model is correctly typed. Delete the probe afterward.
This is the source of truth; it uses the same TypeScript engine the language
server uses, with none of the caching or reload ambiguity.

## Reading server logs

The server writes diagnostic lines to stderr prefixed with `[tmvc]` (process
start, `getLanguageId`, `createVirtualCode`, plugin creation, uncaught errors).
In VS Code, open the Output panel and select the "TypeMVC Language Server"
channel. Start there when the server fails to activate or a `.tmvc` file gets no
intelligence at all.

## Files

- `src/extension.ts` -> `out/extension.js`: the client. Runs in the extension
  host, spawns the language server over IPC.
- `src/server.ts` -> `out/server.js`: the Volar language server. Bundles the
  framework Volar plugin (see gotcha #3).
- `build.mjs`: esbuild bundler for both, with the framework aliases.
- `syntaxes/`, `language-configuration.json`: TextMate grammar and editor
  config for `.tmvc` files. Pure static assets; no build step.

## Scripts

- `node build.mjs` -- bundle once.
- `node build.mjs --watch` -- bundle in watch mode (still does not reinstall;
  watch only updates this folder's `out/`, not the installed copy).
- `npm run typecheck` -- type-check the extension sources.

## Releasing

The extension is released by pushing an `ext-v*` tag, which triggers the
extension release workflow.
