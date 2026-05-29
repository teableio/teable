import { SortFunc, type IRecord } from '@teable/core';
import type { IGetRecordsRo, IGroupPointsVo } from '@teable/openapi';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearch } from '../../../hooks';
import { useRecords } from '../../../hooks/use-records';
import { useGridAsyncRecords } from './use-grid-async-records';

vi.mock('../../../hooks', () => ({
  useSearch: vi.fn(),
}));

vi.mock('../../../hooks/use-records', () => ({
  useRecords: vi.fn(),
}));

const mockedUseSearch = vi.mocked(useSearch);
const mockedUseRecords = vi.mocked(useRecords);

const createRecord = (id: string) => ({ id, fields: {} }) as IRecord;
const mockUseRecordsResult = (records: IRecord[], extra?: unknown): ReturnType<typeof useRecords> =>
  ({
    records,
    extra,
  }) as unknown as ReturnType<typeof useRecords>;

describe('useGridAsyncRecords', () => {
  beforeEach(() => {
    mockedUseSearch.mockReturnValue({ searchQuery: undefined } as ReturnType<typeof useSearch>);
    mockedUseRecords.mockReset();
  });

  it('keeps SSR records and group points on the initial render', () => {
    mockedUseRecords.mockReturnValue(mockUseRecordsResult([createRecord('recSsr')]));

    const initGroupPoints = [{ id: 'grpSsr' }] as IGroupPointsVo;
    const { result } = renderHook(() =>
      useGridAsyncRecords([createRecord('recSsr')], undefined, undefined, initGroupPoints)
    );

    expect(result.current.recordMap[0]?.id).toBe('recSsr');
    expect(result.current.groupPoints).toBe(initGroupPoints);
  });

  it('clears stale records and group points when the record query scope changes', async () => {
    let records = [createRecord('recOld')];
    let extra = { groupPoints: [{ id: 'grpOld' }] as IGroupPointsVo };
    mockedUseRecords.mockImplementation(() => mockUseRecordsResult(records, extra));

    const initGroupPoints = [{ id: 'grpSsr' }] as IGroupPointsVo;
    const oldQuery = {
      groupBy: [{ fieldId: 'fldOldGroup', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;
    const newQuery = {
      groupBy: [{ fieldId: 'fldNewGroup', order: SortFunc.Asc }],
    } as Pick<IGetRecordsRo, 'groupBy'>;

    const { result, rerender } = renderHook(
      ({ outerQuery }) => useGridAsyncRecords(undefined, undefined, outerQuery, initGroupPoints),
      { initialProps: { outerQuery: oldQuery } }
    );

    expect(result.current.recordMap[0]?.id).toBe('recOld');
    expect(result.current.groupPoints).toEqual(extra.groupPoints);

    records = [createRecord('recNew')];
    extra = undefined as unknown as typeof extra;
    rerender({ outerQuery: newQuery });

    await waitFor(() => {
      expect(result.current.recordMap).toEqual({});
      expect(result.current.groupPoints).toBeNull();
    });
  });

  it('does not keep empty cache slots in the loaded record map when loading a later window', async () => {
    mockedUseRecords.mockReturnValue(
      mockUseRecordsResult([createRecord('rec1'), createRecord('rec2')])
    );

    const initQuery = { skip: 3300, take: 300 };
    const { result } = renderHook(() => useGridAsyncRecords(undefined, initQuery));

    await waitFor(() => {
      expect(Object.keys(result.current.recordMap)).toEqual(['3300', '3301']);
    });
  });
});
