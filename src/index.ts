// Bootstrap
export { bootstrap, useAuth, useLocalization } from './core/bootstrap.js';

// Framework-internal: used by the generated preamble in compiled .tmvc modules
export { _callComponent } from './core/component-registry.js';

// Controller base class and decorator set (§3.3)
export { Controller } from './core/controller.js';
export {
  controller,
  retain,
  get,
  post,
  put,
  patch,
  del,
  action,
  body,
  guard,
  layout,
} from './core/decorators.js';

// View result factories
export { View, PartialView, Redirect, RedirectReplace, EmptyView } from './core/view.js';
export { ContextData } from './core/context-data.js';

// Reactivity
export { signal, effect, computed, batch, onCleanup } from './reactivity/signal.js';
export { reactive } from './reactivity/reactive.js';

// Template renderer
export { html } from './renderer/html.js';
export { Fragment } from './renderer/fragment.js';
export { safeHtml, SafeHtml } from './renderer/safe-html.js';
export { prevent, stop } from './renderer/modifiers.js';
export { keyed } from './renderer/keyed.js';
export type { KeyedFragment } from './renderer/keyed.js';

// Dependency injection
export { inject } from './di/decorators.js';

// Layout
export { defineLayout } from './layout/layout.js';

// Validation
export { Validator, ValidationResult } from './validation/validator.js';
export { bindFormData } from './validation/binder.js';
export type { DtoBindingResult } from './validation/binder.js';
export {
  dataType,
  required,
  stringLength,
  minLength,
  maxLength,
  min,
  max,
  integer,
  positive,
  negative,
  email,
  url,
  pattern,
  validate,
} from './validation/decorators.js';

// Logging
export { LOGGER_FACTORY } from './logging/index.js';
export type { ILogger, ILoggerFactory, LogLevel, LogEntry, LogProvider } from './logging/index.js';

// Public types (§3.3 required subset + framework-facing types users must be able to annotate)
export type {
  IView,
  IRouteGuard,
  IRouter,
  Signal,
  ReadonlySignal,
  AppConfig,
  AppBuilder,
  IPlugin,
  ViewContext,
  TypedViewContext,
  ContextErrors,
  LayoutContext,
  TmvcViewFunction,
  TmvcValidationError,
  ViewGlob,
  PartialGlob,
  LayoutGlob,
  Prop,
  ComponentGlob,
  ComponentFunction,
  DisposeReason,
  ResolvedRoute,
  ErrorHandler,
} from './types/index.js';
