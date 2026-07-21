import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DELETE_STREAM_BATCH_SIZE,
  DEFAULT_SELECTION_STREAM_BATCH_SIZE,
  DEFAULT_RESTORE_RECORDS_BATCH_SIZE,
  MAX_SELECTION_STREAM_BATCH_SIZE,
  resolveDeleteStreamBatchSize,
  resolveRestoreRecordsBatchSize,
  resolveSelectionStreamBatchSize,
  TARGET_SELECTION_STREAM_CHUNK_COUNT,
} from './streamBatchSize';

describe('resolveSelectionStreamBatchSize', () => {
  it('keeps the default batch size for small selections', () => {
    expect(resolveSelectionStreamBatchSize(1)).toBe(DEFAULT_SELECTION_STREAM_BATCH_SIZE);
    expect(resolveSelectionStreamBatchSize(DEFAULT_SELECTION_STREAM_BATCH_SIZE * 5)).toBe(
      DEFAULT_SELECTION_STREAM_BATCH_SIZE
    );
  });

  it('scales batch size up to keep chunk count near the target for large selections', () => {
    expect(resolveSelectionStreamBatchSize(5_000)).toBe(250);
    expect(resolveSelectionStreamBatchSize(20_000)).toBe(MAX_SELECTION_STREAM_BATCH_SIZE);
    expect(Math.ceil(20_000 / resolveSelectionStreamBatchSize(20_000))).toBeLessThanOrEqual(
      TARGET_SELECTION_STREAM_CHUNK_COUNT
    );
  });

  it('preserves explicit caller-provided batch sizes', () => {
    expect(resolveSelectionStreamBatchSize(20_000, 50)).toBe(50);
    expect(resolveSelectionStreamBatchSize(20_000, 2_000)).toBe(MAX_SELECTION_STREAM_BATCH_SIZE);
  });

  it('uses bounded delete-specific chunks while preserving explicit smaller sizes', () => {
    expect(resolveDeleteStreamBatchSize(0)).toBe(DEFAULT_DELETE_STREAM_BATCH_SIZE);
    expect(resolveDeleteStreamBatchSize(1_000)).toBe(1_000);
    expect(resolveDeleteStreamBatchSize(10_000)).toBe(DEFAULT_DELETE_STREAM_BATCH_SIZE);
    expect(resolveDeleteStreamBatchSize(30_000)).toBe(DEFAULT_DELETE_STREAM_BATCH_SIZE);
    expect(resolveDeleteStreamBatchSize(30_000, 250)).toBe(250);
    expect(resolveDeleteStreamBatchSize(30_000, 10_000)).toBe(MAX_SELECTION_STREAM_BATCH_SIZE);
  });

  it('keeps restore batching at the 500 baseline until large undos need larger chunks', () => {
    expect(resolveRestoreRecordsBatchSize(0)).toBe(DEFAULT_RESTORE_RECORDS_BATCH_SIZE);
    expect(resolveRestoreRecordsBatchSize(1_001)).toBe(DEFAULT_RESTORE_RECORDS_BATCH_SIZE);
    expect(resolveRestoreRecordsBatchSize(11_000)).toBe(550);
    expect(resolveRestoreRecordsBatchSize(30_000)).toBe(MAX_SELECTION_STREAM_BATCH_SIZE);
  });
});
