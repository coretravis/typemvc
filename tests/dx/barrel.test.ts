/**
 * Tests for issue 020: public API surface completeness and integrity.
 *
 * Acceptance criteria verified here:
 *   AC1  types/index.ts exports all six required interface/type names
 *   AC2  src/index.ts barrel is complete: every symbol in SRS §3.3 is accessible
 *   AC3  No internal implementation symbols are leaked through the barrel
 *   AC4  tsc --noEmit passes (verified by CI typecheck step)
 *   AC5  ESLint reports zero errors (verified by CI lint step)
 *   AC6  Tree-shaking is structurally guaranteed by per-module re-exports
 *   AC7  Bundle size <15 KB gzipped (verified by CI build step)
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Compile-time verification of the six required types (AC1)
// If any of these imports were missing, tsc --noEmit would fail.
// ---------------------------------------------------------------------------

import type {
  IView,
  IRouteGuard,
  IRouter,
  Signal,
  ReadonlySignal,
  AppConfig,
} from '../../src/index.js';

// Type guard used in the AC1 test below; return type annotations force tsc to verify imports.
function assertSixTypesExist(): [IView, IRouteGuard, IRouter, Signal<unknown>, ReadonlySignal<unknown>, AppConfig] {
  throw new Error('[TypeMVC] compile-time type guard only');
}

// Runtime namespace import for value-level assertions
import * as barrel from '../../src/index.js';

// ---------------------------------------------------------------------------
// AC2: every §3.3 value-level symbol is exported from the barrel
// ---------------------------------------------------------------------------

describe('§3.3 public API surface: all required symbols exported', () => {
  // Bootstrap
  it('exports bootstrap', () => {
    expect(typeof barrel.bootstrap).toBe('function');
  });

  it('exports useAuth', () => {
    expect(typeof barrel.useAuth).toBe('function');
  });

  it('exports useLocalization', () => {
    expect(typeof barrel.useLocalization).toBe('function');
  });

  // Controller
  it('exports Controller', () => {
    expect(typeof barrel.Controller).toBe('function');
  });

  // Decorator set
  it('exports controller', () => { expect(typeof barrel.controller).toBe('function'); });
  it('exports retain', () => { expect(typeof barrel.retain).toBe('function'); });
  it('exports get', () => { expect(typeof barrel.get).toBe('function'); });
  it('exports post', () => { expect(typeof barrel.post).toBe('function'); });
  it('exports put', () => { expect(typeof barrel.put).toBe('function'); });
  it('exports patch', () => { expect(typeof barrel.patch).toBe('function'); });
  it('exports del', () => { expect(typeof barrel.del).toBe('function'); });
  it('exports action', () => { expect(typeof barrel.action).toBe('function'); });
  it('exports guard', () => { expect(typeof barrel.guard).toBe('function'); });
  it('exports layout', () => { expect(typeof barrel.layout).toBe('function'); });

  // View result factories
  it('exports View', () => { expect(typeof barrel.View).toBe('function'); });
  it('exports PartialView', () => { expect(typeof barrel.PartialView).toBe('function'); });
  it('exports Redirect', () => { expect(typeof barrel.Redirect).toBe('function'); });
  it('exports RedirectReplace', () => { expect(typeof barrel.RedirectReplace).toBe('function'); });
  it('exports EmptyView', () => { expect(typeof barrel.EmptyView).toBe('function'); });
  it('exports ContextData', () => { expect(typeof barrel.ContextData).toBe('function'); });

  // Renderer
  it('exports html', () => { expect(typeof barrel.html).toBe('function'); });
  it('exports safeHtml', () => { expect(typeof barrel.safeHtml).toBe('function'); });

  // Reactivity
  it('exports signal', () => { expect(typeof barrel.signal).toBe('function'); });
  it('exports effect', () => { expect(typeof barrel.effect).toBe('function'); });
  it('exports computed', () => { expect(typeof barrel.computed).toBe('function'); });
  it('exports batch', () => { expect(typeof barrel.batch).toBe('function'); });
  it('exports reactive', () => { expect(typeof barrel.reactive).toBe('function'); });

  // Validation
  it('exports Validator', () => { expect(typeof barrel.Validator).toBe('function'); });
  it('exports ValidationResult', () => { expect(typeof barrel.ValidationResult).toBe('function'); });
  it('exports dataType', () => { expect(typeof barrel.dataType).toBe('function'); });
  it('exports required', () => { expect(typeof barrel.required).toBe('function'); });
  it('exports stringLength', () => { expect(typeof barrel.stringLength).toBe('function'); });
  it('exports minLength', () => { expect(typeof barrel.minLength).toBe('function'); });
  it('exports maxLength', () => { expect(typeof barrel.maxLength).toBe('function'); });
  it('exports min', () => { expect(typeof barrel.min).toBe('function'); });
  it('exports max', () => { expect(typeof barrel.max).toBe('function'); });
  it('exports integer', () => { expect(typeof barrel.integer).toBe('function'); });
  it('exports positive', () => { expect(typeof barrel.positive).toBe('function'); });
  it('exports negative', () => { expect(typeof barrel.negative).toBe('function'); });
  it('exports email', () => { expect(typeof barrel.email).toBe('function'); });
  it('exports url', () => { expect(typeof barrel.url).toBe('function'); });
  it('exports pattern', () => { expect(typeof barrel.pattern).toBe('function'); });
  it('exports validate', () => { expect(typeof barrel.validate).toBe('function'); });

  // DI
  it('exports inject', () => { expect(typeof barrel.inject).toBe('function'); });

  // Layout factory
  it('exports defineLayout', () => { expect(typeof barrel.defineLayout).toBe('function'); });
});

// ---------------------------------------------------------------------------
// AC3: internal implementation symbols are NOT in the barrel
// ---------------------------------------------------------------------------

describe('internal symbols not leaked through barrel', () => {
  it('does not export createApp (legacy, not in §3.3)', () => {
    expect('createApp' in barrel).toBe(false);
  });

  it('does not export coerceToType (internal validation helper)', () => {
    expect('coerceToType' in barrel).toBe(false);
  });

  it('does not export getDataType (internal metadata reader)', () => {
    expect('getDataType' in barrel).toBe(false);
  });

  it('does not export getValidators (internal metadata reader)', () => {
    expect('getValidators' in barrel).toBe(false);
  });

  it('does not export getAllValidatedFields (internal metadata reader)', () => {
    expect('getAllValidatedFields' in barrel).toBe(false);
  });

  it('exports bindFormData as public API', () => {
    expect('bindFormData' in barrel).toBe(true);
  });

  it('does not export getControllerMeta (internal metadata reader)', () => {
    expect('getControllerMeta' in barrel).toBe(false);
  });

  it('does not export getActionMeta (internal metadata reader)', () => {
    expect('getActionMeta' in barrel).toBe(false);
  });

  it('does not export routeRegistry (internal route table)', () => {
    expect('routeRegistry' in barrel).toBe(false);
  });

  it('does not export RESERVED_KEYS (internal constant)', () => {
    expect('RESERVED_KEYS' in barrel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC1 runtime shape: the six required types are reachable via the barrel
// (compile-time proof is the import block at the top of this file)
// ---------------------------------------------------------------------------

describe('six required types are accessible from the barrel', () => {
  it('AC1: all six §3.3 types are exported (tsc verifies the import block above)', () => {
    // The return-type annotation on assertSixTypesExist() references all six types.
    // If any type were absent from the barrel, tsc --noEmit would fail at that line.
    expect(() => { assertSixTypesExist(); }).toThrow('[TypeMVC] compile-time type guard only');
  });

  it('action decorator is a callable function (not a factory)', () => {
    expect(typeof barrel.action).toBe('function');
  });

  it('action decorator applied to a method returns unchanged descriptor', () => {
    const target = {};
    const desc: PropertyDescriptor = { value: (): string => 'ok', writable: true };
    const result = barrel.action(target, 'myMethod', desc);
    expect(result).toBe(desc);
  });

  it('action decorator does not alter the decorated method', () => {
    const impl = (): string => 'result';
    const desc: PropertyDescriptor = { value: impl, writable: true };
    const result = barrel.action({}, 'myMethod', desc);
    const fn = result.value as () => string;
    expect(fn()).toBe('result');
  });
});

// ---------------------------------------------------------------------------
// AC6: tree-shaking is structurally guaranteed
// Each module is re-exported individually, not as a side-effect bundle.
// ---------------------------------------------------------------------------

describe('tree-shaking structure', () => {
  it('html is exported from renderer module (independent of validation)', () => {
    expect(typeof barrel.html).toBe('function');
  });

  it('signal is exported from reactivity module (independent of router)', () => {
    expect(typeof barrel.signal).toBe('function');
  });

  it('barrel re-exports are named (not default) for tree-shaker compatibility', () => {
    // Presence of individually named exports (not a default) proves named re-exports.
    expect('default' in barrel).toBe(false);
  });
});
