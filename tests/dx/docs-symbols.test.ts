import { describe, it, expect } from 'vitest';
import * as barrel from '../../src/index.js';
import {
  View,
  PartialView,
  Redirect,
  RedirectReplace,
  EmptyView,
  signal,
  computed,
  effect,
} from '../../src/index.js';

// The documentation references public symbols by name and shows code that uses the
// public API. This suite verifies those names against the barrel and compiles a
// representative set of the documented shapes, so prose and examples cannot drift
// from the exported surface without a failing test.

describe('documentation symbol drift guard', () => {
  it('exports every public symbol the documentation references', () => {
    const expected = [
      'bootstrap',
      'Controller',
      'controller',
      'retain',
      'get',
      'post',
      'put',
      'patch',
      'del',
      'action',
      'body',
      'guard',
      'layout',
      'title',
      'pending',
      'failure',
      'View',
      'PartialView',
      'Redirect',
      'RedirectReplace',
      'EmptyView',
      'ContextData',
      'signal',
      'effect',
      'computed',
      'batch',
      'onCleanup',
      'untrack',
      'reactive',
      'html',
      'svg',
      'Fragment',
      'safeHtml',
      'SafeHtml',
      'prevent',
      'stop',
      'keyed',
      'keyedMap',
      'keyedList',
      'inject',
      'ROUTER',
      'defineLayout',
      'Validator',
      'ValidationResult',
      'bindFormData',
      'useForm',
      'dataType',
      'required',
      'stringLength',
      'minLength',
      'maxLength',
      'min',
      'max',
      'integer',
      'positive',
      'negative',
      'email',
      'url',
      'pattern',
      'validate',
      'LOGGER_FACTORY',
    ];
    for (const name of expected) {
      expect(barrel, `barrel should export ${name}`).toHaveProperty(name);
    }
  });

  it('uses the current view-result names, not the drifted short names', () => {
    expect(barrel).toHaveProperty('PartialView');
    expect(barrel).toHaveProperty('RedirectReplace');
    expect(barrel).toHaveProperty('EmptyView');
    expect(barrel).not.toHaveProperty('Partial');
    expect(barrel).not.toHaveProperty('Replace');
    expect(barrel).not.toHaveProperty('Empty');
  });

  it('does not export the removed plugin stubs', () => {
    expect(barrel).not.toHaveProperty('useAuth');
    expect(barrel).not.toHaveProperty('useLocalization');
  });
});

describe('documentation scenarios compile and behave', () => {
  it('the documented view-result factories return their discriminants', () => {
    expect(View().kind).toBe('view');
    expect(PartialView('users/row').kind).toBe('partial');
    expect(Redirect('/dashboard').kind).toBe('redirect');
    expect(RedirectReplace('/dashboard').kind).toBe('redirect-replace');
    expect(EmptyView().kind).toBe('empty');
  });

  it('the documented reactivity API drives a computed', () => {
    const count = signal(0);
    const doubled = computed(() => count.get() * 2);
    let observed = -1;
    const dispose = effect(() => {
      observed = count.get();
    });
    count.set(3);
    expect(doubled.get()).toBe(6);
    expect(observed).toBe(0); // effect re-runs on the next flush, not synchronously
    dispose();
  });
});
