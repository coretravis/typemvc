# Changelog: TypeMVC VS Code extension

This file tracks changes since the last release. The first published release will
move the entries below under a dated version heading.

## [Unreleased]

### Added

- Syntax highlighting for `.tmvc` view files, including embedded TypeScript in
  `${...}` expressions and attribute expressions.
- Language intelligence powered by a bundled Volar language server:
  - typed `context.model` inferred from the owning controller action,
  - completions and go-to-definition,
  - inline diagnostics.
