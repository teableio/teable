import { describe, expect, it } from 'vitest';

import { DependencyChangeDetectorVisitor } from './DependencyChangeDetectorVisitor';

const createFieldId = (id: string) => ({
  toString: () => id,
});

const createField = (params: { id: string; type: string }) => ({
  id: () => createFieldId(params.id),
  type: () => ({
    toString: () => params.type,
  }),
});

describe('DependencyChangeDetectorVisitor', () => {
  it('marks only dependency-producing added fields and de-duplicates field ids', () => {
    const visitor = new DependencyChangeDetectorVisitor();
    const formulaField = createField({ id: 'fld_formula', type: 'formula' });
    const linkField = createField({ id: 'fld_link', type: 'link' });
    const textField = createField({ id: 'fld_text', type: 'singleLineText' });

    visitor.visitTableAddField({ field: () => formulaField } as never)._unsafeUnwrap();
    visitor
      .visitTableAddFields({
        fields: () => [linkField, textField, formulaField],
      } as never)
      ._unsafeUnwrap();

    expect(visitor.needsCheck()).toBe(true);
    expect(visitor.dependencyChangedFieldIds().map((id) => id.toString())).toEqual([
      'fld_formula',
      'fld_link',
    ]);
  });

  it('marks dependency-affecting update specs and supports conditional config checks without field ids', () => {
    const visitor = new DependencyChangeDetectorVisitor();
    const changedFieldId = createFieldId('fld_changed');
    const typeField = createField({ id: 'fld_type_new', type: 'lookup' });

    visitor.visitTableUpdateFieldType({ newField: () => typeField } as never)._unsafeUnwrap();
    visitor
      .visitUpdateFormulaExpression({ fieldId: () => changedFieldId } as never)
      ._unsafeUnwrap();
    visitor.visitUpdateLinkConfig({ fieldId: () => changedFieldId } as never)._unsafeUnwrap();
    visitor.visitUpdateLookupOptions({ fieldId: () => changedFieldId } as never)._unsafeUnwrap();
    visitor.visitUpdateRollupConfig({ fieldId: () => changedFieldId } as never)._unsafeUnwrap();
    visitor.visitUpdateConditionalRollupConfig({} as never)._unsafeUnwrap();
    visitor.visitUpdateConditionalLookupConfig({} as never)._unsafeUnwrap();

    expect(visitor.needsCheck()).toBe(true);
    expect(visitor.dependencyChangedFieldIds().map((id) => id.toString())).toEqual([
      'fld_type_new',
      'fld_changed',
    ]);
  });

  it('leaves non-dependency specs as no-ops', () => {
    const visitor = new DependencyChangeDetectorVisitor();
    const noOpMethods = [
      'visit',
      'visitTableRename',
      'visitTableAddSelectOptions',
      'visitTableDuplicateField',
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
      'visitTableUpdateFieldHasError',
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
      'visitUpdateRatingMax',
      'visitUpdateRatingIcon',
      'visitUpdateRatingColor',
      'visitUpdateUserMultiplicity',
      'visitUpdateUserNotification',
      'visitUpdateUserDefaultValue',
      'visitUpdateButtonLabel',
      'visitUpdateButtonColor',
      'visitUpdateButtonMaxCount',
      'visitUpdateButtonWorkflow',
      'visitUpdateSingleSelectOptions',
      'visitUpdateSingleSelectDefaultValue',
      'visitUpdateSingleSelectAutoNewOptions',
      'visitUpdateMultipleSelectOptions',
      'visitUpdateMultipleSelectDefaultValue',
      'visitUpdateMultipleSelectAutoNewOptions',
      'visitUpdateFormulaFormatting',
      'visitUpdateFormulaShowAs',
      'visitUpdateFormulaTimeZone',
      'visitUpdateLinkRelationship',
      'visitUpdateRollupExpression',
      'visitUpdateRollupFormatting',
      'visitUpdateRollupShowAs',
      'visitUpdateRollupTimeZone',
      'visitRemoveSymmetricLinkField',
      'visitUpdateConditionalRollupExpression',
      'visitUpdateConditionalRollupFormatting',
      'visitUpdateConditionalRollupShowAs',
      'visitUpdateConditionalRollupTimeZone',
    ] as const;

    for (const methodName of noOpMethods) {
      const result = (visitor[methodName] as (spec: unknown) => { _unsafeUnwrap(): void })(
        {} as never
      );
      expect(result._unsafeUnwrap()).toBeUndefined();
    }

    expect(visitor.needsCheck()).toBe(false);
    expect(visitor.dependencyChangedFieldIds()).toEqual([]);
  });
});
