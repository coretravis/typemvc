export type ParamType = 'string' | 'number' | 'boolean';

export interface ParameterDef {
  readonly name: string;
  readonly type: ParamType;
  readonly index: number;
}

export interface BindingError {
  readonly paramName: string;
  readonly message: string;
}

export type BindingResult =
  | { readonly kind: 'ok'; readonly args: readonly unknown[] }
  | { readonly kind: 'error'; readonly errors: readonly BindingError[] };

export interface BindingSources {
  readonly routeParams: Readonly<Record<string, string>>;
  readonly queryParams: URLSearchParams;
  readonly body: unknown;
  readonly isBodyVerb: boolean;
}

export function bindActionParameters(
  defs: readonly ParameterDef[],
  sources: BindingSources,
): BindingResult {
  if (defs.length === 0) {
    return { kind: 'ok', args: [] };
  }

  const sorted = [...defs].sort((a, b) => a.index - b.index);
  let maxIndex = 0;
  for (const def of sorted) {
    if (def.index > maxIndex) maxIndex = def.index;
  }
  const args: unknown[] = new Array(maxIndex + 1);
  const errors: BindingError[] = [];
  const matched = new Set<number>();

  const routeLower = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(sources.routeParams)) {
    routeLower[key.toLowerCase()] = value;
  }

  const queryLower = Object.create(null) as Record<string, string>;
  for (const [key, value] of sources.queryParams.entries()) {
    const lkey = key.toLowerCase();
    if (!(lkey in queryLower)) {
      queryLower[lkey] = value;
    }
  }

  for (const def of sorted) {
    const nameLower = def.name.toLowerCase();

    const routeValue = routeLower[nameLower];
    if (routeValue !== undefined) {
      const result = coerce(def.type, def.name, routeValue);
      if (result.kind === 'error') {
        errors.push({ paramName: def.name, message: result.message });
      } else {
        args[def.index] = result.value;
        matched.add(def.index);
      }
      continue;
    }

    const queryValue = queryLower[nameLower];
    if (queryValue !== undefined) {
      const result = coerce(def.type, def.name, queryValue);
      if (result.kind === 'error') {
        errors.push({ paramName: def.name, message: result.message });
      } else {
        args[def.index] = result.value;
        matched.add(def.index);
      }
    }
  }

  if (sources.isBodyVerb && sources.body !== undefined && sources.body !== null) {
    let lastUnmatched: ParameterDef | undefined;
    for (const def of sorted) {
      if (!matched.has(def.index)) {
        lastUnmatched = def;
      }
    }
    if (lastUnmatched !== undefined) {
      args[lastUnmatched.index] = sources.body;
    }
  }

  if (errors.length > 0) {
    return { kind: 'error', errors };
  }
  return { kind: 'ok', args };
}

type CoerceResult =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'error'; readonly message: string };

function coerce(type: ParamType, name: string, value: string): CoerceResult {
  if (type === 'string') {
    return { kind: 'ok', value };
  }
  if (type === 'number') {
    const result = Number(value);
    if (Number.isNaN(result)) {
      return {
        kind: 'error',
        message: `[TypeMVC] Parameter binding failed: cannot coerce value for "${name}" to number.`,
      };
    }
    return { kind: 'ok', value: result };
  }
  return { kind: 'ok', value: value === 'true' };
}
