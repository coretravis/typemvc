import { getAllValidatedFields, getDataType, getDataTypeMessage, getValidators, coerceToType } from './decorators.js';

/** Result of binding form data to a DTO class instance. */
export interface DtoBindingResult {
  /** The populated DTO instance with coerced field values. */
  readonly instance: object;
  /**
   * Field-keyed error messages. A field appears here if coercion failed or
   * the first failing validator returned a non-empty message. Empty means
   * all fields passed.
   */
  readonly fieldErrors: Readonly<Record<string, string>>;
}

/**
 * Binds raw FormData to an instance of the given DTO class, applying type
 * coercion and all registered field validators.
 *
 * Coercion runs first. If a field's value cannot be coerced to the declared
 * @dataType, that field is recorded as an error and its validators are skipped.
 *
 * All validators for every coercible field are evaluated regardless of whether
 * earlier validators have already failed. Only the first failure per field is
 * stored in fieldErrors.
 *
 * The caller is responsible for always invoking the action regardless of
 * whether fieldErrors is non-empty.
 */
export function bindFormData(
  DtoClass: new () => object,
  formData: FormData,
): DtoBindingResult {
  const instance = new DtoClass();
  const proto = Object.getPrototypeOf(instance) as object;
  const fields = getAllValidatedFields(proto);

  const fieldErrors = Object.create(null) as Record<string, string>;
  const allValues = Object.create(null) as Record<string, unknown>;
  const coercionFailed = new Set<string>();

  for (const field of fields) {
    const rawValue: FormDataEntryValue | null = formData.get(field);
    const declaredType = getDataType(proto, field);

    if (declaredType !== undefined) {
      const coercionResult = coerceToType(rawValue, declaredType, getDataTypeMessage(proto, field));
      if (!coercionResult.ok) {
        fieldErrors[field] = coercionResult.error;
        coercionFailed.add(field);
        allValues[field] = rawValue;
        continue;
      }
      allValues[field] = coercionResult.value;
      (instance as unknown as Record<string, unknown>)[field] = coercionResult.value;
    } else {
      allValues[field] = rawValue;
      (instance as unknown as Record<string, unknown>)[field] = rawValue;
    }
  }

  for (const field of fields) {
    if (coercionFailed.has(field)) continue;

    const validators = getValidators(proto, field);
    const value = allValues[field];
    let firstFailure: string | undefined;

    for (const validator of validators) {
      const result = validator(value, allValues);
      if (!result.isValid && firstFailure === undefined) {
        firstFailure = result.message;
      }
    }

    if (firstFailure !== undefined) {
      fieldErrors[field] = firstFailure;
    }
  }

  return { instance, fieldErrors };
}
