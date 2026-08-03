import { describe, expect, it } from 'vitest';

import { RestoreRecordsCommand } from './RestoreRecordsCommand';

const tableId = `tbl${'a'.repeat(16)}`;
const recordId = `rec${'b'.repeat(16)}`;

describe('RestoreRecordsCommand', () => {
  it('creates a command with record payloads', () => {
    const result = RestoreRecordsCommand.create({
      tableId,
      records: [
        {
          recordId,
          fields: {
            Name: 'Alice',
          },
          orders: {
            viw123: 1,
          },
          autoNumber: 2,
          createdTime: '2026-03-11T00:00:00.000Z',
          createdBy: 'usr123',
          lastModifiedTime: '2026-03-11T00:00:00.000Z',
          lastModifiedBy: 'usr456',
        },
      ],
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.records).toHaveLength(1);
    expect(command.records[0]).toMatchObject({
      recordId,
      autoNumber: 2,
    });
  });

  it('rejects invalid input', () => {
    const schemaError = RestoreRecordsCommand.create({
      tableId,
      records: [],
    });
    expect(schemaError.isErr()).toBe(true);

    const invalidTableId = RestoreRecordsCommand.create({
      tableId: 'not-a-table-id',
      records: [
        {
          recordId,
          fields: {},
        },
      ],
    });
    expect(invalidTableId.isErr()).toBe(true);
  });
});
