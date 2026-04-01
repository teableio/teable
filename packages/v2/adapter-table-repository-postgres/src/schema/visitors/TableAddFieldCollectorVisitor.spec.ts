import { describe, expect, it } from 'vitest';

import { TableAddFieldCollectorVisitor } from './TableAddFieldCollectorVisitor';

const createField = (id: string) => ({
  id: () => ({
    toString: () => id,
  }),
});

describe('TableAddFieldCollectorVisitor', () => {
  it('collects fields from add-field specs and returns a defensive copy', () => {
    const collector = new TableAddFieldCollectorVisitor();
    const fieldA = createField('fld_a');
    const fieldB = createField('fld_b');
    const fieldC = createField('fld_c');

    collector.visitTableAddField({ field: () => fieldA } as never)._unsafeUnwrap();
    collector
      .visitTableAddFields({
        fields: () => [fieldB, fieldC],
      } as never)
      ._unsafeUnwrap();

    const collected = collector.fields();
    expect(collected).toEqual([fieldA, fieldB, fieldC]);

    (collected as Array<typeof fieldA>).push(createField('fld_mutated'));
    expect(collector.fields()).toEqual([fieldA, fieldB, fieldC]);
  });

  it('treats all non-add specs as no-ops', () => {
    const collector = new TableAddFieldCollectorVisitor();
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
      'visitTableUpdateFieldType',
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
      'visitUpdateFormulaExpression',
      'visitUpdateFormulaFormatting',
      'visitUpdateFormulaShowAs',
      'visitUpdateFormulaTimeZone',
      'visitUpdateLinkConfig',
      'visitUpdateLinkRelationship',
      'visitUpdateLookupOptions',
      'visitUpdateRollupConfig',
      'visitUpdateRollupExpression',
      'visitUpdateRollupFormatting',
      'visitUpdateRollupShowAs',
      'visitUpdateRollupTimeZone',
      'visitRemoveSymmetricLinkField',
    ] as const;

    for (const methodName of noOpMethods) {
      const result = (collector[methodName] as (spec: unknown) => { _unsafeUnwrap(): void })(
        {} as never
      );
      expect(result._unsafeUnwrap()).toBeUndefined();
    }

    expect(collector.fields()).toEqual([]);
  });
});
