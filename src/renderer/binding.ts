declare const __DEV__: boolean;

import type { ReadonlySignal, RefCallback } from '../types/index.js';
import { effect } from '../reactivity/signal.js';
import { Fragment } from './fragment.js';
import type { MountCallback } from './fragment.js';
import { SafeHtml } from './safe-html.js';
import { sanitizeUrl, sanitizeSrcset, BOOLEAN_ATTRS, isUrlAttribute } from './escape.js';
import { isKeyedFragment } from './keyed.js';
import type { KeyedFragment } from './keyed.js';
import type { AttrPart } from './template.js';
import { clearRegion, reconcile } from './reconciler.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BindingContext =
  | { readonly kind: 'node'; readonly comment: Comment }
  | { readonly kind: 'attr'; readonly element: Element; readonly attrName: string }
  | { readonly kind: 'event'; readonly element: Element; readonly attrName: string; readonly eventName: string }
  | { readonly kind: 'ref'; readonly element: Element; readonly attrName: string }
  | { readonly kind: 'class'; readonly element: Element; readonly attrName: string; readonly className: string }
  | { readonly kind: 'style'; readonly element: Element; readonly attrName: string; readonly property: string };

export interface DisposeCollector {
  addDispose(fn: () => void): void;
  addMount(fn: MountCallback): void;
}

/** The attribute that binds a callback to the element it is written on. */
export const REF_ATTR = 'ref';

/** Prefix of an attribute that toggles one class token from a condition. */
export const CLASS_BINDING_PREFIX = 'class:';

/** Prefix of an attribute that assigns one CSS property through the CSSOM. */
export const STYLE_BINDING_PREFIX = 'style:';

const SVG_NS = 'http://www.w3.org/2000/svg';

const OBJECT_IN_NODE_MESSAGE =
  '[TypeMVC] Objects must be rendered explicitly. Use object.property in your template expression.';

const FUNCTION_IN_NODE_MESSAGE =
  '[TypeMVC] A function was passed to a non-event binding position. ' +
  'To attach an event handler, use an on* attribute (e.g. onclick=${handler}).';

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
    // srcset is a candidate list, so each URL in it is sanitized separately.
    const sanitized = attrName === 'srcset' ? sanitizeSrcset(str) : sanitizeUrl(str);
    element.setAttribute(attrName, sanitized);
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
// Prefixed binding application (one class token, one CSS property)
// ---------------------------------------------------------------------------

/** An element that carries an inline style declaration (HTML, SVG, MathML). */
interface StyledElement extends Element {
  readonly style: CSSStyleDeclaration;
}

function isStyledElement(element: Element): element is StyledElement {
  return 'style' in element;
}

// classList is additive, so this touches only its own token: the static class
// attribute and every other class binding on the element are left intact.
function applyClassValue(element: Element, className: string, value: unknown): void {
  element.classList.toggle(className, Boolean(value));
}

/**
 * Assigns one CSS property, custom or plain, through the CSSOM rather than
 * through a style attribute, which is what keeps a page whose Content Security
 * Policy forbids inline style attributes working. A value that is not a string
 * or a finite number withdraws the property instead of writing a garbage value
 * such as the text "null" into it.
 */
export function applyStyleValue(element: Element, property: string, value: unknown): void {
  if (!isStyledElement(element)) return;
  if (typeof value === 'string' && value !== '') {
    element.style.setProperty(property, value);
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    element.style.setProperty(property, String(value));
    return;
  }
  element.style.removeProperty(property);
}

// ---------------------------------------------------------------------------
// Multi-part attribute binding (literal text plus one or more holes)
// ---------------------------------------------------------------------------

function partToString(value: unknown): string {
  const resolved = isReadonlySignal(value) ? value.get() : value;
  if (resolved === null || resolved === undefined || resolved === false) return '';
  if (typeof resolved === 'string' || typeof resolved === 'number' || typeof resolved === 'boolean') {
    return String(resolved);
  }
  return '';
}

/** Receives the recomposed value of a multi-part binding on every update. */
export type AttrPartsApply = (value: string) => void;

/**
 * Binds an attribute whose value is composed of literal text and one or more
 * interpolation holes (for example `href="/books/${id}"` or `class="${a} ${b}"`).
 * The full value is recomposed and, by default, applied through
 * {@link applyAttrValue}, so boolean handling and URL sanitization run on the
 * final string. A prefixed binding such as `style:--fill="${p}%"` passes its own
 * `apply` instead, which sends the composed string to the CSSOM rather than to
 * an attribute. When any hole is a signal, the recompose runs inside a
 * disposed-on-unmount effect.
 */
export function renderAttrParts(
  element: Element,
  attrName: string,
  parts: readonly AttrPart[],
  values: readonly unknown[],
  collector: DisposeCollector,
  apply?: AttrPartsApply,
): void {
  const hasSignal = parts.some(
    (part) => part.kind === 'hole' && isReadonlySignal(values[part.index]),
  );

  const compose = (): string => {
    let out = '';
    for (const part of parts) {
      out += part.kind === 'literal' ? part.text : partToString(values[part.index]);
    }
    return out;
  };

  const set: AttrPartsApply =
    apply ??
    ((composed: string): void => {
      applyAttrValue(element, attrName, composed);
    });

  element.removeAttribute(attrName);
  if (hasSignal) {
    const dispose = effect(() => {
      set(compose());
    });
    collector.addDispose(dispose);
  } else {
    set(compose());
  }
}

// ---------------------------------------------------------------------------
// Node insertion helpers
//
// Every path that puts a fragment into a parent runs its mount callbacks through
// the collector, so a fragment built inside a not-yet-mounted template waits for
// its owner, and one inserted into a region that is already live runs at once.
// ---------------------------------------------------------------------------

function insertNodes(host: Node, before: Node, nodes: readonly Node[]): void {
  for (const node of nodes) {
    host.insertBefore(node, before);
  }
}

function mountFragment(collector: DisposeCollector, fragment: Fragment): void {
  collector.addMount(() => {
    fragment.mount();
  });
}

/**
 * Inserts pre-sanitized markup. The container is chosen from the destination's
 * namespace: markup destined for an `<svg>` is parsed inside an `<svg>`, so its
 * elements are SVG elements rather than inert HTML elements of the same name.
 */
function insertMarkup(host: Node, before: Node, markup: SafeHtml): void {
  const hostNs = host instanceof Element ? host.namespaceURI : null;
  const temp =
    hostNs === SVG_NS ? document.createElementNS(SVG_NS, 'svg') : document.createElement('div');
  temp.innerHTML = markup.value;
  let child = temp.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    host.insertBefore(child, before);
    child = next;
  }
}

// Inserts the items of an array in order and returns the fragments among them,
// which are the items that own effects and so must be disposed by the caller.
function insertListItems(host: Node, before: Node, items: readonly unknown[]): Fragment[] {
  const fragments: Fragment[] = [];
  for (const item of items) {
    if (item instanceof Fragment) {
      insertNodes(host, before, item.nodes);
      fragments.push(item);
    } else if (typeof item === 'string' || typeof item === 'number' || item === true) {
      host.insertBefore(document.createTextNode(String(item)), before);
    }
  }
  return fragments;
}

// ---------------------------------------------------------------------------
// Reactive region
//
// A region is the span between two sentinel comments. The sentinels are placed
// once, at bind time; everything else is resolved on each update, including the
// parent (which at bind time is still the throwaway clone) and the rendering
// strategy (which the value's current shape decides, not its initial one).
// ---------------------------------------------------------------------------

type RegionContent =
  | { readonly kind: 'empty' }
  | { readonly kind: 'fragment'; readonly fragment: Fragment }
  | { readonly kind: 'keyed'; readonly keyMap: Map<string | number, KeyedFragment> }
  | { readonly kind: 'list'; readonly fragments: readonly Fragment[] }
  | { readonly kind: 'text'; readonly node: Text }
  | { readonly kind: 'markup'; readonly markup: SafeHtml };

interface RegionState {
  content: RegionContent;
  warnedUnkeyed: boolean;
}

const EMPTY_CONTENT: RegionContent = { kind: 'empty' };

// Tears down the effects owned by the mounted content. The DOM is left alone:
// callers either clear the region or are disposing the whole subtree.
function disposeContent(content: RegionContent): void {
  switch (content.kind) {
    case 'fragment':
      content.fragment.dispose();
      break;
    case 'keyed':
      for (const entry of content.keyMap.values()) {
        entry.fragment.dispose();
      }
      content.keyMap.clear();
      break;
    case 'list':
      for (const fragment of content.fragments) {
        fragment.dispose();
      }
      break;
    default:
      break;
  }
}

function clearContent(state: RegionState, start: Comment, end: Comment): void {
  disposeContent(state.content);
  clearRegion(start, end);
  state.content = EMPTY_CONTENT;
}

function renderKeyedList(
  start: Comment,
  end: Comment,
  items: readonly KeyedFragment[],
  state: RegionState,
  collector: DisposeCollector,
): void {
  const current = state.content;
  let oldMap: Map<string | number, KeyedFragment>;
  if (current.kind === 'keyed') {
    oldMap = current.keyMap;
  } else {
    clearContent(state, start, end);
    oldMap = new Map<string | number, KeyedFragment>();
  }
  const keyMap = reconcile(end, oldMap, items);
  state.content = { kind: 'keyed', keyMap };
  // Mount every freshly built fragment the reconciler adopted: a new key, or a
  // replaced row whose content changed. A reused row keeps the retained fragment
  // (a different object from this item's), so its identity check is false and it
  // is not mounted again.
  for (const item of items) {
    if (keyMap.get(item.key)?.fragment === item.fragment) {
      mountFragment(collector, item.fragment);
    }
  }
}

function renderUnkeyedList(
  host: Node,
  start: Comment,
  end: Comment,
  items: readonly unknown[],
  state: RegionState,
  collector: DisposeCollector,
): void {
  if (__DEV__ && !state.warnedUnkeyed && items.some((item) => item instanceof Fragment)) {
    state.warnedUnkeyed = true;
    console.warn(
      '[TypeMVC] A reactive list of unkeyed fragments rebuilds every row on each change. ' +
        'Give each row a stable identity with keyed(key, fragment), or build the list with ' +
        'keyedMap(items, key, render), so rows are reused instead.',
    );
  }
  clearContent(state, start, end);
  const fragments = insertListItems(host, end, items);
  state.content = { kind: 'list', fragments };
  for (const fragment of fragments) {
    mountFragment(collector, fragment);
  }
}

function renderArrayRegion(
  host: Node,
  start: Comment,
  end: Comment,
  items: readonly unknown[],
  state: RegionState,
  collector: DisposeCollector,
): void {
  // A nullish or false item renders nothing, so it is neither keyed nor unkeyed
  // content and does not decide the strategy.
  const renderable = items.filter(
    (item) => item !== null && item !== undefined && item !== false,
  );
  const keyedItems: KeyedFragment[] = [];
  for (const item of renderable) {
    if (isKeyedFragment(item)) keyedItems.push(item);
  }

  if (keyedItems.length > 0 && keyedItems.length < renderable.length) {
    throw new Error(
      '[TypeMVC] A reactive list mixes keyed and unkeyed items, so the renderer cannot tell ' +
        'whether to reconcile by key or rebuild the list. Wrap every item with keyed(key, fragment), ' +
        'or wrap none of them.',
    );
  }

  if (keyedItems.length > 0) {
    renderKeyedList(start, end, keyedItems, state, collector);
    return;
  }
  renderUnkeyedList(host, start, end, items, state, collector);
}

/**
 * Renders the current value of a reactive region between its sentinels, mounting
 * the new content and disposing whatever the previous strategy had mounted. The
 * value's shape picks the strategy on every run, so a region may hold a fragment,
 * a list, markup, text, or nothing at different points in its life.
 */
function renderRegion(
  start: Comment,
  end: Comment,
  value: unknown,
  state: RegionState,
  collector: DisposeCollector,
): void {
  const host = end.parentNode;
  if (host === null) return;

  if (value instanceof Fragment) {
    const current = state.content;
    if (current.kind === 'fragment' && current.fragment === value) return;
    clearContent(state, start, end);
    insertNodes(host, end, value.nodes);
    state.content = { kind: 'fragment', fragment: value };
    mountFragment(collector, value);
    return;
  }

  if (Array.isArray(value)) {
    renderArrayRegion(host, start, end, value as readonly unknown[], state, collector);
    return;
  }

  if (value instanceof SafeHtml) {
    const current = state.content;
    if (current.kind === 'markup' && current.markup === value) return;
    clearContent(state, start, end);
    insertMarkup(host, end, value);
    state.content = { kind: 'markup', markup: value };
    return;
  }

  if (value === null || value === undefined || value === false) {
    if (state.content.kind === 'empty') return;
    clearContent(state, start, end);
    return;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value);
    const current = state.content;
    if (current.kind === 'text') {
      current.node.data = text;
      return;
    }
    clearContent(state, start, end);
    const node = document.createTextNode(text);
    host.insertBefore(node, end);
    state.content = { kind: 'text', node };
    return;
  }

  throw new Error(typeof value === 'function' ? FUNCTION_IN_NODE_MESSAGE : OBJECT_IN_NODE_MESSAGE);
}

// Places the region sentinels at the binding site and drives them from the signal.
function bindRegion(comment: Comment, value: ReadonlySignal<unknown>, collector: DisposeCollector): void {
  const parent = comment.parentNode;
  if (parent === null) return;

  const start = document.createComment('tmvc-rc-start');
  const end = document.createComment('tmvc-rc-end');
  parent.insertBefore(start, comment);
  parent.insertBefore(end, comment);
  parent.removeChild(comment);

  const state: RegionState = { content: EMPTY_CONTENT, warnedUnkeyed: false };
  const dispose = effect(() => {
    renderRegion(start, end, value.get(), state, collector);
  });
  collector.addDispose(() => {
    dispose();
    disposeContent(state.content);
    state.content = EMPTY_CONTENT;
  });
}

// ---------------------------------------------------------------------------
// renderValue - central dispatcher
// ---------------------------------------------------------------------------

export function renderValue(
  value: unknown,
  ctx: BindingContext,
  collector: DisposeCollector,
): void {
  // ref -- the element itself, handed to a callback once it is in the document
  if (ctx.kind === 'ref') {
    const { element, attrName } = ctx;
    element.removeAttribute(attrName);
    if (typeof value !== 'function') {
      throw new Error(
        `[TypeMVC] The "${attrName}" attribute must be a function that receives the element. ` +
          `Received: ${typeof value}. Write ref="\${(el) => { ... }}".`,
      );
    }
    const callback = value as RefCallback;
    collector.addMount(() => callback(element));
    return;
  }

  // class:name applies one class token, toggled from the truthiness of the value
  if (ctx.kind === 'class') {
    const { element, attrName, className } = ctx;
    element.removeAttribute(attrName);
    if (isReadonlySignal(value)) {
      const dispose = effect(() => {
        applyClassValue(element, className, value.get());
      });
      collector.addDispose(dispose);
    } else {
      applyClassValue(element, className, value);
    }
    return;
  }

  // style:property applies one CSS property, assigned through the CSSOM
  if (ctx.kind === 'style') {
    const { element, attrName, property } = ctx;
    element.removeAttribute(attrName);
    if (isReadonlySignal(value)) {
      const dispose = effect(() => {
        applyStyleValue(element, property, value.get());
      });
      collector.addDispose(dispose);
    } else {
      applyStyleValue(element, property, value);
    }
    return;
  }

  // Signal or ReadonlySignal -- wire reactively via effect()
  if (isReadonlySignal(value)) {
    if (ctx.kind === 'node') {
      bindRegion(ctx.comment, value, collector);
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
      const { comment } = ctx;
      const parent = comment.parentNode;
      if (parent === null) return;
      insertNodes(parent, comment, value.nodes);
      parent.removeChild(comment);
      // Adopt the child's dispose chain so its binding effects tear down when the parent
      // Fragment is disposed, and its mount chain so its refs fire when the parent mounts.
      collector.addDispose(() => {
        value.dispose();
      });
      mountFragment(collector, value);
    }
    return;
  }

  // SafeHtml - insert as raw markup, bypass escaping
  if (value instanceof SafeHtml) {
    if (ctx.kind === 'node') {
      const { comment } = ctx;
      const parent = comment.parentNode;
      if (parent === null) return;
      insertMarkup(parent, comment, value);
      parent.removeChild(comment);
    }
    return;
  }

  // Array - render each element in order
  if (Array.isArray(value)) {
    if (ctx.kind === 'node') {
      const { comment } = ctx;
      const parent = comment.parentNode;
      if (parent === null) return;
      const fragments = insertListItems(parent, comment, value as readonly unknown[]);
      parent.removeChild(comment);
      // Adopt each item Fragment's chains so a static array of fragments neither
      // leaks effects nor misses its refs.
      for (const fragment of fragments) {
        collector.addDispose(() => {
          fragment.dispose();
        });
        mountFragment(collector, fragment);
      }
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
      throw new Error(FUNCTION_IN_NODE_MESSAGE);
    }
    return;
  }

  // Object - programmer error: must use an explicit property
  if (typeof value === 'object') {
    throw new Error(OBJECT_IN_NODE_MESSAGE);
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
