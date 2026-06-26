import { CellValueType, FieldType, RowHeightLevel, ViewType } from '@teable/core';
import type { IImportAirtableIssue } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import type { IAirtableViewConfig } from './airtable-share.client';
import {
  mapAirtableViewConfig,
  type IImportFieldMeta,
  type IViewConfigMapperContext,
} from './airtable-view-config-mapper';

const field = (
  fieldId: string,
  type: FieldType,
  cellValueType: CellValueType,
  isMultipleCellValue = false
): IImportFieldMeta => ({ fieldId, type, cellValueType, isMultipleCellValue });

const fields: Record<string, IImportFieldMeta> = {
  colText: field('fldText', FieldType.SingleLineText, CellValueType.String),
  colNum: field('fldNum', FieldType.Number, CellValueType.Number),
  colSel: field('fldSel', FieldType.SingleSelect, CellValueType.String),
  colDate: field('fldDate', FieldType.Date, CellValueType.DateTime),
  colUser: field('fldUser', FieldType.User, CellValueType.String),
  colLink: field('fldLink', FieldType.Link, CellValueType.String, true),
  colAtt: field('fldAtt', FieldType.Attachment, CellValueType.String, true),
};

const ctx: IViewConfigMapperContext = {
  resolveField: (columnId) => fields[columnId],
  resolveSelectOptionName: (columnId, optionId) =>
    columnId === 'colSel' ? { optHigh: 'High', optLow: 'Low' }[optionId] : undefined,
};

const emptyConfig = (over: Partial<IAirtableViewConfig> = {}): IAirtableViewConfig => ({
  filters: null,
  sorts: null,
  groupLevels: null,
  metadata: undefined,
  ...over,
});

const run = (config: IAirtableViewConfig, teableViewType = ViewType.Grid) => {
  const issues: IImportAirtableIssue[] = [];
  const result = mapAirtableViewConfig({
    teableViewType,
    config,
    ctx,
    tableName: 'T',
    viewName: 'V',
    issues,
  });
  return { result, issues };
};

const filterOf = (...leaves: Array<{ columnId: string; operator: string; value: unknown }>) =>
  emptyConfig({ filters: { conjunction: 'and', filterSet: leaves } });

describe('mapAirtableViewConfig filters', () => {
  it('maps text, number and select operators with mapped field ids and option names', () => {
    const { result } = run(
      filterOf(
        { columnId: 'colText', operator: 'contains', value: '1' },
        { columnId: 'colNum', operator: '>', value: 5 },
        { columnId: 'colSel', operator: 'isAnyOf', value: ['optHigh', 'optLow'] }
      )
    );
    expect(result.filter).toEqual({
      conjunction: 'and',
      filterSet: [
        { fieldId: 'fldText', operator: 'contains', value: '1' },
        { fieldId: 'fldNum', operator: 'isGreater', value: 5 },
        { fieldId: 'fldSel', operator: 'isAnyOf', value: ['High', 'Low'] },
      ],
    });
  });

  it('keeps empty/not-empty with a null value and maps a date condition to a mode object', () => {
    const { result } = run(
      filterOf(
        { columnId: 'colText', operator: 'isEmpty', value: null },
        { columnId: 'colDate', operator: '=', value: { mode: 'today' } }
      )
    );
    expect(result.filter?.filterSet).toEqual([
      { fieldId: 'fldText', operator: 'isEmpty', value: null },
      { fieldId: 'fldDate', operator: 'is', value: { mode: 'today', timeZone: 'UTC' } },
    ]);
  });

  it('drops conditions that cannot be converted and reports them, never guessing', () => {
    // attachment filename has no Teable equivalent; a link condition references
    // specific records that cannot be remapped; an unknown field is skipped.
    const { result, issues } = run(
      filterOf(
        { columnId: 'colAtt', operator: 'filename', value: 'a.png' },
        { columnId: 'colLink', operator: 'isAnyOf', value: ['rec1'] },
        { columnId: 'colLink', operator: 'isEmpty', value: null },
        { columnId: 'colGone', operator: 'contains', value: 'x' }
      )
    );
    // Only the link "is empty" condition survives.
    expect(result.filter?.filterSet).toEqual([
      { fieldId: 'fldLink', operator: 'isEmpty', value: null },
    ]);
    expect(issues.every((issue) => issue.code === 'viewConfigDegraded')).toBe(true);
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('mapAirtableViewConfig sort, group and options', () => {
  it('maps sorts and grid grouping by order', () => {
    const { result } = run(
      emptyConfig({
        sorts: [
          { columnId: 'colText', ascending: true },
          { columnId: 'colNum', ascending: false },
        ],
        groupLevels: [{ columnId: 'colSel', order: 'descending' }],
      })
    );
    expect(result.sort).toEqual({
      sortObjs: [
        { fieldId: 'fldText', order: 'asc' },
        { fieldId: 'fldNum', order: 'desc' },
      ],
      manualSort: false,
    });
    expect(result.group).toEqual([{ fieldId: 'fldSel', order: 'desc' }]);
  });

  it('reads the kanban stack from the group level (a collaborator field, not a guess)', () => {
    const { result } = run(
      emptyConfig({
        groupLevels: [{ columnId: 'colUser', order: 'ascending' }],
        metadata: { kanban: { coverColumnId: 'colAtt' } },
      }),
      ViewType.Kanban
    );
    // For kanban the group level is the stack field; no row grouping is emitted.
    expect(result.group).toBeUndefined();
    expect(result.options).toEqual({ stackFieldId: 'fldUser', coverFieldId: 'fldAtt' });
  });

  it('maps known grid row heights and degrades unknown ones', () => {
    expect(run(emptyConfig({ metadata: { grid: { rowHeight: 'tall' } } })).result.options).toEqual({
      rowHeight: RowHeightLevel.Tall,
    });
    const unknown = run(emptyConfig({ metadata: { grid: { rowHeight: 'gigantic' } } }));
    expect(unknown.result.options).toBeUndefined();
    expect(unknown.issues[0]?.code).toBe('viewConfigDegraded');
  });
});
