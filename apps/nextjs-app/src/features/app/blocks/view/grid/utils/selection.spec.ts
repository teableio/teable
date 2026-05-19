import { SelectionRegionType } from '@teable/sdk/components';
import type { CombinedSelection } from '@teable/sdk/components';
import { describe, expect, it } from 'vitest';

import {
  DELETE_SELECTION_STREAM_ROW_THRESHOLD,
  DUPLICATE_SELECTION_STREAM_ROW_THRESHOLD,
  getEffectRows,
  selectionIncludesEditableField,
  shouldUseDeleteSelectionStream,
  shouldUseDuplicateSelectionStream,
} from './selection';

describe('selection delete stream helpers', () => {
  it('counts effective rows for row selections', () => {
    const selection = {
      type: SelectionRegionType.Rows,
      ranges: [
        [0, 2],
        [5, 6],
      ],
    } as unknown as CombinedSelection;

    expect(getEffectRows(selection)).toBe(5);
  });

  it('enables stream delete only when the selection exceeds the threshold', () => {
    const belowThreshold = {
      type: SelectionRegionType.Cells,
      ranges: [
        [0, 0],
        [0, DELETE_SELECTION_STREAM_ROW_THRESHOLD - 1],
      ],
    } as unknown as CombinedSelection;

    const atThreshold = {
      type: SelectionRegionType.Rows,
      ranges: [[0, DELETE_SELECTION_STREAM_ROW_THRESHOLD - 1]],
    } as unknown as CombinedSelection;

    const aboveThreshold = {
      type: SelectionRegionType.Rows,
      ranges: [[0, DELETE_SELECTION_STREAM_ROW_THRESHOLD]],
    } as unknown as CombinedSelection;

    expect(shouldUseDeleteSelectionStream(belowThreshold)).toBe(false);
    expect(shouldUseDeleteSelectionStream(atThreshold)).toBe(false);
    expect(shouldUseDeleteSelectionStream(aboveThreshold)).toBe(true);
  });

  it('enables stream duplicate only when the selection exceeds the threshold', () => {
    const atThreshold = {
      type: SelectionRegionType.Rows,
      ranges: [[0, DUPLICATE_SELECTION_STREAM_ROW_THRESHOLD - 1]],
    } as unknown as CombinedSelection;

    const aboveThreshold = {
      type: SelectionRegionType.Rows,
      ranges: [[0, DUPLICATE_SELECTION_STREAM_ROW_THRESHOLD]],
    } as unknown as CombinedSelection;

    expect(shouldUseDuplicateSelectionStream(atThreshold)).toBe(false);
    expect(shouldUseDuplicateSelectionStream(aboveThreshold)).toBe(true);
  });

  it('detects when a cell selection only targets computed fields', () => {
    const selection = {
      type: SelectionRegionType.Cells,
      ranges: [
        [1, 0],
        [1, 2],
      ],
      serialize: () => [
        [1, 0],
        [1, 2],
      ],
    } as unknown as CombinedSelection;
    const fields = [{ isComputed: false }, { isComputed: true }] as unknown as Parameters<
      typeof selectionIncludesEditableField
    >[1];

    expect(selectionIncludesEditableField(selection, fields)).toBe(false);
  });

  it('detects editable fields across mixed cell and column selections', () => {
    const fields = [
      { isComputed: true },
      { isComputed: false },
      { isComputed: true },
    ] as unknown as Parameters<typeof selectionIncludesEditableField>[1];

    const cellSelection = {
      type: SelectionRegionType.Cells,
      ranges: [
        [0, 0],
        [1, 0],
      ],
      serialize: () => [
        [0, 0],
        [1, 0],
      ],
    } as unknown as CombinedSelection;

    const columnSelection = {
      type: SelectionRegionType.Columns,
      ranges: [[2, 2]],
    } as unknown as CombinedSelection;

    expect(selectionIncludesEditableField(cellSelection, fields)).toBe(true);
    expect(selectionIncludesEditableField(columnSelection, fields)).toBe(false);
  });
});
