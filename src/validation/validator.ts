/** The result returned by every field validator. */
export class ValidationResult {
  readonly isValid: boolean;
  readonly message: string;

  private constructor(isValid: boolean, message: string) {
    this.isValid = isValid;
    this.message = message;
  }

  static ok(): ValidationResult {
    return new ValidationResult(true, '');
  }

  static fail(message: string): ValidationResult {
    return new ValidationResult(false, message);
  }
}

/** Base class for custom field validators supplied via @validate(instance). */
export abstract class Validator {
  abstract validate(value: unknown, allValues: Record<string, unknown>): ValidationResult;
}
