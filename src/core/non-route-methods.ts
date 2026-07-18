import { Controller, _invokeOnActionError } from './controller.js';
import { getAllActionMeta, isActionMethod } from './decorators.js';
import type { ActionErrorTarget, ErrorHandler } from '../types/index.js';

type AnyConstructor = new (...args: unknown[]) => unknown;

/** True when a value is a thenable, so it is awaited like a promise. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Narrows a caught or rejected value to an Error without accessing its properties first. */
function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Returns the names of the controller methods exposed to the view as
 * `context.<name>`. A method is exposed only when it carries the `@action`
 * decorator, so the view surface is opt-in and inspectable rather than every
 * prototype method (including a TypeScript-private one) leaking into it. The
 * prototype chain is walked so an inherited `@action` method is exposed, matching
 * inherited DI; a route method (a verb decorator) is never a non-route method, and
 * a subclass override is collected once.
 */
export function getNonRouteMethods(cls: AnyConstructor): readonly string[] {
  const result = new Set<string>();
  let proto: object | null = cls.prototype as object;

  while (proto !== null && proto !== Controller.prototype && proto !== Object.prototype) {
    const routeMethods = getAllActionMeta(proto);
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      if (result.has(name)) continue;
      if (!isActionMethod(proto, name)) continue;
      if (routeMethods.has(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof descriptor?.value !== 'function') continue;
      result.add(name);
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }

  return [...result];
}

/**
 * Builds the non-route method entries to be spread into the view context.
 * Each entry is the method name mapped to a wrapper function that:
 * - clears errorsTarget.action to null before invocation
 * - binds the method to the controller instance
 * - intercepts async rejections and routes them through the three-layer chain
 *
 * Layer 1: controller onActionError override (if overridden and does not re-throw)
 * Layer 2: application-level error handler (if layer 1 skipped or re-threw)
 * Layer 3: always sets errorsTarget.action to the error
 */
export function buildNonRouteMethodContext(
  cls: AnyConstructor,
  instance: Controller,
  errorsTarget: ActionErrorTarget,
  appErrorHandler: ErrorHandler | undefined,
  route: string | null = null,
): Record<string, (...args: unknown[]) => void> {
  const methodNames = getNonRouteMethods(cls);
  const result = Object.create(null) as Record<string, (...args: unknown[]) => void>;
  const controllerName = cls.name;

  for (const name of methodNames) {
    const rawMethod: unknown = (cls.prototype as Record<string, unknown>)[name];
    if (typeof rawMethod !== 'function') continue;
    const bound = (rawMethod as (...args: unknown[]) => unknown).bind(instance);

    result[name] = (...args: unknown[]): void => {
      errorsTarget.action = null;
      try {
        const returnValue: unknown = bound(...args);
        // Any thenable is handled, not only a Promise, so a bare thenable rejection
        // goes through the same chain as a Promise rejection.
        if (isThenable(returnValue)) {
          void Promise.resolve(returnValue).catch((err: unknown) => {
            handleNonRouteError(
              toError(err),
              name,
              controllerName,
              route,
              instance,
              errorsTarget,
              appErrorHandler,
            );
          });
        }
      } catch (err) {
        // A synchronous throw is caught here rather than escaping to the DOM event
        // handler, so it takes the same three-layer chain as an async rejection.
        handleNonRouteError(
          toError(err),
          name,
          controllerName,
          route,
          instance,
          errorsTarget,
          appErrorHandler,
        );
      }
    };
  }

  return result;
}

function handleNonRouteError(
  error: Error,
  methodName: string,
  controllerName: string,
  route: string | null,
  instance: Controller,
  errorsTarget: ActionErrorTarget,
  appErrorHandler: ErrorHandler | undefined,
): void {
  // Layer 1: controller override (call only if subclass defines onActionError)
  const handled = _invokeOnActionError(instance, error, methodName);

  // Layer 2: application-level error handler, given the same structured event a
  // route action failure carries so observability sees one shape for both.
  if (!handled && appErrorHandler !== undefined) {
    appErrorHandler(error, methodName, {
      error,
      controller: controllerName,
      action: methodName,
      route,
      phase: 'action',
    });
  }

  // Layer 3: always update errors.action
  errorsTarget.action = error;
}
