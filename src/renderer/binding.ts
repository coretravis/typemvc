import type { ReadonlySignal } from '../types/index.js';
import { effect } from '../reactivity/signal.js';
import { Fragment } from './fragment.js';
import { SafeHtml } from './safe-html.js';
import { sanitizeUrl, BOOLEAN_ATTRS, isUrlAttribute } from './escape.js';
import { isKeyedFragment } from './keyed.js';
import type { KeyedFragment } from './keyed.js';
import { clearRegion, reconcile } from './reconciler.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BindingContext =
  | { readonly kind: 'node'; readonly comment: Comment }
  | { readonly kind: 'attr'; readonly element: Element; readonly attrName: string }
  | { readonly kind: 'event'; readonly element: Element; readonly attrName: string; readonly eventName: string };

export interface DisposeCollector {
  addDispose(fn: () => void): void;
}

// ---------------------------------------------------------------------------
// Signal type guard
// ---------------------------------------------------------------------------

export function isReadonlySignal(value: unknown): value is ReadonlySignal<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function'
  );
}

// ---------------------------------------------------------------------------
// Event listener tracking - keyed by element to allow re-bind cleanup
// ---------------------------------------------------------------------------

// Maps element - (eventName - current handler) so re-binding removes old listener.
const eventListeners = new WeakMap<Element, Map<string, EventListener>>();

function bindEventListener(element: Element, eventName: string, handler: EventListener): void {
  let byEvent = eventListeners.get(element);
  if (byEvent === undefined) {
    byEvent = new Map<string, EventListener>();
    eventListeners.set(element, byEvent);
  }
  const prev = byEvent.get(eventName);
  if (prev !== undefined) {
    element.removeEventListener(eventName, prev);
  }
  element.addEventListener(eventName, handler);
  byEvent.set(eventName, handler);
}

// ---------------------------------------------------------------------------
// Attribute value application (handles booleans and URL sanitisation)
// ---------------------------------------------------------------------------

function applyAttrValue(element: Element, attrName: string, value: unknown): void {
  if (BOOLEAN_ATTRS.has(attrName)) {
    const boolValue = value === true;
    if (boolValue) {
      element.setAttribute(attrName, '');
    } else {
      element.removeAttribute(attrName);
    }
    // Also assign DOM property for checked and selected so live state is driven
    // by signals after user interaction (setAttribute only updates defaultValue/defaultChecked).
    if (attrName === 'checked' && 'checked' in element) {
      (element as HTMLInputElement).checked = boolValue;
    } else if (attrName === 'selected' && 'selected' in element) {
      (element as HTMLOptionElement).selected = boolValue;
    }
    return;
  }
  if (value === null || value === undefined || value === false) {
    element.removeAttribute(attrName);
    return;
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return;
  }
  const str = String(value);
  if (isUrlAttribute(attrName)) {
    element.setAttribute(attrName, sanitizeUrl(str));
  } else {
    element.setAttribute(attrName, str);
  }
  // Also assign DOM property for value so live displayed value is driven by
  // signals after user interaction (setAttribute only updates defaultValue).
  if (attrName === 'value' && 'value' in element) {
    (element as HTMLInputElement).value = str;
  }
}

// ---------------------------------------------------------------------------
// renderValue - central dispatcher
// ---------------------------------------------------------------------------

export function renderValue(
  value: unknown,
  ctx: BindingContext,
  collector: DisposeCollector,
): void {
  // Signal or ReadonlySignal -- wire reactively via effect()
  if (isReadonlySignal(value)) {
    if (ctx.kind === 'node') {
      const { comment } = ctx;
      const parent = comment.parentNode;
      if (parent === null) return;

      const initialValue = value.get();

      if (initialValue instanceof Fragment) {
        // Signal<Fragment> -- sentinel-based clear-and-replace
        const startSentinel = document.createComment('tmvc-rc-start');
        const endSentinel = document.createComment('tmvc-rc-end');
        parent.insertBefore(startSentinel, comment);
        parent.insertBefore(endSentinel, comment);
        parent.removeChild(comment);
        let mounted: Fragment | null = null;
        const dispose = effect(() => {
          const v = value.get();
          // Same fragment instance: nothing to replace.
          if (v === mounted) return;
          // Dispose the outgoing fragment's binding effects before swapping.
          if (mounted !== null) mounted.dispose();
          clearRegion(startSentinel, endSentinel);
          if (v instanceof Fragment) {
            for (const node of v.nodes) {
              parent.insertBefore(node, endSentinel);
            }
            mounted = v;
          } else {
            mounted = null;
          }
        });
        collector.addDispose(() => {
          dispose();
          if (mounted !== null) {
            mounted.dispose();
            mounted = null;
          }
        });
      } else if (Array.isArray(initialValue)) {
        // Signal<KeyedFragment[]> -- keyed reconciler
        const startSentinel = document.createComment('tmvc-rc-start');
        const endSentinel = document.createComment('tmvc-rc-end');
        parent.insertBefore(startSentinel, comment);
        parent.insertBefore(endSentinel, comment);
        parent.removeChild(comment);
        let keyMap = new Map<string | number, KeyedFragment>();
        const dispose = effect(() => {
          const v = value.get();
          if (Array.isArray(v)) {
            const items = v.filter((item): item is KeyedFragment => isKeyedFragment(item));
            keyMap = reconcile(endSentinel, keyMap, items);
          }
        });
        collector.addDispose(() => {
          dispose();
          // Dispose any items still mounted so their binding effects do not leak.
          for (const [, entry] of keyMap) {
            entry.fragment.dispose();
          }
          keyMap.clear();
        });
      } else {
        // Signal<scalar> -- reactive text node
        const textNode = document.createTextNode('');
        parent.insertBefore(textNode, comment);
        parent.removeChild(comment);
        const dispose = effect(() => {
          textNode.data = String(value.get());
        });
        collector.addDispose(dispose);
      }
    } else if (ctx.kind === 'attr') {
      const { element, attrName } = ctx;
      element.removeAttribute(attrName);
      const dispose = effect(() => {
        applyAttrValue(element, attrName, value.get());
      });
      collector.addDispose(dispose);
    } else {
      throw new Error(
        `[TypeMVC] Event handler for "${ctx.eventName}" must be a function, not a Signal. ` +
          'Pass a function reference directly.',
      );
    }
    return;
  }

  // Fragment - insert live DOM nodes, bypass escaping
  if (value instanceof Fragment) {
    if (ctx.kind === 'node') {
      insertFragment(ctx.comment, value);
    }
    return;
  }

  // SafeHtml - insert as innerHTML, bypass escaping
  if (value instanceof SafeHtml) {
    if (ctx.kind === 'node') {
      const { comment } = ctx;
      const parent = comment.parentNode;
      if (parent === null) return;
      const temp = document.createElement('div');
      temp.innerHTML = value.value;
      let child = temp.firstChild;
      while (child !== null) {
        const next = child.nextSibling;
        parent.insertBefore(child, comment);
        child = next;
      }
      parent.removeChild(comment);
    }
    return;
  }

  // Array - recursively render each element in order
  if (Array.isArray(value)) {
    if (ctx.kind === 'node') {
      const { comment } = ctx;
      const parent = comment.parentNode;
      if (parent === null) return;
      for (const item of value) {
        if (item instanceof Fragment) {
          for (const node of item.nodes) {
            parent.insertBefore(node, comment);
          }
        } else if (
          item !== null &&
          item !== undefined &&
          item !== false &&
          (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
        ) {
          parent.insertBefore(document.createTextNode(String(item)), comment);
        }
      }
      parent.removeChild(comment);
    }
    return;
  }

  // null / undefined / false - render nothing
  if (value === null || value === undefined || value === false) {
    if (ctx.kind === 'node') {
      const parent = ctx.comment.parentNode;
      if (parent !== null) parent.removeChild(ctx.comment);
    } else if (ctx.kind === 'attr') {
      ctx.element.removeAttribute(ctx.attrName);
    }
    return;
  }

  // Function - only valid in event position
  if (typeof value === 'function') {
    if (ctx.kind === 'event') {
      const { element, attrName, eventName } = ctx;
      element.removeAttribute(attrName);
      bindEventListener(element, eventName, value as EventListener);
    } else {
      throw new Error(
        '[TypeMVC] A function was passed to a non-event binding position. ' +
          'To attach an event handler, use an on* attribute (e.g. onclick=${handler}).',
      );
    }
    return;
  }

  // Object - programmer error: must use an explicit property
  if (typeof value === 'object') {
    throw new Error(
      '[TypeMVC] Objects must be rendered explicitly. Use object.property in your template expression.',
    );
  }

  // Primitive (string, number, boolean true) - after all object/function checks above
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return;
  }
  const str = String(value);
  if (ctx.kind === 'node') {
    const { comment } = ctx;
    const parent = comment.parentNode;
    if (parent !== null) {
      parent.insertBefore(document.createTextNode(str), comment);
      parent.removeChild(comment);
    }
  } else if (ctx.kind === 'attr') {
    applyAttrValue(ctx.element, ctx.attrName, value);
  } else {
    throw new Error(
      `[TypeMVC] Event handler for "${ctx.eventName}" must be a function. Received: ${typeof value}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: insert a Fragment's nodes before a comment marker, then remove marker
// ---------------------------------------------------------------------------

function insertFragment(comment: Comment, frag: Fragment): void {
  const parent = comment.parentNode;
  if (parent === null) return;
  for (const node of frag.nodes) {
    parent.insertBefore(node, comment);
  }
  parent.removeChild(comment);
}
