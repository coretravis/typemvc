import { signal, computed } from '../reactivity/signal.js';
import type { Form, FormField, Signal } from '../types/index.js';
import {
  getAllValidatedFields,
  getDataType,
  getDataTypeMessage,
  getValidators,
  coerceToType,
  requiredError,
} from './decorators.js';

/**
 * The coerced snapshot of every field's current value, built the same way the
 * submit-path binder builds it: a field whose declared type coercion fails keeps
 * its raw value in `values` (so a sibling cross-field validator still sees it)
 * and records the coercion message in `coercionErrors`.
 */
interface FieldSnapshot {
  readonly values: Record<string, unknown>;
  readonly coercionErrors: Record<string, string>;
}

/** Reads the raw value the event target carries, matching what FormData would submit. */
function readTargetValue(event: Event): unknown {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    if (target.type === 'checkbox' || target.type === 'radio') {
      return target.checked ? target.value : '';
    }
    return target.value;
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return target.value;
  }
  return undefined;
}

/**
 * Builds eager, reactive form state over a DTO's existing validation decorators.
 *
 * One writable {@link Signal} is created per `@dataType`-or-validator-declared
 * field, seeded from `initial`. Each field's `error` is a `computed` that coerces
 * the field through the DTO's declared `@dataType` and then runs the DTO's own
 * validators, reusing the exact order and messages the submit-path binder uses,
 * so the eager and submit paths never disagree about a field's error. Because a
 * field's `error` reads every field's current value, a cross-field validator (for
 * example an end date that must not precede a start date) re-evaluates when a
 * sibling field changes, not only when its own does.
 *
 * `useForm` owns field state and eager validation. It does not own submission:
 * the form element still submits to a `@post` action, which binds and validates
 * the same DTO through `@body`. Drive the form's inputs from these signals so the
 * submitted FormData is the data the component validated.
 *
 * This creates component state, so it is only callable from a `@local` block.
 *
 * @param DtoClass - The DTO class whose decorators define the fields and rules.
 * @param initial - The seed value for every field, typed as the DTO's shape.
 * @returns A {@link Form} exposing per-field state plus `valid`, `invalid`,
 *   `errors`, and `values`.
 * @example
 * ```ts
 * // Inside a component's @local block:
 * const form = useForm(CreateCandidateDto, { name: '', age: 0 });
 * // In the template:
 * // <input value="${form.fields.name.value}" oninput="${form.fields.name.onInput}" />
 * // <span>${form.fields.name.error}</span>
 * // <button disabled="${form.invalid}">Save</button>
 * ```
 */
export function useForm<D extends new () => object>(
  DtoClass: D,
  initial: InstanceType<D>,
): Form<InstanceType<D>> {
  const proto = DtoClass.prototype as object;
  const fieldNames = getAllValidatedFields(proto);
  const seed = initial as Record<string, unknown>;

  const valueSignals = Object.create(null) as Record<string, Signal<unknown>>;
  const touchedSignals = Object.create(null) as Record<string, Signal<boolean>>;

  for (const name of fieldNames) {
    valueSignals[name] = signal<unknown>(seed[name]);
    touchedSignals[name] = signal(false);
  }

  // Coerce every field the way the submit-path binder does, so a per-field error
  // computed can validate its own field against a full snapshot of siblings.
  const snapshot = (): FieldSnapshot => {
    const values = Object.create(null) as Record<string, unknown>;
    const coercionErrors = Object.create(null) as Record<string, string>;
    for (const name of fieldNames) {
      const raw = valueSignals[name]?.get();
      const declaredType = getDataType(proto, name);
      if (declaredType !== undefined) {
        const result = coerceToType(raw, declaredType, getDataTypeMessage(proto, name));
        if (!result.ok) {
          coercionErrors[name] = result.error;
          values[name] = raw;
          continue;
        }
        values[name] = result.value;
        continue;
      }
      values[name] = raw;
    }
    return { values, coercionErrors };
  };

  const fields = Object.create(null) as Record<string, FormField<unknown>>;

  for (const name of fieldNames) {
    const value = valueSignals[name];
    const touched = touchedSignals[name];
    if (value === undefined || touched === undefined) continue;

    const error = computed<string | null>(() => {
      // Presence is tested on the raw field value before coercion, matching the
      // submit-path binder, so the eager and submit paths agree that a missing
      // required field fails rather than coercing to 0 or false and passing.
      const requiredMessage = requiredError(proto, name, value.get());
      if (requiredMessage !== undefined) return requiredMessage;
      const { values, coercionErrors } = snapshot();
      const coercionError = coercionErrors[name];
      if (coercionError !== undefined) return coercionError;
      for (const validator of getValidators(proto, name)) {
        const result = validator(values[name], values);
        if (!result.isValid) return result.message;
      }
      return null;
    });

    fields[name] = {
      value,
      error,
      touched: { get: touched.get },
      onInput: (event: Event): void => {
        value.set(readTargetValue(event));
        touched.set(true);
      },
    };
  }

  const valid = computed(() => fieldNames.every((name) => fields[name]?.error.get() === null));

  const errors = computed<Readonly<Record<string, string>>>(() => {
    const out = Object.create(null) as Record<string, string>;
    for (const name of fieldNames) {
      const message = fields[name]?.error.get();
      if (message !== null && message !== undefined) out[name] = message;
    }
    return out;
  });

  const values = computed(() => snapshot().values as InstanceType<D>);

  const form = {
    fields,
    valid,
    invalid: computed(() => !valid.get()),
    errors,
    values,
  };

  return form as unknown as Form<InstanceType<D>>;
}
