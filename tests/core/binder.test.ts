import { describe, it, expect } from 'vitest';
import { bindActionParameters } from '../../src/core/binder.js';
import type { ParameterDef, BindingSources } from '../../src/core/binder.js';

function makeSources(partial?: Partial<BindingSources>): BindingSources {
  return {
    routeParams: {},
    queryParams: new URLSearchParams(),
    body: null,
    isBodyVerb: false,
    ...partial,
  };
}

describe('bindActionParameters - route segment binding', () => {
  it('binds a route param to the matching action parameter by name', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ routeParams: { id: '42' } }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('42');
    }
  });

  it('binds route param case-insensitively (URL key uppercase)', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ routeParams: { ID: '42' } }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('42');
    }
  });

  it('binds route param case-insensitively (param name uppercase)', () => {
    const defs: ParameterDef[] = [{ name: 'Id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ routeParams: { id: '42' } }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('42');
    }
  });

  it('binds multiple route params in correct index slots', () => {
    const defs: ParameterDef[] = [
      { name: 'orderId', type: 'string', index: 1 },
      { name: 'id', type: 'string', index: 0 },
    ];
    const result = bindActionParameters(defs, makeSources({
      routeParams: { id: 'user1', orderId: 'order9' },
    }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('user1');
      expect(result.args[1]).toBe('order9');
    }
  });
});

describe('bindActionParameters - query string binding', () => {
  it('binds a query param to a remaining action parameter', () => {
    const defs: ParameterDef[] = [{ name: 'page', type: 'number', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ queryParams: new URLSearchParams('page=2') }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe(2);
    }
  });

  it('binds query param case-insensitively (query key uppercase)', () => {
    const defs: ParameterDef[] = [{ name: 'page', type: 'number', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ queryParams: new URLSearchParams('PAGE=3') }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe(3);
    }
  });

  it('route param takes priority over query param with the same name', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({
      routeParams: { id: 'route-value' },
      queryParams: new URLSearchParams('id=query-value'),
    }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('route-value');
    }
  });
});

describe('bindActionParameters - body binding', () => {
  it('last unmatched param on a body verb receives the body', () => {
    const body = { name: 'Alice' };
    const defs: ParameterDef[] = [
      { name: 'id', type: 'string', index: 0 },
      { name: 'model', type: 'string', index: 1 },
    ];
    const result = bindActionParameters(defs, makeSources({
      routeParams: { id: '42' },
      body,
      isBodyVerb: true,
    }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('42');
      expect(result.args[1]).toBe(body);
    }
  });

  it('body is not bound when isBodyVerb is false', () => {
    const body = { name: 'Alice' };
    const defs: ParameterDef[] = [{ name: 'model', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ body, isBodyVerb: false }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBeUndefined();
    }
  });

  it('body is not bound when all params are already matched', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({
      routeParams: { id: '42' },
      body: { name: 'Alice' },
      isBodyVerb: true,
    }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('42');
    }
  });

  it('body is not bound when body is null', () => {
    const defs: ParameterDef[] = [{ name: 'model', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ body: null, isBodyVerb: true }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBeUndefined();
    }
  });
});

describe('bindActionParameters - type coercion', () => {
  it('string parameters pass through unmodified', () => {
    const defs: ParameterDef[] = [{ name: 'name', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ routeParams: { name: 'hello world' } }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('hello world');
    }
  });

  it('number parameters are coerced from route string', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'number', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ routeParams: { id: '42' } }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe(42);
      expect(typeof result.args[0]).toBe('number');
    }
  });

  it('number parameters are coerced from query string', () => {
    const defs: ParameterDef[] = [{ name: 'page', type: 'number', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ queryParams: new URLSearchParams('page=5') }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe(5);
    }
  });

  it('NaN coercion results in a binding error', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'number', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ routeParams: { id: 'not-a-number' } }));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.errors.at(0)?.paramName).toBe('id');
      expect(result.errors.at(0)?.message).toContain('[TypeMVC]');
    }
  });

  it('NaN from query string also results in a binding error', () => {
    const defs: ParameterDef[] = [{ name: 'page', type: 'number', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ queryParams: new URLSearchParams('page=abc') }));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.errors.at(0)?.paramName).toBe('page');
    }
  });

  it('boolean "true" coerces to true', () => {
    const defs: ParameterDef[] = [{ name: 'active', type: 'boolean', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ queryParams: new URLSearchParams('active=true') }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe(true);
    }
  });

  it('boolean non-"true" values coerce to false', () => {
    const defs: ParameterDef[] = [{ name: 'active', type: 'boolean', index: 0 }];
    for (const val of ['false', '0', '1', 'yes', 'TRUE', '']) {
      const result = bindActionParameters(defs, makeSources({
        queryParams: new URLSearchParams(`active=${val}`),
      }));
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.args[0]).toBe(false);
      }
    }
  });
});

describe('bindActionParameters - optional parameters', () => {
  it('returns undefined for a param with no matching source', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources());
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBeUndefined();
    }
  });

  it('binds the value when the optional param is present in route', () => {
    const defs: ParameterDef[] = [{ name: 'id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, makeSources({ routeParams: { id: '42' } }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('42');
    }
  });
});

describe('bindActionParameters - edge cases', () => {
  it('returns empty args for empty defs', () => {
    const result = bindActionParameters([], makeSources());
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args).toHaveLength(0);
    }
  });

  it('priority order: route > query > body', () => {
    const body = { id: 'body-id' };
    const defs: ParameterDef[] = [{ name: 'id', type: 'string', index: 0 }];
    const result = bindActionParameters(defs, {
      routeParams: { id: 'route-id' },
      queryParams: new URLSearchParams('id=query-id'),
      body,
      isBodyVerb: true,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.args[0]).toBe('route-id');
    }
  });

  it('multiple NaN errors are all collected', () => {
    const defs: ParameterDef[] = [
      { name: 'a', type: 'number', index: 0 },
      { name: 'b', type: 'number', index: 1 },
    ];
    const result = bindActionParameters(defs, makeSources({
      routeParams: { a: 'bad', b: 'alsobad' },
    }));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.errors).toHaveLength(2);
    }
  });
});
