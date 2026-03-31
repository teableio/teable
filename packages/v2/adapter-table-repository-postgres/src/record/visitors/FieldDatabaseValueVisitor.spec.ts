import { describe, expect, it } from 'vitest';

import { FieldDatabaseValueVisitor } from './FieldDatabaseValueVisitor';

const createSelectOption = (id: string, name: string) => ({
  id: () => ({ toString: () => id }),
  name: () => ({ toString: () => name }),
});

const createSingleSelectField = () => ({
  selectOptions: () => [
    createSelectOption('choRed00000001', 'Red'),
    createSelectOption('choBlue0000001', 'Blue'),
  ],
});

const createMultipleSelectField = () => ({
  selectOptions: () => [
    createSelectOption('choRed00000001', 'Red'),
    createSelectOption('choBlue0000001', 'Blue'),
  ],
});

describe('FieldDatabaseValueVisitor', () => {
  it('passes through primitive fields unchanged', () => {
    const visitor = FieldDatabaseValueVisitor.create('plain-value');
    const methods = [
      'visitSingleLineTextField',
      'visitLongTextField',
      'visitNumberField',
      'visitRatingField',
      'visitCheckboxField',
      'visitDateField',
    ] as const;

    for (const method of methods) {
      const result = visitor[method]({} as never);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('plain-value');
    }
  });

  it('maps single-select ids to stored names and preserves unknown inputs', () => {
    const field = createSingleSelectField();

    expect(
      FieldDatabaseValueVisitor.create('choRed00000001')
        .visitSingleSelectField(field as never)
        ._unsafeUnwrap()
    ).toBe('Red');
    expect(
      FieldDatabaseValueVisitor.create('Blue')
        .visitSingleSelectField(field as never)
        ._unsafeUnwrap()
    ).toBe('Blue');
    expect(
      FieldDatabaseValueVisitor.create('Missing')
        .visitSingleSelectField(field as never)
        ._unsafeUnwrap()
    ).toBe('Missing');
    expect(
      FieldDatabaseValueVisitor.create(null)
        .visitSingleSelectField(field as never)
        ._unsafeUnwrap()
    ).toBeNull();
  });

  it('maps multiple-select ids to stored names and keeps mixed arrays intact', () => {
    const field = createMultipleSelectField();

    expect(
      FieldDatabaseValueVisitor.create(['choRed00000001', 'Blue', 'Missing', 42])
        .visitMultipleSelectField(field as never)
        ._unsafeUnwrap()
    ).toEqual(['Red', 'Blue', 'Missing', 42]);
    expect(
      FieldDatabaseValueVisitor.create('not-an-array')
        .visitMultipleSelectField(field as never)
        ._unsafeUnwrap()
    ).toBe('not-an-array');
    expect(
      FieldDatabaseValueVisitor.create(undefined)
        .visitMultipleSelectField(field as never)
        ._unsafeUnwrap()
    ).toBeNull();
  });

  it('serializes JSON-backed values and clears them when nullish', () => {
    const raw = [{ id: 'recA', title: 'A' }];
    const visitor = FieldDatabaseValueVisitor.create(raw);
    const emptyVisitor = FieldDatabaseValueVisitor.create(undefined);

    expect(visitor.visitAttachmentField({} as never)._unsafeUnwrap()).toBe(JSON.stringify(raw));
    expect(visitor.visitUserField({} as never)._unsafeUnwrap()).toBe(JSON.stringify(raw));
    expect(visitor.visitLinkField({} as never)._unsafeUnwrap()).toBe(JSON.stringify(raw));

    expect(emptyVisitor.visitAttachmentField({} as never)._unsafeUnwrap()).toBeNull();
    expect(emptyVisitor.visitUserField({} as never)._unsafeUnwrap()).toBeNull();
    expect(emptyVisitor.visitLinkField({} as never)._unsafeUnwrap()).toBeNull();
  });

  it('returns null for computed and system-managed fields', () => {
    const visitor = FieldDatabaseValueVisitor.create('ignored');
    const methods = [
      'visitFormulaField',
      'visitRollupField',
      'visitLookupField',
      'visitCreatedTimeField',
      'visitLastModifiedTimeField',
      'visitCreatedByField',
      'visitLastModifiedByField',
      'visitAutoNumberField',
      'visitButtonField',
      'visitConditionalRollupField',
      'visitConditionalLookupField',
    ] as const;

    for (const method of methods) {
      const result = visitor[method]({} as never);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    }
  });
});
