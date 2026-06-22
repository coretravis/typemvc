import type { ILogger, ILoggerFactory } from '../logging/types.js';

type Factory = (container: Container) => unknown;

type Registration =
  | { readonly kind: 'singleton'; readonly factory: Factory }
  | { readonly kind: 'scoped'; readonly factory: Factory }
  | { readonly kind: 'transient'; readonly factory: Factory };

export class Container {
  readonly #parent: Container | null;
  readonly #registrations = new Map<symbol, Registration>();
  readonly #singletonInstances = new Map<symbol, unknown>();
  readonly #scopedInstances = new Map<symbol, unknown>();
  readonly #resolutionStack = new Set<symbol>();
  readonly #log: ILogger | undefined;

  constructor(parent: Container | null = null, loggerFactory?: ILoggerFactory) {
    this.#parent = parent;
    if (loggerFactory !== undefined) {
      this.#log = loggerFactory.create('TypeMVC.Container');
    } else if (parent !== null) {
      this.#log = parent.#log;
    } else {
      this.#log = undefined;
    }
  }

  singleton(token: symbol, factory: (c: Container) => unknown): void {
    this.#registrations.set(token, { kind: 'singleton', factory });
  }

  scoped(token: symbol, factory: (c: Container) => unknown): void {
    this.#registrations.set(token, { kind: 'scoped', factory });
  }

  transient(token: symbol, factory: (c: Container) => unknown): void {
    this.#registrations.set(token, { kind: 'transient', factory });
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the caller's expected type for the resolved value
  resolve<T>(token: symbol): T {
    return this.#getRoot().#resolveAt<T>(token, this);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the caller's expected type; undefined is the not-registered sentinel
  resolveOptional<T>(token: symbol): T | undefined {
    const reg = this.#findRegistration(token);
    if (reg === undefined) return undefined;
    return this.resolve<T>(token);
  }

  createScope(): Container {
    return new Container(this);
  }

  #getRoot(): Container {
    if (this.#parent === null) return this;
    return this.#parent.#getRoot();
  }

  #findRegistration(token: symbol): Registration | undefined {
    const local = this.#registrations.get(token);
    if (local !== undefined) return local;
    const parent = this.#parent;
    if (parent !== null) return parent.#findRegistration(token);
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is the caller's expected type for the resolved value
  #resolveAt<T>(token: symbol, scope: Container): T {
    if (this.#resolutionStack.has(token)) {
      const cycle = [...this.#resolutionStack, token]
        .map((t) => String(t.description))
        .join(' -> ');
      throw new Error(`[TypeMVC] Circular dependency detected: ${cycle}`);
    }

    const reg = scope.#findRegistration(token);
    if (reg === undefined) {
      const tokenDesc = String(token.description);
      const detail = `DI token "${tokenDesc}" is not registered. Register it via singleton(), scoped(), or transient() before calling resolve().`;
      this.#log?.error(detail);
      throw new Error(`[TypeMVC] ${detail}`);
    }

    this.#resolutionStack.add(token);
    try {
      if (__DEV__) {
        this.#log?.debug('Token resolved', {
          token: String(token.description),
          kind: reg.kind,
        });
      }
      if (reg.kind === 'singleton') {
        const cached = this.#singletonInstances.get(token);
        if (cached !== undefined) return cached as T;
        const instance = reg.factory(this);
        this.#singletonInstances.set(token, instance);
        return instance as T;
      } else if (reg.kind === 'scoped') {
        const cached = scope.#scopedInstances.get(token);
        if (cached !== undefined) return cached as T;
        const instance = reg.factory(scope);
        scope.#scopedInstances.set(token, instance);
        return instance as T;
      } else {
        return reg.factory(scope) as T;
      }
    } finally {
      this.#resolutionStack.delete(token);
    }
  }
}
