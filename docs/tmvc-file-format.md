# .tmvc File Format Specification

**Version:** 1.0
**Phase:** 2
**Status:** Approved for Development

---

## 1. Overview

The `.tmvc` format is the view document format for TypeMVC Phase 2. It replaces inline template functions for view authoring. A `.tmvc` file is plain markup with embedded TypeScript expressions. It has no imports, no exports, and no class definitions. The framework provides all bindings implicitly.

This document is the reference for the two implementations that consume `.tmvc` files:

- The Vite plugin that transforms `.tmvc` files at build time
- The runtime parser that evaluates `.tmvc` files at runtime

Both implementations must produce output that is behaviourally identical to an inline `html` tagged template function.

---

## 2. File Extension and Location

- File extension: `.tmvc`
- Default location: the `views/` directory (configurable via `viewsRoot` in `AppConfig`)
- Resolved by convention from controller and action names
- Override with an explicit path in `View('path/to/view', data)`

### 2.1 File Location Determines Capability

A `.tmvc` file's directory is not a project suggestion: it is a language rule that
decides which directives the file may use.

- A file under a `components/` directory is a **component**. Only a component may
  declare a `@local` block. A `@local` block in a file outside `components/` is a
  compile-time error: `the @local block is only allowed in component files.`
- A file under a `layouts/` directory is a **layout**. Only a layout may declare a
  `@parent` directive, which names the layout that wraps it. A `@parent` outside
  `layouts/` is a compile-time error: `the @parent directive is only allowed in a
  layout file.` A view chooses its layout with `@layout` on the controller or the
  action instead.
- Every other `.tmvc` file is a **view**.

A component, layout, or view is also identified to the framework by its file
basename, which must be unique across the application: two files with the same
basename in different folders are a hard error at build, not a silent last-wins.
Because both the capability and the identity of a file are read from its path,
moving a file between these directories changes what it is and what it may declare.

The Vite plugin enforces these rules at build time and the Volar language service
surfaces the same diagnostics in the editor. The zero-build runtime parser cannot
see a file's directory, so it enforces the in-`@local` rules (section 7.2) but not
the folder-capability rules; keep files in their correct directories so the build
enforces them.

### 2.2 Co-located Stylesheet

A `.tmvc` file may have a sibling stylesheet with the same name and `.css`
appended:

```
src/components/Pill.tmvc
src/components/Pill.tmvc.css
```

If the sibling exists, the Vite plugin imports it from the document's generated
module, so the bundler emits a `<style>` tag in development, an extracted CSS
asset in a build, and splits the stylesheet into the same chunk as the document
that uses it. If the sibling does not exist, nothing is imported. There is no
directive to write: the filename is the declaration. The convention applies
identically to views, components, and layouts.

The double extension is deliberate. `Pill.tmvc.css` sorts next to `Pill.tmvc`
and cannot be confused with a hand-authored `Pill.css` that an application
imports globally for its own reasons, which the plugin ignores.

This is a Vite plugin feature. The zero-build runtime parser cannot import CSS;
see section 7.2. Co-location gives adjacency, code splitting, and deletion
safety. It does not give style encapsulation: selectors remain global, and a
naming convention is what keeps two documents' rules from colliding.

---

## 3. File Structure and Constraints

A `.tmvc` file contains only two kinds of content:

1. **Markup text** -- any HTML or text content that is not an interpolation
2. **TypeScript expressions** -- embedded using `${...}` syntax

### 3.1 Constraints

The following constructs are forbidden at the top level of a `.tmvc` file (in markup text, outside a `${...}` expression):

| Forbidden construct | Error kind | Framework error message prefix |
|---|---|---|
| `import` declaration | `import-statement` | `[TypeMVC] .tmvc files may not contain import declarations.` |
| `export` declaration | `export-statement` | `[TypeMVC] .tmvc files may not contain export declarations.` |
| `class` definition | `class-definition` | `[TypeMVC] .tmvc files may not contain class definitions.` |

These restrictions enforce the view-as-document philosophy: a view has no knowledge of modules, services, or object hierarchies. Violations are detected at build time by the Vite plugin and at parse time by the runtime parser.

---

## 4. Implicit Bindings

Every `.tmvc` file has a context parameter and a set of framework names in scope
that require no import. A view receives `context`; a component receives `props`.

| Name | Kind | View | Component template | `@local` |
|---|---|---|---|---|
| `context` / `props` | render parameter | `context` | `props` | `props` |
| `html`, `svg` | tagged template functions | yes | yes | yes |
| `computed` | reactive derivation | yes | yes | yes |
| `keyed`, `keyedMap` | keyed list helpers | yes | yes | yes |
| `safeHtml` | trusted markup | yes | yes | yes |
| `stop`, `prevent` | event modifiers | yes | yes | yes |
| `signal`, `effect`, `batch`, `onCleanup` | state primitives | no | no | yes |

`context` is the parameter name of the generated view render function. It carries
`context.data`, `context.errors`, `context.router`, `context.params`,
`context.query`, and any non-route method names from the controller. A component
receives `props` in its place.

`html` and `svg` are available inside `${...}` expressions for authoring nested
fragments. `computed` is a derivation of the model the view was already handed, so
it is in scope everywhere. `keyed`, `keyedMap`, `safeHtml`, `stop` and `prevent`
are output helpers a template needs to build keyed, trusted, or event-bound markup.

`signal` and `effect` are deliberately out of scope in a view and in a component
template. A view is a pure template over a model, and a component template is a
pure template over its props: owning mutable state is what a component `@local`
block is for. Using `signal` or `effect` in a view therefore reports as an
undefined name, which is the intended guardrail rather than an oversight.

Component tags (`<Pill />`) are rewritten to component calls anywhere they appear
inside an `html` or `svg` tagged template, including inside a `@local` block, so a
reactive list of components can be built where the state that drives it lives.

---

## 5. TypeScript Expression Embedding

Expressions are embedded with `${...}`:

```ts
<p>${context.data.message}</p>
```

Expressions may contain any valid TypeScript, including:

**Property access:**

```ts
<h1>${context.data.title}</h1>
```

**Method calls returning a Fragment:**

```ts
<ul>
  ${context.data.items.map(item => html`<li>${item.name}</li>`)}
</ul>
```

**Ternary for conditional rendering:**

```ts
${context.errors.name
  ? html`<span class="field-error">${context.errors.name}</span>`
  : ''
}
```

**Logical AND for optional rendering:**

```ts
${context.data.isAdmin && html`<button>Admin Panel</button>`}
```

No special template directives exist. There is no `*ngFor`, `v-for`, or `#each`. TypeScript is the template language.

### 5.1 Prefixed Attributes

Two attribute prefixes bind one thing each instead of recomposing a whole attribute
value. They are ordinary attributes to the compiler and to the parser; the renderer
recognises the prefix.

**`class:name`** toggles a single class from a condition:

```ts
<button class="palette__item" class:is-active="${context.data.isActive}">Open</button>
```

The class is applied through `classList`, so it composes with the static `class`
attribute and with any other `class:` binding on the same element, in any authoring
order. Each binding owns its own effect and touches only its own token, so no empty
string branch is needed. The value must be a single `${...}` expression: combining it
with literal text is an error, because every non-empty string is truthy.

**`style:property`** assigns a single CSS property, custom or plain:

```ts
<div class="bars__bar" style:--fill="${context.data.percent}"></div>
<div style:width="${context.data.width}px"></div>
```

The value is assigned with `element.style.setProperty`. Assigning a `style` attribute
is governed by the `style-src-attr` policy directive and requires `unsafe-inline`;
assigning through the CSSOM is not, so a data driven dimension does not force an
application to weaken its Content Security Policy. The property name is taken verbatim
after the prefix. A number is written as a bare string, and the stylesheet decides the
unit. `null`, `undefined`, `false`, and the empty string remove the property rather
than writing a value into it.

The stylesheet keeps ownership of how a thing looks; the model owns only how much.

### 5.2 Importing Module Values with `@use`

A `.tmvc` file may not contain a bare `import` declaration. To bring a module
value (an icon table, a formatter, a set of chart definitions, a column spec)
into scope, declare it with a `@use` directive in the directive block at the top
of the file:

```ts
@model { rows: Row[] }
@use { ICONS, formatCurrency } from '../lib/display'

<td>${formatCurrency(row.total)}</td>
```

Rules:

- A `@use` line sits in the directive block, after any `@model` or `@props` line
  and before the markup. A `@use` elsewhere is a build error.
- The import clause is emitted verbatim as a plain `import`, so named
  (`{ A, B }`), default (`Name`), and namespace (`* as ns`) forms all work. A
  relative specifier resolves against the `.tmvc` file's directory; a bare
  specifier resolves as a package, matching normal bundler resolution.
- A `@use` binding is in scope in the template body and inside a `@local` block.
  It is not permitted in `@model` or `@props`, which are types.

`@use` is a convenience for module *values*, not a general escape hatch. The
template body denylist still applies to code that uses a `@use` binding: `await`
on its result is still rejected, and `fetch` is still rejected. The check is on
the use site, not on the imported module's contents. A determined author can
import a module that itself does IO and call it, exactly as `@local` can today.
This is a guardrail that makes the wrong thing inconvenient and legible, not a
sandbox.

The zero-build runtime parser cannot resolve module imports, so it rejects
`@use` with a descriptive `[TypeMVC]` error. Build the file with the Vite plugin
to use `@use`.

### 5.3 Composing Layouts with `@parent`

A layout file may name the layout that wraps it, so shared chrome is written
once and the layouts that need it declare the relationship:

```ts
@parent AppLayout

<div class="admin-shell">
  <nav class="admin-nav">...</nav>
  <main>${context.slot}</main>
</div>
```

`@parent` takes a layout **name**, not a path and not an import: the name the
layout is registered under, which is its filename without the extension. It is
the same name `@layout('AppLayout')` takes on a controller or an action, and it
resolves through the same map.

Rules:

- `@parent` is valid in a layout file only. A view and a component are wrapped by
  a layout; they do not declare one. A view chooses its layout with `@layout` on
  the controller or the action.
- It sits in the directive block at the top of the file, before the markup, and
  may appear only once. `@use` lines may sit alongside it, in either order.
- The named layout must be registered in the `layouts` eager glob passed to
  `bootstrap()`. A name that is not registered is a bootstrap-time error naming
  the child layout, the missing parent, and the glob to register it in.
- A layout has one parent. The chain it forms is walked to its root, and a cycle
  is an error naming every layout on the path.

Rendering is inside out: the page view renders first, its `Fragment` arrives as
`context.slot` in the innermost layout, that layout's output becomes the next
layout's `context.slot`, and so on outward to the root.

The zero-build runtime parser has no layout registry, so it strips a `@parent`
line and renders the layout's own markup without wrapping it. Build the file with
the Vite plugin to compose layouts.

---

## 6. The Generated Module Shape

The Vite plugin wraps the entire `.tmvc` file content verbatim in a tagged template literal and exports a default render function. The generated TypeScript module has the following shape:

```ts
import { html } from '@typemvc/core';
import type { ViewContext } from '@typemvc/core';
import type { Fragment } from '@typemvc/core';

export default function render(context: ViewContext): Fragment {
  return html`<tmvc file content verbatim>`;
}
```

Key properties of this shape:

- The default export is a function matching `TmvcViewFunction = (context: ViewContext) => Fragment`.
- The `.tmvc` file content is placed verbatim as the body of the tagged template literal. No transformation of the markup or expressions is performed.
- `context` is NOT declared inside the `.tmvc` file; it is the parameter of the generated `render` function, so all `${context...}` expressions resolve correctly.
- `html` is imported once at the top of the module. It is available inside `${...}` expressions for nested `html\`...\`` calls.
- The generated module is valid TypeScript that the Phase 1 runtime executes without modification.

### 6.1 Minimal Example

**.tmvc Source (views/hello.tmvc):**

```ts
<p>Hello</p>
```

**Generated TypeScript module:**

```ts
import { html } from '@typemvc/core';
import type { ViewContext } from '@typemvc/core';
import type { Fragment } from '@typemvc/core';

export default function render(context: ViewContext): Fragment {
  return html`<p>Hello</p>`;
}
```

---

## 7. Runtime Evaluated Form

The runtime parser produces an equivalent result without a build step, using `new Function()`. This requires the `unsafe-eval` Content Security Policy directive.

The parser wraps the `.tmvc` source in a function body and evaluates it:

```ts
const rawFn = new Function(
  'context',
  'html',
  `return html\`<tmvc file content>\``
) as TmvcViewFunction;
```

The returned function is called with `context` and the `html` import:

```ts
function render(context: ViewContext): Fragment {
  return rawFn(context, html) as Fragment;
}
```

The result is behaviourally identical to the Vite plugin output. Both paths produce a `TmvcViewFunction`.

### 7.1 Backtick Escaping

`.tmvc` source may contain bare backtick characters in markup (for example, inside `<code>` elements). When building the function body string, bare backticks in markup text (outside `${...}` expressions) must be escaped to prevent premature termination of the outer template literal.

Backticks that appear inside `${...}` expressions are already delimiters of nested template literals; the JavaScript engine handles their nesting correctly when the function body is evaluated.

### 7.2 Runtime Parser Limitations

Template expressions and `@local` blocks are authored as TypeScript. The Vite
plugin hands the generated module to the build's TypeScript pass, which strips
type annotations before the browser sees the code. The zero-build runtime parser
has no such pass: it evaluates the source directly with `new Function`, which
cannot strip types.

The runtime parser therefore rejects type annotations in a `@local` block with a
descriptive `[TypeMVC]` error rather than evaluating them. A typed declaration
like `const count = signal<number>(0)` is not a syntax error in JavaScript: it
parses as two chained comparisons and yields a boolean. Rejecting it up front is
safer than silently producing the wrong value. Remove the annotations, or build
the file with the Vite plugin.

The runtime parser also rejects `@use`, because it has no bundler to resolve the
import. Pass the value through the view context, or build the file with the Vite
plugin.

A co-located stylesheet (section 2.2) is likewise a build-time feature. The
runtime parser is handed source text, not a path, so a sibling `Name.tmvc.css` on
disk is invisible to it. It tolerates the document and renders it, without the
stylesheet. Build the file with the Vite plugin to apply co-located styles.

---

## 8. Error Cases

The markup checks below run against a copy of the source with every HTML comment
blanked, so prose inside `<!-- ... -->` never triggers one. A comment line that
happens to begin with `class`, `import`, or `export` is text, not a declaration.
The reported line number and source line are always the author's own.

### 8.1 Import Statement

**Detection:** A line beginning with `import ` (possibly preceded by whitespace) that appears in markup text (outside a `${...}` expression and outside an HTML comment).

**Error kind:** `'import-statement'`

**Message format:**
```
[TypeMVC] .tmvc file line N: import declarations are not permitted. Move the import into a controller or a service, and pass what the template needs through the view context.
```

### 8.2 Export Statement

**Detection:** A line beginning with `export ` (possibly preceded by whitespace) that appears in markup text (outside a `${...}` expression and outside an HTML comment).

**Error kind:** `'export-statement'`

**Message format:**
```
[TypeMVC] .tmvc file line N: export declarations are not permitted. The default export is generated by the framework, so delete this line.
```

### 8.3 Class Definition

**Detection:** A line containing `class ` (optionally preceded by `abstract `) that appears in markup text (outside a `${...}` expression and outside an HTML comment).

**Error kind:** `'class-definition'`

**Message format:**
```
[TypeMVC] .tmvc file line N: class definitions are not permitted. Views are pure templates: move the class into a controller, a service, or a model module.
```

### 8.4 Invalid TypeScript Expression

A `${...}` expression containing a TypeScript syntax error is detected at build time by the TypeScript compiler (Vite plugin) and at runtime by the JavaScript engine (`new Function` throws a `SyntaxError`). The Vite plugin should surface the source line number in the error. The runtime parser should wrap the `SyntaxError` and include the source line number.

---

## 9. Grammar

The following grammar defines the structure of a `.tmvc` file.

```
tmvc-file        := chunk*
chunk            := text-chunk | interpolation
text-chunk       := (any-char | lone-dollar)+
lone-dollar      := "$" [^{]        (a $ not followed by {, not an interpolation start)
interpolation    := "${" ts-expr "}"
ts-expr          := balanced TypeScript expression (see depth tracking)
```

### 9.1 Expression Depth Tracking

The parser tracks brace depth while scanning `ts-expr`:

1. Start depth at 1 (the opening `{` of `${` counts as depth 1).
2. For each character encountered:
   - On `{` outside a string or template literal: increment depth.
   - On `}` outside a string or template literal: decrement depth. If depth reaches 0, the expression ends (do not consume the closing `}`; it belongs to the interpolation syntax).
3. String literals must be tracked to skip their interior braces:
   - `"..."` -- double-quoted string; skip until unescaped `"`
   - `'...'` -- single-quoted string; skip until unescaped `'`
   - `` `...` `` -- template literal; skip until unescaped `` ` ``, recursively handling its own `${...}` interpolations
4. Comments are skipped:
   - `//` starts a line comment; skip to end of line
   - `/*` starts a block comment; skip until `*/`

### 9.2 Forbidden Pattern Detection

Validators check the **markup text** (not inside any `${...}` expression). The following patterns at the start of a line trigger errors:

```
/^\s*import\s/           -> TmvcValidationError kind: 'import-statement'
/^\s*export\s/           -> TmvcValidationError kind: 'export-statement'
/^\s*(abstract\s+)?class\s/ -> TmvcValidationError kind: 'class-definition'
```

The line number included in the error is the 1-based line number in the `.tmvc` source where the pattern matched.

---

## 10. Worked Example: Users List

A users list view that maps over a collection and surfaces an action error.

### 10.1 .tmvc Source

**views/users/index.tmvc:**
```ts
<h1>Users</h1>

<ul>
  ${context.data.users.map(user => html`
    <li>
      <a href="/users/${user.id}">${user.name}</a>
    </li>
  `)}
</ul>

${context.errors.action
  ? html`<p class="error">${context.errors.action.message}</p>`
  : ''
}
```

### 10.2 Generated TypeScript Module (Vite Plugin Output)

```ts
import { html } from '@typemvc/core';
import type { ViewContext } from '@typemvc/core';
import type { Fragment } from '@typemvc/core';

export default function render(context: ViewContext): Fragment {
  return html`<h1>Users</h1>

<ul>
  ${context.data.users.map(user => html`
    <li>
      <a href="/users/${user.id}">${user.name}</a>
    </li>
  `)}
</ul>

${context.errors.action
  ? html`<p class="error">${context.errors.action.message}</p>`
  : ''
}`;
}
```

### 10.3 Runtime Parser Form

```ts
const render = parseTmvc(`<h1>Users</h1>

<ul>
  \${context.data.users.map(user => html\`
    <li>
      <a href="/users/\${user.id}">\${user.name}</a>
    </li>
  \`)}
</ul>
...`);
// render is a TmvcViewFunction: (context: ViewContext) => Fragment
```

### 10.4 Behaviour Equivalence

Both the Vite plugin output and the runtime parser form produce a `TmvcViewFunction` with identical runtime behaviour: calling `render(context)` returns a `Fragment` whose nodes are the live DOM produced by `html\`...\``. Signals accessed in the expressions are wired reactively to their DOM positions exactly as they would be in a Phase 1 inline template function.

---

## 11. TypeScript Types

The following types are exported from `@typemvc/core` and used by both the Vite plugin and the runtime parser.

### 11.1 TmvcViewFunction

```ts
type TmvcViewFunction = (context: ViewContext) => Fragment;
```

The function signature that every compiled or parsed `.tmvc` file produces. The default export of a generated module satisfies this type. The value returned by the runtime parser also satisfies this type.

### 11.2 TmvcValidationError

```ts
type TmvcValidationError =
  | { readonly kind: 'import-statement'; readonly line: number; readonly source: string }
  | { readonly kind: 'export-statement'; readonly line: number; readonly source: string }
  | { readonly kind: 'class-definition'; readonly line: number; readonly source: string };
```

Discriminated union representing the three forbidden constructs. `line` is the 1-based line number in the `.tmvc` source. `source` is the text of the offending line (not sanitised; do not include this in user-facing logs if the `.tmvc` file might contain sensitive content).

---

## 12. Implementation Checklist for Issue 022 (Vite Plugin)

The Vite plugin must:

1. Register a `transform` hook that matches files with `.tmvc` extension.
2. Call the validator on the raw source. If `TmvcValidationError[]` is non-empty, surface each error as a Vite build error with the file path and line number.
3. Wrap the raw source in the generated module shape (Section 6).
4. Emit a source map that maps each line of the generated TypeScript to the corresponding line in the `.tmvc` source.
5. Implement an HMR `handleHotUpdate` hook that triggers re-evaluation of the view on `.tmvc` file change.

---

## 13. Implementation Checklist for Issue 023 (Runtime Parser)

The runtime parser must:

1. Accept a `.tmvc` source string.
2. Call the validator. Throw the first `TmvcValidationError` as a `[TypeMVC]`-prefixed `Error` if any are found.
3. Escape bare backtick characters in markup text (outside `${...}` expressions).
4. Construct and evaluate the function body using `new Function('context', 'html', body)`.
5. Return a `TmvcViewFunction` that closes over the `html` import.
6. Detect CSP-blocked `new Function` by catching `EvalError` and rethrowing with a descriptive message that includes the CSP requirement.
