import type { Signal } from '../types/index.js';
import { signal, onCleanup, _hasOwner } from '../reactivity/signal.js';

declare const __DEV__: boolean;

/**
 * Serialisation overrides for {@link persisted}. Both default to JSON. Pass a
 * matching pair: a value written by `serialize` must be readable by
 * `deserialize`.
 */
export interface PersistedOptions<T> {
  /** Turns a value into the string written to storage. Defaults to `JSON.stringify`. */
  readonly serialize?: (value: T) => string;
  /** Turns a stored string back into a value. Defaults to `JSON.parse`. */
  readonly deserialize?: (raw: string) => T;
}

/**
 * A writable {@link Signal} produced by {@link persisted}, extended with an
 * explicit `dispose`. A component's `@local` block ties the teardown to the
 * owner scope automatically; a service with no owner scope calls `dispose`
 * itself to remove the cross tab `storage` listener.
 */
export interface PersistedSignal<T> extends Signal<T> {
  /** Removes the cross tab `storage` listener. Idempotent. */
  readonly dispose: () => void;
}

/**
 * Reads `globalThis.localStorage`. Access alone can throw in a sandboxed or
 * blocked origin, so the read is guarded and a failure degrades to no storage.
 */
function getLocalStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage | null }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads `globalThis.window` for the cross tab `storage` event, which fires on
 * the window rather than on the storage object. Absent outside a browser.
 */
function getWindow(): (Window & typeof globalThis) | null {
  const w = (globalThis as { window?: Window & typeof globalThis }).window;
  return w ?? null;
}

/**
 * A signal whose value is seeded from `localStorage` and written back on every
 * change, so it survives a reload. It listens for the `storage` event, so a
 * change in another tab updates it, and removes that listener on dispose.
 *
 * A corrupt stored value, a failed write (a full quota), and storage being
 * unavailable at all (private browsing, a blocked origin) never throw into a
 * render: the signal falls back to `initial` or to an in memory value, and warns
 * in development. This is the failure handling a hand written storage service
 * usually misses.
 *
 * @param key - The `localStorage` key to read and write.
 * @param initial - The value used when nothing is stored, or the stored value
 *   cannot be read.
 * @param options - Optional {@link PersistedOptions} serialiser overrides.
 * @returns A {@link PersistedSignal}: a writable signal plus `dispose`.
 * @example
 * ```ts
 * const theme = persisted<'light' | 'dark'>('theme', 'light');
 * theme.set('dark'); // persisted to localStorage, mirrored to other tabs
 * ```
 */
export function persisted<T>(
  key: string,
  initial: T,
  options?: PersistedOptions<T>,
): PersistedSignal<T> {
  const serialize = options?.serialize ?? ((value: T): string => JSON.stringify(value));
  const deserialize = options?.deserialize ?? ((raw: string): T => JSON.parse(raw) as T);

  const storage = getLocalStorage();
  if (storage === null && __DEV__) {
    console.warn(
      `[TypeMVC] persisted() has no localStorage for key "${key}", so it is an in memory ` +
        `signal that does not survive a reload. This is expected in private browsing or a ` +
        `sandboxed context.`,
    );
  }

  let seed = initial;
  if (storage !== null) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        seed = deserialize(raw);
      } catch {
        if (__DEV__) {
          console.warn(
            `[TypeMVC] persisted() could not deserialize the stored value for key "${key}", ` +
              `so the initial value is used. If you pass a custom serialize, pass a matching ` +
              `deserialize.`,
          );
        }
        seed = initial;
      }
    }
  }

  const inner = signal<T>(seed);

  const write = (value: T): void => {
    if (storage === null) return;
    try {
      storage.setItem(key, serialize(value));
    } catch {
      if (__DEV__) {
        console.warn(
          `[TypeMVC] persisted() could not write key "${key}" to localStorage. The value is ` +
            `held in memory but was not persisted, which usually means the storage quota is full.`,
        );
      }
    }
  };

  const set = (value: T): void => {
    inner.set(value);
    write(value);
  };

  // A change from another tab updates the signal without writing back: the other
  // tab already wrote, and echoing it would be redundant. A cleared key resets to
  // the initial value.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== key) return;
    if (event.newValue === null) {
      inner.set(initial);
      return;
    }
    try {
      inner.set(deserialize(event.newValue));
    } catch {
      if (__DEV__) {
        console.warn(
          `[TypeMVC] persisted() ignored a storage event for key "${key}" whose value could ` +
            `not be deserialized.`,
        );
      }
    }
  };

  const win = storage === null ? null : getWindow();
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (win !== null) win.removeEventListener('storage', onStorage);
  };

  if (win !== null) win.addEventListener('storage', onStorage);
  // Tie teardown to the component owner scope when there is one. Outside it (the
  // ThemeService case), the caller holds the returned dispose instead.
  if (_hasOwner()) onCleanup(dispose);

  return {
    get: inner.get,
    set,
    update: (fn: (current: T) => T): void => {
      set(fn(inner.get()));
    },
    dispose,
  };
}
