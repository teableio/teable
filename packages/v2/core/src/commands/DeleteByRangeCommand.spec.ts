import { describe, expect, it } from 'vitest';

import { DeleteByRangeCommand } from './DeleteByRangeCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const viewId = `viw${'b'.repeat(16)}`;

describe('DeleteByRangeCommand', () => {
  it('creates command with valid cell range input', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [2, 3],
      ],
    });

    expect(commandResult.isOk()).toBe(true);
    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.viewId.toString()).toBe(viewId);
    expect(command.rangeType).toBeUndefined();
  });

  it('creates command with columns type', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [[0, 2]], // columns 0-2
      type: 'columns',
    });

    expect(commandResult.isOk()).toBe(true);
    const command = commandResult._unsafeUnwrap();
    expect(command.rangeType).toBe('columns');
  });

  it('creates command with rows type', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [[1, 5]], // rows 1-5
      type: 'rows',
    });

    expect(commandResult.isOk()).toBe(true);
    const command = commandResult._unsafeUnwrap();
    expect(command.rangeType).toBe('rows');
  });

  it('normalizes cell range correctly', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [
        [1, 2],
        [3, 5],
      ],
    });

    const command = commandResult._unsafeUnwrap();
    const normalized = command.normalizeRanges(100, 10);
    expect(normalized).toEqual([
      [1, 2],
      [3, 5],
    ]);
  });

  it('normalizes columns type correctly', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [[0, 2]], // columns 0-2
      type: 'columns',
    });

    const command = commandResult._unsafeUnwrap();
    const normalized = command.normalizeRanges(100, 10);
    expect(normalized).toEqual([
      [0, 0],
      [2, 99],
    ]);
  });

  it('normalizes rows type correctly', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [[1, 5]], // rows 1-5
      type: 'rows',
    });

    const command = commandResult._unsafeUnwrap();
    const normalized = command.normalizeRanges(100, 10);
    expect(normalized).toEqual([
      [0, 1],
      [9, 5],
    ]);
  });

  it('handles zero rows for columns type', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [[0, 2]],
      type: 'columns',
    });

    const command = commandResult._unsafeUnwrap();
    const normalized = command.normalizeRanges(0, 10);
    expect(normalized).toEqual([
      [0, 0],
      [2, 0],
    ]);
  });

  it('handles zero cols for rows type', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [[1, 5]],
      type: 'rows',
    });

    const command = commandResult._unsafeUnwrap();
    const normalized = command.normalizeRanges(100, 0);
    expect(normalized).toEqual([
      [0, 1],
      [0, 5],
    ]);
  });

  it('includes filter when provided', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 1],
      ],
      filter: { fieldId: 'fld123', operator: 'is', value: 'test' },
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.filter).toBeDefined();
    // Filter is a RecordFilterCondition in this case
    const filter = command.filter as { fieldId: string; operator: string; value: string };
    expect(filter.fieldId).toBe('fld123');
  });

  it('rejects invalid tableId', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId: 'invalid',
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects invalid viewId', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId: 'invalid',
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects negative range values', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [
        [-1, 0],
        [0, 0],
      ],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('accepts columns type with multiple ranges (non-contiguous selection)', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [2, 2],
      ],
      type: 'columns',
    });

    expect(commandResult.isOk()).toBe(true);
  });

  it('accepts rows type with multiple ranges (non-contiguous selection)', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [2, 2],
      ],
      type: 'rows',
    });

    expect(commandResult.isOk()).toBe(true);
  });

  it('rejects columns type with empty ranges', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [],
      type: 'columns',
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects rows type with empty ranges', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [],
      type: 'rows',
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects cell range with wrong ranges format (single element)', () => {
    const commandResult = DeleteByRangeCommand.create({
      tableId,
      viewId,
      ranges: [[0, 0]],
    });

    expect(commandResult.isErr()).toBe(true);
  });
});
