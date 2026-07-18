import { describe, it, expect } from 'vitest';
import { resolveViewPath, DEFAULT_VIEWS_ROOT } from '../../src/core/view-resolution.js';

// ---------------------------------------------------------------------------
// Convention resolution: controller name to folder
// ---------------------------------------------------------------------------

describe('convention resolution:controller name to folder', () => {
  it('strips Controller suffix and lowercases a single-word name', () => {
    const result = resolveViewPath(null, 'UsersController', 'index', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/users/index.tmvc');
  });

  it('converts PascalCase multi-word name to kebab-case (AdminUsersController)', () => {
    const result = resolveViewPath(null, 'AdminUsersController', 'index', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/admin-users/index.tmvc');
  });

  it('converts three-word PascalCase to kebab-case', () => {
    const result = resolveViewPath(null, 'SuperAdminDashboardController', 'index', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/super-admin-dashboard/index.tmvc');
  });

  it('handles a controller whose name has no Controller suffix', () => {
    const result = resolveViewPath(null, 'Products', 'list', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/products/list.tmvc');
  });

  it('handles a two-word name without Controller suffix', () => {
    const result = resolveViewPath(null, 'AdminUsers', 'show', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/admin-users/show.tmvc');
  });
});

// ---------------------------------------------------------------------------
// Convention resolution: action name
// ---------------------------------------------------------------------------

describe('convention resolution:action name', () => {
  it('lowercases the action name', () => {
    const result = resolveViewPath(null, 'UsersController', 'Details', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/users/details.tmvc');
  });

  it('lowercases camelCase action names without inserting dashes', () => {
    const result = resolveViewPath(null, 'UsersController', 'getAll', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/users/getall.tmvc');
  });

  it('builds the full convention path (viewsRoot + folder + action + .tmvc)', () => {
    const result = resolveViewPath(null, 'ProductsController', 'details', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/products/details.tmvc');
  });
});

// ---------------------------------------------------------------------------
// Explicit relative path
// ---------------------------------------------------------------------------

describe('explicit relative path', () => {
  it('prepends viewsRoot for a relative path', () => {
    const result = resolveViewPath('shared/error', 'UsersController', 'index', DEFAULT_VIEWS_ROOT);
    expect(result).toBe('views/shared/error');
  });

  it('prepends a custom viewsRoot for a relative path', () => {
    const result = resolveViewPath('shared/not-found', 'UsersController', 'index', 'templates/');
    expect(result).toBe('templates/shared/not-found');
  });

  it('does not append .tmvc to explicit relative paths', () => {
    const result = resolveViewPath('partials/header', 'UsersController', 'index', DEFAULT_VIEWS_ROOT);
    expect(result).not.toMatch(/\.tmvc$/);
    expect(result).toBe('views/partials/header');
  });
});

// ---------------------------------------------------------------------------
// Explicit absolute path
// ---------------------------------------------------------------------------

describe('explicit absolute path', () => {
  it('returns the absolute path unchanged, ignoring viewsRoot', () => {
    const result = resolveViewPath(
      '/absolute/path/to/view',
      'UsersController',
      'index',
      DEFAULT_VIEWS_ROOT,
    );
    expect(result).toBe('/absolute/path/to/view');
  });

  it('absolute path with a custom viewsRoot still bypasses the root', () => {
    const result = resolveViewPath(
      '/templates/special',
      'UsersController',
      'index',
      'views/',
    );
    expect(result).toBe('/templates/special');
  });

  it('does not modify absolute paths that already include a file extension', () => {
    const result = resolveViewPath(
      '/views/users/custom.tmvc',
      'UsersController',
      'index',
      DEFAULT_VIEWS_ROOT,
    );
    expect(result).toBe('/views/users/custom.tmvc');
  });
});

// ---------------------------------------------------------------------------
// AppConfig.viewsRoot customisation
// ---------------------------------------------------------------------------

describe('AppConfig.viewsRoot customisation', () => {
  it('uses a custom views root with a trailing slash', () => {
    const result = resolveViewPath(null, 'UsersController', 'index', 'templates/');
    expect(result).toBe('templates/users/index.tmvc');
  });

  it('normalises a custom views root without a trailing slash', () => {
    const result = resolveViewPath(null, 'UsersController', 'index', 'templates');
    expect(result).toBe('templates/users/index.tmvc');
  });

  it('uses an empty viewsRoot (no prefix)', () => {
    const result = resolveViewPath(null, 'UsersController', 'index', '');
    expect(result).toBe('users/index.tmvc');
  });

  it('relative explicit path also respects the custom viewsRoot', () => {
    const result = resolveViewPath('shared/error', 'UsersController', 'index', 'tpl/');
    expect(result).toBe('tpl/shared/error');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_VIEWS_ROOT export
// ---------------------------------------------------------------------------

describe('DEFAULT_VIEWS_ROOT', () => {
  it('is "views/"', () => {
    expect(DEFAULT_VIEWS_ROOT).toBe('views/');
  });
});
