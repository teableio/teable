import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../schema/visitors/__tests__/helpers/createTestDb';
import { buildAttachmentTableBatchReplaceQueries } from './attachmentTableMutations';

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('attachmentTableMutations', () => {
  it('builds one delete and one insert for batch replacement', () => {
    const statements = buildAttachmentTableBatchReplaceQueries(createTestDb() as never, [
      {
        actorId: 'usrActor000000001',
        tableId: 'tblTable000000001',
        recordId: 'recRecord00000001',
        fieldId: 'fldFiles000000001',
        value: [
          {
            id: 'actAttachment0001',
            token: 'tok-1',
            name: 'one.txt',
          },
        ],
      },
      {
        actorId: 'usrActor000000001',
        tableId: 'tblTable000000001',
        recordId: 'recRecord00000002',
        fieldId: 'fldFiles000000001',
        value: [
          {
            id: 'actAttachment0002',
            token: 'tok-2',
            name: 'two.txt',
          },
        ],
      },
    ]);

    expect(statements).toHaveLength(2);
    expect(normalizeSql(statements[0]!.sql)).toContain(
      'delete from attachments_table where (table_id, record_id, field_id) in (($1, $2, $3), ($4, $5, $6))'
    );
    expect(normalizeSql(statements[1]!.sql)).toContain(
      'insert into "attachments_table" ("id", "attachment_id", "token", "name", "table_id", "record_id", "field_id", "created_by") values'
    );
  });
});
