import type { ComponentFunction } from '../types/index.js';
import { Fragment } from '../renderer/fragment.js';

declare const __DEV__: boolean;

type ComponentMap = Readonly<Record<string, ComponentFunction>>;

let _registry: ComponentMap = Object.create(null) as ComponentMap;

export function _setComponentRegistry(map: ComponentMap): void {
  _registry = map;
}

export function _getComponentRegistry(): ComponentMap {
  return _registry;
}

export function _callComponent(name: string, props: Record<string, unknown>): Fragment {
  const fn = _registry[name];
  if (fn === undefined) {
    if (__DEV__) {
      console.warn(
        `[TypeMVC] Component "${name}" is not registered. ` +
          `Add it to the components glob in bootstrap().`,
      );
    }
    return new Fragment([]);
  }
  return fn(props);
}
