import type { IGridColumnMeta } from '@teable/core';
import { StatisticsFunc } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { buildStatisticFieldMap, formatAttachmentSize } from './statistic';

const columnMeta = {
  fldVisibleSum: { order: 0, statisticFunc: StatisticsFunc.Sum },
  fldVisibleAvg: { order: 1, statisticFunc: StatisticsFunc.Average },
  fldHiddenSum: { order: 2, statisticFunc: StatisticsFunc.Sum, hidden: true },
  fldNoFunc: { order: 3 },
} as unknown as IGridColumnMeta;

describe('buildStatisticFieldMap', () => {
  it('groups fields by statistic func and skips columns without one', () => {
    expect(buildStatisticFieldMap(columnMeta)).toEqual({
      [StatisticsFunc.Sum]: ['fldVisibleSum', 'fldHiddenSum'],
      [StatisticsFunc.Average]: ['fldVisibleAvg'],
    });
  });

  it('drops columns outside the visible set (hidden columns must not be requested)', () => {
    expect(
      buildStatisticFieldMap(columnMeta, ['fldVisibleSum', 'fldVisibleAvg', 'fldNoFunc'])
    ).toEqual({
      [StatisticsFunc.Sum]: ['fldVisibleSum'],
      [StatisticsFunc.Average]: ['fldVisibleAvg'],
    });
  });

  it('returns an empty map for empty visible set or missing columnMeta', () => {
    expect(buildStatisticFieldMap(columnMeta, [])).toEqual({});
    expect(buildStatisticFieldMap(undefined)).toEqual({});
  });
});

describe('formatAttachmentSize', () => {
  it.each([
    [0, '0 B'],
    [1024, '1 KB'],
    [1.5 * 1024 ** 2, '1.5 MB'],
    [1024 ** 2 - 1, '1 MB'],
    [3322.55 * 1024 ** 2, '3.24 GB'],
    [1024 ** 3 - 1, '1 GB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatAttachmentSize(bytes)).toBe(expected);
  });
});
