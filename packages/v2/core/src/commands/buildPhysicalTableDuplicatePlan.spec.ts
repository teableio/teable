import { describe, expect, it } from 'vitest';

import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import type { ITablePersistenceDTO } from '../ports/mappers/TableMapper';
import {
  buildPhysicalTableDuplicatePlan,
  canUsePhysicalTableDuplicate,
} from './buildPhysicalTableDuplicatePlan';

const tableMapper = new DefaultTableMapper();

const baseId = `bse${'a'.repeat(16)}`;
const sourceTableId = `tbl${'b'.repeat(16)}`;
const targetTableId = `tbl${'c'.repeat(16)}`;
const sourceFieldId = `fld${'d'.repeat(16)}`;
const targetFieldId = `fld${'e'.repeat(16)}`;
const sourceViewId = `viw${'f'.repeat(16)}`;
const targetViewId = `viw${'g'.repeat(16)}`;
const linkFieldId = `fld${'h'.repeat(16)}`;

const createPlainTable = (
  tableId: string,
  fieldId: string,
  viewId: string,
  fieldDbName: string
) => {
  const dto: ITablePersistenceDTO = {
    id: tableId,
    baseId,
    name: 'Plain',
    dbTableName: `${baseId}.${tableId}`,
    primaryFieldId: fieldId,
    fields: [
      {
        id: fieldId,
        name: 'Title',
        type: 'singleLineText',
        dbFieldName: fieldDbName,
      },
    ],
    views: [
      {
        id: viewId,
        type: 'grid',
        name: 'Grid',
        columnMeta: {
          [fieldId]: { order: 0 },
        },
      },
    ],
  };
  return tableMapper.toDomain(dto)._unsafeUnwrap();
};

const createTableWithFormula = (params: {
  tableId: string;
  textFieldId: string;
  formulaFieldId: string;
  viewId: string;
  textDbName: string;
  formulaDbName: string;
}) => {
  const dto: ITablePersistenceDTO = {
    id: params.tableId,
    baseId,
    name: 'With Formula',
    dbTableName: `${baseId}.${params.tableId}`,
    primaryFieldId: params.textFieldId,
    fields: [
      {
        id: params.textFieldId,
        name: 'Title',
        type: 'singleLineText',
        dbFieldName: params.textDbName,
      },
      {
        id: params.formulaFieldId,
        name: 'Formula',
        type: 'formula',
        dbFieldName: params.formulaDbName,
        options: {
          expression: `{${params.textFieldId}}`,
          timeZone: 'UTC',
        },
      },
    ],
    views: [
      {
        id: params.viewId,
        type: 'grid',
        name: 'Grid',
        columnMeta: {
          [params.textFieldId]: { order: 0 },
          [params.formulaFieldId]: { order: 1 },
        },
      },
    ],
  };
  return tableMapper.toDomain(dto)._unsafeUnwrap();
};

describe('buildPhysicalTableDuplicatePlan', () => {
  it('rejects tables with link fields', () => {
    const dto: ITablePersistenceDTO = {
      id: sourceTableId,
      baseId,
      name: 'With Link',
      dbTableName: `${baseId}.${sourceTableId}`,
      primaryFieldId: sourceFieldId,
      fields: [
        {
          id: sourceFieldId,
          name: 'Title',
          type: 'singleLineText',
          dbFieldName: 'Title',
        },
        {
          id: linkFieldId,
          name: 'Related',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: sourceTableId,
            lookupFieldId: sourceFieldId,
            isOneWay: true,
            fkHostTableName: `${baseId}.__related`,
            selfKeyName: '__id',
            foreignKeyName: '__fk_related',
          },
        },
      ],
      views: [
        {
          id: sourceViewId,
          type: 'grid',
          name: 'Grid',
          columnMeta: { [sourceFieldId]: { order: 0 } },
        },
      ],
    };
    const table = tableMapper.toDomain(dto)._unsafeUnwrap();
    expect(canUsePhysicalTableDuplicate(table)).toBe(false);
  });

  it('builds INSERT…SELECT column map with system columns, field remap, and view order', () => {
    const source = createPlainTable(sourceTableId, sourceFieldId, sourceViewId, 'Title');
    const target = createPlainTable(targetTableId, targetFieldId, targetViewId, 'Title_copy');

    const plan = buildPhysicalTableDuplicatePlan({
      sourceTable: source,
      targetTable: target,
      fieldIdMap: new Map([[sourceFieldId, targetFieldId]]),
      viewIdMap: new Map([[sourceViewId, targetViewId]]),
    })._unsafeUnwrap();

    expect(plan.sourceTableName).toBe(`${baseId}.${sourceTableId}`);
    expect(plan.targetTableName).toBe(`${baseId}.${targetTableId}`);
    expect(plan.ensureTargetOrderColumns).toEqual([targetViewId]);

    expect(plan.columns).toEqual(
      expect.arrayContaining([
        { targetColumn: '__id', sourceSql: '"__id"' },
        { targetColumn: '__created_by', sourceSql: '"__created_by"' },
        { targetColumn: '__version', sourceSql: '1' },
        { targetColumn: 'Title_copy', sourceSql: '"Title"' },
        {
          targetColumn: `__row_${targetViewId}`,
          sourceSql: `"__row_${sourceViewId}"`,
        },
      ])
    );
    expect(plan.columns.some((column) => column.targetColumn === '__auto_number')).toBe(false);
  });

  it('includes computed formula columns in the physical column map', () => {
    const sourceTextFieldId = `fld${'i'.repeat(16)}`;
    const sourceFormulaFieldId = `fld${'j'.repeat(16)}`;
    const targetTextFieldId = `fld${'k'.repeat(16)}`;
    const targetFormulaFieldId = `fld${'l'.repeat(16)}`;

    const source = createTableWithFormula({
      tableId: sourceTableId,
      textFieldId: sourceTextFieldId,
      formulaFieldId: sourceFormulaFieldId,
      viewId: sourceViewId,
      textDbName: 'Title',
      formulaDbName: 'Formula',
    });
    const target = createTableWithFormula({
      tableId: targetTableId,
      textFieldId: targetTextFieldId,
      formulaFieldId: targetFormulaFieldId,
      viewId: targetViewId,
      textDbName: 'Title_copy',
      formulaDbName: 'Formula_copy',
    });

    const plan = buildPhysicalTableDuplicatePlan({
      sourceTable: source,
      targetTable: target,
      fieldIdMap: new Map([
        [sourceTextFieldId, targetTextFieldId],
        [sourceFormulaFieldId, targetFormulaFieldId],
      ]),
      viewIdMap: new Map([[sourceViewId, targetViewId]]),
    })._unsafeUnwrap();

    expect(plan.columns).toEqual(
      expect.arrayContaining([
        { targetColumn: 'Title_copy', sourceSql: '"Title"' },
        { targetColumn: 'Formula_copy', sourceSql: '"Formula"' },
      ])
    );
  });
});
