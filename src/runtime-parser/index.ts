import { html } from '../renderer/html.js';
import type { Fragment } from '../renderer/fragment.js';
import type { ViewContext, TmvcViewFunction } from '../types/index.js';
import {
  validateTmvcSource,
  escapeTmvcMarkup,
  rewriteComponentTags,
  describeValidationError,
  extractDirective,
  extractLocalBlock,
} from '../vite-plugin/index.js';
import { _callComponent } from '../core/component-registry.js';
import { signal, computed, effect, batch, onCleanup } from '../reactivity/signal.js';

// Internal alias for the typed raw function produced by new Function(). The
// reactivity primitives are passed as parameters
type RawViewFn = (
  h: typeof html,
  cc: typeof _callComponent,
  s: typeof signal,
  c: typeof computed,
  e: typeof effect,
  b: typeof batch,
  oc: typeof onCleanup,
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
  const { body: directiveStripped } = extractDirective(source);
  // Lift a @local block to function-scope statements
  const localBlock = extractLocalBlock(directiveStripped);
  const markupSource = localBlock !== null ? localBlock.markup : directiveStripped;
  const rewritten = rewriteComponentTags(markupSource);
  const escaped = escapeTmvcMarkup(rewritten);
  const statements = localBlock !== null ? localBlock.statements + '\n' : '';
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
    rawFn(html, _callComponent, signal, computed, effect, batch, onCleanup, context);
}
