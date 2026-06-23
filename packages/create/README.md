# @typemvc/create

Project initializer for [TypeMVC](https://github.com/coretravis/typemvc). Scaffolds a minimal, ready-to-run app.

## Usage

```bash
npm create @typemvc@latest my-app
# or: pnpm create @typemvc my-app
# or: yarn create @typemvc my-app
```

Then:

```bash
cd my-app
npm install
npm run dev
```

## Options

| Flag | Description |
| --- | --- |
| `--name <name>` | Project name (default: target directory name) |
| `--force`, `-f` | Scaffold into a non-empty directory |
| `--no-git` | Do not run `git init` |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show the version |

## What you get

A Vite SPA wired for TypeMVC: a typed `tsconfig.json`, the `@typemvc/core/vite` plugin, a bootstrap entry, a Home controller with a reactive counter, a 404 catch-all controller, and matching `.tmvc` views. The generated app installs, typechecks, and builds against the published `@typemvc/core`.

This package has zero runtime dependencies and is non-interactive (flags only), so it works in CI and scripts.

## License

MIT (c) coretravis
