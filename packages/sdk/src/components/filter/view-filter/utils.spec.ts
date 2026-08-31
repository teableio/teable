import { FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { shouldResetFieldValue } from './utils';

const linkField = { type: FieldType.Link };
const textField = { type: FieldType.SingleLineText };

describe('shouldResetFieldValue T6936', () => {
  it('resets a link filter when switching from is to contains', () => {
    expect(shouldResetFieldValue('is', 'contains', linkField)).toBe(true);
    expect(shouldResetFieldValue('contains', 'is', linkField)).toBe(true);
  });

  it('resets a link filter when switching from isExactly to contains', () => {
    expect(shouldResetFieldValue('isExactly', 'contains', linkField)).toBe(true);
    expect(shouldResetFieldValue('contains', 'isExactly', linkField)).toBe(true);
  });

  it('keeps a link title string when switching contains to doesNotContain', () => {
    expect(shouldResetFieldValue('contains', 'doesNotContain', linkField)).toBe(false);
  });

  it('does not reset text field is to contains', () => {
    expect(shouldResetFieldValue('is', 'contains', textField)).toBe(false);
  });

  it('still resets empty and array operator type changes', () => {
    expect(shouldResetFieldValue('is', 'isEmpty', linkField)).toBe(true);
    expect(shouldResetFieldValue('is', 'isAnyOf', linkField)).toBe(true);
  });
});
