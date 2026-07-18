// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Validator, ValidationResult } from '../../src/validation/validator.js';
import {
  dataType,
  required,
  minLength,
  min,
  email,
  pattern,
  validate,
} from '../../src/validation/decorators.js';
import { bindFormData } from '../../src/validation/binder.js';
import { useForm } from '../../src/validation/form.js';
import { flush } from '../../src/reactivity/scheduler.js';

// ---------------------------------------------------------------------------
// DTO fixtures (module level so the decorators run once)
// ---------------------------------------------------------------------------

class CandidateDto {
  @dataType('string')
  @required()
  @minLength(2)
  name = '';

  @dataType('number')
  @min(0)
  age = 0;

  @dataType('string')
  @email()
  emailAddress = '';

  @dataType('string')
  @pattern(/^[a-z]+$/)
  handle = '';
}

class EndAfterStartValidator extends Validator {
  validate(value: unknown, allValues: Record<string, unknown>): ValidationResult {
    const end = value instanceof Date ? value : null;
    const start = allValues.start instanceof Date ? allValues.start : null;
    if (end !== null && start !== null && end.getTime() < start.getTime()) {
      return ValidationResult.fail('The end date must not precede the start date.');
    }
    return ValidationResult.ok();
  }
}

class DateRangeDto {
  @dataType('date')
  @required()
  start = '';

  @dataType('date')
  @required()
  @validate(new EndAfterStartValidator())
  end = '';
}

// ---------------------------------------------------------------------------
// Helper: build an input event whose target carries a value
// ---------------------------------------------------------------------------

function inputEvent(value: string): Event {
  const input = document.createElement('input');
  input.value = value;
  const event = new Event('input');
  Object.defineProperty(event, 'target', { value: input });
  return event;
}

function checkboxEvent(checked: boolean): Event {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = 'true';
  input.checked = checked;
  const event = new Event('input');
  Object.defineProperty(event, 'target', { value: input });
  return event;
}

// ---------------------------------------------------------------------------
// Fields discovered from the DTO, seeded from initial
// ---------------------------------------------------------------------------

describe('useForm field discovery and seeding', () => {
  it('produces one field per declared DTO field, seeded from initial', () => {
    const form = useForm(CandidateDto, {
      name: 'Ada',
      age: 30,
      emailAddress: 'ada@example.com',
      handle: 'ada',
    });
    expect(Object.keys(form.fields)).toEqual(['name', 'age', 'emailAddress', 'handle']);
    expect(form.fields.name.value.get()).toBe('Ada');
    expect(form.fields.age.value.get()).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Errors reflect the DTO decorators, with the messages the submit path produces
// ---------------------------------------------------------------------------

describe('useForm eager errors match the submit path', () => {
  it('reflects @required with the submit-path message', () => {
    const form = useForm(CandidateDto, { name: '', age: 5, emailAddress: '', handle: 'x' });
    const submitError = bindFormData(
      CandidateDto,
      formDataOf({ name: '', age: '5', emailAddress: '', handle: 'x' }),
    ).fieldErrors.name;
    expect(form.fields.name.error.get()).toBe('This field is required.');
    expect(form.fields.name.error.get()).toBe(submitError);
  });

  it('reflects @minLength', () => {
    const form = useForm(CandidateDto, { name: 'A', age: 5, emailAddress: '', handle: 'x' });
    expect(form.fields.name.error.get()).toBe('Must be at least 2 characters.');
  });

  it('reflects @min on a coerced number field', () => {
    const form = useForm(CandidateDto, { name: 'Ada', age: -1, emailAddress: '', handle: 'x' });
    expect(form.fields.age.error.get()).toBe('Must be at least 0.');
  });

  it('reflects @email', () => {
    const form = useForm(CandidateDto, {
      name: 'Ada',
      age: 5,
      emailAddress: 'not-an-email',
      handle: 'x',
    });
    expect(form.fields.emailAddress.error.get()).toBe('Must be a valid email address.');
  });

  it('reflects @pattern', () => {
    const form = useForm(CandidateDto, { name: 'Ada', age: 5, emailAddress: '', handle: 'AB1' });
    expect(form.fields.handle.error.get()).toBe('Value does not match the required pattern.');
  });

  it('reports null for a field that passes every validator', () => {
    const form = useForm(CandidateDto, {
      name: 'Ada',
      age: 5,
      emailAddress: 'ada@example.com',
      handle: 'ada',
    });
    expect(form.fields.name.error.get()).toBeNull();
    expect(form.fields.age.error.get()).toBeNull();
  });
});

function formDataOf(record: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(record)) fd.append(key, value);
  return fd;
}

// ---------------------------------------------------------------------------
// Custom validator runs eagerly with allValues
// ---------------------------------------------------------------------------

describe('useForm custom and cross-field validators', () => {
  it('runs a custom @validate validator eagerly and passes allValues', () => {
    const form = useForm(DateRangeDto, { start: '2026-01-10', end: '2026-01-01' });
    expect(form.fields.end.error.get()).toBe('The end date must not precede the start date.');
  });

  it('re-evaluates a cross-field validator when a sibling field changes', () => {
    const form = useForm(DateRangeDto, { start: '2026-01-01', end: '2026-01-10' });
    expect(form.fields.end.error.get()).toBeNull();

    // Move the start past the end without touching the end field.
    form.fields.start.value.set('2026-02-01');
    expect(form.fields.end.error.get()).toBe('The end date must not precede the start date.');
  });
});

// ---------------------------------------------------------------------------
// Coercion failure parity
// ---------------------------------------------------------------------------

describe('useForm coercion failure', () => {
  it('produces the same error the submit path produces for a non-numeric number field', () => {
    const form = useForm(CandidateDto, { name: 'Ada', age: 0, emailAddress: '', handle: 'x' });
    form.fields.age.onInput(inputEvent('not-a-number'));
    const submitError = bindFormData(
      CandidateDto,
      formDataOf({ name: 'Ada', age: 'not-a-number', emailAddress: '', handle: 'x' }),
    ).fieldErrors.age;
    expect(form.fields.age.error.get()).toBe('Must be a valid number.');
    expect(form.fields.age.error.get()).toBe(submitError);
  });
});

// ---------------------------------------------------------------------------
// valid / invalid
// ---------------------------------------------------------------------------

describe('useForm valid and invalid', () => {
  it('computes valid and invalid over every field and updates on any change', () => {
    const form = useForm(CandidateDto, {
      name: '',
      age: 5,
      emailAddress: 'ada@example.com',
      handle: 'ada',
    });
    expect(form.valid.get()).toBe(false);
    expect(form.invalid.get()).toBe(true);

    form.fields.name.value.set('Ada');
    expect(form.valid.get()).toBe(true);
    expect(form.invalid.get()).toBe(false);
  });

  it('collects the current errors keyed by field', () => {
    const form = useForm(CandidateDto, {
      name: '',
      age: -1,
      emailAddress: 'ada@example.com',
      handle: 'ada',
    });
    expect(form.errors.get()).toEqual({
      name: 'This field is required.',
      age: 'Must be at least 0.',
    });
  });
});

// ---------------------------------------------------------------------------
// touched
// ---------------------------------------------------------------------------

describe('useForm touched', () => {
  it('is false initially and true after onInput', () => {
    const form = useForm(CandidateDto, { name: '', age: 0, emailAddress: '', handle: 'x' });
    expect(form.fields.name.touched.get()).toBe(false);
    form.fields.name.onInput(inputEvent('Ada'));
    flush();
    expect(form.fields.name.touched.get()).toBe(true);
    expect(form.fields.name.value.get()).toBe('Ada');
  });
});

// ---------------------------------------------------------------------------
// Required presence agrees with the submit-path binder
// ---------------------------------------------------------------------------

describe('useForm required presence matches the binder', () => {
  class AcceptDto {
    @dataType('boolean')
    @required('You must accept the terms')
    accepted = false;
  }

  it('reports a missing required checkbox as invalid, the same as bindFormData', () => {
    const form = useForm(AcceptDto, { accepted: false });
    expect(form.fields.accepted.error.get()).toBe('You must accept the terms');
    expect(form.invalid.get()).toBe(true);

    const bound = bindFormData(AcceptDto, new FormData());
    expect(bound.fieldErrors.accepted).toBe('You must accept the terms');
  });

  it('clears the error once the checkbox is checked', () => {
    const form = useForm(AcceptDto, { accepted: false });
    form.fields.accepted.onInput(checkboxEvent(true));
    flush();
    expect(form.fields.accepted.error.get()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// values
// ---------------------------------------------------------------------------

describe('useForm values', () => {
  it('produces the coerced, typed DTO shape', () => {
    const form = useForm(CandidateDto, {
      name: 'Ada',
      age: 30,
      emailAddress: 'ada@example.com',
      handle: 'ada',
    });
    const values = form.values.get();
    expect(values).toEqual({
      name: 'Ada',
      age: 30,
      emailAddress: 'ada@example.com',
      handle: 'ada',
    });
    expect(typeof values.age).toBe('number');
  });

  it('recoerces values as fields change', () => {
    const form = useForm(CandidateDto, { name: 'Ada', age: 0, emailAddress: '', handle: 'x' });
    form.fields.age.onInput(inputEvent('42'));
    expect(form.values.get().age).toBe(42);
  });
});
