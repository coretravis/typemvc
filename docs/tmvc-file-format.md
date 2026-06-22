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

Every `.tmvc` file has two implicitly available names that require no import:

| Name | Type | Source |
|---|---|---|
| `context` | `ViewContext` | The view context assembled by the framework |
| `html` | tagged template function | The `html` renderer |

`context` is the parameter name of the generated render function. It carries `context.data`, `context.errors`, `context.router`, `context.params`, `context.query`, and any non-route method names from the controller.

`html` is imported from `@typemvc/core` in the generated module and passed as a parameter in the runtime parser path. It is available inside `${...}` expressions for authoring nested fragments.

---

## 5. TypeScript Expression Embedding

Expressions are embedded with `${...}`:

```
<p>${context.data.message}</p>
```

Expressions may contain any valid TypeScript, including:

**Property access:**
```
<h1>${context.data.title}</h1>
```

**Method calls returning a Fragment:**
```
<ul>
  ${context.data.items.map(item => html`<li>${item.name}</li>`)}
</ul>
```

**Ternary for conditional rendering:**
```
${context.errors.name
  ? html`<span class="field-error">${context.errors.name}</span>`
  : ''
}
```

**Logical AND for optional rendering:**
```
${context.data.isAdmin && html`<button>Admin Panel</button>`}
```

No special template directives exist. There is no `*ngFor`, `v-for`, or `#each`. TypeScript is the template language.

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
```
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

---

## 8. Error Cases

### 8.1 Import Statement

**Detection:** A line beginning with `import ` (possibly preceded by whitespace) that appears in markup text (outside a `${...}` expression).

**Error kind:** `'import-statement'`

**Message format:**
```
[TypeMVC] .tmvc file line N: import declarations are not permitted. Use the implicit context and html bindings instead.
```

### 8.2 Export Statement

**Detection:** A line beginning with `export ` (possibly preceded by whitespace) that appears in markup text (outside a `${...}` expression).

**Error kind:** `'export-statement'`

**Message format:**
```
[TypeMVC] .tmvc file line N: export declarations are not permitted. The default export is generated by the framework.
```

### 8.3 Class Definition

**Detection:** A line containing `class ` (optionally preceded by `abstract `) that appears in markup text (outside a `${...}` expression).

**Error kind:** `'class-definition'`

**Message format:**
```
[TypeMVC] .tmvc file line N: class definitions are not permitted. Views are pure templates.
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
```
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
