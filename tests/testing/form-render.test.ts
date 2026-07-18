// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderComponent, flushEffects } from '../../src/testing/index.js';
import '../../src/testing/vitest.js';
import { html } from '../../src/renderer/html.js';
import { computed, effect } from '../../src/reactivity/signal.js';
import { bindFormData } from '../../src/validation/binder.js';
import { useForm } from '../../src/validation/form.js';
import { dataType, required, minLength, min } from '../../src/validation/decorators.js';
import type { Fragment } from '../../src/renderer/fragment.js';
import type { Form } from '../../src/types/index.js';

class SignupDto {
  @dataType('string')
  @required()
  @minLength(2)
  name = '';

  @dataType('number')
  @min(18)
  age = 0;
}

// ---------------------------------------------------------------------------
// AC9: a field signal binds to an input and updates the DOM when set
// ---------------------------------------------------------------------------

describe('a field signal drives an input value', () => {
  it('binds value and updates the DOM when set programmatically', () => {
    let form: Form<SignupDto> | undefined;
    const Comp = (): Fragment => {
      form = useForm(SignupDto, { name: '', age: 18 });
      return html`<input class="name" value="${form.fields.name.value}" />`;
    };

    const view = renderComponent(Comp);
    expect((view.query('.name') as HTMLInputElement).value).toBe('');

    form?.fields.name.value.set('Ada');
    flushEffects();
    expect((view.query('.name') as HTMLInputElement).value).toBe('Ada');
  });
});

// ---------------------------------------------------------------------------
// AC10 + AC12: the form element submits the same data the component validated
// ---------------------------------------------------------------------------

describe('a useForm-driven form submits the same FormData', () => {
  it('yields the field values through the real form element, and @body binds them', () => {
    let form: Form<SignupDto> | undefined;
    const Comp = (): Fragment => {
      form = useForm(SignupDto, { name: 'Ada', age: 20 });
      return html`<form>
        <input name="name" value="${form.fields.name.value}" oninput="${form.fields.name.onInput}" />
        <input name="age" value="${form.fields.age.value}" oninput="${form.fields.age.onInput}" />
      </form>`;
    };

    const view = renderComponent(Comp);
    const formEl = view.query('form') as HTMLFormElement;
    const submitted = new FormData(formEl);
    expect(submitted.get('name')).toBe('Ada');
    expect(submitted.get('age')).toBe('20');

    const { instance, fieldErrors } = bindFormData(SignupDto, submitted);
    expect((instance as SignupDto).name).toBe('Ada');
    expect((instance as SignupDto).age).toBe(20);
    expect(Object.keys(fieldErrors)).toHaveLength(0);
    // Progressive enhancement: no field was touched, yet the form still submits.
    expect(form?.fields.name.touched.get()).toBe(false);
  });

  it('reflects an edited field in the submitted FormData', () => {
    let form: Form<SignupDto> | undefined;
    const Comp = (): Fragment => {
      form = useForm(SignupDto, { name: '', age: 20 });
      return html`<form>
        <input name="name" value="${form.fields.name.value}" oninput="${form.fields.name.onInput}" />
      </form>`;
    };

    const view = renderComponent(Comp);
    view.input('input[name="name"]', 'Grace');
    flushEffects();

    const submitted = new FormData(view.query('form') as HTMLFormElement);
    expect(submitted.get('name')).toBe('Grace');
  });
});

// ---------------------------------------------------------------------------
// AC11: a touched field shows its local error; an untouched field shows the
// server-round-trip error, and the two do not conflict
// ---------------------------------------------------------------------------

describe('local and server errors compose through touched', () => {
  it('shows the server error until touched, then the local error', () => {
    let form: Form<SignupDto> | undefined;
    const Comp = (props: { readonly serverError: string }): Fragment => {
      form = useForm(SignupDto, { name: '', age: 20 });
      const message = computed(() =>
        form?.fields.name.touched.get() === true
          ? form.fields.name.error.get()
          : props.serverError,
      );
      return html`<input class="name" value="${form.fields.name.value}" oninput="${form.fields.name.onInput}" />
        <span class="err">${message}</span>`;
    };

    const view = renderComponent(Comp, { serverError: 'That name is taken.' });
    expect(view.query('.err')).toHaveText('That name is taken.');

    view.input('.name', 'A');
    flushEffects();
    expect(view.query('.err')).toHaveText('Must be at least 2 characters.');

    view.input('.name', 'Ada');
    flushEffects();
    expect(view.query('.err')?.textContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AC15: the form's effects are owned by the component Fragment and disposed
// ---------------------------------------------------------------------------

describe('form effects are disposed with the component', () => {
  it('stops re-running an effect over a field after unmount', () => {
    let form: Form<SignupDto> | undefined;
    let runs = 0;
    const Comp = (): Fragment => {
      form = useForm(SignupDto, { name: '', age: 20 });
      effect(() => {
        form?.fields.name.error.get();
        runs += 1;
      });
      return html`<span class="err">${form.fields.name.error}</span>`;
    };

    const view = renderComponent(Comp);
    expect(runs).toBe(1);

    form?.fields.name.value.set('Ada');
    flushEffects();
    expect(runs).toBe(2);

    view.unmount();
    form?.fields.name.value.set('Bo');
    flushEffects();
    expect(runs).toBe(2);
  });
});
