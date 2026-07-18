import type { ComponentFunction } from '../types/index.js';
import { Fragment } from '../renderer/fragment.js';
import { _withOwner } from '../reactivity/signal.js';

declare const __DEV__: boolean;

type ComponentMap = Readonly<Record<string, ComponentFunction>>;

let _registry: ComponentMap = Object.create(null) as ComponentMap;

export function _setComponentRegistry(map: ComponentMap): void {
  _registry = map;
}

export function _getComponentRegistry(): ComponentMap {
  return _registry;
}

/**
 * Framework-internal: calls a component under a fresh owner scope and attaches
 * every effect dispose and onCleanup callback registered during the render to
 * the Fragment it returned, so disposing that Fragment tears the component down.
 *
 * This is the single owner-scope path: name based calls from compiled templates
 * and function based calls from the testing helpers both go through it, so a
 * component disposes identically in a test and in the browser.
 */
export function _invokeComponent(fn: ComponentFunction, props: object): Fragment {
  const { value: fragment, disposes } = _withOwner(() => fn(props));
  for (const dispose of disposes) {
    fragment.addDispose(dispose);
  }
  return fragment;
}

export function _callComponent(name: string, props: Record<string, unknown>): Fragment {
  const fn = _registry[name];
  if (fn === undefined) {
    if (__DEV__) {
      console.warn(
        `[TypeMVC] Component "${name}" is not registered. ` +
          `Add it to the components glob in bootstrap(), or register it with ` +
          `registerComponents() when testing.`,
      );
    }
    return new Fragment([]);
  }
  return _invokeComponent(fn, props);
}
