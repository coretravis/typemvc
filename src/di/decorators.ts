const injectionMeta = new WeakMap<object, (symbol | undefined)[]>();

/** The parts of a constructor the injector reads: its name and its declared arity. */
export interface ConstructorMeta {
  readonly name: string;
  readonly length: number;
}

/**
 * Marks a constructor parameter for dependency injection, resolving it from the
 * DI container by token at construction time. The token must be registered via
 * `app.singleton` / `app.scoped` / `app.transient` in the bootstrap configure
 * callback.
 *
 * Injection metadata is inherited. A subclass that declares no constructor of
 * its own uses its base class's parameter list, so it also uses the base's
 * tokens, however many levels up they were declared:
 *
 * ```ts
 * class ShellController extends Controller {
 *   constructor(@inject(NAV_SERVICE) protected nav: NavService) { super(); }
 * }
 *
 * @controller('/admin')
 * class AdminController extends ShellController {} // nav is injected
 * ```
 *
 * A subclass that declares its own constructor has its own parameter list, which
 * may differ in arity and order, so it must decorate its own parameters. The
 * base's tokens are not consulted for it, even when it only forwards to `super`.
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

/**
 * Returns the injection tokens for a constructor, walking up the prototype chain
 * until a class that declares its own parameter list is reached.
 *
 * A class whose own constructor is the default derived one (`class B extends A {}`)
 * has an arity of zero and no tokens of its own, so the search continues into its
 * base. A class that declares constructor parameters answers for itself: its own
 * tokens win, and if it has none the result is empty, because a redeclared
 * parameter list carries no relation to the base's.
 */
export function getInjectTokens(cls: ConstructorMeta): (symbol | undefined)[] {
  let current: object | null = cls;
  while (current !== null && current !== Function.prototype) {
    const own = injectionMeta.get(current);
    if (own !== undefined) return own;
    if ((current as ConstructorMeta).length > 0) return [];
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [];
}
