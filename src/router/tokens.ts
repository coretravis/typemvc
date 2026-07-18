/**
 * DI token for the {@link IRouter}. Registered by `bootstrap()`, so a service or
 * a route guard can take the router as an ordinary dependency with
 * `@inject(ROUTER)` and navigate imperatively from code that is not returning a
 * view. A controller reaches the same router through `this.router`.
 */
export const ROUTER: unique symbol = Symbol('TypeMVC.IRouter');
