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

/**
 * True when a value is one this module can make deeply reactive: a plain object
 * (an object literal or a null-prototype object) or an array.
 */
function isReactivable(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function maybeReactive(value: unknown): unknown {
  return isReactivable(value) ? reactive(value) : value;
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
      // An element object is itself made reactive, so reading state[0].name tracks
      // that nested property. A function (an array method) is left as-is.
      return maybeReactive(value);
    },
    set(target: unknown[], key: string | symbol, value: unknown): boolean {
      const ok = Reflect.set(target, key, value);
      counter.update((n) => n + 1);
      return ok;
    },
    deleteProperty(target: unknown[], key: string | symbol): boolean {
      const ok = Reflect.deleteProperty(target, key);
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
  // Tracks the set of own keys. Reading it in the has and ownKeys traps subscribes
  // a dependent to structure, so adding or deleting a key re-runs enumeration.
  const shape = signal(0);

  for (const key of Object.keys(obj)) {
    const rawValue: unknown = (obj as Record<string, unknown>)[key];
    signals.set(key, signal(maybeReactive(rawValue)));
  }

  // A per-key signal read tracks that property. One is created on first read even
  // when the key is absent, so a read of a not-yet-present property subscribes and a
  // later assignment notifies. Inherited members (Object.prototype methods) and
  // symbols are left to Reflect so their real behavior is preserved.
  const trackKey = (target: T, key: string | symbol): Signal<unknown> | undefined => {
    const existing = signals.get(key);
    if (existing !== undefined) return existing;
    if (typeof key !== 'string' || key in target) return undefined;
    const created = signal<unknown>(undefined);
    signals.set(key, created);
    return created;
  };

  const proxy = new Proxy(obj, {
    get(_target: T, key: string | symbol): unknown {
      const sig = trackKey(_target, key);
      if (sig !== undefined) {
        return sig.get();
      }
      return Reflect.get(_target, key);
    },
    has(_target: T, key: string | symbol): boolean {
      shape.get();
      return Reflect.has(_target, key);
    },
    ownKeys(_target: T): (string | symbol)[] {
      shape.get();
      return Reflect.ownKeys(_target);
    },
    set(_target: T, key: string | symbol, value: unknown): boolean {
      const isNewOwnKey =
        typeof key === 'string' && !Object.prototype.hasOwnProperty.call(_target, key);
      const reactiveValue = maybeReactive(value);
      const ok = Reflect.set(_target, key, value);
      // Reactive state changes only when the write lands, so a frozen or sealed
      // target that rejects the write exposes no ghost signal or shape change. The
      // notify runs after the write so a reader that re-runs sees the new value.
      if (!ok) return ok;
      const sig = signals.get(key);
      if (sig !== undefined) {
        sig.set(reactiveValue);
      } else if (typeof key === 'string') {
        signals.set(key, signal(reactiveValue));
      }
      if (isNewOwnKey) shape.update((n) => n + 1);
      return ok;
    },
    deleteProperty(_target: T, key: string | symbol): boolean {
      const hadOwnKey = Object.prototype.hasOwnProperty.call(_target, key);
      const ok = Reflect.deleteProperty(_target, key);
      if (!ok) return ok;
      // Notify readers of the deleted key by driving its signal to undefined; the
      // signal is kept so a later re-assignment reuses it.
      const sig = signals.get(key);
      if (sig !== undefined) {
        sig.set(undefined);
      }
      if (hadOwnKey) shape.update((n) => n + 1);
      return ok;
    },
  });

  proxyCache.set(obj, proxy);
  proxyCache.set(proxy, proxy);
  return proxy;
}

/**
 * Wraps an object in a deep reactive proxy: reading a property tracks it as a
 * dependency and assigning or deleting a property notifies dependents, so effects
 * and computed values update automatically. Use when a signal-per-field would be
 * verbose; for a single value prefer {@link signal}.
 *
 * Reactivity is deep through plain objects and arrays: a nested object, an object
 * inside an array, property assignment, and property deletion are all tracked. The
 * supported domain is plain objects (object literals and null-prototype objects)
 * and arrays.
 *
 * @param obj - The object to make reactive.
 * @returns A reactive proxy over a plain object or array; the same reference is
 *   reused if re-wrapped, and a non-plain object is returned unchanged.
 */
export function reactive<T extends object>(obj: T): T {
  const cached = proxyCache.get(obj);
  if (cached !== undefined) {
    return cached as T;
  }

  if (Array.isArray(obj)) {
    return makeArrayProxy(obj as unknown[]) as unknown as T;
  }

  // A non-plain object (Date, Map, Set, class instance) is returned unwrapped: a
  // property-signal proxy would break the methods that depend on its real receiver.
  const proto = Object.getPrototypeOf(obj) as object | null;
  if (proto !== Object.prototype && proto !== null) {
    return obj;
  }

  return makePlainObjectProxy(obj);
}
