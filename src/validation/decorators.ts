import { ValidationResult, Validator } from './validator.js';
export { ValidationResult, Validator };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The supported runtime type hint for DTO properties. */
export type DataType = 'string' | 'number' | 'boolean' | 'date';

/**
 * The internal validator function signature used for both built-in decorators
 * and the @validate(instance) wrapper.
 */
export type FieldValidator = (value: unknown, allValues: Record<string, unknown>) => ValidationResult;

/**
 * The result of coercing a raw form string to a declared DataType.
 * ok=false means coercion failed and is itself a validation failure.
 */
export type CoercionResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Internal metadata storage
// ---------------------------------------------------------------------------

interface FieldMeta {
  dataType: DataType | undefined;
  dataTypeMessage: string | undefined;
  validators: FieldValidator[];
}

// WeakMap keyed on class prototype (consistent with experimentalDecorators style).
const fieldMetaStore = new WeakMap<object, Record<string, FieldMeta>>();
// Ordered list of field names registered for a prototype (insertion order = source order).
const fieldNamesStore = new WeakMap<object, string[]>();

function getOrCreateFieldMeta(proto: object, key: string): FieldMeta {
  let record = fieldMetaStore.get(proto);
  if (record === undefined) {
    record = Object.create(null) as Record<string, FieldMeta>;
    fieldMetaStore.set(proto, record);
  }
  let meta = (record as Record<string, FieldMeta | undefined>)[key];
  if (meta === undefined) {
    meta = { dataType: undefined, dataTypeMessage: undefined, validators: [] };
    record[key] = meta;
    trackFieldName(proto, key);
  }
  return meta;
}

function trackFieldName(proto: object, key: string): void {
  let names = fieldNamesStore.get(proto);
  if (names === undefined) {
    names = [];
    fieldNamesStore.set(proto, names);
  }
  if (!names.includes(key)) {
    // Field names are tracked in source order. Because legacy decorators on a
    // single property are applied bottom-to-top, we record the name only on the
    // first encounter (whichever decorator fires first for that property). The
    // first encounter for a new field is guaranteed to be the bottom-most
    // decorator of that field.
    names.push(key);
  }
}

function addValidator(proto: object, key: string, validator: FieldValidator): void {
  const meta = getOrCreateFieldMeta(proto, key);
  // Legacy decorators apply bottom-to-top (the decorator closest to the property
  // runs first). Unshifting reverses that so the final array is in source
  // (top-to-bottom) order, matching the developer's reading expectation.
  meta.validators.unshift(validator);
}

// ---------------------------------------------------------------------------
// Metadata readers (consumed by the validation engine, issue 017)
// ---------------------------------------------------------------------------

/** Returns the declared DataType for a property, or undefined if none. */
export function getDataType(proto: object, propertyName: string): DataType | undefined {
  return fieldMetaStore.get(proto)?.[propertyName]?.dataType;
}

/** Returns the custom coercion error message for a property, or undefined if none. */
export function getDataTypeMessage(proto: object, propertyName: string): string | undefined {
  return fieldMetaStore.get(proto)?.[propertyName]?.dataTypeMessage;
}

/** Returns the ordered list of validators for a property (source order). */
export function getValidators(proto: object, propertyName: string): readonly FieldValidator[] {
  return fieldMetaStore.get(proto)?.[propertyName]?.validators ?? [];
}

/**
 * Returns all property names on a prototype that carry validation metadata,
 * in source (top-to-bottom) order.
 */
export function getAllValidatedFields(proto: object): readonly string[] {
  return fieldNamesStore.get(proto) ?? [];
}

// ---------------------------------------------------------------------------
// Coercion utility
// ---------------------------------------------------------------------------

/**
 * Coerces a raw form value to the declared DataType. When coercion fails,
 * `errorMessage` (from `@dataType`) replaces the default failure message.
 */
export function coerceToType(
  rawValue: unknown,
  type: DataType,
  errorMessage?: string,
): CoercionResult {
  if (type === 'string') {
    return { ok: true, value: rawValue };
  }

  if (type === 'number') {
    const n = Number(rawValue);
    if (Number.isNaN(n)) {
      return { ok: false, error: errorMessage ?? 'Must be a valid number.' };
    }
    return { ok: true, value: n };
  }

  if (type === 'boolean') {
    // A checkbox that is present sends a string. Absent = undefined/null = false.
    if (rawValue === null || rawValue === undefined) {
      return { ok: true, value: false };
    }
    return { ok: true, value: rawValue === 'true' };
  }

  // type === 'date'
  const d = new Date(String(rawValue));
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: errorMessage ?? 'Must be a valid date.' };
  }
  return { ok: true, value: d };
}

// ---------------------------------------------------------------------------
// Property decorator type alias
// ---------------------------------------------------------------------------

type PropDec = (target: object, key: string | symbol) => void;

// ---------------------------------------------------------------------------
// @dataType(type) - stores the runtime type hint
// ---------------------------------------------------------------------------

/**
 * Declares the runtime type of a DTO property. The model binder coerces the raw
 * form string to this type before any validator runs; a failed coercion is
 * itself a validation error.
 *
 * @param type - One of `'string'`, `'number'`, `'boolean'`, or `'date'`.
 * @param errorMessage - Optional message shown when coercion fails (for example
 *   a non-numeric value in a number field), replacing the default.
 */
export function dataType(type: DataType, errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    const meta = getOrCreateFieldMeta(target, String(key));
    meta.dataType = type;
    meta.dataTypeMessage = errorMessage;
  };
}

// ---------------------------------------------------------------------------
// Built-in validators
// ---------------------------------------------------------------------------

/**
 * Requires the value to be present: not null, undefined, or an empty string.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function required(errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (value === null || value === undefined || value === '') {
        return ValidationResult.fail(errorMessage ?? 'This field is required.');
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a string whose length is between `min` and `max` (inclusive).
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function stringLength(min: number, max: number, errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'string') return ValidationResult.ok();
      const len = value.length;
      if (len < min || len > max) {
        return ValidationResult.fail(errorMessage ?? `Must be between ${String(min)} and ${String(max)} characters.`);
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a string of at least `n` characters.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function minLength(n: number, errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'string') return ValidationResult.ok();
      if (value.length < n) {
        return ValidationResult.fail(errorMessage ?? `Must be at least ${String(n)} characters.`);
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a string of at most `n` characters.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function maxLength(n: number, errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'string') return ValidationResult.ok();
      if (value.length > n) {
        return ValidationResult.fail(errorMessage ?? `Must be at most ${String(n)} characters.`);
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a number greater than or equal to `n`.
 * @param errorMessage - Optional message replacing the default (and the
 *   type-guard message) on failure.
 */
export function min(n: number, errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'number') {
        return ValidationResult.fail(errorMessage ?? 'Must be a number.');
      }
      if (value < n) {
        return ValidationResult.fail(errorMessage ?? `Must be at least ${String(n)}.`);
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a number less than or equal to `n`.
 * @param errorMessage - Optional message replacing the default (and the
 *   type-guard message) on failure.
 */
export function max(n: number, errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'number') {
        return ValidationResult.fail(errorMessage ?? 'Must be a number.');
      }
      if (value > n) {
        return ValidationResult.fail(errorMessage ?? `Must be at most ${String(n)}.`);
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a whole number (no decimal part).
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function integer(errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'number') {
        return ValidationResult.fail(errorMessage ?? 'Must be a number.');
      }
      if (!Number.isInteger(value)) {
        return ValidationResult.fail(errorMessage ?? 'Must be a whole number.');
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a number greater than zero.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function positive(errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'number') {
        return ValidationResult.fail(errorMessage ?? 'Must be a number.');
      }
      if (value <= 0) {
        return ValidationResult.fail(errorMessage ?? 'Must be greater than zero.');
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires a number less than zero.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function negative(errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'number') {
        return ValidationResult.fail(errorMessage ?? 'Must be a number.');
      }
      if (value >= 0) {
        return ValidationResult.fail(errorMessage ?? 'Must be less than zero.');
      }
      return ValidationResult.ok();
    });
  };
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Requires a value in valid email address format.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function email(errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'string') return ValidationResult.ok();
      if (!EMAIL_REGEX.test(value)) {
        return ValidationResult.fail(errorMessage ?? 'Must be a valid email address.');
      }
      return ValidationResult.ok();
    });
  };
}

const URL_REGEX = /^https?:\/\/.+/;

/**
 * Requires a valid http or https URL.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function url(errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'string') return ValidationResult.ok();
      if (!URL_REGEX.test(value)) {
        return ValidationResult.fail(errorMessage ?? 'Must be a valid URL starting with http:// or https://.');
      }
      return ValidationResult.ok();
    });
  };
}

/**
 * Requires the value to match the supplied regular expression.
 * @param errorMessage - Optional message replacing the default on failure.
 */
export function pattern(regex: RegExp, errorMessage?: string): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value) => {
      if (typeof value !== 'string') return ValidationResult.ok();
      if (!regex.test(value)) {
        return ValidationResult.fail(errorMessage ?? 'Value does not match the required pattern.');
      }
      return ValidationResult.ok();
    });
  };
}

/** Delegates validation of a property to a custom {@link Validator} instance, enabling cross-field rules. */
export function validate(validatorInstance: Validator): PropDec {
  return function (target: object, key: string | symbol): void {
    addValidator(target, String(key), (value, allValues) => {
      return validatorInstance.validate(value, allValues);
    });
  };
}
