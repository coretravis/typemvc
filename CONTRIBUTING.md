# Contributing to TypeMVC

Thanks for your interest in improving TypeMVC! This document covers how to get
set up and what we expect in a contribution.

## Prerequisites

- Node.js >= 20
- pnpm >= 8 (`corepack enable` will provide the pinned version)

## Getting started

```bash
git clone https://github.com/coretravis/typemvc
cd typemvc
pnpm install
```

The framework lives at the repo root; the VS Code extension is under
`extensions/tmvc-syntax/`.

## Development workflow

```bash
pnpm dev            # rebuild the framework on save
pnpm test           # vitest watch mode
pnpm test:run       # single test run
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm format         # prettier --write
```

Before opening a pull request, run the full pipeline locally:

```bash
pnpm run ci         # lint + typecheck + test + build
```

CI runs this same pipeline on every pull request; PRs must be green to merge.

## Pull request guidelines

- Keep changes focused; one logical change per PR.
- Add or update tests for any behavior change.
- Update `CHANGELOG.md` under the `[Unreleased]` heading.
- Match the style of the surrounding code; Prettier and ESLint are the source of
  truth for formatting and lint rules.
- Note: Prettier reformats `--` to `,` inside `eslint-disable` comments. Always
  use the `--` separator form so CI lint stays green.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) (e.g.
`feat(controller): ...`, `fix(router): ...`, `docs: ...`).

## Releases

Releases are tag-driven and automated. Pushing a version tag builds and
publishes the package; maintainers handle this.

## Reporting bugs

Open an issue using the bug report template. For security issues, follow
[SECURITY.md](./SECURITY.md) instead of filing a public issue.
