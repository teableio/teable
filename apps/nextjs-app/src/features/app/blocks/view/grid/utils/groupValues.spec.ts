import type { IGroupHeaderPoint, IGroupPoint } from '@teable/openapi';
import { GroupPointType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { getGroupValuesByRowIndex } from './groupValues';

const header = (depth: number, value: unknown): IGroupHeaderPoint => ({
  id: `grp-${depth}-${String(value)}`,
  type: GroupPointType.Header,
  depth,
  value,
  isCollapsed: false,
});

const rows = (count: number): IGroupPoint => ({ type: GroupPointType.Row, count });

describe('getGroupValuesByRowIndex', () => {
  it('resolves single-level group values by row index', () => {
    const points = [header(0, 'A'), rows(2), header(0, 'B'), rows(3)];

    expect(getGroupValuesByRowIndex(points, 0)).toEqual(['A']);
    expect(getGroupValuesByRowIndex(points, 1)).toEqual(['A']);
    expect(getGroupValuesByRowIndex(points, 2)).toEqual(['B']);
    expect(getGroupValuesByRowIndex(points, 4)).toEqual(['B']);
  });

  it('resolves nested chains and truncates deeper levels when a parent changes', () => {
    const points = [
      header(0, 'A'),
      header(1, 'a1'),
      rows(1),
      header(1, 'a2'),
      rows(2),
      header(0, 'B'),
      header(1, 'b1'),
      rows(1),
    ];

    expect(getGroupValuesByRowIndex(points, 0)).toEqual(['A', 'a1']);
    expect(getGroupValuesByRowIndex(points, 1)).toEqual(['A', 'a2']);
    expect(getGroupValuesByRowIndex(points, 2)).toEqual(['A', 'a2']);
    expect(getGroupValuesByRowIndex(points, 3)).toEqual(['B', 'b1']);
  });

  it('keeps null group values so the empty bucket prefills as empty', () => {
    const points = [header(0, null), rows(1), header(0, 'A'), rows(1)];

    expect(getGroupValuesByRowIndex(points, 0)).toEqual([null]);
    expect(getGroupValuesByRowIndex(points, 1)).toEqual(['A']);
  });

  it('skips the synthetic overflow bucket instead of prefilling its label', () => {
    const overflowHeader: IGroupHeaderPoint = {
      id: 'unknown',
      type: GroupPointType.Header,
      depth: 0,
      value: 'Unknown',
      isCollapsed: false,
    };
    const points = [header(0, 'A'), rows(2), overflowHeader, rows(3)];

    expect(getGroupValuesByRowIndex(points, 1)).toEqual(['A']);
    expect(getGroupValuesByRowIndex(points, 2)).toBeUndefined();
    expect(getGroupValuesByRowIndex(points, 4)).toBeUndefined();
  });

  it('returns undefined when out of range or without group points', () => {
    const points = [header(0, 'A'), rows(2)];

    expect(getGroupValuesByRowIndex(points, 2)).toBeUndefined();
    expect(getGroupValuesByRowIndex(points, -1)).toBeUndefined();
    expect(getGroupValuesByRowIndex(null, 0)).toBeUndefined();
    expect(getGroupValuesByRowIndex(undefined, 0)).toBeUndefined();
    expect(getGroupValuesByRowIndex([], 0)).toBeUndefined();
  });
});
