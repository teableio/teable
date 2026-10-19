import type { IFieldVo, IViewVo } from '@teable/core';
import { FieldType, ViewType } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { getFields, getRecords, getViewList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTableSeed, resolveSeedVisibleFieldIds } from './use-table-seed';

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    getFields: vi.fn(),
    getViewList: vi.fn(),
    getRecords: vi.fn(),
  };
});

const mockedGetFields = vi.mocked(getFields);
const mockedGetViewList = vi.mocked(getViewList);
const mockedGetRecords = vi.mocked(getRecords);

const field = (id: string, name: string, isPrimary = false): IFieldVo =>
  ({
    id,
    name,
    type: FieldType.SingleLineText,
    isPrimary,
    options: {},
  }) as unknown as IFieldVo;

const fields = [
  field('fldPrimary', 'Title', true),
  field('fldHidden', 'Hidden'),
  field('fldVisible', 'Visible'),
];
const view = {
  id: 'viwTarget',
  name: 'Target',
  type: ViewType.Grid,
  columnMeta: {
    fldPrimary: { order: 0 },
    fldHidden: { order: 1, hidden: true },
    fldVisible: { order: 2 },
  },
  sort: { sortObjs: [], manualSort: false },
} as unknown as IViewVo;

describe('resolveSeedVisibleFieldIds', () => {
  it('orders the visible fields by the view column order and skips hidden ones', () => {
    const shuffled = [fields[2], fields[1], fields[0]];

    expect(resolveSeedVisibleFieldIds(shuffled, view)).toEqual(['fldPrimary', 'fldVisible']);
  });

  it('keeps every field when there is no view to scope them', () => {
    expect(resolveSeedVisibleFieldIds(fields, undefined)).toEqual([
      'fldPrimary',
      'fldHidden',
      'fldVisible',
    ]);
  });

  it('handles a missing field list', () => {
    expect(resolveSeedVisibleFieldIds(undefined, view)).toEqual([]);
  });
});

describe('fetchTableSeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds every field, unscoped by view, and projects the view-visible ones', async () => {
    mockedGetFields.mockResolvedValue({ data: fields } as never);
    mockedGetViewList.mockResolvedValue({ data: [view] } as never);
    mockedGetRecords.mockResolvedValue({
      data: { records: [], extra: { groupPoints: null } },
    } as never);

    const seed = await fetchTableSeed('tblTarget', 'viwTarget');

    // a view-scoped field query drops the view's hidden fields
    expect(mockedGetFields).toHaveBeenCalledWith('tblTarget');
    expect(seed.fields).toEqual(fields);

    const [, recordsQuery] = mockedGetRecords.mock.calls[0];
    expect(recordsQuery?.projection).toContain('fldPrimary');
    expect(recordsQuery?.projection).toContain('fldVisible');
    expect(recordsQuery?.projection).not.toContain('fldHidden');
  });

  it('asks for the grouped seed with the current collapse state', async () => {
    const groupedView = {
      ...view,
      group: [{ fieldId: 'fldPrimary', order: 'asc' }],
    } as unknown as IViewVo;
    mockedGetFields.mockResolvedValue({ data: fields } as never);
    mockedGetViewList.mockResolvedValue({ data: [groupedView] } as never);
    mockedGetRecords.mockResolvedValue({
      data: { records: [], extra: { groupPoints: null } },
    } as never);

    await fetchTableSeed('tblTarget', 'viwTarget', ['grpCollapsed']);

    const groupedCall = mockedGetRecords.mock.calls.at(-1);
    expect(groupedCall?.[1]).toMatchObject({
      groupBy: groupedView.group,
      collapsedGroupIds: ['grpCollapsed'],
    });
  });
});

describe('seed cache identity', () => {
  it('keys the seed by the navigation-time collapse state', () => {
    const collapsed = ReactQueryKeys.tableSeed('tblT', 'viwV', ['grpA']);

    expect(collapsed).toEqual(['table-seed', 'tblT', 'viwV', ['grpA']]);
    expect(collapsed).not.toEqual(ReactQueryKeys.tableSeed('tblT', 'viwV'));
    expect(collapsed).not.toEqual(ReactQueryKeys.tableSeed('tblT', 'viwV', ['grpB']));
  });
});
