import { describe, it, expect } from 'vitest';
import { transformTmvc } from '../../src/vite-plugin/index.js';
import { generateVirtualTs } from '../../src/volar-plugin/index.js';
import { useForm } from '../../src/validation/form.js';
import { dataType, required, min } from '../../src/validation/decorators.js';

const COMPONENT_ID = '/src/components/CandidateForm.tmvc';
const VIEW_ID = '/src/views/home/index.tmvc';

// ---------------------------------------------------------------------------
// AC13: useForm is in @local scope, and undefined in a view or outside @local
// ---------------------------------------------------------------------------

describe('useForm capability surface', () => {
  it('imports useForm into a component @local block', () => {
    const { code } = transformTmvc(
      '@local {\n  const f = useForm;\n}\n<div></div>',
      COMPONENT_ID,
    );
    const importLine = code.split('\n')[0] ?? '';
    expect(importLine).toContain('useForm');
  });

  it('leaves useForm out of a view runtime module so its use is undefined', () => {
    const { code } = transformTmvc('<p>hi</p>', VIEW_ID);
    const importLine = code.split('\n')[0] ?? '';
    expect(importLine).not.toContain('useForm');
  });

  it('leaves useForm out of the view virtual file so its use is a diagnostic', () => {
    const { code } = generateVirtualTs('<p>${useForm}</p>', 'src/views/home/index.tmvc', null);
    const valueImport = code.split('\n').find((l) => l.startsWith('import { html'));
    expect(valueImport).toBeDefined();
    expect(valueImport).not.toContain('useForm');
  });

  it('imports useForm into the component @local virtual file', () => {
    const { code } = generateVirtualTs(
      '@local {\n  const f = useForm;\n}\n<div></div>',
      'src/components/X.tmvc',
      null,
    );
    expect(code).toContain("import { signal, effect, batch, onCleanup, useForm } from '@typemvc/core';");
  });
});

// ---------------------------------------------------------------------------
// AC14: a DTO reached through @use is in scope for useForm inside @local
// ---------------------------------------------------------------------------

describe('a DTO reached through @use drives useForm', () => {
  const src =
    "@use { CandidateDto } from './dtos'\n" +
    '@local {\n' +
    "  const form = useForm(CandidateDto, { name: '', age: 0 });\n" +
    '}\n' +
    '<input value="${form.fields.name.value}" oninput="${form.fields.name.onInput}" />';

  it('emits the @use import and lifts the useForm call into the render body', () => {
    const { code } = generateVirtualTs(src, COMPONENT_ID, null);
    expect(code).toContain("import { CandidateDto } from './dtos';");
    expect(code).toContain('const form = useForm(CandidateDto, ');
    const stmtIdx = code.indexOf('const form = useForm(CandidateDto, ');
    const returnIdx = code.indexOf('  return html`');
    expect(stmtIdx).toBeGreaterThan(-1);
    expect(stmtIdx).toBeLessThan(returnIdx);
  });
});

// ---------------------------------------------------------------------------
// AC14: the mapped type gives each field its DTO field type (checked by tsc)
// ---------------------------------------------------------------------------

class TypingDto {
  @dataType('string')
  @required()
  name = '';

  @dataType('number')
  @min(0)
  age = 0;
}

describe('useForm typing', () => {
  it('types each field value and the values snapshot as the DTO shape', () => {
    const form = useForm(TypingDto, { name: 'Ada', age: 3 });
    // The explicit annotations fail typecheck if the mapped type were unknown.
    const name: string = form.fields.name.value.get();
    const age: number = form.fields.age.value.get();
    const values: { name: string; age: number } = form.values.get();
    expect(name).toBe('Ada');
    expect(age).toBe(3);
    expect(values).toEqual({ name: 'Ada', age: 3 });
  });
});
