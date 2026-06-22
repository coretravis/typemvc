const injectionMeta = new WeakMap<object, (symbol | undefined)[]>();

/**
 * Marks a constructor parameter for dependency injection, resolving it from the
 * DI container by token at construction time. The token must be registered via
 * `app.singleton` / `app.scoped` / `app.transient` in the bootstrap configure
 * callback.
 *
 * @param token - The DI token (a `Symbol`) identifying the dependency.
 * @example
 * ```ts
 * @controller('/todos')
 * class TodoController extends Controller {
 *   constructor(@inject(TODO_SERVICE) private svc: TodoService) { super(); }
 * }
 * ```
 */
export function inject(token: symbol): ParameterDecorator {
  return function (target: object, _key: string | symbol | undefined, index: number): void {
    let tokens = injectionMeta.get(target);
    if (tokens === undefined) {
      tokens = [];
      injectionMeta.set(target, tokens);
    }
    tokens[index] = token;
  };
}

export function getInjectTokens(
  cls: new (...args: unknown[]) => unknown,
): (symbol | undefined)[] {
  return injectionMeta.get(cls) ?? [];
}
