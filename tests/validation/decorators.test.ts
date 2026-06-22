import { describe, it, expect } from 'vitest';
import {
  ValidationResult,
  Validator,
  dataType,
  required,
  stringLength,
  minLength,
  maxLength,
  min,
  max,
  integer,
  positive,
  negative,
  email,
  url,
  pattern,
  validate,
  coerceToType,
  getDataType,
  getDataTypeMessage,
  getValidators,
  getAllValidatedFields,
} from '../../src/validation/decorators.js';

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------

describe('ValidationResult', () => {
  it('ok() creates a passing result with empty message', () => {
    const r = ValidationResult.ok();
    expect(r.isValid).toBe(true);
    expect(r.message).toBe('');
  });

  it('fail(message) creates a failing result with the supplied message', () => {
    const r = ValidationResult.fail('too short');
    expect(r.isValid).toBe(false);
    expect(r.message).toBe('too short');
  });
});

// ---------------------------------------------------------------------------
// Validator abstract class
// ---------------------------------------------------------------------------

describe('Validator base class', () => {
  it('can be extended with a concrete implementation', () => {
    class AlwaysOk extends Validator {
      validate(): ValidationResult {
        return ValidationResult.ok();
      }
    }
    const v: Validator = new AlwaysOk();
    expect(v.validate('anything', {})).toStrictEqual(ValidationResult.ok());
  });

  it('custom validator returning fail propagates message', () => {
    class AlwaysFail extends Validator {
      validate(): ValidationResult {
        return ValidationResult.fail('always fails');
      }
    }
    const v: Validator = new AlwaysFail();
    const r = v.validate('anything', {});
    expect(r.isValid).toBe(false);
    expect(r.message).toBe('always fails');
  });
});

// ---------------------------------------------------------------------------
// DTO class with decorators (module-level so decorators run once)
// ---------------------------------------------------------------------------

class UserDto {
  @dataType('string')
  @required()
  @stringLength(2, 10)
  name = '';

  @dataType('number')
  @min(18)
  @max(120)
  age = 0;

  @dataType('boolean')
  acceptedTerms = false;

  @dataType('date')
  birthDate: Date = new Date();

  @dataType('string')
  @required()
  @email()
  emailAddress = '';

  @dataType('string')
  @url()
  website = '';

  @dataType('string')
  @pattern(/^\d{5}$/)
  zipCode = '';

  @minLength(3)
  nickname = '';

  @maxLength(5)
  code = '';

  @integer()
  count = 0;

  @positive()
  score = 0;

  @negative()
  deficit = 0;
}

// ---------------------------------------------------------------------------
// @dataType metadata reads
// ---------------------------------------------------------------------------

describe('@dataType', () => {
  it('stores "string" for name', () => {
    expect(getDataType(UserDto.prototype, 'name')).toBe('string');
  });

  it('stores "number" for age', () => {
    expect(getDataType(UserDto.prototype, 'age')).toBe('number');
  });

  it('stores "boolean" for acceptedTerms', () => {
    expect(getDataType(UserDto.prototype, 'acceptedTerms')).toBe('boolean');
  });

  it('stores "date" for birthDate', () => {
    expect(getDataType(UserDto.prototype, 'birthDate')).toBe('date');
  });

  it('returns undefined for a property with no @dataType', () => {
    class Plain {
      @required()
      name = '';
    }
    expect(getDataType(Plain.prototype, 'name')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAllValidatedFields
// ---------------------------------------------------------------------------

describe('getAllValidatedFields', () => {
  it('returns all decorated field names', () => {
    const fields = getAllValidatedFields(UserDto.prototype);
    expect(fields).toContain('name');
    expect(fields).toContain('age');
    expect(fields).toContain('emailAddress');
  });

  it('returns an empty array for a class with no validation decorators', () => {
    class Empty {
      notDecorated = '';
    }
    expect(getAllValidatedFields(Empty.prototype)).toHaveLength(0);
  });

  it('does not repeat the same field name', () => {
    const fields = getAllValidatedFields(UserDto.prototype);
    const unique = new Set(fields);
    expect(unique.size).toBe(fields.length);
  });
});

// ---------------------------------------------------------------------------
// @required
// ---------------------------------------------------------------------------

describe('@required', () => {
  const validators = getValidators(UserDto.prototype, 'name');
  const req = validators.find((v) => {
    const r = v(null, {});
    return !r.isValid;
  });

  it('has at least one validator on name', () => {
    expect(validators.length).toBeGreaterThan(0);
  });

  it('fails when value is null', () => {
    expect(req).toBeDefined();
    if (req !== undefined) {
      expect(req(null, {}).isValid).toBe(false);
    }
  });

  it('fails when value is undefined', () => {
    expect(req).toBeDefined();
    if (req !== undefined) {
      expect(req(undefined, {}).isValid).toBe(false);
    }
  });

  it('fails when value is empty string', () => {
    expect(req).toBeDefined();
    if (req !== undefined) {
      expect(req('', {}).isValid).toBe(false);
    }
  });

  it('passes when value is a non-empty string', () => {
    expect(req).toBeDefined();
    if (req !== undefined) {
      expect(req('Alice', {}).isValid).toBe(true);
    }
  });

  it('passes when value is zero (not empty)', () => {
    expect(req).toBeDefined();
    if (req !== undefined) {
      expect(req(0, {}).isValid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// @required as standalone class
// ---------------------------------------------------------------------------

describe('@required standalone', () => {
  class Standalone {
    @required()
    field = '';
  }

  it('fails for null', () => {
    const [v] = getValidators(Standalone.prototype, 'field');
    expect(v).toBeDefined();
    expect(v?.(null, {}).isValid).toBe(false);
  });

  it('fails for empty string', () => {
    const [v] = getValidators(Standalone.prototype, 'field');
    expect(v?.('', {}).isValid).toBe(false);
  });

  it('passes for a string value', () => {
    const [v] = getValidators(Standalone.prototype, 'field');
    expect(v?.('hello', {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @stringLength
// ---------------------------------------------------------------------------

describe('@stringLength', () => {
  class SLDto {
    @stringLength(3, 6)
    tag = '';
  }
  const proto = SLDto.prototype;

  it('passes when length is within bounds', () => {
    const [v] = getValidators(proto, 'tag');
    expect(v?.('abc', {}).isValid).toBe(true);
    expect(v?.('abcdef', {}).isValid).toBe(true);
  });

  it('fails when length is below minimum', () => {
    const [v] = getValidators(proto, 'tag');
    expect(v?.('ab', {}).isValid).toBe(false);
  });

  it('fails when length exceeds maximum', () => {
    const [v] = getValidators(proto, 'tag');
    expect(v?.('abcdefg', {}).isValid).toBe(false);
  });

  it('passes (skips) when value is not a string', () => {
    const [v] = getValidators(proto, 'tag');
    expect(v?.(42, {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @minLength
// ---------------------------------------------------------------------------

describe('@minLength', () => {
  class MLDto {
    @minLength(4)
    field = '';
  }
  const proto = MLDto.prototype;

  it('passes when length meets minimum', () => {
    const [v] = getValidators(proto, 'field');
    expect(v?.('abcd', {}).isValid).toBe(true);
  });

  it('fails when length is below minimum', () => {
    const [v] = getValidators(proto, 'field');
    expect(v?.('abc', {}).isValid).toBe(false);
  });

  it('passes (skips) when value is not a string', () => {
    const [v] = getValidators(proto, 'field');
    expect(v?.(99, {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @maxLength
// ---------------------------------------------------------------------------

describe('@maxLength', () => {
  class MXDto {
    @maxLength(4)
    field = '';
  }
  const proto = MXDto.prototype;

  it('passes when length is within maximum', () => {
    const [v] = getValidators(proto, 'field');
    expect(v?.('ab', {}).isValid).toBe(true);
    expect(v?.('abcd', {}).isValid).toBe(true);
  });

  it('fails when length exceeds maximum', () => {
    const [v] = getValidators(proto, 'field');
    expect(v?.('abcde', {}).isValid).toBe(false);
  });

  it('passes (skips) when value is not a string', () => {
    const [v] = getValidators(proto, 'field');
    expect(v?.(99, {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @min
// ---------------------------------------------------------------------------

describe('@min', () => {
  class MinDto {
    @min(10)
    value = 0;
  }
  const proto = MinDto.prototype;

  it('passes when value equals the minimum', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.(10, {}).isValid).toBe(true);
  });

  it('passes when value is above the minimum', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.(100, {}).isValid).toBe(true);
  });

  it('fails when value is below the minimum', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.(9, {}).isValid).toBe(false);
  });

  it('fails when value is not a number', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.('ten', {}).isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @max
// ---------------------------------------------------------------------------

describe('@max', () => {
  class MaxDto {
    @max(100)
    value = 0;
  }
  const proto = MaxDto.prototype;

  it('passes when value equals the maximum', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.(100, {}).isValid).toBe(true);
  });

  it('passes when value is below the maximum', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.(50, {}).isValid).toBe(true);
  });

  it('fails when value exceeds the maximum', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.(101, {}).isValid).toBe(false);
  });

  it('fails when value is not a number', () => {
    const [v] = getValidators(proto, 'value');
    expect(v?.('one hundred', {}).isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @integer
// ---------------------------------------------------------------------------

describe('@integer', () => {
  class IntDto {
    @integer()
    count = 0;
  }
  const proto = IntDto.prototype;

  it('passes for a whole number', () => {
    const [v] = getValidators(proto, 'count');
    expect(v?.(5, {}).isValid).toBe(true);
    expect(v?.(0, {}).isValid).toBe(true);
    expect(v?.(-3, {}).isValid).toBe(true);
  });

  it('fails for a decimal number', () => {
    const [v] = getValidators(proto, 'count');
    expect(v?.(5.5, {}).isValid).toBe(false);
    expect(v?.(0.1, {}).isValid).toBe(false);
  });

  it('fails when value is not a number', () => {
    const [v] = getValidators(proto, 'count');
    expect(v?.('five', {}).isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @positive
// ---------------------------------------------------------------------------

describe('@positive', () => {
  class PosDto {
    @positive()
    score = 0;
  }
  const proto = PosDto.prototype;

  it('passes for a positive number', () => {
    const [v] = getValidators(proto, 'score');
    expect(v?.(1, {}).isValid).toBe(true);
    expect(v?.(0.001, {}).isValid).toBe(true);
  });

  it('fails for zero', () => {
    const [v] = getValidators(proto, 'score');
    expect(v?.(0, {}).isValid).toBe(false);
  });

  it('fails for a negative number', () => {
    const [v] = getValidators(proto, 'score');
    expect(v?.(-1, {}).isValid).toBe(false);
  });

  it('fails when value is not a number', () => {
    const [v] = getValidators(proto, 'score');
    expect(v?.('hi', {}).isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @negative
// ---------------------------------------------------------------------------

describe('@negative', () => {
  class NegDto {
    @negative()
    deficit = 0;
  }
  const proto = NegDto.prototype;

  it('passes for a negative number', () => {
    const [v] = getValidators(proto, 'deficit');
    expect(v?.(-1, {}).isValid).toBe(true);
    expect(v?.(-0.001, {}).isValid).toBe(true);
  });

  it('fails for zero', () => {
    const [v] = getValidators(proto, 'deficit');
    expect(v?.(0, {}).isValid).toBe(false);
  });

  it('fails for a positive number', () => {
    const [v] = getValidators(proto, 'deficit');
    expect(v?.(1, {}).isValid).toBe(false);
  });

  it('fails when value is not a number', () => {
    const [v] = getValidators(proto, 'deficit');
    expect(v?.('hello', {}).isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// @email
// ---------------------------------------------------------------------------

describe('@email', () => {
  class EmailDto {
    @email()
    address = '';
  }
  const proto = EmailDto.prototype;

  it('passes for a valid email address', () => {
    const [v] = getValidators(proto, 'address');
    expect(v?.('user@example.com', {}).isValid).toBe(true);
    expect(v?.('user+tag@sub.domain.org', {}).isValid).toBe(true);
  });

  it('fails for a string without "@"', () => {
    const [v] = getValidators(proto, 'address');
    expect(v?.('notanemail', {}).isValid).toBe(false);
  });

  it('fails for a string with "@" but no domain', () => {
    const [v] = getValidators(proto, 'address');
    expect(v?.('user@', {}).isValid).toBe(false);
  });

  it('fails for a string missing a TLD', () => {
    const [v] = getValidators(proto, 'address');
    expect(v?.('user@domain', {}).isValid).toBe(false);
  });

  it('passes (skips) when value is not a string', () => {
    const [v] = getValidators(proto, 'address');
    expect(v?.(42, {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @url
// ---------------------------------------------------------------------------

describe('@url', () => {
  class UrlDto {
    @url()
    link = '';
  }
  const proto = UrlDto.prototype;

  it('passes for http:// URL', () => {
    const [v] = getValidators(proto, 'link');
    expect(v?.('http://example.com', {}).isValid).toBe(true);
  });

  it('passes for https:// URL', () => {
    const [v] = getValidators(proto, 'link');
    expect(v?.('https://example.com/path?q=1', {}).isValid).toBe(true);
  });

  it('fails for a URL without a protocol', () => {
    const [v] = getValidators(proto, 'link');
    expect(v?.('example.com', {}).isValid).toBe(false);
  });

  it('fails for ftp:// URL (not http/https)', () => {
    const [v] = getValidators(proto, 'link');
    expect(v?.('ftp://files.example.com', {}).isValid).toBe(false);
  });

  it('passes (skips) when value is not a string', () => {
    const [v] = getValidators(proto, 'link');
    expect(v?.(42, {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @pattern
// ---------------------------------------------------------------------------

describe('@pattern', () => {
  class PatternDto {
    @pattern(/^\d{5}$/)
    zip = '';
  }
  const proto = PatternDto.prototype;

  it('passes when value matches the regex', () => {
    const [v] = getValidators(proto, 'zip');
    expect(v?.('12345', {}).isValid).toBe(true);
  });

  it('fails when value does not match the regex', () => {
    const [v] = getValidators(proto, 'zip');
    expect(v?.('1234', {}).isValid).toBe(false);
    expect(v?.('abcde', {}).isValid).toBe(false);
  });

  it('passes (skips) when value is not a string', () => {
    const [v] = getValidators(proto, 'zip');
    expect(v?.(12345, {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @validate(validatorInstance)
// ---------------------------------------------------------------------------

describe('@validate', () => {
  class EvenValidator extends Validator {
    validate(value: unknown): ValidationResult {
      if (typeof value !== 'number' || value % 2 !== 0) {
        return ValidationResult.fail('Must be an even number.');
      }
      return ValidationResult.ok();
    }
  }

  class EvenDto {
    @validate(new EvenValidator())
    number = 0;
  }
  const proto = EvenDto.prototype;

  it('invokes Validator.validate() and returns ok for valid input', () => {
    const [v] = getValidators(proto, 'number');
    expect(v?.(4, {}).isValid).toBe(true);
  });

  it('invokes Validator.validate() and returns fail for invalid input', () => {
    const [v] = getValidators(proto, 'number');
    const result = v?.(3, {});
    expect(result?.isValid).toBe(false);
    expect(result?.message).toBe('Must be an even number.');
  });

  it('passes allValues to the custom validator', () => {
    const captured: Record<string, unknown>[] = [];

    class CapturingValidator extends Validator {
      validate(value: unknown, allValues: Record<string, unknown>): ValidationResult {
        captured.push(allValues);
        return ValidationResult.ok();
      }
    }

    class CaptureDto {
      @validate(new CapturingValidator())
      field = '';
    }

    const all = { field: 'hello', other: 42 };
    const [cv] = getValidators(CaptureDto.prototype, 'field');
    cv?.('hello', all);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(all);
  });
});

// ---------------------------------------------------------------------------
// Stacking multiple validators on one property
// ---------------------------------------------------------------------------

describe('validator stacking', () => {
  class StackDto {
    @required()
    @minLength(3)
    @maxLength(8)
    code = '';
  }
  const proto = StackDto.prototype;

  it('stores multiple validators for the same property', () => {
    const validators = getValidators(proto, 'code');
    expect(validators.length).toBeGreaterThanOrEqual(3);
  });

  it('evaluates all validators even when the first one fails', () => {
    const validators = getValidators(proto, 'code');
    const results = validators.map((v) => v('', {}));
    const failures = results.filter((r) => !r.isValid);
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });

  it('all validators pass for a valid value', () => {
    const validators = getValidators(proto, 'code');
    const results = validators.map((v) => v('abc', {}));
    expect(results.every((r) => r.isValid)).toBe(true);
  });

  it('only relevant validators fail for a value that is too long', () => {
    const validators = getValidators(proto, 'code');
    const results = validators.map((v) => v('abcdefghi', {}));
    const failures = results.filter((r) => !r.isValid);
    expect(failures.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Type coercion
// ---------------------------------------------------------------------------

describe('coerceToType', () => {
  describe("'string'", () => {
    it('returns the value as-is', () => {
      const r = coerceToType('hello', 'string');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe('hello');
    });

    it('passes through non-string values without conversion', () => {
      const r = coerceToType(42, 'string');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(42);
    });
  });

  describe("'number'", () => {
    it('converts a numeric string to a number', () => {
      const r = coerceToType('42', 'number');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(42);
    });

    it('converts a decimal string to a floating-point number', () => {
      const r = coerceToType('3.14', 'number');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(3.14);
    });

    it('converts "0" to the number 0', () => {
      const r = coerceToType('0', 'number');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(0);
    });

    it('rejects non-numeric strings with ok=false', () => {
      const r = coerceToType('abc', 'number');
      expect(r.ok).toBe(false);
    });

    it('converts empty string to 0 (Number("") === 0, not NaN)', () => {
      const r = coerceToType('', 'number');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(0);
    });

    it('passes through an already-numeric value', () => {
      const r = coerceToType(99, 'number');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(99);
    });
  });

  describe("'boolean'", () => {
    it('converts "true" to true', () => {
      const r = coerceToType('true', 'boolean');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(true);
    });

    it('converts "false" to false', () => {
      const r = coerceToType('false', 'boolean');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(false);
    });

    it('converts any other string to false', () => {
      const r = coerceToType('on', 'boolean');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(false);
    });

    it('converts null (absent checkbox) to false', () => {
      const r = coerceToType(null, 'boolean');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(false);
    });

    it('converts undefined (absent field) to false', () => {
      const r = coerceToType(undefined, 'boolean');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(false);
    });
  });

  describe("'date'", () => {
    it('converts a valid ISO date string to a Date', () => {
      const r = coerceToType('2024-01-15', 'date');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toBeInstanceOf(Date);
        expect((r.value as Date).getFullYear()).toBe(2024);
      }
    });

    it('converts a full ISO datetime string to a Date', () => {
      const r = coerceToType('2024-06-15T12:00:00Z', 'date');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeInstanceOf(Date);
    });

    it('rejects "not-a-date" with ok=false', () => {
      const r = coerceToType('not-a-date', 'date');
      expect(r.ok).toBe(false);
    });

    it('rejects an empty string with ok=false', () => {
      const r = coerceToType('', 'date');
      expect(r.ok).toBe(false);
    });

    it('rejects "undefined" string with ok=false', () => {
      const r = coerceToType('undefined', 'date');
      expect(r.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Coercion precedes validator execution (acceptance criterion 3)
// ---------------------------------------------------------------------------

describe('coercion before validation', () => {
  it('string "42" coerces to number 42 which passes @min(18)', () => {
    const coerced = coerceToType('42', 'number');
    expect(coerced.ok).toBe(true);

    if (coerced.ok) {
      class AgeDto {
        @dataType('number')
        @min(18)
        age = 0;
      }
      const validators = getValidators(AgeDto.prototype, 'age');
      const results = validators.map((v) => v(coerced.value, {}));
      expect(results.every((r) => r.isValid)).toBe(true);
    }
  });

  it('NaN from number coercion is a coercion failure', () => {
    const result = coerceToType('not-a-number', 'number');
    expect(result.ok).toBe(false);
  });

  it('invalid date from date coercion is a coercion failure', () => {
    const result = coerceToType('not-a-date', 'date');
    expect(result.ok).toBe(false);
  });

  it('coerced number passes @min but fails @max when appropriate', () => {
    class RangeDto {
      @dataType('number')
      @min(0)
      @max(10)
      value = 0;
    }
    const coerced = coerceToType('15', 'number');
    expect(coerced.ok).toBe(true);

    if (coerced.ok) {
      const validators = getValidators(RangeDto.prototype, 'value');
      const results = validators.map((v) => v(coerced.value, {}));
      const failures = results.filter((r) => !r.isValid);
      expect(failures.length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Validators are usable as field decorators on DTO classes (acceptance criterion 1)
// ---------------------------------------------------------------------------

describe('all decorators are usable as field decorators', () => {
  it('decorators apply to a new DTO class without errors', () => {
    expect(() => {
      class CompleteDto {
        @dataType('string')
        @required()
        @stringLength(1, 100)
        @minLength(1)
        @maxLength(100)
        @email()
        emailField = '';

        @dataType('string')
        @url()
        @pattern(/^https:\/\//)
        urlField = '';

        @dataType('number')
        @min(0)
        @max(999)
        @integer()
        @positive()
        count = 0;

        @dataType('number')
        @negative()
        balance = 0;

        @dataType('boolean')
        flag = false;

        @dataType('date')
        createdAt: Date = new Date();

        @validate(new (class extends Validator {
          validate(): ValidationResult { return ValidationResult.ok(); }
        })())
        custom = '';
      }

      const fields = getAllValidatedFields(CompleteDto.prototype);
      expect(fields.length).toBeGreaterThan(0);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Issue 050: custom error messages for built-in validators
// ---------------------------------------------------------------------------

describe('050: custom validator error messages', () => {
  it('required(msg) returns the custom message on failure', () => {
    class D { @required('Name is needed') name = ''; }
    const [v] = getValidators(D.prototype, 'name');
    expect(v?.('', {}).message).toBe('Name is needed');
  });

  it('falls back to the default message when none is provided', () => {
    class D { @required() name = ''; }
    const [v] = getValidators(D.prototype, 'name');
    expect(v?.('', {}).message).toBe('This field is required.');
  });

  it('maxLength(n, msg) returns the custom message', () => {
    class D { @maxLength(3, 'Too long') tag = ''; }
    const [v] = getValidators(D.prototype, 'tag');
    expect(v?.('abcd', {}).message).toBe('Too long');
  });

  it('stringLength(min, max, msg) returns the custom message', () => {
    class D { @stringLength(2, 4, 'Bad length') tag = ''; }
    const [v] = getValidators(D.prototype, 'tag');
    expect(v?.('a', {}).message).toBe('Bad length');
  });

  it('pattern(regex, msg) returns the custom message', () => {
    class D { @pattern(/^\d+$/u, 'Digits only') code = ''; }
    const [v] = getValidators(D.prototype, 'code');
    expect(v?.('abc', {}).message).toBe('Digits only');
  });

  it('email(msg) returns the custom message', () => {
    class D { @email('Enter a valid email') addr = ''; }
    const [v] = getValidators(D.prototype, 'addr');
    expect(v?.('nope', {}).message).toBe('Enter a valid email');
  });

  it('min(n, msg) replaces both the constraint and the type-guard message (AC3)', () => {
    class D { @min(18, 'You must be 18 or older') age = 0; }
    const [v] = getValidators(D.prototype, 'age');
    expect(v?.(10, {}).message).toBe('You must be 18 or older');   // constraint failure
    expect(v?.('nan', {}).message).toBe('You must be 18 or older'); // type-guard failure
  });

  it('@dataType(type, msg) stores the coercion message', () => {
    class D { @dataType('number', 'Enter a number') age = 0; }
    expect(getDataTypeMessage(D.prototype, 'age')).toBe('Enter a number');
  });

  it('coerceToType returns the custom message on coercion failure', () => {
    const result = coerceToType('abc', 'number', 'Not a number');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Not a number');
  });

  it('coerceToType uses the default when no message is supplied', () => {
    const result = coerceToType('abc', 'number');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Must be a valid number.');
  });
});
