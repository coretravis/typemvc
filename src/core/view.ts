import type { IView } from '../types/index.js';

/**
 * Returns a convention view: renders the `.tmvc` file matching the controller
 * and action name, with no model.
 */
export function View(): IView;
/**
 * Returns a convention view with a typed model. The model is exposed to the
 * template as `context.model`.
 *
 * @param model - The view model object.
 */
export function View<T extends object>(model: T): IView<T>;
/**
 * Returns a view at an explicit path, optionally with a typed model. Use this
 * for shared views whose path does not match the action name.
 *
 * @param path - The view path (relative to the views root, without extension).
 * @param model - Optional view model exposed as `context.model`.
 * @example
 * ```ts
 * @get() index(): IView<Stats> { return View({ total, done }); }   // convention view + model
 * @get('{id}') detail(id: string): IView<Todo> {
 *   return View('todo/detail', todo);                              // explicit path + model
 * }
 * ```
 */
export function View<T extends object>(path: string, model?: T): IView<T>;
export function View(
  pathOrModel?: string | object,
  model?: object,
): IView {
  if (pathOrModel === undefined) {
    return { kind: 'view', path: null, model: null };
  }
  if (typeof pathOrModel === 'string') {
    return { kind: 'view', path: pathOrModel, model: (model ?? null) as Record<string, unknown> | null };
  }
  return { kind: 'view', path: null, model: pathOrModel as Record<string, unknown> };
}

/**
 * Returns a partial view result: renders a partial template at `path` with an
 * optional model, without applying the controller's layout chain.
 *
 * @param path - The partial template path.
 * @param model - Optional model exposed as `context.model`.
 */
export function PartialView<T extends object>(path: string, model?: T): IView<T> {
  return { kind: 'partial', path, model: model ?? null };
}

/**
 * Returns a redirect result that pushes a new history entry and navigates to
 * `path`. Return this from an action instead of rendering a view.
 *
 * @param path - The destination path.
 */
export function Redirect(path: string): { readonly kind: 'redirect'; readonly path: string; readonly replace: false } {
  return { kind: 'redirect', path, replace: false };
}

/**
 * Returns a redirect result that replaces the current history entry (no back
 * entry is created) and navigates to `path`.
 *
 * @param path - The destination path.
 */
export function RedirectReplace(path: string): { readonly kind: 'redirect-replace'; readonly path: string; readonly replace: true } {
  return { kind: 'redirect-replace', path, replace: true };
}

/**
 * Returns an empty result: the action renders nothing and leaves the current
 * view in place. Useful for actions that only perform a side effect.
 */
export function EmptyView(): { readonly kind: 'empty' } {
  return { kind: 'empty' };
}
