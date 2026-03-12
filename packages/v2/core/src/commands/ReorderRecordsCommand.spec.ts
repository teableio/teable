import { describe, expect, it } from 'vitest';

import { ReorderRecordsCommand } from './ReorderRecordsCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const viewId = `viw${'b'.repeat(16)}`;
const anchorId = `rec${'c'.repeat(16)}`;
const recordIdA = `rec${'d'.repeat(16)}`;
const recordIdB = `rec${'e'.repeat(16)}`;

describe('ReorderRecordsCommand', () => {
  it('creates a command with parsed record ids and order', () => {
    const result = ReorderRecordsCommand.create({
      tableId,
      recordIds: [recordIdA, recordIdB],
      order: {
        viewId,
        anchorId,
        position: 'before',
      },
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.recordIds.map((recordId) => recordId.toString())).toEqual([
      recordIdA,
      recordIdB,
    ]);
    expect(command.order.viewId.toString()).toBe(viewId);
    expect(command.order.anchorId.toString()).toBe(anchorId);
    expect(command.order.position).toBe('before');
  });

  it('rejects schema-level invalid input', () => {
    const result = ReorderRecordsCommand.create({
      tableId,
      recordIds: [],
      order: {
        viewId,
        anchorId,
        position: 'before',
      },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid ReorderRecordsCommand input');
  });

  it('rejects invalid ids after schema parsing', () => {
    const invalidTableId = ReorderRecordsCommand.create({
      tableId: 'not-a-table-id',
      recordIds: [recordIdA],
      order: {
        viewId,
        anchorId,
        position: 'before',
      },
    });
    expect(invalidTableId.isErr()).toBe(true);

    const invalidRecordId = ReorderRecordsCommand.create({
      tableId,
      recordIds: ['not-a-record-id'],
      order: {
        viewId,
        anchorId,
        position: 'before',
      },
    });
    expect(invalidRecordId.isErr()).toBe(true);
    expect(invalidRecordId._unsafeUnwrapErr().message).toContain('Invalid recordId');

    const invalidOrder = ReorderRecordsCommand.create({
      tableId,
      recordIds: [recordIdA],
      order: {
        viewId: 'not-a-view-id',
        anchorId,
        position: 'before',
      },
    });
    expect(invalidOrder.isErr()).toBe(true);
  });
});
