import { Fragment } from './fragment.js';
import type { DisposeCollector } from './binding.js';
import { renderValue, renderAttrParts } from './binding.js';
import { getOrParseTemplate, parseSentinelIndex, splitAttrValue } from './template.js';
import type { AttrPart } from './template.js';

/**
 * Tagged template literal that compiles HTML markup with interpolated values
 * into a live {@link Fragment}. Interpolated signals create reactive bindings;
 * `on*` attributes bind event handlers; nested fragments and arrays are inserted
 * as child content. This is the same `html` used inside `.tmvc` templates.
 *
 * @returns A {@link Fragment} of live DOM nodes.
 * @example
 * ```ts
 * const name = signal('Ada');
 * const frag = html`<p>Hello ${name}</p>`; // updates when name changes
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Fragment {
  const parsed = getOrParseTemplate(strings);
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

  // Collect dispose fns, transfer to Fragment after construction.
  const disposes: (() => void)[] = [];
  const collector: DisposeCollector = {
    addDispose(fn: () => void): void {
      disposes.push(fn);
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
  return frag;
}
