import { Fragment } from '../renderer/fragment.js';
import type { LayoutConstructor, LayoutContext, ViewContext } from '../types/index.js';
import { getClassLayout, getMethodLayout } from '../core/decorators.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LayoutOptions {
  readonly parent?: LayoutConstructor;
  readonly template: (context: LayoutContext) => Fragment;
}

type AnyConstructor = new (...args: unknown[]) => unknown;

// ---------------------------------------------------------------------------
// Layout definition store (WeakMap keyed on the class returned by defineLayout)
// ---------------------------------------------------------------------------

const layoutDefStore = new WeakMap<LayoutConstructor, LayoutOptions>();

// ---------------------------------------------------------------------------
// defineLayout
// ---------------------------------------------------------------------------

/**
 * Creates a layout definition from a template function and an optional parent
 * layout. The returned value is a constructor that can be passed to @layout().
 */
export function defineLayout(options: LayoutOptions): LayoutConstructor {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- opaque class used as WeakMap key; no members needed, identity is the only requirement
  const Layout = class LayoutClass {};
  const lc = Layout as unknown as LayoutConstructor;
  layoutDefStore.set(lc, options);
  return lc;
}

// ---------------------------------------------------------------------------
// resolveLayoutChain
// ---------------------------------------------------------------------------

/** Map from layout name string to LayoutConstructor, built by bootstrap from LayoutGlob. */
export type LayoutMap = Readonly<Record<string, LayoutConstructor>>;

function resolveRef(
  ref: LayoutConstructor | string,
  layoutMap: LayoutMap | undefined,
): LayoutConstructor {
  if (typeof ref !== 'string') return ref;
  const resolved = layoutMap?.[ref];
  if (resolved === undefined) {
    throw new Error(
      `[TypeMVC] Layout "${ref}" not found. Register it via the "layouts" eager glob in bootstrap().`,
    );
  }
  return resolved;
}

/**
 * Returns the ordered layout chain for a controller action, innermost first.
 * Action-level @layout takes precedence over controller-level @layout.
 * Returns an empty array if no layout is declared.
 */
export function resolveLayoutChain(
  cls: AnyConstructor,
  methodName: string,
  layoutMap?: LayoutMap,
): LayoutConstructor[] {
  const proto = cls.prototype as object;
  const immediateRef = getMethodLayout(proto, methodName) ?? getClassLayout(cls);
  if (immediateRef === undefined) return [];
  const immediate = resolveRef(immediateRef, layoutMap);

  const chain: LayoutConstructor[] = [immediate];
  let current = immediate;
  const seen = new Set<LayoutConstructor>([current]);

  for (;;) {
    const def = layoutDefStore.get(current);
    if (def?.parent === undefined) break;
    const parent = def.parent;
    if (seen.has(parent)) {
      throw new Error(
        '[TypeMVC] Circular layout chain detected. A layout cannot be its own ancestor.',
      );
    }
    seen.add(parent);
    chain.push(parent);
    current = parent;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// applyLayoutChain
// ---------------------------------------------------------------------------

/**
 * Applies a layout chain to a slot Fragment, rendering inside-out.
 * Returns the slot unchanged when the chain is empty (no layout declared).
 * Each layout receives the previous output as context.slot.
 */
export function applyLayoutChain(
  chain: LayoutConstructor[],
  slot: Fragment,
  context: ViewContext,
): Fragment {
  if (chain.length === 0) return slot;

  let currentSlot = slot;
  for (const layoutCtor of chain) {
    const def = layoutDefStore.get(layoutCtor);
    if (def === undefined) {
      throw new Error(
        '[TypeMVC] Layout class was not created with defineLayout(). ' +
          'Only layouts created by defineLayout() can be used with @layout.',
      );
    }
    const layoutContext = Object.create(context) as unknown as LayoutContext;
    Object.defineProperty(layoutContext, 'slot', {
      value: currentSlot,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    currentSlot = def.template(layoutContext);
  }
  return currentSlot;
}
