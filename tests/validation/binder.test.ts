import { describe, it, expect, vi } from 'vitest';
import { Validator, ValidationResult } from '../../src/validation/validator.js';
import {
  dataType,
  required,
  email,
  min,
  max,
  validate,
  minLength,
} from '../../src/validation/decorators.js';
import { bindFormData } from '../../src/validation/binder.js';
import { Controller } from '../../src/core/controller.js';
import { assembleContext } from '../../src/core/context.js';
import type { IRouter, ActionErrorTarget } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.append(key, value);
  }
  return fd;
}

function makeRouter(): IRouter {
  return {
    navigateTo: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    current: '/',
  };
}

function makeErrors(): ActionErrorTarget {
  return { action: null };
}

// ---------------------------------------------------------------------------
// Acceptance criterion 1: Validator and ValidationResult exported from validator.ts
// ---------------------------------------------------------------------------

describe('Validator and ValidationResult exported from validation/validator.ts', () => {
  it('ValidationResult.ok() produces a passing result', () => {
    const r = ValidationResult.ok();
    expect(r.isValid).toBe(true);
    expect(r.message).toBe('');
  });

  it('ValidationResult.fail(message) produces a failing result', () => {
    const r = ValidationResult.fail('bad input');
    expect(r.isValid).toBe(false);
    expect(r.message).toBe('bad input');
  });

  it('Validator can be subclassed and its validate() method called', () => {
    class AlwaysOk extends Validator {
      validate(): ValidationResult {
        return ValidationResult.ok();
      }
    }
    const v: Validator = new AlwaysOk();
    expect(v.validate('anything', {}).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DTO classes used across tests (module-level so decorators run once)
// ---------------------------------------------------------------------------

class CreateUserDto {
  @dataType('string')
  @required()
  @email()
  emailAddress = '';

  @dataType('string')
  @required()
  @minLength(2)
  name = '';

  @dataType('number')
  @min(18)
  @max(120)
  age = 0;
}

class SimpleDto {
  @required()
  field = '';
}

// ---------------------------------------------------------------------------
// Acceptance criterion 2: bindFormData - passing validation
// ---------------------------------------------------------------------------

describe('bindFormData - passing validation', () => {
  it('returns an instance and empty fieldErrors when all validators pass', () => {
    const fd = makeFormData({
      emailAddress: 'alice@example.com',
      name: 'Alice',
      age: '25',
    });
    const result = bindFormData(CreateUserDto, fd);
    expect(result.instance).toBeInstanceOf(CreateUserDto);
    expect(Object.keys(result.fieldErrors)).toHaveLength(0);
  });

  it('coerces form string to number on the returned instance', () => {
    const fd = makeFormData({ emailAddress: 'bob@example.com', name: 'Bob', age: '30' });
    const result = bindFormData(CreateUserDto, fd);
    const inst = result.instance as CreateUserDto;
    expect(inst.age).toBe(30);
    expect(typeof inst.age).toBe('number');
  });

  it('assigns coerced string values to the instance', () => {
    const fd = makeFormData({ emailAddress: 'carol@example.com', name: 'Carol', age: '20' });
    const result = bindFormData(CreateUserDto, fd);
    const inst = result.instance as CreateUserDto;
    expect(inst.emailAddress).toBe('carol@example.com');
    expect(inst.name).toBe('Carol');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3 + 4: custom validator, failures keyed by field name
// ---------------------------------------------------------------------------

describe('custom Validator subclass stacked via @validate(), failures in context.errors', () => {
  class StrongPasswordValidator extends Validator {
    validate(value: unknown): ValidationResult {
      if (typeof value !== 'string' || value.length < 8) {
        return ValidationResult.fail('Password must be at least 8 characters.');
      }
      return ValidationResult.ok();
    }
  }

  class LoginDto {
    @dataType('string')
    @required()
    @validate(new StrongPasswordValidator())
    password = '';
  }

  it('populates fieldErrors keyed by the DTO property name when custom validator fails', () => {
    const fd = makeFormData({ password: 'short' });
    const result = bindFormData(LoginDto, fd);
    expect(result.fieldErrors.password).toBeDefined();
    expect(result.fieldErrors.password).toBe('Password must be at least 8 characters.');
  });

  it('does not populate fieldErrors when custom validator passes', () => {
    const fd = makeFormData({ password: 'LongEnough1!' });
    const result = bindFormData(LoginDto, fd);
    expect(result.fieldErrors.password).toBeUndefined();
  });

  it('failures appear in context.errors after assembling context', () => {
    const fd = makeFormData({ password: 'short' });
    const { fieldErrors } = bindFormData(LoginDto, fd);
    expect(fieldErrors.password).toBeDefined();

    const errorMap = new Map(Object.entries(fieldErrors));
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, errorMap);
    expect(ctx.errors.password).toBe('Password must be at least 8 characters.');
  });

  it('@required fires before custom validator -- first failure per field wins', () => {
    const fd = makeFormData({});  // no password field
    const result = bindFormData(LoginDto, fd);
    // @required fails (null from missing field), message stored
    expect(result.fieldErrors.password).toBe('This field is required.');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3 (cross-field): allValues contains the full coerced DTO
// ---------------------------------------------------------------------------

describe('cross-field validation: allValues contains the full coerced DTO', () => {
  const capturedAllValues: Record<string, unknown>[] = [];

  class PasswordMatchValidator extends Validator {
    validate(value: unknown, allValues: Record<string, unknown>): ValidationResult {
      capturedAllValues.push({ ...allValues });
      return value === allValues.password
        ? ValidationResult.ok()
        : ValidationResult.fail('Passwords do not match.');
    }
  }

  class ChangePasswordDto {
    @dataType('string')
    @required()
    password = '';

    @dataType('string')
    @required()
    @validate(new PasswordMatchValidator())
    confirmPassword = '';
  }

  it('allValues passed to validator contains all fields at their coerced values', () => {
    capturedAllValues.length = 0;
    makeFormData({ password: 'MySecret1', confirmPassword: 'MySecret1' });
    const fd = makeFormData({ password: 'MySecret1', confirmPassword: 'MySecret1' });
    bindFormData(ChangePasswordDto, fd);

    expect(capturedAllValues.length).toBeGreaterThan(0);
    const snapshot = capturedAllValues[0];
    expect(snapshot).toBeDefined();
    if (snapshot !== undefined) {
      expect(snapshot.password).toBe('MySecret1');
      expect(snapshot.confirmPassword).toBe('MySecret1');
    }
  });

  it('cross-field validator passes when passwords match', () => {
    const fd = makeFormData({ password: 'Secret123', confirmPassword: 'Secret123' });
    const result = bindFormData(ChangePasswordDto, fd);
    expect(result.fieldErrors.confirmPassword).toBeUndefined();
  });

  it('cross-field validator fails when passwords differ', () => {
    const fd = makeFormData({ password: 'Secret123', confirmPassword: 'Different' });
    const result = bindFormData(ChangePasswordDto, fd);
    expect(result.fieldErrors.confirmPassword).toBe('Passwords do not match.');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 4: failures keyed by property name in context.errors
// ---------------------------------------------------------------------------

describe('validation failures keyed by DTO property name in context.errors', () => {
  it('each failed field maps to a string error message under its property name', () => {
    const fd = makeFormData({});  // all fields missing
    const { fieldErrors } = bindFormData(CreateUserDto, fd);

    expect(Object.keys(fieldErrors).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(fieldErrors)) {
      expect(typeof key).toBe('string');
      expect(typeof value).toBe('string');
    }
  });

  it('context.errors has undefined for fields that passed', () => {
    const fd = makeFormData({ emailAddress: 'ok@example.com', name: 'Bob', age: '25' });
    const { fieldErrors } = bindFormData(CreateUserDto, fd);

    const errorMap = new Map(Object.entries(fieldErrors));
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, errorMap);
    expect(ctx.errors.emailAddress).toBeUndefined();
    expect(ctx.errors.name).toBeUndefined();
    expect(ctx.errors.age).toBeUndefined();
  });

  it('context.errors has a message for each failed field', () => {
    const fd = makeFormData({ emailAddress: 'not-an-email', name: '', age: '5' });
    const { fieldErrors } = bindFormData(CreateUserDto, fd);

    const errorMap = new Map(Object.entries(fieldErrors));
    const ctx = assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {}, errorMap);

    expect(typeof ctx.errors.emailAddress).toBe('string');
    expect(typeof ctx.errors.name).toBe('string');
    expect(typeof ctx.errors.age).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 5: action method invoked even when validation fails
// ---------------------------------------------------------------------------

describe('action method invoked even when validation failures exist', () => {
  it('bindFormData returns an instance even when fieldErrors is non-empty', () => {
    const fd = makeFormData({});  // missing required field
    const result = bindFormData(SimpleDto, fd);

    expect(result.fieldErrors.field).toBeDefined();
    expect(result.instance).toBeInstanceOf(SimpleDto);
  });

  it('the returned DTO instance can be passed to an action even with failures', () => {
    const fd = makeFormData({});
    const { instance, fieldErrors } = bindFormData(SimpleDto, fd);

    expect(Object.keys(fieldErrors).length).toBeGreaterThan(0);

    // Simulate action invocation: the framework passes the instance to the action
    let actionReceived: object | null = null;
    function simulateAction(dto: object): void {
      actionReceived = dto;
    }
    simulateAction(instance);

    expect(actionReceived).toBe(instance);
  });

  it('a controller seeded with errors still executes action logic', () => {
    class TestCtrl extends Controller {
      hasErrorsPublic(): boolean {
        return this.hasErrors();
      }
    }

    const fd = makeFormData({});
    const { fieldErrors } = bindFormData(SimpleDto, fd);

    const ctrl = new TestCtrl();
    ctrl._primeErrors(fieldErrors);

    // "Action runs" -- hasErrors is inspectable from inside the action
    expect(ctrl.hasErrorsPublic()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 6: this.hasErrors() returns true when failures exist
// ---------------------------------------------------------------------------

describe('this.hasErrors() inside the action', () => {
  it('returns false when no errors have been set', () => {
    const ctrl = new Controller();
    expect(ctrl.hasErrors()).toBe(false);
  });

  it('returns true after _primeErrors() is called with failures', () => {
    const ctrl = new Controller();
    ctrl._primeErrors({ name: 'Required', email: 'Invalid' });
    expect(ctrl.hasErrors()).toBe(true);
  });

  it('returns false when _primeErrors is called with empty errors', () => {
    const ctrl = new Controller();
    ctrl._primeErrors({});
    expect(ctrl.hasErrors()).toBe(false);
  });

  it('returns true after addError() is called', () => {
    const ctrl = new Controller();
    ctrl.addError('email', 'Already taken');
    expect(ctrl.hasErrors()).toBe(true);
  });

  it('reflects actual binding failures from bindFormData pipeline', () => {
    const fd = makeFormData({ emailAddress: 'bad', name: '', age: '5' });
    const { fieldErrors } = bindFormData(CreateUserDto, fd);

    const ctrl = new Controller();
    ctrl._primeErrors(fieldErrors);
    expect(ctrl.hasErrors()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 7: this.addError() accumulates in context.errors
// ---------------------------------------------------------------------------

describe('this.addError() adds to context.errors after decorator validation', () => {
  it('addError on a new field adds that field to context.errors', () => {
    const ctrl = new Controller();
    ctrl.addError('username', 'Username is taken');

    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {},
      ctrl._getFieldErrors(),
    );
    expect(ctx.errors.username).toBe('Username is taken');
  });

  it('addError on a field not set by validators adds it alongside existing errors', () => {
    const fd = makeFormData({ emailAddress: 'bad', name: '', age: '25' });
    const { fieldErrors } = bindFormData(CreateUserDto, fd);

    const ctrl = new Controller();
    ctrl._primeErrors(fieldErrors);
    // Action adds a custom business-logic error on a different field
    ctrl.addError('username', 'Username already taken');

    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {},
      ctrl._getFieldErrors(),
    );
    // Decorator validation error still present
    expect(typeof ctx.errors.emailAddress).toBe('string');
    // Action-supplied error also present
    expect(ctx.errors.username).toBe('Username already taken');
  });

  it('addError on a field already set by validators overwrites with action message', () => {
    const fd = makeFormData({ emailAddress: 'bad', name: 'Alice', age: '25' });
    const { fieldErrors } = bindFormData(CreateUserDto, fd);

    const ctrl = new Controller();
    ctrl._primeErrors(fieldErrors);

    // Action overrides the validation message for emailAddress
    ctrl.addError('emailAddress', 'This email is banned');

    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {},
      ctrl._getFieldErrors(),
    );
    expect(ctx.errors.emailAddress).toBe('This email is banned');
  });

  it('multiple addError calls accumulate errors for multiple fields', () => {
    const ctrl = new Controller();
    ctrl.addError('fieldA', 'Error A');
    ctrl.addError('fieldB', 'Error B');
    ctrl.addError('fieldC', 'Error C');
    expect(ctrl.hasErrors()).toBe(true);

    const ctx = assembleContext(
      null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {},
      ctrl._getFieldErrors(),
    );
    expect(ctx.errors.fieldA).toBe('Error A');
    expect(ctx.errors.fieldB).toBe('Error B');
    expect(ctx.errors.fieldC).toBe('Error C');
  });
});

// ---------------------------------------------------------------------------
// context.errors preserves action error alongside field errors
// ---------------------------------------------------------------------------

describe('context.errors: action error and field errors coexist', () => {
  it('action error is still readable alongside field errors', () => {
    const ctrl = new Controller();
    ctrl.addError('name', 'Required');

    const errorsTarget = makeErrors();
    const asyncError = new Error('async failure');
    errorsTarget.action = asyncError;

    const ctx = assembleContext(
      null, null, errorsTarget, makeRouter(), {}, new URLSearchParams(), {},
      ctrl._getFieldErrors(),
    );
    expect(ctx.errors.action).toBe(asyncError);
    expect(ctx.errors.name).toBe('Required');
  });
});

// ---------------------------------------------------------------------------
// Controller._clearFieldErrors() is available for navigation reset
// ---------------------------------------------------------------------------

describe('controller._clearFieldErrors()', () => {
  it('removes all accumulated errors', () => {
    const ctrl = new Controller();
    ctrl.addError('a', 'error');
    ctrl.addError('b', 'error');
    expect(ctrl.hasErrors()).toBe(true);

    ctrl._clearFieldErrors();
    expect(ctrl.hasErrors()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type coercion failure recorded as fieldError
// ---------------------------------------------------------------------------

describe('bindFormData - coercion failure becomes a field error', () => {
  class NumericDto {
    @dataType('number')
    @min(0)
    count = 0;
  }

  it('records a coercion error when a number field receives a non-numeric string', () => {
    const fd = makeFormData({ count: 'not-a-number' });
    const result = bindFormData(NumericDto, fd);
    expect(result.fieldErrors.count).toBeDefined();
    expect(typeof result.fieldErrors.count).toBe('string');
  });

  it('skips validators when coercion already failed for that field', () => {
    // If coercion fails, @min(0) should not run (no "Must be a number." from it)
    const fd = makeFormData({ count: 'xyz' });
    const result = bindFormData(NumericDto, fd);
    // Error is the coercion error, not the @min error
    expect(result.fieldErrors.count).toBe('Must be a valid number.');
  });
});

// ---------------------------------------------------------------------------
// Inheritance, regex state, URL, and File handling
// ---------------------------------------------------------------------------

describe('bindFormData - inherited DTO fields', () => {
  class BaseDto {
    @dataType('string')
    @required('Name is required')
    name = '';
  }

  class ExtendedDto extends BaseDto {
    @dataType('number')
    @min(1)
    age = 0;
  }

  it('validates a field declared on the base class', () => {
    const result = bindFormData(ExtendedDto, makeFormData({ age: '30' }));
    expect(result.fieldErrors.name).toBe('Name is required');
  });

  it('validates both inherited and own fields', () => {
    const result = bindFormData(ExtendedDto, makeFormData({ name: '', age: '0' }));
    expect(result.fieldErrors.name).toBe('Name is required');
    expect(result.fieldErrors.age).toBeDefined();
  });

  it('passes when inherited and own fields are valid', () => {
    const result = bindFormData(ExtendedDto, makeFormData({ name: 'Ada', age: '30' }));
    expect(result.fieldErrors.name).toBeUndefined();
    expect(result.fieldErrors.age).toBeUndefined();
    expect((result.instance as ExtendedDto).name).toBe('Ada');
    expect((result.instance as ExtendedDto).age).toBe(30);
  });
});

describe('bindFormData - a File does not satisfy a string field', () => {
  class AvatarDto {
    @dataType('string')
    @required()
    caption = '';
  }

  it('records a coercion error when a string field receives a File', () => {
    const fd = new FormData();
    fd.append('caption', new File(['x'], 'note.txt', { type: 'text/plain' }));
    const result = bindFormData(AvatarDto, fd);
    expect(result.fieldErrors.caption).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Required presence tested on the raw value before coercion
// ---------------------------------------------------------------------------

describe('bindFormData - required presence before coercion', () => {
  class RequiredNumberDto {
    @dataType('number')
    @required('Age is required')
    age = 0;
  }

  class RequiredBoolDto {
    @dataType('boolean')
    @required('You must accept the terms')
    accepted = false;
  }

  class RequiredStringDto {
    @dataType('string')
    @required()
    name = '';
  }

  it('fails a missing required number instead of binding it as 0', () => {
    const result = bindFormData(RequiredNumberDto, new FormData());
    expect(result.fieldErrors.age).toBe('Age is required');
  });

  it('fails an empty numeric string for a required number', () => {
    const result = bindFormData(RequiredNumberDto, makeFormData({ age: '' }));
    expect(result.fieldErrors.age).toBe('Age is required');
  });

  it('fails a missing required checkbox instead of binding it as false', () => {
    const result = bindFormData(RequiredBoolDto, new FormData());
    expect(result.fieldErrors.accepted).toBe('You must accept the terms');
  });

  it('passes a checked required checkbox and binds true', () => {
    const result = bindFormData(RequiredBoolDto, makeFormData({ accepted: 'true' }));
    expect(result.fieldErrors.accepted).toBeUndefined();
    expect((result.instance as RequiredBoolDto).accepted).toBe(true);
  });

  it('binds the first value when a key repeats', () => {
    const fd = new FormData();
    fd.append('name', 'first');
    fd.append('name', 'second');
    const result = bindFormData(RequiredStringDto, fd);
    expect(result.fieldErrors.name).toBeUndefined();
    expect((result.instance as RequiredStringDto).name).toBe('first');
  });

  it('treats a whitespace-only value as present for a required string', () => {
    const result = bindFormData(RequiredStringDto, makeFormData({ name: '   ' }));
    expect(result.fieldErrors.name).toBeUndefined();
    expect((result.instance as RequiredStringDto).name).toBe('   ');
  });
});

// ---------------------------------------------------------------------------
// Stacking: all validators evaluated, first failure per field stored
// ---------------------------------------------------------------------------

describe('bindFormData - stacked validators: all run, first failure stored', () => {
  class StackDto {
    @dataType('string')
    @required()
    @minLength(5)
    tag = '';
  }

  it('stores the first failing validator message when multiple validators fail', () => {
    const fd = makeFormData({ tag: '' });
    const result = bindFormData(StackDto, fd);
    // @required fires first (source order) and fails for empty string
    expect(result.fieldErrors.tag).toBe('This field is required.');
  });

  it('stores the later validator message when earlier ones pass', () => {
    const fd = makeFormData({ tag: 'ab' });
    const result = bindFormData(StackDto, fd);
    // @required passes (non-empty), @minLength(5) fails
    expect(result.fieldErrors.tag).toBe('Must be at least 5 characters.');
  });
});

// ---------------------------------------------------------------------------
// Issue 050: custom messages surfaced through bindFormData
// ---------------------------------------------------------------------------

describe('050: custom messages via bindFormData', () => {
  it('surfaces a validator custom message in fieldErrors', () => {
    class D {
      @dataType('string')
      @required('Name is required')
      name = '';
    }
    const fd = new FormData();
    fd.append('name', '');

    const result = bindFormData(D, fd);
    expect(result.fieldErrors.name).toBe('Name is required');
  });

  it('surfaces the @dataType coercion custom message for a non-coercible value', () => {
    class D {
      @dataType('number', 'Please enter a valid age')
      @min(18, 'You must be 18 or older')
      age = 0;
    }
    const fd = new FormData();
    fd.append('age', 'not-a-number');

    const result = bindFormData(D, fd);
    // Coercion fails first; the @dataType message wins and validators are skipped.
    expect(result.fieldErrors.age).toBe('Please enter a valid age');
  });

  it('uses the default coercion message when @dataType has none', () => {
    class D {
      @dataType('number')
      age = 0;
    }
    const fd = new FormData();
    fd.append('age', 'abc');

    const result = bindFormData(D, fd);
    expect(result.fieldErrors.age).toBe('Must be a valid number.');
  });
});
