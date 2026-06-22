import { Controller } from './controller.js';
import { getAllActionMeta } from './decorators.js';
import type { ActionErrorTarget, ErrorHandler } from '../types/index.js';

type AnyConstructor = new (...args: unknown[]) => unknown;

// Names defined on Controller.prototype that must never be exposed as non-route methods.
// Computed once at module load; stable across all calls.
const CONTROLLER_BASE_METHOD_NAMES = new Set<string>(
  Object.getOwnPropertyNames(Controller.prototype),
);

// Internal interface for accessing the protected onActionError method.
interface ControllerWithActionError {
  onActionError(error: Error, methodName: string): void;
}

/**
 * Returns the names of non-route methods on the given controller class.
 * A non-route method is a public function on the immediate prototype that:
 * - is not the constructor
 * - is not a Controller base class method (hasErrors, addError, onActionError)
 * - does not carry a verb decorator (GET, POST, PUT, PATCH, DELETE)
 *
 * Reserved key collisions are enforced at @controller decoration time, not here.
 */
export function getNonRouteMethods(cls: AnyConstructor): readonly string[] {
  const proto = cls.prototype as object;
  const routeMethods = getAllActionMeta(proto);
  const result: string[] = [];

  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    if (CONTROLLER_BASE_METHOD_NAMES.has(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (typeof descriptor?.value !== 'function') continue;
    if (routeMethods.has(name)) continue;
    result.push(name);
  }

  return result;
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
): Record<string, (...args: unknown[]) => void> {
  const methodNames = getNonRouteMethods(cls);
  const result = Object.create(null) as Record<string, (...args: unknown[]) => void>;

  for (const name of methodNames) {
    const rawMethod: unknown = (cls.prototype as Record<string, unknown>)[name];
    if (typeof rawMethod !== 'function') continue;
    const bound = (rawMethod as (...args: unknown[]) => unknown).bind(instance);

    result[name] = (...args: unknown[]): void => {
      errorsTarget.action = null;
      const returnValue: unknown = bound(...args);
      if (returnValue instanceof Promise) {
        void returnValue.catch((err: unknown) => {
          const error =
            err instanceof Error
              ? err
              : new Error('[TypeMVC] Non-route method rejected with a non-Error value');
          handleNonRouteError(error, name, instance, errorsTarget, appErrorHandler);
        });
      }
    };
  }

  return result;
}

function handleNonRouteError(
  error: Error,
  methodName: string,
  instance: Controller,
  errorsTarget: ActionErrorTarget,
  appErrorHandler: ErrorHandler | undefined,
): void {
  // Layer 1: controller override (call only if subclass defines onActionError)
  let shouldCallLayer2 = true;
  if (isOnActionErrorOverridden(instance)) {
    try {
      (instance as unknown as ControllerWithActionError).onActionError(error, methodName);
      shouldCallLayer2 = false;
    } catch {
      // override re-threw: fall through to layer 2
    }
  }

  // Layer 2: application-level error handler
  if (shouldCallLayer2 && appErrorHandler !== undefined) {
    appErrorHandler(error, methodName);
  }

  // Layer 3: always update errors.action
  errorsTarget.action = error;
}

function isOnActionErrorOverridden(instance: Controller): boolean {
  let proto: object | null = Object.getPrototypeOf(instance) as object | null;
  while (proto !== null && proto !== Controller.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, 'onActionError')) {
      return true;
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
}
