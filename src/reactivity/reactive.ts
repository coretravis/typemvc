import { signal } from './signal.js';
import type { Signal } from '../types/index.js';

const proxyCache = new WeakMap<object, object>();

const ARRAY_MUTATION_METHODS = new Set<string>([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

function maybeReactive(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    return reactive(value);
  }
  return value;
}

function makeArrayProxy(arr: unknown[]): unknown[] {
  const counter = signal(0);

  const proxy = new Proxy(arr, {
    get(target: unknown[], key: string | symbol): unknown {
      counter.get();
      const value: unknown = Reflect.get(target, key) as unknown;
      if (
        typeof key === 'string' &&
        ARRAY_MUTATION_METHODS.has(key) &&
        typeof value === 'function'
      ) {
        const fn = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]): unknown => {
          const result: unknown = fn.apply(target, args);
          counter.update((n) => n + 1);
          return result;
        };
      }
      return value;
    },
    set(target: unknown[], key: string | symbol, value: unknown): boolean {
      const ok = Reflect.set(target, key, value);
      counter.update((n) => n + 1);
      return ok;
    },
  });

  proxyCache.set(arr, proxy);
  proxyCache.set(proxy, proxy);
  return proxy;
}

function makePlainObjectProxy<T extends object>(obj: T): T {
  const signals = new Map<string | symbol, Signal<unknown>>();

  for (const key of Object.keys(obj)) {
    const rawValue: unknown = (obj as Record<string, unknown>)[key];
    signals.set(key, signal(maybeReactive(rawValue)));
  }

  const proxy = new Proxy(obj, {
    get(_target: T, key: string | symbol): unknown {
      const sig = signals.get(key);
      if (sig !== undefined) {
        return sig.get();
      }
      return Reflect.get(_target, key);
    },
    set(_target: T, key: string | symbol, value: unknown): boolean {
      const reactiveValue = maybeReactive(value);
      const sig = signals.get(key);
      if (sig !== undefined) {
        sig.set(reactiveValue);
      } else {
        signals.set(key, signal(reactiveValue));
      }
      return Reflect.set(_target, key, value);
    },
  });

  proxyCache.set(obj, proxy);
  proxyCache.set(proxy, proxy);
  return proxy;
}

/**
 * Wraps an object in a deep reactive proxy: reading a property tracks it as a
 * dependency and assigning a property notifies dependents, so effects and
 * computed values update automatically. Use when a signal-per-field would be
 * verbose; for a single value prefer {@link signal}.
 *
 * @param obj - The object to make reactive.
 * @returns A reactive proxy over `obj` (same reference is reused if re-wrapped).
 */
export function reactive<T extends object>(obj: T): T {
  const cached = proxyCache.get(obj);
  if (cached !== undefined) {
    return cached as T;
  }

  if (Array.isArray(obj)) {
    return makeArrayProxy(obj as unknown[]) as unknown as T;
  }

  return makePlainObjectProxy(obj);
}
