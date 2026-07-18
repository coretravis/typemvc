import { describe, it, expect } from 'vitest';
import { View, PartialView, Redirect, RedirectReplace, EmptyView } from '../../src/core/view.js';
import type { IView } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// View factory
// ---------------------------------------------------------------------------

describe('View factory', () => {
  it('View() returns kind "view" with null path and null model', () => {
    const v = View();
    expect(v.kind).toBe('view');
    if (v.kind === 'view') {
      expect(v.path).toBeNull();
      expect(v.model).toBeNull();
    }
  });

  it('View(model) returns kind "view" with null path and the provided model', () => {
    const model = { title: 'All Users' };
    const v = View(model);
    expect(v.kind).toBe('view');
    if (v.kind === 'view') {
      expect(v.path).toBeNull();
      expect(v.model).toBe(model);
    }
  });

  it('View(path) returns kind "view" with the explicit path and null model', () => {
    const v = View('shared/error');
    expect(v.kind).toBe('view');
    if (v.kind === 'view') {
      expect(v.path).toBe('shared/error');
      expect(v.model).toBeNull();
    }
  });

  it('View(path, model) returns kind "view" with explicit path and provided model', () => {
    const model = { title: 'Error' };
    const v = View('shared/error', model);
    expect(v.kind).toBe('view');
    if (v.kind === 'view') {
      expect(v.path).toBe('shared/error');
      expect(v.model).toBe(model);
    }
  });

  it('View("/absolute/path", model) stores the absolute path unchanged', () => {
    const model = { x: 1 };
    const v = View('/absolute/path/to/view', model);
    expect(v.kind).toBe('view');
    if (v.kind === 'view') {
      expect(v.path).toBe('/absolute/path/to/view');
    }
  });

  it('View() null path is the sentinel for convention-based resolution', () => {
    const withConvention = View();
    const withExplicit = View('users/index');
    expect(withConvention.kind === 'view' && withConvention.path).toBeNull();
    expect(withExplicit.kind === 'view' && withExplicit.path).toBe('users/index');
  });
});

// ---------------------------------------------------------------------------
// PartialView factory
// ---------------------------------------------------------------------------

describe('PartialView factory', () => {
  it('PartialView(path) returns kind "partial" with the given path and null model', () => {
    const v = PartialView('users/user-row');
    expect(v.kind).toBe('partial');
    if (v.kind === 'partial') {
      expect(v.path).toBe('users/user-row');
      expect(v.model).toBeNull();
    }
  });

  it('PartialView(path, model) returns kind "partial" with path and provided model', () => {
    const model = { name: 'Alice' };
    const v = PartialView('users/user-row', model);
    expect(v.kind).toBe('partial');
    if (v.kind === 'partial') {
      expect(v.path).toBe('users/user-row');
      expect(v.model).toBe(model);
    }
  });
});

// ---------------------------------------------------------------------------
// Redirect factory
// ---------------------------------------------------------------------------

describe('Redirect factory', () => {
  it('Redirect(path) returns kind "redirect" with the target path', () => {
    const v = Redirect('/users');
    expect(v.kind).toBe('redirect');
    expect(v.path).toBe('/users');
  });

  it('Redirect has replace: false (push-history mode)', () => {
    const v = Redirect('/users');
    expect(v.replace).toBe(false);
  });

  it('Redirect stores dynamic path segments', () => {
    const id = '42';
    const v = Redirect(`/users/${id}`);
    expect(v.path).toBe('/users/42');
  });
});

// ---------------------------------------------------------------------------
// RedirectReplace factory
// ---------------------------------------------------------------------------

describe('RedirectReplace factory', () => {
  it('RedirectReplace(path) returns kind "redirect-replace" with the target path', () => {
    const v = RedirectReplace('/login');
    expect(v.kind).toBe('redirect-replace');
    expect(v.path).toBe('/login');
  });

  it('RedirectReplace has replace: true (replace-history mode)', () => {
    const v = RedirectReplace('/login');
    expect(v.replace).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EmptyView factory
// ---------------------------------------------------------------------------

describe('EmptyView factory', () => {
  it('EmptyView() returns kind "empty"', () => {
    const v = EmptyView();
    expect(v.kind).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// IView type discrimination (AC: dispatcher can discriminate all five types)
// ---------------------------------------------------------------------------

describe('IView type discrimination', () => {
  it('dispatcher switch on kind handles all five variants', () => {
    const views: IView[] = [
      View(),
      View({ title: 'home' }),
      PartialView('some/path'),
      Redirect('/go'),
      RedirectReplace('/replace'),
      EmptyView(),
    ];

    const kinds: string[] = [];
    for (const view of views) {
      switch (view.kind) {
        case 'view':
          kinds.push('view');
          break;
        case 'partial':
          kinds.push('partial');
          break;
        case 'redirect':
          kinds.push('redirect');
          break;
        case 'redirect-replace':
          kinds.push('redirect-replace');
          break;
        case 'empty':
          kinds.push('empty');
          break;
      }
    }

    expect(kinds).toEqual(['view', 'view', 'partial', 'redirect', 'redirect-replace', 'empty']);
  });

  it('Redirect and RedirectReplace are distinct kinds (not unified)', () => {
    const push = Redirect('/a');
    const replace = RedirectReplace('/b');
    expect(push.kind).not.toBe(replace.kind);
  });

  it('Redirect replace field is false; RedirectReplace replace field is true', () => {
    const push = Redirect('/a');
    const replace = RedirectReplace('/b');
    expect(push.replace).toBe(false);
    expect(replace.replace).toBe(true);
  });

  it('EmptyView signals the dispatcher to skip rendering', () => {
    const v = EmptyView();
    expect(v.kind).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// Public barrel exports
// ---------------------------------------------------------------------------

describe('public barrel exports', () => {
  it('all five factories and IView are exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.View).toBeDefined();
    expect(barrel.PartialView).toBeDefined();
    expect(barrel.Redirect).toBeDefined();
    expect(barrel.RedirectReplace).toBeDefined();
    expect(barrel.EmptyView).toBeDefined();
  });
});
