import { describe, it, expect } from 'vitest';
import { compileRoutePattern, matchRoute } from '../../src/router/matcher.js';

describe('compileRoutePattern', () => {
  it('matches the exact base path with no segment', () => {
    const compiled = compileRoutePattern('/users', '');
    expect(matchRoute(compiled, '/users')).not.toBeNull();
    expect(matchRoute(compiled, '/users/')).not.toBeNull();
    expect(matchRoute(compiled, '/other')).toBeNull();
  });

  it('compiles a required named parameter', () => {
    const compiled = compileRoutePattern('/users', '{id}');
    const match = matchRoute(compiled, '/users/42');
    expect(match).not.toBeNull();
    expect(match?.params.id).toBe('42');
  });

  it('does not match when a required parameter is absent', () => {
    const compiled = compileRoutePattern('/users', '{id}');
    expect(matchRoute(compiled, '/users')).toBeNull();
    expect(matchRoute(compiled, '/users/')).toBeNull();
  });

  it('compiles multiple required parameters', () => {
    const compiled = compileRoutePattern('/users', '{id}/orders/{orderId}');
    const match = matchRoute(compiled, '/users/42/orders/99');
    expect(match).not.toBeNull();
    expect(match?.params.id).toBe('42');
    expect(match?.params.orderId).toBe('99');
  });

  it('compiles a literal segment after a parameter', () => {
    const compiled = compileRoutePattern('/users', '{id}/games');
    const match = matchRoute(compiled, '/users/42/games');
    expect(match).not.toBeNull();
    expect(match?.params.id).toBe('42');
    expect(matchRoute(compiled, '/users/42/other')).toBeNull();
  });

  it('exposes all paramNames', () => {
    const compiled = compileRoutePattern('/users', '{id}/orders/{orderId}');
    expect(compiled.paramNames).toContain('id');
    expect(compiled.paramNames).toContain('orderId');
    expect(compiled.paramNames).toHaveLength(2);
  });

  it('optional parameter matches when present', () => {
    const compiled = compileRoutePattern('/users', '{id?}');
    const match = matchRoute(compiled, '/users/42');
    expect(match).not.toBeNull();
    expect(match?.params.id).toBe('42');
  });

  it('optional parameter returns no entry when absent', () => {
    const compiled = compileRoutePattern('/users', '{id?}');
    const match = matchRoute(compiled, '/users');
    expect(match).not.toBeNull();
    expect(match?.params.id).toBeUndefined();
  });

  it('marks optional params in optionalParams', () => {
    const compiled = compileRoutePattern('/users', '{id?}');
    expect(compiled.optionalParams.has('id')).toBe(true);
  });

  it('does not mark required params as optional', () => {
    const compiled = compileRoutePattern('/users', '{id}');
    expect(compiled.optionalParams.has('id')).toBe(false);
  });

  it('does not match extra path segments beyond the pattern', () => {
    const compiled = compileRoutePattern('/users', '{id}');
    expect(matchRoute(compiled, '/users/42/extra')).toBeNull();
  });

  it('compiles root path with no segment', () => {
    const compiled = compileRoutePattern('/', '');
    expect(matchRoute(compiled, '/')).not.toBeNull();
    expect(matchRoute(compiled, '/other')).toBeNull();
  });

  it('compiles a controller with a leading slash on basePath', () => {
    const compiled = compileRoutePattern('/articles', 'active');
    const match = matchRoute(compiled, '/articles/active');
    expect(match).not.toBeNull();
    expect(matchRoute(compiled, '/articles/other')).toBeNull();
  });
});

describe('matchRoute', () => {
  it('returns null for a non-matching URL', () => {
    const compiled = compileRoutePattern('/users', '{id}');
    expect(matchRoute(compiled, '/posts/42')).toBeNull();
  });

  it('returns params with all named groups', () => {
    const compiled = compileRoutePattern('/items', '{category}/{itemId}');
    const match = matchRoute(compiled, '/items/books/123');
    expect(match?.params.category).toBe('books');
    expect(match?.params.itemId).toBe('123');
  });

  it('returns empty params for a route with no parameters', () => {
    const compiled = compileRoutePattern('/about', '');
    const match = matchRoute(compiled, '/about');
    expect(match).not.toBeNull();
    expect(Object.keys(match?.params ?? {})).toHaveLength(0);
  });

  it('returns a prototype-free params record', () => {
    const compiled = compileRoutePattern('/users', '{id}');
    const match = matchRoute(compiled, '/users/42');
    expect(Object.getPrototypeOf(match?.params)).toBeNull();
  });
});
