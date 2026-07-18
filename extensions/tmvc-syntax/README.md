# TypeMVC for VS Code

Syntax highlighting and language intelligence for **TypeMVC** `.tmvc` view files.

This extension makes `.tmvc` views first-class in your editor, with a bundled
[Volar](https://volarjs.dev/) language server that understands the framework.

## Features

- **Syntax highlighting** for `.tmvc` markup, including embedded TypeScript in
  `${...}` expressions and attribute expressions.
- **Typed `context.model`**: inferred from the controller action that owns the
  view, so model properties are checked and autocompleted.
- **Completions and go-to-definition** across views and controllers.
- **Inline diagnostics** for type errors in your view expressions.

## Requirements

Your project should use [`@typemvc/core`](https://www.npmjs.com/package/@typemvc/core).
The extension's language intelligence resolves framework types from your
installed `@typemvc/core` package, and maps each `.tmvc` view to its owning
controller by convention (`views/<segment>/<action>.tmvc` →
`<Segment>Controller.<action>`).

## Usage

Open any `.tmvc` file. The language server starts automatically. To see its
logs, open the Output panel and select the **TypeMVC Language Server** channel.

## Learn more

- Framework: <https://github.com/coretravis/typemvc>
- `.tmvc` file format: see the project documentation.

## License

[MIT](./LICENSE)
