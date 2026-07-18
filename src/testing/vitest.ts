/**
 * Optional Vitest matchers for TypeMVC tests (issue 051). Import this entry once
 * (in a test or setup file) to register the matchers:
 *
 * ```ts
 * import '@typemvc/core/testing/vitest';
 * expect(result).toBeView('users/index');
 * expect(errors).toHaveValidationError('name');
 * ```
 */

import { expect } from 'vitest';
import type { IView } from '../types/index.js';
import { isView, isPartialView, isRedirect, isRedirectReplace, isEmpty } from './index.js';

interface MatcherOutcome {
  pass: boolean;
  message: () => string;
}

function isIView(value: unknown): value is IView {
  return value !== null && typeof value === 'object' && 'kind' in value;
}

// Accepts either an IView or a harness result ({ result: IView }).
function asView(received: unknown): IView | null {
  if (isIView(received)) return received;
  if (received !== null && typeof received === 'object' && 'result' in received) {
    const inner = received.result;
    if (isIView(inner)) return inner;
  }
  return null;
}

// Accepts an errors record or a harness result ({ errors: record }).
function asErrors(received: unknown): Readonly<Record<string, string>> {
  if (received !== null && typeof received === 'object' && 'errors' in received) {
    const inner = received.errors;
    if (inner !== null && typeof inner === 'object') return inner as Record<string, string>;
  }
  if (received !== null && typeof received === 'object') {
    return received as Record<string, string>;
  }
  return {};
}

function describe(received: unknown): string {
  const view = asView(received);
  return view === null ? JSON.stringify(received) : view.kind;
}

expect.extend({
  toBeView(received: unknown, path?: string): MatcherOutcome {
    const view = asView(received);
    const pass = view !== null && isView(view, path);
    return {
      pass,
      message: () =>
        `expected ${describe(received)} ${pass ? 'not ' : ''}to be a view${path === undefined ? '' : ` at "${path}"`}`,
    };
  },
  toBePartialView(received: unknown, path?: string): MatcherOutcome {
    const view = asView(received);
    const pass = view !== null && isPartialView(view, path);
    return {
      pass,
      message: () =>
        `expected ${describe(received)} ${pass ? 'not ' : ''}to be a partial view${path === undefined ? '' : ` at "${path}"`}`,
    };
  },
  toRedirectTo(received: unknown, path: string): MatcherOutcome {
    const view = asView(received);
    const pass = view !== null && isRedirect(view, path);
    return {
      pass,
      message: () => `expected ${describe(received)} ${pass ? 'not ' : ''}to redirect to "${path}"`,
    };
  },
  toRedirectReplace(received: unknown, path: string): MatcherOutcome {
    const view = asView(received);
    const pass = view !== null && isRedirectReplace(view, path);
    return {
      pass,
      message: () => `expected ${describe(received)} ${pass ? 'not ' : ''}to redirect-replace to "${path}"`,
    };
  },
  toBeEmptyView(received: unknown): MatcherOutcome {
    const view = asView(received);
    const pass = view !== null && isEmpty(view);
    return {
      pass,
      message: () => `expected ${describe(received)} ${pass ? 'not ' : ''}to be an empty view`,
    };
  },
  toHaveValidationError(received: unknown, field: string, message?: string): MatcherOutcome {
    const errors = asErrors(received);
    const actual = errors[field];
    const pass = actual !== undefined && (message === undefined || actual === message);
    return {
      pass,
      message: () =>
        message === undefined
          ? `expected a validation error on "${field}" ${pass ? '(found one)' : `(field errors: ${JSON.stringify(errors)})`}`
          : `expected "${field}" error to be "${message}" but was "${String(actual)}"`,
    };
  },
  toBeNavigationCancelled(received: unknown): MatcherOutcome {
    const pass = hasFlag(received, 'cancelled');
    return {
      pass,
      message: () => `expected navigation ${pass ? 'not ' : ''}to be cancelled by a guard`,
    };
  },
  toBeNotFound(received: unknown): MatcherOutcome {
    const pass = hasFlag(received, 'notFound');
    return {
      pass,
      message: () => `expected navigation ${pass ? 'not ' : ''}to be not-found`,
    };
  },
  toContainText(received: unknown, text: string): MatcherOutcome {
    const actual = asText(received);
    const pass = actual.includes(text);
    return {
      pass,
      message: () => `expected rendered text ${pass ? 'not ' : ''}to contain "${text}" (got "${actual}")`,
    };
  },
  toHaveText(received: unknown, text: string): MatcherOutcome {
    const actual = asText(received).trim();
    const pass = actual === text;
    return {
      pass,
      message: () => `expected rendered text ${pass ? 'not ' : ''}to equal "${text}" (got "${actual}")`,
    };
  },
});

// True when received (a NavigationResult) has the named boolean flag set.
function hasFlag(received: unknown, flag: 'cancelled' | 'notFound'): boolean {
  return received !== null && typeof received === 'object' && (received as Record<string, unknown>)[flag] === true;
}

// Extracts text from a string, a RenderedView (via text()), or a DOM node
// (via textContent).
function asText(received: unknown): string {
  if (typeof received === 'string') return received;
  if (received !== null && typeof received === 'object') {
    const obj = received as Record<string, unknown>;
    if (typeof obj.text === 'function') return String((obj.text as () => unknown).call(received));
    if (typeof obj.textContent === 'string') return obj.textContent;
  }
  return String(received);
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors vitest's own Assertion<T = any> signature so the declaration merges
  interface Assertion<T = any> {
    toBeView(path?: string): T;
    toBePartialView(path?: string): T;
    toRedirectTo(path: string): T;
    toRedirectReplace(path: string): T;
    toBeEmptyView(): T;
    toHaveValidationError(field: string, message?: string): T;
    toBeNavigationCancelled(): T;
    toBeNotFound(): T;
    toContainText(text: string): T;
    toHaveText(text: string): T;
  }
  interface AsymmetricMatchersContaining {
    toBeView(path?: string): unknown;
    toBePartialView(path?: string): unknown;
    toRedirectTo(path: string): unknown;
    toRedirectReplace(path: string): unknown;
    toBeEmptyView(): unknown;
    toHaveValidationError(field: string, message?: string): unknown;
    toBeNavigationCancelled(): unknown;
    toBeNotFound(): unknown;
    toContainText(text: string): unknown;
    toHaveText(text: string): unknown;
  }
}
