import { describe, expect, it } from 'vitest';

import { PasteCommand } from './PasteCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const viewId = `viw${'b'.repeat(16)}`;

describe('PasteCommand', () => {
  it('creates command with valid input', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [2, 3],
      ],
      content: [
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
        ['g', 'h', 'i'],
        ['j', 'k', 'l'],
      ],
    });

    expect(commandResult.isOk()).toBe(true);
    const command = commandResult._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.viewId.toString()).toBe(viewId);
    expect(command.startCol).toBe(0);
    expect(command.startRow).toBe(0);
    expect(command.rowCount).toBe(4);
    expect(command.colCount).toBe(3);
  });

  it('calculates startCell correctly', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [2, 5],
        [4, 10],
      ],
      content: [['a', 'b', 'c']],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.startCell).toEqual([2, 5]);
    expect(command.startCol).toBe(2);
    expect(command.startRow).toBe(5);
  });

  it('handles empty content', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.rowCount).toBe(0);
    expect(command.colCount).toBe(0);
  });

  it('handles single cell content', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [1, 2],
        [1, 2],
      ],
      content: [['single value']],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.rowCount).toBe(1);
    expect(command.colCount).toBe(1);
    expect(command.content[0][0]).toBe('single value');
  });

  it('defaults typecast to true', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['a']],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.typecast).toBe(true);
  });

  it('respects typecast=false', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['a']],
      typecast: false,
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.typecast).toBe(false);
  });

  it('includes sourceFields when provided', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['a']],
      sourceFields: [{ type: 'singleLineText' }, { type: 'number', cellValueType: 'number' }],
    });

    const command = commandResult._unsafeUnwrap();
    expect(command.sourceFields).toHaveLength(2);
    expect(command.sourceFields![0].type).toBe('singleLineText');
    expect(command.sourceFields![1].type).toBe('number');
  });

  it('rejects invalid tableId', () => {
    const commandResult = PasteCommand.create({
      tableId: 'invalid',
      viewId,
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects invalid viewId', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId: 'invalid',
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('rejects negative range values', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [-1, 0],
        [0, 0],
      ],
      content: [],
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('generates row iterator correctly', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 5],
        [1, 7],
      ],
      content: [
        ['a', 'b'],
        ['c', 'd'],
        ['e', 'f'],
      ],
    });

    const command = commandResult._unsafeUnwrap();
    const rows = [...command.rows()];

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ rowIndex: 5, data: ['a', 'b'] });
    expect(rows[1]).toEqual({ rowIndex: 6, data: ['c', 'd'] });
    expect(rows[2]).toEqual({ rowIndex: 7, data: ['e', 'f'] });
  });

  it('parses string content (clipboard format) with tabs and newlines', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 1],
      ],
      content: 'a\tb\nc\td',
    });

    expect(commandResult.isOk()).toBe(true);
    const command = commandResult._unsafeUnwrap();
    expect(command.content).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('parses string content with Windows line endings', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [0, 1],
      ],
      content: 'row1\r\nrow2',
    });

    expect(commandResult.isOk()).toBe(true);
    const command = commandResult._unsafeUnwrap();
    expect(command.content).toEqual([['row1'], ['row2']]);
  });

  it('parses string content with quoted cells containing delimiters', () => {
    const commandResult = PasteCommand.create({
      tableId,
      viewId,
      ranges: [
        [0, 0],
        [1, 0],
      ],
      content: '"cell\twith\ttabs"\tnormal',
    });

    expect(commandResult.isOk()).toBe(true);
    const command = commandResult._unsafeUnwrap();
    expect(command.content).toEqual([['cell\twith\ttabs', 'normal']]);
  });
});
