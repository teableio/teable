/* eslint-disable @typescript-eslint/naming-convention */
import type { IGroupPoint } from '@teable/openapi';
import { GroupPointType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { applyCollapsedGroupChange, collectGroupRowCounts } from './collapsed-group';

const header = (id: string, depth = 0, isCollapsed = false): IGroupPoint => ({
  id,
  type: GroupPointType.Header,
  depth,
  value: id,
  isCollapsed,
});

const rows = (count: number): IGroupPoint => ({ type: GroupPointType.Row, count });

const mapOf = (...indexes: number[]) =>
  Object.fromEntries(indexes.map((index) => [index, `r${index}`])) as {
    [index: number]: string;
  };

describe('applyCollapsedGroupChange', () => {
  it('collapses a group in place and shifts the rows behind it up', () => {
    const points = [header('a'), rows(3), header('b'), rows(2), header('c'), rows(1)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1, 2, 3, 4, 5),
      new Set(['b'])
    );

    expect(groupPoints).toEqual([header('a'), rows(3), header('b', 0, true), header('c'), rows(1)]);
    expect(recordMap).toEqual({ 0: 'r0', 1: 'r1', 2: 'r2', 3: 'r5' });
  });

  it('expands a group, keeping rows ahead and dropping rows behind it', () => {
    const points = [header('a'), rows(3), header('b', 0, true), header('c'), rows(1)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1, 2, 3),
      new Set()
    );

    expect(groupPoints).toEqual([header('a'), rows(3), header('b'), header('c'), rows(1)]);
    expect(recordMap).toEqual({ 0: 'r0', 1: 'r1', 2: 'r2' });
  });

  it('collapsing a parent drops its sub-headers and all covered rows', () => {
    const points = [
      header('a', 0),
      header('a1', 1),
      rows(2),
      header('a2', 1),
      rows(1),
      header('b', 0),
      header('b1', 1),
      rows(2),
    ];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1, 2, 3, 4),
      new Set(['a'])
    );

    expect(groupPoints).toEqual([header('a', 0, true), header('b', 0), header('b1', 1), rows(2)]);
    expect(recordMap).toEqual({ 0: 'r3', 1: 'r4' });
  });

  it('collapsing a sub-group keeps its peers and parent intact', () => {
    const points = [header('a', 0), header('a1', 1), rows(2), header('a2', 1), rows(1)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1, 2),
      new Set(['a1'])
    );

    expect(groupPoints).toEqual([header('a', 0), header('a1', 1, true), header('a2', 1), rows(1)]);
    expect(recordMap).toEqual({ 0: 'r2' });
  });

  it('handles collapsing several groups at once', () => {
    const points = [header('a'), rows(2), header('b'), rows(1)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1, 2),
      new Set(['a', 'b'])
    );

    expect(groupPoints).toEqual([header('a', 0, true), header('b', 0, true)]);
    expect(recordMap).toEqual({});
  });

  it('handles a mixed expand and collapse in one change', () => {
    const points = [header('a', 0, true), header('b'), rows(2), header('c'), rows(3)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1, 2, 3, 4),
      new Set(['b'])
    );

    expect(groupPoints).toEqual([header('a'), header('b', 0, true), header('c'), rows(3)]);
    // everything sits behind the expanded group "a", whose row count is unknown
    expect(recordMap).toEqual({});
  });

  it('keeps groups already collapsed on both sides untouched', () => {
    const points = [header('a', 0, true), header('b'), rows(2)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1),
      new Set(['a'])
    );

    expect(groupPoints).toEqual(points);
    expect(recordMap).toEqual({ 0: 'r0', 1: 'r1' });
  });

  it('drops loaded rows outside any kept segment', () => {
    const points = [header('a'), rows(2)];
    const { recordMap } = applyCollapsedGroupChange(
      points,
      // index 7 is beyond the grouped rows (stale tail)
      mapOf(0, 1, 7),
      new Set()
    );

    expect(recordMap).toEqual({ 0: 'r0', 1: 'r1' });
  });

  it('places nothing when no layout is known yet', () => {
    const { groupPoints, recordMap } = applyCollapsedGroupChange(null, mapOf(0, 1), new Set(['a']));

    expect(groupPoints).toBeNull();
    expect(recordMap).toEqual({});
  });

  it('restores an expanded group row block in place when its size is known', () => {
    const points = [header('a', 0, true), header('b'), rows(2)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(points, mapOf(0, 1), new Set(), {
      a: 3,
    });

    expect(groupPoints).toEqual([header('a'), rows(3), header('b'), rows(2)]);
    // group B's rows keep their content, shifted by the restored block
    expect(recordMap).toEqual({ 3: 'r0', 4: 'r1' });
  });

  it('keeps rows behind an expanded group with a known count of zero', () => {
    const points = [header('a', 0, true), header('b'), rows(2)];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(points, mapOf(0, 1), new Set(), {
      a: 0,
    });

    // no row block to restore — everything behind stays exactly in place
    expect(groupPoints).toEqual([header('a'), header('b'), rows(2)]);
    expect(recordMap).toEqual({ 0: 'r0', 1: 'r1' });
  });

  it('keeps rows placeable up to the first expanded group of unknown size', () => {
    const points = [
      header('a', 0, true),
      header('b'),
      rows(1),
      header('c', 0, true),
      header('d'),
      rows(2),
    ];
    const { groupPoints, recordMap } = applyCollapsedGroupChange(
      points,
      mapOf(0, 1, 2),
      new Set(),
      { a: 2 }
    );

    expect(groupPoints).toEqual([
      header('a'),
      rows(2),
      header('b'),
      rows(1),
      header('c'),
      header('d'),
      rows(2),
    ]);
    // b's row rides the known +2 shift; rows behind the unknown-size c drop
    expect(recordMap).toEqual({ 2: 'r0' });
  });
});

describe('collectGroupRowCounts', () => {
  it('sums visible rows per group across depths', () => {
    const points = [
      header('a', 0),
      header('a1', 1),
      rows(2),
      header('a2', 1),
      rows(1),
      header('b', 0),
      rows(4),
    ];

    expect(collectGroupRowCounts(points)).toEqual({ a: 3, a1: 2, a2: 1, b: 4 });
  });

  it('records nothing for collapsed groups so merged caches keep their last value', () => {
    const points = [header('a', 0, true), header('b'), rows(2)];

    expect(collectGroupRowCounts(points)).toEqual({ b: 2 });
  });

  it('records a true zero for an expanded group whose subtree is collapsed', () => {
    // "a" is expanded but shows no rows: its visible count really is zero,
    // and recording it overwrites a count that went stale when the children
    // were collapsed
    const points = [header('a', 0), header('a1', 1, true), header('b', 0), rows(2)];

    expect(collectGroupRowCounts(points)).toEqual({ a: 0, b: 2 });
  });
});
