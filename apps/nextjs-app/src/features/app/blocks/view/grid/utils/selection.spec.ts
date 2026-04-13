import { SelectionRegionType } from '@teable/sdk/components';
import type { CombinedSelection } from '@teable/sdk/components';
import { describe, expect, it } from 'vitest';

import {
  DELETE_SELECTION_STREAM_ROW_THRESHOLD,
  DUPLICATE_SELECTION_STREAM_ROW_THRESHOLD,
  getEffectRows,
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
});
