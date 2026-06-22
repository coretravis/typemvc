# Changelog

All notable changes to `@typemvc/core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is `0.x`, minor releases may contain breaking changes.

This file tracks changes since the last release. The first published release will
move the entries below under a dated version heading.

## [Unreleased]

### Added

- Controller layer: `Controller` base class with `@controller`, `@get`, `@post`,
  `@put`, `@patch`, `@del`, `@action`, `@body`, `@guard`, `@layout`, and `@retain`.
- View results: `View`, `PartialView`, `Redirect`, `RedirectReplace`, `EmptyView`.
- `.tmvc` view files with typed `context.model`, compiled by the Vite plugin
  (`@typemvc/core/vite`) and parsed at runtime via `@typemvc/core/parser`.
- Signals reactivity: `signal`, `computed`, `effect`, `batch`, `reactive`.
- Template renderer: `html`, `Fragment`, `safeHtml`, `keyed`, and event
  modifiers `prevent` and `stop`.
- Dependency injection via `inject`.
- Layouts via `defineLayout`.
- Validation: `Validator`, `bindFormData`, and the decorator set (`required`,
  `email`, `min`/`max`, `pattern`, custom error messages, and more).
- Logging abstraction (`LOGGER_FACTORY`, `ILogger`, `ILoggerFactory`).
- First-party testing helpers under `@typemvc/core/testing` and Vitest matchers
  under `@typemvc/core/testing/vitest`.
- Volar language plugin (`@typemvc/core/volar`) powering the TypeMVC VS Code
  extension's `.tmvc` language intelligence.
