import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  escapeTmvcMarkup,
  extractDirective,
  extractLocalBlock,
  validateTmvcSource,
  describeValidationError,
} from '../vite-plugin/index.js';

// ---------------------------------------------------------------------------
// Public Volar-compatible interfaces
// ---------------------------------------------------------------------------

/**
 * Feature flags controlling which TypeScript language service operations apply
 * to a source mapping segment. Compatible with @volar/language-core 2.x
 * CodeInformation.
 */
export interface CodeFeatures {
  /** Enable diagnostic type errors on this range. */
  readonly verification: boolean;
  /** Enable completion suggestions on this range. */
  readonly completion: boolean;
  /** Enable hover, references, and rename on this range. */
  readonly semantic: boolean;
  /** Enable go-to-definition and navigation on this range. */
  readonly navigation: boolean;
  /** Enable code structure features on this range. */
  readonly structure: boolean;
  /** Enable code formatting on this range. */
  readonly format: boolean;
}

/**
 * A source mapping segment from virtual TypeScript positions to .tmvc source
 * positions. Compatible with @volar/language-core 2.x Mapping.
 */
export interface TmvcMapping {
  /** Offsets in the .tmvc source file. */
  readonly sourceOffsets: readonly number[];
  /** Corresponding offsets in the generated TypeScript virtual file. */
  readonly generatedOffsets: readonly number[];
  /** Source-side lengths of each mapped range in characters. */
  readonly lengths: readonly number[];
  /**
   * Generated-side lengths, when they differ from the source lengths (Volar's
   * unequal-length segment support). Omitted for equal-length segments. Used to
   * map the (long) generated prop-check object literal back to the (short)
   * source component tag so missing-required-prop errors surface on the tag.
   */
  readonly generatedLengths?: readonly number[];
  /** Feature flags controlling which language service features apply. */
  readonly data: CodeFeatures;
}

/**
 * A span within a snapshot. Compatible with TypeScript's TextSpan.
 */
export interface TmvcTextSpan {
  readonly start: number;
  readonly length: number;
}

/**
 * Describes a text change range. Compatible with TypeScript's TextChangeRange.
 */
export interface TmvcTextChangeRange {
  readonly span: TmvcTextSpan;
  readonly newLength: number;
}

/**
 * A snapshot of the generated TypeScript content for a .tmvc file.
 * Compatible with @volar/language-core 2.x IScriptSnapshot.
 */
export interface TmvcSnapshot {
  /** Returns the text in the half-open range [start, end). */
  readonly getText: (start: number, end: number) => string;
  /** Returns the total length of the snapshot content. */
  readonly getLength: () => number;
  /** Returns undefined: incremental change tracking is not implemented. */
  readonly getChangeRange: (oldSnapshot: TmvcSnapshot) => TmvcTextChangeRange | undefined;
}

/**
 * A virtual code entry for a .tmvc file.
 * Compatible with @volar/language-core 2.x VirtualCode.
 */
export interface TmvcVirtualCode {
  /** Unique identifier within the virtual file set. Always 'main'. */
  readonly id: string;
  /** Language ID of the virtual file. Always 'typescript'. */
  readonly languageId: string;
  /** Snapshot of the generated TypeScript content. */
  readonly snapshot: TmvcSnapshot;
  /** Source mappings from virtual TypeScript positions to .tmvc positions. */
  readonly mappings: readonly TmvcMapping[];
  /** Embedded virtual codes (present for interface compatibility; unused). */
  readonly embeddedCodes?: readonly TmvcVirtualCode[];
}

/**
 * A Volar-compatible language plugin for .tmvc files.
 * Compatible with @volar/language-core 2.x LanguagePlugin.
 */
export interface TmvcLanguagePlugin {
  /** Returns 'tmvc' for .tmvc files, undefined for all other extensions. */
  readonly getLanguageId: (fileName: string) => string | undefined;
  /**
   * Creates a virtual TypeScript file from a .tmvc file snapshot.
   * Returns undefined if the file is not a .tmvc file.
   */
  readonly createVirtualCode: (
    fileName: string,
    languageId: string,
    snapshot: TmvcSnapshot,
  ) => TmvcVirtualCode | undefined;
  /** Recreates the virtual code when the .tmvc source changes on disk or in the editor. */
  readonly updateVirtualCode: (
    fileName: string,
    virtualCode: TmvcVirtualCode,
    snapshot: TmvcSnapshot,
  ) => TmvcVirtualCode;
}

// ---------------------------------------------------------------------------
// Internal preamble constants
// ---------------------------------------------------------------------------

const PREAMBLE_IMPORTS =
  "import { html } from '@typemvc/core';\n" +
  "import type { ViewContext } from '@typemvc/core';\n" +
  "import type { Fragment } from '@typemvc/core';\n";

const PREAMBLE_IMPORTS_TYPED =
  "import { html } from '@typemvc/core';\n" +
  "import type { TypedViewContext } from '@typemvc/core';\n" +
  "import type { Fragment } from '@typemvc/core';\n";

const PREAMBLE_RENDER_NO_CONTROLLER =
  '\n' +
  'export default function render(context: ViewContext): Fragment {\n' +
  '  return html`';

// Component .tmvc files receive props (not context) to match the Vite plugin's
// PREAMBLE_PROPS branch, which is selected when the path contains /components/.
const PREAMBLE_IMPORTS_COMPONENT =
  "import { html } from '@typemvc/core';\n" +
  "import type { Fragment } from '@typemvc/core';\n";

// Without @props: children is typed as Fragment, other props stay loose.
const PREAMBLE_RENDER_COMPONENT =
  '\n' +
  'export default function render(props: { readonly children?: Fragment } & Record<string, unknown>): Fragment {\n' +
  '  return html`';

// Imported into a component virtual file that declares a @local block so the
// lifted statements type-check against the reactivity primitives.
const PREAMBLE_REACTIVITY =
  "import { signal, computed, effect, batch, onCleanup } from '@typemvc/core';\n";

// The line that opens the template literal; the @local statements are spliced in
// just before it.
const RETURN_HTML = '  return html`';

// With @props <type>: props are the declared type, plus an always-available
// optional children slot (any caller may project content, issue 043).
function buildComponentPropsPreamble(expr: string): string {
  return (
    PREAMBLE_IMPORTS_COMPONENT +
    `type __TmvcProps = ${expr} & { readonly children?: Fragment };\n` +
    '\n' +
    'export default function render(props: __TmvcProps): Fragment {\n' +
    '  return html`'
  );
}

const VIRTUAL_SUFFIX = '`;\n}\n';

const ALL_FEATURES: CodeFeatures = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
};

// ---------------------------------------------------------------------------
// Path utilities (forward-slash only; no node:path dependency for portability)
// ---------------------------------------------------------------------------

function pathDirname(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const last = norm.lastIndexOf('/');
  return last === -1 ? '.' : norm.slice(0, last);
}

function computeRelativeImport(fromDir: string, toPathNoExt: string): string {
  const fromParts = fromDir.split('/').filter((p) => p.length > 0);
  const toParts = toPathNoExt.split('/').filter((p) => p.length > 0);

  let commonLen = 0;
  for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
    const a = fromParts[i];
    const b = toParts[i];
    if (a === undefined || b === undefined || a !== b) break;
    commonLen++;
  }

  const upCount = fromParts.length - commonLen;
  const downParts = toParts.slice(commonLen);
  const relParts: string[] = [
    ...new Array<string>(upCount).fill('..'),
    ...downParts,
  ];

  if (relParts.length === 0) return '.';
  const rel = relParts.join('/');
  return rel.startsWith('..') ? rel : `./${rel}`;
}

function toPascalCase(segment: string): string {
  return segment
    .split('-')
    .map((part) =>
      part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : '',
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Controller discovery (§5.2 convention)
// ---------------------------------------------------------------------------

/**
 * Returns the ordered list of absolute candidate paths to check for the
 * owning controller of a .tmvc view file.
 *
 * Convention (§5.2): strip the 'views/' prefix, take the first path segment,
 * convert it to PascalCase, and append 'Controller'.
 *
 * e.g. views/admin-users/list.tmvc -> AdminUsersController ->
 *   {workspaceRoot}/src/controllers/AdminUsersController.ts (first candidate)
 */
export function getControllerCandidatePaths(
  tmvcFilePath: string,
  workspaceRoot: string,
): string[] {
  const normalized = tmvcFilePath.replace(/\\/g, '/');
  const viewsMarker = 'views/';
  const viewsIdx = normalized.indexOf(viewsMarker);
  if (viewsIdx === -1) return [];

  const afterViews = normalized.slice(viewsIdx + viewsMarker.length);
  const slashIdx = afterViews.indexOf('/');
  const firstSegment =
    slashIdx === -1
      ? afterViews.replace(/\.tmvc$/, '')
      : afterViews.slice(0, slashIdx);

  if (firstSegment.length === 0) return [];

  const controllerName = toPascalCase(firstSegment) + 'Controller';
  const fileName = controllerName + '.ts';

  const candidates = [
    join(workspaceRoot, 'src', 'controllers', fileName),
    join(workspaceRoot, 'controllers', fileName),
    join(workspaceRoot, 'src', fileName),
  ];

  // When the .tmvc path has a directory prefix before views/ (e.g. the file is
  // absolute or lives inside a sub-project like apps/web/src/views/...), also
  // look for the controller relative to that prefix.  This handles monorepo and
  // sub-project layouts where the controller sits at
  //   <prefix>/controllers/<Name>Controller.ts
  // rather than at the workspace root.
  const beforeViews = normalized.slice(0, viewsIdx);
  if (beforeViews.length > 0) {
    candidates.push(join(beforeViews, 'controllers', fileName));
  }

  return candidates;
}

/**
 * Returns the absolute, forward-slash normalised path of the owning controller
 * file, or null if no controller file is found on disk.
 */
export function findOwningController(
  tmvcFilePath: string,
  workspaceRoot: string,
): string | null {
  const candidates = getControllerCandidatePaths(tmvcFilePath, workspaceRoot);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate.replace(/\\/g, '/');
    }
  }
  return null;
}

/**
 * Returns the ordered candidate paths for an explicitly named controller (from
 * an `@model from Controller.action` directive), mirroring
 * getControllerCandidatePaths but using the supplied name rather than deriving
 * it from the view path. Includes the sibling-of-views location so sub-project
 * layouts resolve.
 */
export function getControllerCandidatePathsByName(
  controllerName: string,
  tmvcFilePath: string,
  workspaceRoot: string,
): string[] {
  if (controllerName.length === 0) return [];
  const fileName = controllerName + '.ts';

  const candidates = [
    join(workspaceRoot, 'src', 'controllers', fileName),
    join(workspaceRoot, 'controllers', fileName),
    join(workspaceRoot, 'src', fileName),
  ];

  const normalized = tmvcFilePath.replace(/\\/g, '/');
  const viewsIdx = normalized.indexOf('views/');
  if (viewsIdx > 0) {
    candidates.push(join(normalized.slice(0, viewsIdx), 'controllers', fileName));
  }

  return candidates;
}

/**
 * Resolves an explicitly named controller to its absolute, forward-slash path.
 * Returns the first candidate that exists on disk; if none exist, returns the
 * first candidate anyway (best effort) so the generated import surfaces a
 * visible "cannot find module" error rather than silently falling back to an
 * untyped context. Returns null only when no candidates can be formed.
 */
export function findControllerByName(
  controllerName: string,
  tmvcFilePath: string,
  workspaceRoot: string,
): string | null {
  const candidates = getControllerCandidatePathsByName(
    controllerName,
    tmvcFilePath,
    workspaceRoot,
  );
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate.replace(/\\/g, '/');
    }
  }
  return (candidates[0] ?? '').replace(/\\/g, '/') || null;
}

// ---------------------------------------------------------------------------
// Component resolution (issue 046: call-site prop checking)
// ---------------------------------------------------------------------------

/**
 * Ordered candidate paths for a component file named `<Name>.tmvc`, searching
 * the component directories the runtime globs use, plus the sibling-of-views
 * location for sub-project layouts.
 */
export function getComponentCandidatePathsByName(
  componentName: string,
  tmvcFilePath: string,
  workspaceRoot: string,
): string[] {
  if (componentName.length === 0) return [];
  const fileName = componentName + '.tmvc';

  const candidates = [
    join(workspaceRoot, 'src', 'components', fileName),
    join(workspaceRoot, 'components', fileName),
  ];

  const normalized = tmvcFilePath.replace(/\\/g, '/');
  const viewsIdx = normalized.indexOf('views/');
  if (viewsIdx > 0) {
    candidates.push(join(normalized.slice(0, viewsIdx), 'components', fileName));
  }

  return candidates;
}

/**
 * Resolves a component name to its absolute, forward-slash `.tmvc` path. Returns
 * the first existing candidate, or the first candidate as a best effort so an
 * unresolved component still produces a visible "cannot find module" error.
 */
export function findComponentByName(
  componentName: string,
  tmvcFilePath: string,
  workspaceRoot: string,
): string | null {
  const candidates = getComponentCandidatePathsByName(
    componentName,
    tmvcFilePath,
    workspaceRoot,
  );
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate.replace(/\\/g, '/');
    }
  }
  return (candidates[0] ?? '').replace(/\\/g, '/') || null;
}

// ---------------------------------------------------------------------------
// Component usage scanner (issue 046)
// ---------------------------------------------------------------------------

/** A prop on a component usage, as JS plus an optional mappable expression. */
interface UsageProp {
  /** Generated JS for the value, e.g. '(context.model.total)', '"items"', 'true'. */
  readonly valueJs: string;
  /** Prop name. */
  readonly name: string;
  /** Source offset of the inner expression (expr props only) for equal-length mapping. */
  readonly exprSourceOffset: number;
  /** Length of the inner expression text (0 when not an expr prop). */
  readonly exprLength: number;
}

/** A component tag usage found in markup. */
export interface ComponentUsage {
  readonly name: string;
  /** Source offset of the tag name (the char after '<'). */
  readonly nameOffset: number;
  readonly props: readonly UsageProp[];
  readonly hasChildren: boolean;
}

// Scans an expression starting after '${' (at `start`); returns the inner text
// span and the index past the closing '}'. Bracket/quote/template aware.
function scanExprSpan(
  source: string,
  start: number,
): { inner: string; innerStart: number; end: number } | null {
  const n = source.length;
  let i = start;
  let depth = 1;
  while (i < n) {
    const ch = source[i] ?? '';
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"' || ch === "'") {
      const q = ch; i++;
      while (i < n) { const c = source[i] ?? ''; if (c === '\\') { i += 2; continue; } if (c === q) { i++; break; } i++; }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < n) { const c = source[i] ?? ''; if (c === '\\') { i += 2; continue; } if (c === '`') { i++; break; } i++; }
      continue;
    }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; if (depth === 0) return { inner: source.slice(start, i), innerStart: start, end: i + 1 }; i++; continue; }
    i++;
  }
  return null;
}

/**
 * Scans top-level PascalCase component tags in markup, returning each usage with
 * its props and whether it has projected children. Only pure-expression props
 * (`name="${expr}"`) carry a source offset for mapping; static and boolean props
 * are emitted as literals. Tags inside ${...} expressions or nested components
 * are not scanned (top-level usages only, per issue 046 scope).
 */
export function scanComponentUsages(source: string): ComponentUsage[] {
  const usages: ComponentUsage[] = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const ch = source[i] ?? '';

    if (ch === '$' && (source[i + 1] ?? '') === '{') {
      const span = scanExprSpan(source, i + 2);
      if (span === null) break;
      i = span.end;
      continue;
    }

    if (ch === '<' && /[A-Z]/u.test(source[i + 1] ?? '')) {
      const parsed = scanOneUsage(source, i);
      if (parsed !== null) {
        usages.push(parsed.usage);
        i = parsed.end;
        continue;
      }
    }

    i++;
  }

  return usages;
}

// Parses a single component tag at `start` (pointing at '<') into a structured
// usage. Returns null if it is not a parseable component tag.
function scanOneUsage(
  source: string,
  start: number,
): { usage: ComponentUsage; end: number } | null {
  const n = source.length;
  let i = start + 1;
  const nameOffset = i;
  let name = '';
  while (i < n && /\w/u.test(source[i] ?? '')) { name += source[i] ?? ''; i++; }
  if (name.length === 0 || !/^[A-Z]/u.test(name)) return null;

  const props: UsageProp[] = [];

  while (i < n) {
    while (i < n && /\s/u.test(source[i] ?? '')) i++;
    const ch = source[i] ?? '';

    if (ch === '/' && (source[i + 1] ?? '') === '>') {
      return { usage: { name, nameOffset, props, hasChildren: false }, end: i + 2 };
    }
    if (ch === '>') {
      // Paired tag: detect non-whitespace children, then find the close.
      const scanned = scanComponentChildrenLocal(source, i + 1, name);
      if (scanned === null) return null;
      const hasChildren = scanned.childrenRaw.trim().length > 0;
      return { usage: { name, nameOffset, props, hasChildren }, end: scanned.end };
    }

    if (!/[a-zA-Z_]/u.test(ch)) return null;
    let attrName = '';
    while (i < n && /[a-zA-Z0-9_-]/u.test(source[i] ?? '')) { attrName += source[i] ?? ''; i++; }
    while (i < n && /[ \t]/u.test(source[i] ?? '')) i++;

    if ((source[i] ?? '') !== '=') {
      props.push({ name: attrName, valueJs: 'true', exprSourceOffset: 0, exprLength: 0 });
      continue;
    }
    i++; // '='
    const quote = source[i] ?? '';
    if (quote !== '"' && quote !== "'") return null;
    i++;

    const valueStart = i;
    // Pure single-expression value: ${ ... } filling the whole attribute.
    if ((source[i] ?? '') === '$' && (source[i + 1] ?? '') === '{') {
      const span = scanExprSpan(source, i + 2);
      if (span === null) return null;
      if ((source[span.end] ?? '') === quote) {
        props.push({
          name: attrName,
          valueJs: `(${span.inner})`,
          exprSourceOffset: span.innerStart,
          exprLength: span.inner.length,
        });
        i = span.end + 1;
        continue;
      }
    }
    // Otherwise consume to the closing quote and emit as a string literal
    // (static) -- not individually mapped.
    let raw = '';
    i = valueStart;
    while (i < n) {
      const vc = source[i] ?? '';
      if (vc === '\\') { raw += vc + (source[i + 1] ?? ''); i += 2; continue; }
      if (vc === quote) { i++; break; }
      raw += vc; i++;
    }
    const isStatic = !raw.includes('${');
    props.push({
      name: attrName,
      valueJs: isStatic ? JSON.stringify(raw) : `\`${raw.replace(/`/gu, '\\`')}\``,
      exprSourceOffset: 0,
      exprLength: 0,
    });
  }

  return null;
}

// Lightweight children-span finder for the usage scanner (mirrors the vite
// plugin's scanComponentChildren but local to the volar module).
function scanComponentChildrenLocal(
  source: string,
  start: number,
  tagName: string,
): { childrenRaw: string; end: number } | null {
  const n = source.length;
  const closeOpen = `</${tagName}`;
  let i = start;
  while (i < n) {
    const ch = source[i] ?? '';
    if (ch === '$' && (source[i + 1] ?? '') === '{') {
      const span = scanExprSpan(source, i + 2);
      if (span === null) return null;
      i = span.end;
      continue;
    }
    if (ch === '<') {
      if (source.slice(i, i + closeOpen.length) === closeOpen) {
        const boundary = source[i + closeOpen.length] ?? '';
        if (boundary === '>' || /\s/u.test(boundary)) {
          let k = i + closeOpen.length;
          while (k < n && /\s/u.test(source[k] ?? '')) k++;
          if ((source[k] ?? '') === '>') {
            return { childrenRaw: source.slice(start, i), end: k + 1 };
          }
        }
      }
      if (/[A-Z]/u.test(source[i + 1] ?? '')) {
        const nested = scanOneUsage(source, i);
        if (nested !== null) { i = nested.end; continue; }
      }
    }
    i++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Virtual TypeScript generation
// ---------------------------------------------------------------------------

/** The output of generating a virtual TypeScript file from a .tmvc source. */
export interface TmvcGeneratedTs {
  /** The full virtual TypeScript source code. */
  readonly code: string;
  /** The offset in `code` where the escaped .tmvc content begins. */
  readonly preambleLength: number;
  /** Absolute controller path (forward slashes) or null. */
  readonly controllerPath: string | null;
  /**
   * Extra source mappings for the injected component prop-check block (issue
   * 046). Each maps a prop expression in the check to its source expression so
   * a type error surfaces on the real expression in the .tmvc file. Empty when
   * no component checks were generated.
   */
  readonly extraMappings: readonly TmvcMapping[];
}

// Builds the non-executed prop-check block for component usages and records:
//  - exprs:    equal-length mappings for each prop expression and the tag name
//              (precise wrong-type positioning and tag navigation).
//  - argSpans: unequal-length mappings from each generated `{ ... }` argument
//              object back to the source tag name, so missing-required-prop
//              errors (which TypeScript reports on the argument) surface on the
//              tag. genLen is the generated argument length; srcLen the tag name.
function buildCheckBlock(usages: readonly ComponentUsage[]): {
  text: string;
  exprs: { genRel: number; srcOffset: number; len: number }[];
  argSpans: { genRel: number; genLen: number; srcOffset: number; srcLen: number }[];
} {
  const exprs: { genRel: number; srcOffset: number; len: number }[] = [];
  const argSpans: { genRel: number; genLen: number; srcOffset: number; srcLen: number }[] = [];
  let text = '  if (false) {\n';

  for (const u of usages) {
    text += '    __Cmp_';
    // Map the source tag name to the <Name> token here so hover and
    // go-to-definition on the tag navigate to the component (via the import).
    exprs.push({ genRel: text.length, srcOffset: u.nameOffset, len: u.name.length });
    text += `${u.name}(`;
    const argStart = text.length; // position of the opening '{'
    text += '{ ';
    let first = true;
    for (const p of u.props) {
      if (!first) text += ', ';
      first = false;
      text += `${p.name}: `;
      if (p.exprLength > 0) {
        const inner = p.valueJs.slice(1, -1); // strip the wrapping parens
        text += '(';
        exprs.push({ genRel: text.length, srcOffset: p.exprSourceOffset, len: p.exprLength });
        text += inner + ')';
      } else {
        text += p.valueJs;
      }
    }
    if (u.hasChildren) {
      if (!first) text += ', ';
      text += 'children: (undefined as unknown as Fragment)';
    }
    text += ' }';
    const argEnd = text.length; // position just past the closing '}'
    argSpans.push({
      genRel: argStart,
      genLen: argEnd - argStart,
      srcOffset: u.nameOffset,
      srcLen: u.name.length,
    });
    text += ');\n';
  }

  text += '  }\n';
  return { text, exprs, argSpans };
}

// Shared tail for controller-derived model typing: extract the model type from
// the action's IView<T> return and expose it as TypedViewContext<__TmvcData>.
// `strict` selects how the action's return type is read:
//   - false (convention): structural match `{ action(...args): infer R }`, which
//     silently falls back to Record when the action does not exist.
//   - true (@model from): indexed access ['action'], so a missing action surfaces
//     a TypeScript error in the .tmvc file.
function buildControllerPreamble(
  relImport: string,
  controllerName: string,
  actionName: string,
  strict: boolean,
): string {
  const actionReturn = strict
    ? `type __ActionReturn = ReturnType<InstanceType<typeof __OwnerController>['${actionName}']>;\n`
    : 'type __ActionReturn = InstanceType<typeof __OwnerController> extends\n' +
      `  { ${actionName}(...args: any[]): infer R } ? R : never;\n`;

  return (
    PREAMBLE_IMPORTS_TYPED +
    `import type { ${controllerName} as __OwnerController } from '${relImport}';\n` +
    '\n' +
    actionReturn +
    // Distributive conditional over the IView<T> union: TypeScript distributes
    // when V is a naked type parameter, so view/partial members yield the model
    // type while redirect/empty members yield never.
    'type __ExtractModel<V> = V extends\n' +
    "  { readonly kind: 'view' | 'partial'; readonly model: infer M | null } ? NonNullable<M> : never;\n" +
    'type __TmvcData = __ExtractModel<__ActionReturn> extends never\n' +
    '  ? Record<string, unknown>\n' +
    '  : __ExtractModel<__ActionReturn>;\n' +
    '\n' +
    'export default function render(context: TypedViewContext<__TmvcData>): Fragment {\n' +
    '  return html`'
  );
}

// Preamble for `@model <type-expression>`: the model type is the raw expression
// verbatim (may use import(...) type syntax). No controller lookup.
function buildRawTypePreamble(expr: string): string {
  return (
    PREAMBLE_IMPORTS_TYPED +
    `type __TmvcData = ${expr};\n` +
    '\n' +
    'export default function render(context: TypedViewContext<__TmvcData>): Fragment {\n' +
    '  return html`'
  );
}

/**
 * Generates the virtual TypeScript code for a .tmvc source file.
 *
 * An `@model` directive, when present, drives the context model type:
 *   - `@model from Controller.action` types from that action's IView<T> return
 *     (ownerControllerPath must be the resolved controller, supplied by caller).
 *   - `@model <type-expression>` uses the raw type verbatim, no controller.
 *
 * Without a directive, the model type is derived from the convention-resolved
 * ownerControllerPath (action name = view filename). When that is null too, the
 * context is typed as the base ViewContext from '@typemvc/core'.
 *
 * When `componentImports` (component name -> relative `.tmvc` import path) is
 * supplied for a view, component usages are checked against each component's
 * prop contract by importing its render function and emitting a non-executed
 * prop-check block (issue 046).
 */
export function generateVirtualTs(
  source: string,
  tmvcFilePath: string,
  ownerControllerPath: string | null,
  componentImports?: ReadonlyMap<string, string>,
): TmvcGeneratedTs {
  const { body, directive } = extractDirective(source);
  const normalizedPath = tmvcFilePath.replace(/\\/g, '/');
  const isComponent = normalizedPath.includes('/components/');

  // A @local block (component only) lifts to function-scope statements that tsc
  // type-checks; the markup it came from is blanked.
  const localBlock = isComponent ? extractLocalBlock(body) : null;
  const escaped = escapeTmvcMarkup(localBlock !== null ? localBlock.markup : body);

  let preamble: string;
  let localBlockMapping: TmvcMapping | null = null;

  if (isComponent) {
    let base = directive?.kind === 'props'
      ? buildComponentPropsPreamble(directive.expr)
      : PREAMBLE_IMPORTS_COMPONENT + PREAMBLE_RENDER_COMPONENT;
    if (localBlock !== null) {
      // Import the reactivity primitives after the html import.
      base = base.replace(
        "import { html } from '@typemvc/core';\n",
        "import { html } from '@typemvc/core';\n" + PREAMBLE_REACTIVITY,
      );
      // Splice the lifted statements in just before `  return html\``, and map the
      // block source region to the lifted region (equal length, so a type error
      // lands on the real expression in the .tmvc file).
      const retIdx = base.lastIndexOf(RETURN_HTML);
      base = base.slice(0, retIdx) + localBlock.statements + '\n' + base.slice(retIdx);
      localBlockMapping = {
        sourceOffsets: [localBlock.sourceStart],
        generatedOffsets: [retIdx],
        lengths: [localBlock.statements.length],
        data: ALL_FEATURES,
      };
    }
    preamble = base;
  } else if (directive?.kind === 'model-type') {
    preamble = buildRawTypePreamble(directive.expr);
  } else if (ownerControllerPath !== null) {
    const tmvcDir = pathDirname(normalizedPath);
    const controllerNoExt = ownerControllerPath
      .replace(/\\/g, '/')
      .replace(/\.ts$/, '');

    const controllerParts = controllerNoExt.split('/').filter((p) => p.length > 0);
    const controllerName = controllerParts.at(-1);

    if (controllerName === undefined) {
      return generateVirtualTs(source, tmvcFilePath, null, componentImports);
    }

    const relImport = computeRelativeImport(tmvcDir, controllerNoExt);
    const basename = normalizedPath.split('/').pop() ?? '';
    const fromDirective = directive?.kind === 'model-from' ? directive : null;
    const actionName = fromDirective ? fromDirective.action : basename.replace(/\.tmvc$/, '');

    preamble = buildControllerPreamble(
      relImport,
      controllerName,
      actionName,
      fromDirective !== null,
    );
  } else {
    preamble = PREAMBLE_IMPORTS + PREAMBLE_RENDER_NO_CONTROLLER;
  }

  let extraMappings: readonly TmvcMapping[] = [];

  // Component call-site checking (views only). Inject component imports before
  // the render function and a prop-check block before the `return html`.
  if (!isComponent && componentImports !== undefined && componentImports.size > 0) {
    const RETURN_LINE = '  return html`';
    const usages = scanComponentUsages(body).filter((u) => componentImports.has(u.name));
    if (usages.length > 0) {
      const names = [...new Set(usages.map((u) => u.name))];
      const importLines = names
        .map((nm) => `import __Cmp_${nm} from '${componentImports.get(nm) ?? ''}';\n`)
        .join('');

      const fnIdx = preamble.indexOf('export default function render');
      if (fnIdx !== -1) {
        preamble = preamble.slice(0, fnIdx) + importLines + preamble.slice(fnIdx);
      }

      const { text: checkText, exprs, argSpans } = buildCheckBlock(usages);
      const retIdx = preamble.lastIndexOf(RETURN_LINE);
      if (retIdx !== -1) {
        preamble = preamble.slice(0, retIdx) + checkText + preamble.slice(retIdx);
        // Equal-length mappings first (precise wrong-type and tag navigation),
        // then the unequal-length argument-object mappings. Order matters: an
        // expression offset is matched by its own mapping before the broader
        // argument mapping, preserving precise wrong-type positioning; a
        // missing-prop error at the '{' (outside every expression mapping)
        // falls through to the argument mapping and lands on the tag name.
        extraMappings = [
          ...exprs.map((e) => ({
            sourceOffsets: [e.srcOffset],
            generatedOffsets: [retIdx + e.genRel],
            lengths: [e.len],
            data: ALL_FEATURES,
          })),
          ...argSpans.map((a) => ({
            sourceOffsets: [a.srcOffset],
            generatedOffsets: [retIdx + a.genRel],
            lengths: [a.srcLen],
            generatedLengths: [a.genLen],
            data: ALL_FEATURES,
          })),
        ];
      }
    }
  }

  if (localBlockMapping !== null) {
    extraMappings = [...extraMappings, localBlockMapping];
  }

  const code = preamble + escaped + VIRTUAL_SUFFIX;

  return { code, preambleLength: preamble.length, controllerPath: ownerControllerPath, extraMappings };
}

// ---------------------------------------------------------------------------
// Source-level diagnostics
// ---------------------------------------------------------------------------

/**
 * A diagnostic reported directly on .tmvc source (not via the virtual file).
 * Columns are zero-based; the range covers the offending line. Carries the
 * forbidden-construct and @local rules that are not TypeScript type errors.
 */
export interface TmvcDiagnostic {
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly message: string;
  readonly severity: 'error';
}

/**
 * Runs the .tmvc validator and returns its findings as editor diagnostics with
 * `[TypeMVC]` messages. The file id enforces the components-only `@local` rule;
 * the in-block denylist applies regardless. The VS Code extension surfaces these
 * alongside the TypeScript errors derived from the virtual file.
 */
export function getTmvcDiagnostics(source: string, fileName: string): TmvcDiagnostic[] {
  return validateTmvcSource(source, fileName).map((err) => ({
    line: err.line - 1,
    startColumn: 0,
    endColumn: err.source.length,
    message: '[TypeMVC] ' + describeValidationError(err),
    severity: 'error' as const,
  }));
}

// ---------------------------------------------------------------------------
// Snapshot factory
// ---------------------------------------------------------------------------

/**
 * Creates a TmvcSnapshot from a plain string.
 * Used by tests and by the VS Code extension when constructing virtual files.
 */
export function createTmvcSnapshot(content: string): TmvcSnapshot {
  return {
    getText: (start: number, end: number): string => content.slice(start, end),
    getLength: (): number => content.length,
    getChangeRange: (): TmvcTextChangeRange | undefined => undefined,
  };
}

// ---------------------------------------------------------------------------
// Source mapping builder
// ---------------------------------------------------------------------------

function buildMappings(
  source: string,
  escaped: string,
  preambleLength: number,
): readonly TmvcMapping[] {
  if (source.length === 0) return [];

  // Map the full content region as a single segment. This is an approximation:
  // escaping can shift offsets slightly, but it covers all expressions and
  // gives the language service enough information to resolve positions.
  const mappedLength = Math.min(source.length, escaped.length);
  if (mappedLength === 0) return [];

  return [
    {
      sourceOffsets: [0],
      generatedOffsets: [preambleLength],
      lengths: [mappedLength],
      data: ALL_FEATURES,
    },
  ];
}

// ---------------------------------------------------------------------------
// Virtual code factory (internal)
// ---------------------------------------------------------------------------

function makeVirtualCode(
  source: string,
  tmvcFilePath: string,
  controllerPath: string | null,
  componentImports?: ReadonlyMap<string, string>,
): TmvcVirtualCode {
  const { code, preambleLength, extraMappings } = generateVirtualTs(
    source,
    tmvcFilePath,
    controllerPath,
    componentImports,
  );
  const escaped = escapeTmvcMarkup(source);
  const snapshot = createTmvcSnapshot(code);
  const mappings = [...buildMappings(source, escaped, preambleLength), ...extraMappings];

  return { id: 'main', languageId: 'typescript', snapshot, mappings };
}

/**
 * Resolves the components used in a view to relative `.tmvc` import paths
 * (component name -> import path). Returns an empty map for component files
 * (call-site checking applies to views only). Unresolved names still get a
 * best-effort path so a "cannot find module" error surfaces.
 */
function resolveComponentImports(
  source: string,
  fileName: string,
  workspaceRoot: string,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const normalized = fileName.replace(/\\/g, '/');
  if (normalized.includes('/components/')) return map;

  const tmvcDir = pathDirname(normalized);
  for (const usage of scanComponentUsages(source)) {
    if (map.has(usage.name)) continue;
    const compPath = findComponentByName(usage.name, fileName, workspaceRoot);
    if (compPath === null) continue;
    const noExt = compPath.replace(/\.tmvc$/, '');
    map.set(usage.name, computeRelativeImport(tmvcDir, noExt) + '.tmvc');
  }
  return map;
}

/**
 * Resolves the controller path that generateVirtualTs should import for a view.
 * An `@model from Controller.action` directive resolves the named controller;
 * otherwise the owning controller is found by the filename convention. (A
 * `@model <type>` directive needs no controller, so the convention result is
 * harmless and ignored downstream.)
 */
function resolveControllerPath(
  source: string,
  fileName: string,
  workspaceRoot: string,
): string | null {
  const { directive } = extractDirective(source);
  if (directive?.kind === 'model-from') {
    return findControllerByName(directive.controller, fileName, workspaceRoot);
  }
  return findOwningController(fileName, workspaceRoot);
}

// ---------------------------------------------------------------------------
// Language plugin factory
// ---------------------------------------------------------------------------

/** Options for the TypeMVC Volar language plugin. */
export interface TmvcVolarPluginOptions {
  /**
   * Workspace root directory used for owning controller discovery.
   * Defaults to process.cwd().
   */
  readonly workspaceRoot?: string;
}

/**
 * Creates a Volar-compatible language plugin for .tmvc files.
 *
 * The returned plugin's interface mirrors @volar/language-core 2.x
 * LanguagePlugin and can be registered directly with @volar/vscode in the
 * VS Code extension to provide completions, type errors, hover, and
 * go-to-definition inside .tmvc files.
 *
 * When the owning controller is found by convention (§5.2), the virtual file
 * derives a typed context from the controller action's IView<T> return type.
 */
export function createTmvcLanguagePlugin(
  options?: TmvcVolarPluginOptions,
): TmvcLanguagePlugin {
  const workspaceRoot = options?.workspaceRoot ?? process.cwd();

  return {
    getLanguageId(fileName: string): string | undefined {
      return fileName.endsWith('.tmvc') ? 'tmvc' : undefined;
    },

    createVirtualCode(
      fileName: string,
      languageId: string,
      snapshot: TmvcSnapshot,
    ): TmvcVirtualCode | undefined {
      if (languageId !== 'tmvc') return undefined;
      const source = snapshot.getText(0, snapshot.getLength());
      const controllerPath = resolveControllerPath(source, fileName, workspaceRoot);
      const componentImports = resolveComponentImports(source, fileName, workspaceRoot);
      return makeVirtualCode(source, fileName, controllerPath, componentImports);
    },

    updateVirtualCode(
      fileName: string,
      _virtualCode: TmvcVirtualCode,
      snapshot: TmvcSnapshot,
    ): TmvcVirtualCode {
      const source = snapshot.getText(0, snapshot.getLength());
      const controllerPath = resolveControllerPath(source, fileName, workspaceRoot);
      const componentImports = resolveComponentImports(source, fileName, workspaceRoot);
      return makeVirtualCode(source, fileName, controllerPath, componentImports);
    },
  };
}
