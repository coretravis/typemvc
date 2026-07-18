import { Fragment } from './fragment.js';
import type { MountCallback } from './fragment.js';
import type { DisposeCollector } from './binding.js';
import {
  renderValue,
  renderAttrParts,
  applyStyleValue,
  REF_ATTR,
  CLASS_BINDING_PREFIX,
  STYLE_BINDING_PREFIX,
} from './binding.js';
import { getOrParseTemplate, parseSentinelIndex, splitAttrValue } from './template.js';
import type { AttrPart, ParseContext } from './template.js';

function build(
  strings: TemplateStringsArray,
  values: readonly unknown[],
  context: ParseContext,
): Fragment {
  const parsed = getOrParseTemplate(strings, context);
  const clone = parsed.template.content.cloneNode(true) as DocumentFragment;

  // Collect all binding sites BEFORE mutating the DOM so walker state is stable.
  const nodeBindings: { comment: Comment; index: number }[] = [];
  const attrBindings: { element: Element; attrName: string; parts: AttrPart[] }[] = [];

  const commentWalker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
  let node = commentWalker.nextNode();
  while (node !== null) {
    const comment = node as Comment;
    const index = parseSentinelIndex(comment.nodeValue ?? '');
    if (index !== null && index < values.length) {
      nodeBindings.push({ comment, index });
    }
    node = commentWalker.nextNode();
  }

  const elementWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  let el = elementWalker.nextNode();
  while (el !== null) {
    const element = el as Element;
    const attrCount = element.attributes.length;
    for (let j = 0; j < attrCount; j++) {
      const attr = element.attributes[j];
      if (attr === undefined) continue;
      const parts = splitAttrValue(attr.value);
      if (parts !== null) {
        attrBindings.push({ element, attrName: attr.name, parts });
      }
    }
    el = elementWalker.nextNode();
  }

  // Collect dispose and mount callbacks until the Fragment exists, then forward
  // straight to it: an effect that re-runs after construction registers on the
  // Fragment itself, which is what lets a live region mount its new content.
  const disposes: (() => void)[] = [];
  const mounts: MountCallback[] = [];
  let target: Fragment | null = null;
  const collector: DisposeCollector = {
    addDispose(fn: () => void): void {
      if (target === null) disposes.push(fn);
      else target.addDispose(fn);
    },
    addMount(fn: MountCallback): void {
      if (target === null) mounts.push(fn);
      else target.addMount(fn);
    },
  };

  for (const { comment, index } of nodeBindings) {
    renderValue(values[index], { kind: 'node', comment }, collector);
  }

  for (const { element, attrName, parts } of attrBindings) {
    const soleHole = parts.length === 1 && parts[0]?.kind === 'hole' ? parts[0] : null;

    if (attrName.startsWith('on')) {
      // Event handlers must be a single whole-value expression: a function
      // cannot be concatenated with literal text.
      if (soleHole === null) {
        throw new Error(
          `[TypeMVC] Event handler attribute "${attrName}" must be a single \${...} ` +
            'expression, not combined with literal text or other expressions.',
        );
      }
      const eventName = attrName.slice(2);
      renderValue(values[soleHole.index], { kind: 'event', element, attrName, eventName }, collector);
    } else if (attrName === REF_ATTR) {
      // A ref is a callback, so it has the same whole-value requirement as on*.
      if (soleHole === null) {
        throw new Error(
          `[TypeMVC] The "${REF_ATTR}" attribute must be a single \${...} expression, ` +
            'not combined with literal text or other expressions.',
        );
      }
      renderValue(values[soleHole.index], { kind: 'ref', element, attrName }, collector);
    } else if (attrName.startsWith(CLASS_BINDING_PREFIX)) {
      // A class binding takes a condition, so it must be a single whole-value
      // expression: literal text composed into it would make the class always
      // apply, because every non-empty string is truthy.
      if (soleHole === null) {
        throw new Error(
          `[TypeMVC] The "${attrName}" attribute must be a single \${...} expression, ` +
            'not combined with literal text or other expressions. Pass one boolean ' +
            'expression, and let the stylesheet decide what the class looks like.',
        );
      }
      const className = attrName.slice(CLASS_BINDING_PREFIX.length);
      if (className.length === 0) {
        throw new Error(
          '[TypeMVC] The "class:" prefix must be followed by the class name to toggle, ' +
            'for example class:is-active="${isActive}".',
        );
      }
      renderValue(values[soleHole.index], { kind: 'class', element, attrName, className }, collector);
    } else if (attrName.startsWith(STYLE_BINDING_PREFIX)) {
      const property = attrName.slice(STYLE_BINDING_PREFIX.length);
      if (property.length === 0) {
        throw new Error(
          '[TypeMVC] The "style:" prefix must be followed by the CSS property to set, ' +
            'for example style:--fill="${percent}".',
        );
      }
      if (soleHole !== null) {
        renderValue(values[soleHole.index], { kind: 'style', element, attrName, property }, collector);
      } else {
        // A composed value such as style:--fill="${p}%" is meaningful, so it goes
        // through the parts path, applied to the CSSOM rather than an attribute.
        renderAttrParts(element, attrName, parts, values, collector, (composed) => {
          applyStyleValue(element, property, composed);
        });
      }
    } else if (soleHole !== null) {
      // Whole-value attribute: keep the existing single-value path so reactive
      // values and form control property assignment behave as before.
      renderValue(values[soleHole.index], { kind: 'attr', element, attrName }, collector);
    } else {
      renderAttrParts(element, attrName, parts, values, collector);
    }
  }

  const nodes: Node[] = Array.from(clone.childNodes);
  const frag = new Fragment(nodes);
  for (const fn of disposes) {
    frag.addDispose(fn);
  }
  for (const fn of mounts) {
    frag.addMount(fn);
  }
  target = frag;
  return frag;
}

/**
 * Tagged template literal that compiles HTML markup with interpolated values
 * into a live {@link Fragment}. Interpolated signals create reactive bindings;
 * `on*` attributes bind event handlers; a `ref` attribute hands the element to a
 * callback once it is mounted; nested fragments and arrays are inserted as child
 * content. This is the same `html` used inside `.tmvc` templates.
 *
 * @returns A {@link Fragment} of live DOM nodes.
 * @example
 * ```ts
 * const name = signal('Ada');
 * const frag = html`<p>Hello ${name}</p>`; // updates when name changes
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Fragment {
  return build(strings, values, 'html');
}

/**
 * Tagged template literal for SVG content. Identical to {@link html} except that
 * the markup is parsed inside an `<svg>`, so its elements are SVG elements. Use
 * it for every interpolated child of an `<svg>`: markup parsed as HTML produces
 * an element of the same name in the wrong namespace, which the browser ignores.
 *
 * @returns A {@link Fragment} of live DOM nodes in the SVG namespace.
 * @example
 * ```ts
 * const r = signal(10);
 * html`<svg viewBox="0 0 40 40">${svg`<circle cx="20" cy="20" r="${r}" />`}</svg>`;
 * ```
 */
export function svg(strings: TemplateStringsArray, ...values: unknown[]): Fragment {
  return build(strings, values, 'svg');
}
