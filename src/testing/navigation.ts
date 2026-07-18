/**
 * Synthetic Navigation API recorder for route-simulation tests (issue 052).
 *
 * The router emits redirects by calling the global `navigation.navigate(...)`.
 * In a test there is no real Navigation API, so this installs a stub that
 * records navigate calls (the redirect target and whether it replaced history)
 * and restores the previous global afterward. The recorder does not follow the
 * redirect; the test asserts the captured target.
 */

/** A recorded `navigation.navigate(...)` call. */
export interface RecordedNavigation {
  readonly path: string;
  readonly replace: boolean;
}

/** Handle for inspecting recorded navigations and restoring the global. */
export interface NavigationRecorder {
  readonly calls: readonly RecordedNavigation[];
  restore(): void;
}

/** Installs a recording `navigation` global; call `restore()` when done. */
export function installNavigationRecorder(): NavigationRecorder {
  const calls: RecordedNavigation[] = [];
  const globalRef = globalThis as Record<string, unknown>;
  const had = 'navigation' in globalRef;
  const previous = globalRef.navigation;

  globalRef.navigation = {
    navigate: (path: string, opts?: { history?: string }): void => {
      calls.push({ path, replace: opts?.history === 'replace' });
    },
    back: () => undefined,
    forward: () => undefined,
    addEventListener: () => undefined,
  };

  return {
    calls,
    restore(): void {
      if (had) {
        globalRef.navigation = previous;
      } else {
        delete globalRef.navigation;
      }
    },
  };
}
