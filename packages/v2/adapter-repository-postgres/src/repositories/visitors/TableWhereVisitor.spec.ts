import {
  BaseId,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByIncomingReferenceToTableSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableId,
  TableName,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { TableWhereVisitor } from './TableWhereVisitor';

type ExpressionResult =
  | { type: 'comparison'; args: unknown[] }
  | { type: 'and'; args: unknown[] }
  | { type: 'or'; args: unknown[] }
  | { type: 'not'; arg: unknown };

const createExpressionBuilder = () => ({
  eb: (...args: unknown[]): ExpressionResult => ({ type: 'comparison', args }),
  and: (args: unknown[]): ExpressionResult => ({ type: 'and', args }),
  or: (args: unknown[]): ExpressionResult => ({ type: 'or', args }),
  not: (arg: unknown): ExpressionResult => ({ type: 'not', arg }),
});

describe('TableWhereVisitor', () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  const otherTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Projects')._unsafeUnwrap();

  it('adds the default deleted_time filter for active and deleted states', () => {
    const eb = createExpressionBuilder();

    expect(new TableWhereVisitor('active').where()._unsafeUnwrap()(eb as never)).toEqual({
      type: 'comparison',
      args: ['deleted_time', 'is', null],
    });
    expect(new TableWhereVisitor('deleted').where()._unsafeUnwrap()(eb as never)).toEqual({
      type: 'comparison',
      args: ['deleted_time', 'is not', null],
    });
    expect(new TableWhereVisitor('all').where().isErr()).toBe(true);
  });

  it('builds where clauses and spec info for direct table selectors', () => {
    const eb = createExpressionBuilder();

    const byBase = new TableWhereVisitor('all');
    expect(byBase.visitTableByBaseId(TableByBaseIdSpec.create(baseId)).isOk()).toBe(true);
    expect(byBase.describe()).toEqual({
      specName: 'TableByBaseIdSpec',
      baseId: baseId.toString(),
    });
    expect(byBase.where()._unsafeUnwrap()(eb as never)).toEqual({
      type: 'comparison',
      args: ['base_id', '=', baseId.toString()],
    });

    const byId = new TableWhereVisitor('all');
    expect(byId.visitTableById(TableByIdSpec.create(tableId)).isOk()).toBe(true);
    expect(byId.describe()).toEqual({
      specName: 'TableByIdSpec',
      tableId: tableId.toString(),
    });
    expect(byId.where()._unsafeUnwrap()(eb as never)).toEqual({
      type: 'comparison',
      args: ['id', '=', tableId.toString()],
    });

    const byName = new TableWhereVisitor('all');
    expect(byName.visitTableByName(TableByNameSpec.create(tableName)).isOk()).toBe(true);
    expect(byName.describe()).toEqual({
      specName: 'TableByNameSpec',
      tableName: tableName.toString(),
    });
    expect(byName.where()._unsafeUnwrap()(eb as never)).toEqual({
      type: 'comparison',
      args: ['name', '=', tableName.toString()],
    });

    const byNameLike = new TableWhereVisitor('all');
    expect(byNameLike.visitTableByNameLike(TableByNameLikeSpec.create(tableName)).isOk()).toBe(
      true
    );
    expect(byNameLike.describe()).toEqual({
      specName: 'TableByNameLikeSpec',
      nameLike: tableName.toString(),
    });
    expect(byNameLike.where()._unsafeUnwrap()(eb as never)).toEqual({
      type: 'comparison',
      args: ['name', 'like', `%${tableName.toString()}%`],
    });
  });

  it('handles table id lists, including the empty-list validation path', () => {
    const eb = createExpressionBuilder();
    const visitor = new TableWhereVisitor('all');

    expect(visitor.visitTableByIds(TableByIdsSpec.create([tableId, otherTableId])).isOk()).toBe(
      true
    );
    expect(visitor.describe()).toEqual({
      specName: 'TableByIdsSpec',
      tableIds: [tableId.toString(), otherTableId.toString()],
    });
    expect(visitor.where()._unsafeUnwrap()(eb as never)).toEqual({
      type: 'comparison',
      args: ['id', 'in', [tableId.toString(), otherTableId.toString()]],
    });

    const emptyResult = new TableWhereVisitor('all').visitTableByIds(TableByIdsSpec.create([]));
    expect(emptyResult.isErr()).toBe(true);
    expect(emptyResult._unsafeUnwrapErr()).toMatchObject({
      code: 'unexpected',
      message: 'TableByIdsSpec requires at least one id',
    });
  });

  it('records incoming-reference filters for both active and deleted states', () => {
    const activeVisitor = new TableWhereVisitor('active');
    const deletedVisitor = new TableWhereVisitor('deleted');

    const activeResult = activeVisitor.visitTableByIncomingReferenceToTable(
      TableByIncomingReferenceToTableSpec.create(tableId)
    );
    const deletedResult = deletedVisitor.visitTableByIncomingReferenceToTable(
      TableByIncomingReferenceToTableSpec.create(tableId)
    );

    expect(activeResult.isOk()).toBe(true);
    expect(deletedResult.isOk()).toBe(true);
    expect(activeVisitor.describe()).toEqual({
      specName: 'TableByIncomingReferenceToTableSpec',
      incomingReferenceToTableId: tableId.toString(),
    });
    expect(deletedVisitor.describe()).toEqual({
      specName: 'TableByIncomingReferenceToTableSpec',
      incomingReferenceToTableId: tableId.toString(),
    });
    expect(typeof activeResult._unsafeUnwrap()).toBe('function');
    expect(typeof deletedResult._unsafeUnwrap()).toBe('function');
  });

  it('returns validation errors for unsupported specs', () => {
    const visitor = new TableWhereVisitor('all');
    const unsupportedMethods = [
      ['visitTableAddField', 'TableAddFieldSpec is not supported for table filters'],
      ['visitTableAddFields', 'TableAddFieldsSpec is not supported for table filters'],
      [
        'visitTableAddSelectOptions',
        'TableAddSelectOptionsSpec is not supported for table filters',
      ],
      ['visitTableDuplicateField', 'TableDuplicateFieldSpec is not supported for table filters'],
      ['visitTableRemoveField', 'TableRemoveFieldSpec is not supported for table filters'],
      [
        'visitTableUpdateViewColumnMeta',
        'TableUpdateViewColumnMetaSpec is not supported for table filters',
      ],
      [
        'visitTableUpdateViewQueryDefaults',
        'TableUpdateViewQueryDefaultsSpec is not supported for table filters',
      ],
      ['visitTableRename', 'TableRenameSpec is not supported for table filters'],
      [
        'visitTableUpdateFieldDbFieldName',
        'TableUpdateFieldDbFieldNameSpec is not supported for table filters',
      ],
      ['visitTableUpdateFieldName', 'TableUpdateFieldNameSpec is not supported for table filters'],
      ['visitTableUpdateFieldType', 'TableUpdateFieldTypeSpec is not supported for table filters'],
      [
        'visitTableUpdateFieldConstraints',
        'TableUpdateFieldConstraintsSpec is not supported for table filters',
      ],
      [
        'visitTableUpdateFieldAiConfig',
        'TableUpdateFieldAiConfigSpec is not supported for table filters',
      ],
      [
        'visitTableUpdateFieldDescription',
        'TableUpdateFieldDescriptionSpec is not supported for table filters',
      ],
      [
        'visitTableUpdateFieldHasError',
        'TableUpdateFieldHasErrorSpec is not supported for table filters',
      ],
      [
        'visitUpdateSingleLineTextShowAs',
        'UpdateSingleLineTextShowAsSpec is not supported for table filters',
      ],
      [
        'visitUpdateSingleLineTextDefaultValue',
        'UpdateSingleLineTextDefaultValueSpec is not supported for table filters',
      ],
      ['visitUpdateLongTextShowAs', 'UpdateLongTextShowAsSpec is not supported for table filters'],
      [
        'visitUpdateLongTextDefaultValue',
        'UpdateLongTextDefaultValueSpec is not supported for table filters',
      ],
      [
        'visitUpdateNumberFormatting',
        'UpdateNumberFormattingSpec is not supported for table filters',
      ],
      ['visitUpdateNumberShowAs', 'UpdateNumberShowAsSpec is not supported for table filters'],
      [
        'visitUpdateNumberDefaultValue',
        'UpdateNumberDefaultValueSpec is not supported for table filters',
      ],
      ['visitUpdateDateFormatting', 'UpdateDateFormattingSpec is not supported for table filters'],
      [
        'visitUpdateDateDefaultValue',
        'UpdateDateDefaultValueSpec is not supported for table filters',
      ],
      [
        'visitUpdateCheckboxDefaultValue',
        'UpdateCheckboxDefaultValueSpec is not supported for table filters',
      ],
      ['visitUpdateRatingMax', 'UpdateRatingMaxSpec is not supported for table filters'],
      ['visitUpdateRatingIcon', 'UpdateRatingIconSpec is not supported for table filters'],
      ['visitUpdateRatingColor', 'UpdateRatingColorSpec is not supported for table filters'],
      [
        'visitUpdateUserMultiplicity',
        'UpdateUserMultiplicitySpec is not supported for table filters',
      ],
      [
        'visitUpdateUserNotification',
        'UpdateUserNotificationSpec is not supported for table filters',
      ],
      [
        'visitUpdateUserDefaultValue',
        'UpdateUserDefaultValueSpec is not supported for table filters',
      ],
      ['visitUpdateButtonLabel', 'UpdateButtonLabelSpec is not supported for table filters'],
      ['visitUpdateButtonColor', 'UpdateButtonColorSpec is not supported for table filters'],
      ['visitUpdateButtonMaxCount', 'UpdateButtonMaxCountSpec is not supported for table filters'],
      ['visitUpdateButtonWorkflow', 'UpdateButtonWorkflowSpec is not supported for table filters'],
      [
        'visitUpdateSingleSelectOptions',
        'UpdateSingleSelectOptionsSpec is not supported for table filters',
      ],
      [
        'visitUpdateSingleSelectDefaultValue',
        'UpdateSingleSelectDefaultValueSpec is not supported for table filters',
      ],
      [
        'visitUpdateSingleSelectAutoNewOptions',
        'UpdateSingleSelectAutoNewOptionsSpec is not supported for table filters',
      ],
      [
        'visitUpdateMultipleSelectOptions',
        'UpdateMultipleSelectOptionsSpec is not supported for table filters',
      ],
      [
        'visitUpdateMultipleSelectDefaultValue',
        'UpdateMultipleSelectDefaultValueSpec is not supported for table filters',
      ],
      [
        'visitUpdateMultipleSelectAutoNewOptions',
        'UpdateMultipleSelectAutoNewOptionsSpec is not supported for table filters',
      ],
      [
        'visitUpdateFormulaExpression',
        'UpdateFormulaExpressionSpec is not supported for table filters',
      ],
      [
        'visitUpdateFormulaFormatting',
        'UpdateFormulaFormattingSpec is not supported for table filters',
      ],
      ['visitUpdateFormulaShowAs', 'UpdateFormulaShowAsSpec is not supported for table filters'],
      [
        'visitUpdateFormulaTimeZone',
        'UpdateFormulaTimeZoneSpec is not supported for table filters',
      ],
      ['visitUpdateLinkConfig', 'UpdateLinkConfigSpec is not supported for table filters'],
      [
        'visitUpdateLinkRelationship',
        'UpdateLinkRelationshipSpec is not supported for table filters',
      ],
      ['visitUpdateLookupOptions', 'UpdateLookupOptionsSpec is not supported for table filters'],
      ['visitUpdateRollupConfig', 'UpdateRollupConfigSpec is not supported for table filters'],
      [
        'visitUpdateRollupExpression',
        'UpdateRollupExpressionSpec is not supported for table filters',
      ],
      [
        'visitUpdateRollupFormatting',
        'UpdateRollupFormattingSpec is not supported for table filters',
      ],
      ['visitUpdateRollupShowAs', 'UpdateRollupShowAsSpec is not supported for table filters'],
      ['visitUpdateRollupTimeZone', 'UpdateRollupTimeZoneSpec is not supported for table filters'],
      [
        'visitRemoveSymmetricLinkField',
        'RemoveSymmetricLinkFieldSpec is not supported for table filters',
      ],
    ] as const;

    for (const [methodName, message] of unsupportedMethods) {
      const result = (
        visitor as Record<
          string,
          (spec: unknown) => {
            isErr(): boolean;
            _unsafeUnwrapErr(): { message: string; type: string };
          }
        >
      )[methodName](undefined);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'validation.invalid',
        message,
      });
    }
  });

  it('clones the visitor and combines expressions with and/or/not', () => {
    const visitor = new TableWhereVisitor('all');
    const eb = createExpressionBuilder();
    const left = () => ({ type: 'comparison', args: ['id', '=', 'left'] });
    const right = () => ({ type: 'comparison', args: ['id', '=', 'right'] });

    expect(visitor.clone()).toBeInstanceOf(TableWhereVisitor);
    expect(visitor.and(left as never, right as never)(eb as never)).toEqual({
      type: 'and',
      args: [left(), right()],
    });
    expect(visitor.or(left as never, right as never)(eb as never)).toEqual({
      type: 'or',
      args: [left(), right()],
    });
    expect(visitor.not(left as never)(eb as never)).toEqual({
      type: 'not',
      arg: left(),
    });
  });
});
