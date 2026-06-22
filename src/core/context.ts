import type { Fragment } from '../renderer/fragment.js';
import type { ContextData } from './context-data.js';
import type { ActionErrorTarget, ComponentFunction, ContextErrors, IRouter, ViewContext } from '../types/index.js';
import { RESERVED_KEYS } from './decorators.js';

export type PartialRenderer = (name: string, data?: Readonly<Record<string, unknown>>) => Fragment;

/**
 * Assembles the view context object passed to every view render call.
 *
 * `model` is the typed view model from IView<T>, exposed as context.model.
 * `viewBag` is the controller's this.data ViewBag, exposed as context.data.
 *
 * Callers are responsible for building `nonRouteMethods` via
 * `buildNonRouteMethodContext` (issue 009) before calling this function.
 * Reserved-key collisions on method names are enforced at @controller
 * decoration time, not here. A secondary guard in this function skips
 * any method whose name collides with a reserved key, so the framework
 * reserved properties can never be overwritten at assembly time.
 */
export function assembleContext(
  model: Record<string, unknown> | null,
  viewBag: ContextData | null,
  errorsTarget: ActionErrorTarget,
  router: IRouter,
  params: Readonly<Record<string, string>>,
  query: URLSearchParams,
  nonRouteMethods: Readonly<Record<string, (...args: unknown[]) => void>>,
  fieldErrors?: ReadonlyMap<string, string>,
  renderPartial?: PartialRenderer,
  componentMap?: Readonly<Record<string, ComponentFunction>>,
): ViewContext {
  const ctx = Object.create(null) as Record<string, unknown>;

  ctx.model = Object.freeze(model ?? (Object.create(null) as Record<string, unknown>));
  ctx.data = Object.freeze(viewBag !== null ? viewBag.getAll() : (Object.create(null) as Record<string, unknown>));
  ctx.errors = buildContextErrors(errorsTarget, fieldErrors);
  ctx.router = router;
  ctx.params = params;
  ctx.query = query;
  ctx.partial = renderPartial ?? ((): never => {
    throw new Error(
      '[TypeMVC] context.partial() called but no partials were configured. ' +
        'Pass a partials eager glob to bootstrap() via the "partials" option.',
    );
  });

  for (const name of Object.keys(nonRouteMethods)) {
    if (RESERVED_KEYS.has(name)) continue;
    const fn = nonRouteMethods[name];
    if (fn !== undefined) {
      ctx[name] = fn;
    }
  }

  if (componentMap !== undefined) {
    for (const [name, fn] of Object.entries(componentMap)) {
      if (RESERVED_KEYS.has(name)) continue;
      if (ctx[name] !== undefined) continue;
      ctx[name] = fn;
    }
  }

  return ctx as ViewContext;
}

function buildContextErrors(
  errorsTarget: ActionErrorTarget,
  fieldErrors?: ReadonlyMap<string, string>,
): ContextErrors {
  const base = Object.create(null) as Record<string, string | Error | null>;

  Object.defineProperty(base, 'action', {
    get: (): Error | null => errorsTarget.action,
    enumerable: true,
    configurable: false,
  });

  if (fieldErrors !== undefined) {
    for (const [field, message] of fieldErrors) {
      base[field] = message;
    }
  }

  return base as unknown as ContextErrors;
}
