import {
  FieldHasError,
  FieldId,
  FieldName,
  FormulaExpression,
  RollupExpression,
  createFormulaField,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { FieldValueChangeCollectorVisitor } from './FieldValueChangeCollectorVisitor';
import { createBtnField, createTextField, createValidFieldId } from './__tests__/helpers';

const mkFieldId = (seed: string) => FieldId.create(createValidFieldId(seed))._unsafeUnwrap();
const mkFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

describe('FieldValueChangeCollectorVisitor coverage', () => {
  it('covers no-op visitor methods without mutating tracked field ids', () => {
    const visitor = new FieldValueChangeCollectorVisitor();
    const noOpMethods = [
      'visit',
      'visitTableRename',
      'visitTableAddField',
      'visitTableAddFields',
      'visitTableAddSelectOptions',
      'visitTableRemoveField',
      'visitTableUpdateViewColumnMeta',
      'visitTableUpdateViewQueryDefaults',
      'visitTableByBaseId',
      'visitTableById',
      'visitTableByIncomingReferenceToTable',
      'visitTableByIds',
      'visitTableByName',
      'visitTableByNameLike',
      'visitTableUpdateFieldName',
      'visitTableUpdateFieldDbFieldName',
      'visitTableUpdateFieldConstraints',
      'visitTableUpdateFieldAiConfig',
      'visitTableUpdateFieldDescription',
      'visitUpdateSingleLineTextShowAs',
      'visitUpdateSingleLineTextDefaultValue',
      'visitUpdateLongTextShowAs',
      'visitUpdateLongTextDefaultValue',
      'visitUpdateNumberFormatting',
      'visitUpdateNumberShowAs',
      'visitUpdateNumberDefaultValue',
      'visitUpdateDateFormatting',
      'visitUpdateDateDefaultValue',
      'visitUpdateCheckboxDefaultValue',
      'visitUpdateRatingIcon',
      'visitUpdateRatingColor',
      'visitUpdateUserNotification',
      'visitUpdateUserDefaultValue',
      'visitUpdateButtonLabel',
      'visitUpdateButtonColor',
      'visitUpdateButtonMaxCount',
      'visitUpdateSingleSelectDefaultValue',
      'visitUpdateSingleSelectAutoNewOptions',
      'visitUpdateMultipleSelectDefaultValue',
      'visitUpdateMultipleSelectAutoNewOptions',
      'visitUpdateFormulaFormatting',
      'visitUpdateFormulaShowAs',
      'visitRemoveSymmetricLinkField',
    ] as const;

    for (const method of noOpMethods) {
      const result = (visitor[method] as (spec: unknown) => ReturnType<typeof visitor.visit>)({});
      expect(result.isOk()).toBe(true);
    }

    expect(visitor.valueChangedFields()).toEqual([]);
    expect(visitor.selfBackfillFields()).toEqual([]);
    expect(visitor.deferredBackfillFields()).toEqual([]);
    expect(visitor.hasDbStorageTypeChange()).toBe(false);
  });

  it('tracks computed field duplication but skips non-computed duplicates', () => {
    const visitor = new FieldValueChangeCollectorVisitor();
    const computedField = createFormulaField({
      id: mkFieldId('dupComputed'),
      name: mkFieldName('Computed Copy'),
      expression: FormulaExpression.create('1 + 1')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const plainField = createTextField('dupPlain', 'Plain Copy', 'plain_copy')._unsafeUnwrap();

    visitor.visitTableDuplicateField({
      newField: () => computedField,
    } as never);
    visitor.visitTableDuplicateField({
      newField: () => plainField,
    } as never);

    expect(visitor.selfBackfillFields().map((fieldId) => fieldId.toString())).toEqual([
      computedField.id().toString(),
    ]);
  });

  it('tracks error clearing/rebuild branches and workflow/timezone updates', () => {
    const visitor = new FieldValueChangeCollectorVisitor();
    const errorFieldId = mkFieldId('hasError');
    const workflowFieldId = mkFieldId('workflow');
    const formulaFieldId = mkFieldId('formulaTz');
    const rollupFieldId = mkFieldId('rollupTz');

    visitor.visitTableUpdateFieldHasError({
      isSettingError: () => true,
      fieldId: () => errorFieldId,
      previousHasError: () => FieldHasError.ok(),
      nextHasError: () => FieldHasError.error(),
    } as never);
    visitor.visitTableUpdateFieldHasError({
      isSettingError: () => false,
      fieldId: () => mkFieldId('clearError'),
      previousHasError: () => FieldHasError.error(),
      nextHasError: () => FieldHasError.ok(),
    } as never);
    visitor.visitUpdateButtonWorkflow({
      fieldId: () => workflowFieldId,
    } as never);
    visitor.visitUpdateFormulaTimeZone({
      fieldId: () => formulaFieldId,
    } as never);
    visitor.visitUpdateRollupTimeZone({
      fieldId: () => rollupFieldId,
    } as never);

    expect(visitor.valueChangedFields().map((fieldId) => fieldId.toString())).toEqual([
      errorFieldId.toString(),
      workflowFieldId.toString(),
    ]);
    expect(visitor.selfBackfillFields().map((fieldId) => fieldId.toString())).toEqual([
      formulaFieldId.toString(),
      rollupFieldId.toString(),
    ]);
  });

  it('skips link self-backfill when lookup field stays unchanged', () => {
    const visitor = new FieldValueChangeCollectorVisitor();
    const unchangedLookupFieldId = createValidFieldId('sameLookup');

    visitor.visitUpdateLinkConfig({
      fieldId: () => mkFieldId('linkCfgSame'),
      previousConfig: () => ({
        lookupFieldId: () => ({
          equals: (other: { toString(): string }) => other.toString() === unchangedLookupFieldId,
        }),
      }),
      nextConfig: () => ({
        lookupFieldId: () => ({
          equals: (other: { toString(): string }) => other.toString() === unchangedLookupFieldId,
          toString: () => unchangedLookupFieldId,
        }),
      }),
    } as never);

    expect(visitor.selfBackfillFields()).toEqual([]);
  });

  it('marks storage-type changes for formula expressions and rollup expression rewrites', () => {
    const visitor = new FieldValueChangeCollectorVisitor();
    const formulaFieldId = mkFieldId('formulaExpr');
    const rollupFieldId = mkFieldId('rollupExpr');

    visitor.visitUpdateFormulaExpression({
      fieldId: () => formulaFieldId,
    } as never);
    visitor.visitUpdateRollupExpression({
      fieldId: () => rollupFieldId,
      previousExpression: () => RollupExpression.create('sum({values})')._unsafeUnwrap(),
      nextExpression: () => RollupExpression.create('average({values})')._unsafeUnwrap(),
    } as never);

    expect(visitor.valueChangedFields().map((fieldId) => fieldId.toString())).toContain(
      formulaFieldId.toString()
    );
    expect(visitor.selfBackfillFields().map((fieldId) => fieldId.toString())).toEqual([
      formulaFieldId.toString(),
      rollupFieldId.toString(),
    ]);
    expect(visitor.hasDbStorageTypeChange()).toBe(true);
  });

  it('accepts real button/text fields in workflow-related specs', () => {
    const visitor = new FieldValueChangeCollectorVisitor();
    const buttonField = createBtnField('buttonField', 'Button', 'button_col')._unsafeUnwrap();
    const textField = createTextField('textField', 'Text', 'text_col')._unsafeUnwrap();

    visitor.visitTableDuplicateField({
      newField: () => buttonField,
    } as never);
    visitor.visitTableDuplicateField({
      newField: () => textField,
    } as never);

    expect(visitor.selfBackfillFields()).toEqual([]);
  });
});
