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

/**
 * The stored form of a layout. `parent` and `name` are mutable because a layout
 * discovered through the layouts glob is created before the layout it names as
 * its parent necessarily exists, so bootstrap links the two in a second pass.
 */
interface LayoutDef {
  parent: LayoutConstructor | undefined;
  name: string | undefined;
  readonly template: (context: LayoutContext) => Fragment;
}

type AnyConstructor = new (...args: unknown[]) => unknown;

// ---------------------------------------------------------------------------
// Layout definition store (WeakMap keyed on the class returned by defineLayout)
// ---------------------------------------------------------------------------

const layoutDefStore = new WeakMap<LayoutConstructor, LayoutDef>();

function requireDef(layout: LayoutConstructor, operation: string): LayoutDef {
  const def = layoutDefStore.get(layout);
  if (def === undefined) {
    throw new Error(
      `[TypeMVC] ${operation} received a class that was not created with defineLayout(). ` +
        'Only layouts created by defineLayout() carry a template and a parent.',
    );
  }
  return def;
}

/** The layout's registered name, or a placeholder when it was defined in code. */
function describeLayout(layout: LayoutConstructor): string {
  return layoutDefStore.get(layout)?.name ?? '(layout defined in TypeScript)';
}

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
  layoutDefStore.set(lc, { template: options.template, parent: options.parent, name: undefined });
  return lc;
}

// ---------------------------------------------------------------------------
// Framework-internal linking, used by the layouts glob path in bootstrap
// ---------------------------------------------------------------------------

/**
 * Framework internal. Sets the parent of a layout that already exists, which is
 * how a layout file's `@parent` name is wired once every layout in the glob has
 * been created. The public contract stays "a layout is created with everything
 * it needs": only the glob path needs to link after the fact.
 */
export function _setLayoutParent(child: LayoutConstructor, parent: LayoutConstructor): void {
  const def = requireDef(child, 'Setting a layout parent');
  requireDef(parent, 'Setting a layout parent');
  def.parent = parent;
}

/**
 * Framework internal. Records the name a layout was registered under, so a chain
 * error can identify it. Layouts defined in TypeScript have no registered name.
 */
export function _setLayoutName(layout: LayoutConstructor, name: string): void {
  requireDef(layout, 'Naming a layout').name = name;
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
      const cycle = [...chain, parent].map(describeLayout).join(' -> ');
      throw new Error(
        `[TypeMVC] Circular layout chain: ${cycle}. A layout cannot be its own ancestor. ` +
          'Remove the @parent declaration that closes the loop.',
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
