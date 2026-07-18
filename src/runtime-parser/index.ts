import { html, svg } from '../renderer/html.js';
import type { Fragment } from '../renderer/fragment.js';
import type { ViewContext, TmvcViewFunction } from '../types/index.js';
import {
  validateTmvcSource,
  escapeTmvcMarkup,
  rewriteComponentTags,
  rewriteLocalComponentTags,
  describeValidationError,
  extractDirective,
  extractLocalBlock,
  blankHtmlComments,
  hasTypeAnnotation,
} from '../vite-plugin/index.js';
import { _callComponent } from '../core/component-registry.js';
import { signal, computed, effect, batch, onCleanup } from '../reactivity/signal.js';
import { useForm } from '../validation/form.js';
import { keyed, keyedMap } from '../renderer/keyed.js';
import { safeHtml } from '../renderer/safe-html.js';
import { stop, prevent } from '../renderer/modifiers.js';
import { persisted, mediaQuery, hotkey, clickOutside } from '../behaviors/index.js';

// Internal alias for the typed raw function produced by new Function(). The
// renderer helpers and reactivity primitives are passed as parameters, mirroring
// the scope the Vite plugin gives a generated module.
type RawViewFn = (
  h: typeof html,
  cc: typeof _callComponent,
  s: typeof signal,
  c: typeof computed,
  e: typeof effect,
  b: typeof batch,
  oc: typeof onCleanup,
  uf: typeof useForm,
  sv: typeof svg,
  k: typeof keyed,
  km: typeof keyedMap,
  sh: typeof safeHtml,
  st: typeof stop,
  pv: typeof prevent,
  ps: typeof persisted,
  mq: typeof mediaQuery,
  hk: typeof hotkey,
  co: typeof clickOutside,
  ctx: ViewContext,
) => Fragment;

/**
 * Parses a .tmvc view source string and returns a TmvcViewFunction.
 *
 * This is the zero-build alternative to the Vite plugin. It evaluates view
 * expressions at runtime using new Function().
 *
 * IMPORTANT: The application's Content-Security-Policy must include
 * 'unsafe-eval' in the script-src directive. Without it, this function throws
 * a descriptive [TypeMVC] error at parse time.
 *
 * @param source - The raw .tmvc file content as a string.
 * @returns A TmvcViewFunction: (context: ViewContext) => Fragment
 */
export function parseTmvc(source: string): TmvcViewFunction {
  const errors = validateTmvcSource(source);
  if (errors.length > 0) {
    const first = errors[0];
    if (first === undefined) {
      throw new Error('[TypeMVC] .tmvc validation failed.');
    }
    throw new Error(
      '[TypeMVC] .tmvc parse error at line ' +
        String(first.line) +
        ': ' +
        describeValidationError(first),
    );
  }

  // Strip the @model/@props directive (Volar-only type hint) before evaluating.
  const { body: directiveStripped, uses } = extractDirective(source);

  // @use compiles to an import in the build pipeline. The zero-build parser has
  // no bundler to resolve one, so reject it with a clear message rather than
  // leaving the binding undefined at runtime.
  if (uses.length > 0) {
    throw new Error(
      '[TypeMVC] @use is not supported by the zero-build runtime parser, which ' +
        'cannot resolve module imports. Build the .tmvc file with the Vite plugin, ' +
        'or pass the value through the view context instead.',
    );
  }

  // Lift a @local block to function-scope statements
  const localBlock = extractLocalBlock(directiveStripped);

  // The runtime parser evaluates statements as plain JavaScript with no type
  // stripping. A typed declaration such as `signal<number>(0)` would evaluate to
  // garbage rather than a Signal, so reject type syntax with a clear message.
  if (localBlock !== null && hasTypeAnnotation(localBlock.statements)) {
    throw new Error(
      '[TypeMVC] TypeScript type annotations in a @local block are not supported ' +
        'by the zero-build runtime parser, which cannot strip types. Remove the ' +
        'annotations, or build the .tmvc file with the Vite plugin, which type ' +
        'checks and strips them.',
    );
  }
  const markupSource = localBlock !== null ? localBlock.markup : directiveStripped;
  const rewritten = rewriteComponentTags(blankHtmlComments(markupSource));
  const escaped = escapeTmvcMarkup(rewritten);
  // Component tags inside html`` or svg`` literals in a @local block are rewritten
  // too, so a reactive list of components renders under the zero-build parser.
  const statements =
    localBlock !== null ? rewriteLocalComponentTags(localBlock.statements) + '\n' : '';
  const body = statements + 'return html`' + escaped + '`';

  let rawFn: RawViewFn;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- new Function() is the zero-build runtime evaluation path required by SRS §14
    const unsafeRaw: unknown = new Function(
      'html',
      '_callComponent',
      'signal',
      'computed',
      'effect',
      'batch',
      'onCleanup',
      'useForm',
      'svg',
      'keyed',
      'keyedMap',
      'safeHtml',
      'stop',
      'prevent',
      'persisted',
      'mediaQuery',
      'hotkey',
      'clickOutside',
      'context',
      body,
    );
    rawFn = unsafeRaw as RawViewFn;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      "[TypeMVC] Failed to create view function. " +
        "Ensure the Content-Security-Policy includes 'unsafe-eval' in script-src, " +
        'and that the view expressions are valid JavaScript. ' +
        'Original error: ' +
        msg,
      { cause: err },
    );
  }

  return (context: ViewContext): Fragment =>
    rawFn(
      html,
      _callComponent,
      signal,
      computed,
      effect,
      batch,
      onCleanup,
      useForm,
      svg,
      keyed,
      keyedMap,
      safeHtml,
      stop,
      prevent,
      persisted,
      mediaQuery,
      hotkey,
      clickOutside,
      context,
    );
}
