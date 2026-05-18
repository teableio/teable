import { FieldKeyType, FieldType } from '@teable/core';
import Knex from 'knex';
import { vi } from 'vitest';
import { RecordService } from './record.service';

describe('RecordService', () => {
  it('writes SQL-only created record history into the routed data DB internal schema', async () => {
    const dataKnex = Knex({ client: 'pg' });
    const executedSql: string[] = [];
    const service = Object.create(RecordService.prototype) as RecordService & {
      creditCheck: ReturnType<typeof vi.fn>;
      getFieldsByProjection: ReturnType<typeof vi.fn>;
      getWritableCreatedTimeFieldNames: ReturnType<typeof vi.fn>;
      cls: { get: ReturnType<typeof vi.fn> };
      dbProvider: { batchInsertSql: ReturnType<typeof vi.fn> };
      databaseRouter: {
        executeDataPrismaForTable: ReturnType<typeof vi.fn>;
        dataKnexForTable: ReturnType<typeof vi.fn>;
        getDataDatabaseUrlForTable: ReturnType<typeof vi.fn>;
      };
    };

    service.cls = {
      get: vi.fn((key: string) =>
        key === 'user' ? { id: 'usrImport', name: 'User', email: 'user@example.com' } : undefined
      ),
    };
    service.creditCheck = vi.fn().mockResolvedValue(undefined);
    service.getFieldsByProjection = vi.fn().mockResolvedValue([
      {
        id: 'fldText',
        name: 'Text',
        type: FieldType.SingleLineText,
        dbFieldName: 'fld_text',
        convertCellValue2DBValue: vi.fn((value) => value),
      },
    ]);
    service.getWritableCreatedTimeFieldNames = vi.fn().mockResolvedValue(new Set());
    service.dbProvider = {
      batchInsertSql: vi.fn().mockReturnValue('insert into "bse_data"."tbl_imported" values (...)'),
    };
    service.databaseRouter = {
      executeDataPrismaForTable: vi.fn(async (_tableId: string, sql: string) => {
        executedSql.push(sql);
        return 1;
      }),
      dataKnexForTable: vi.fn().mockResolvedValue(dataKnex),
      getDataDatabaseUrlForTable: vi
        .fn()
        .mockResolvedValue('postgresql://user:pass@example.test:5432/data?schema=teable_internal'),
    };

    await service.createRecordsOnlySql(
      { id: 'tblImport', dbTableName: 'bse_data.tbl_imported' } as never,
      [{ fields: { fldText: 'Imported value' } }],
      FieldKeyType.Id
    );

    expect(executedSql[0]).toContain('"bse_data"."tbl_imported"');
    expect(executedSql.some((sql) => sql.includes('"teable_internal"."record_history"'))).toBe(
      true
    );
    expect(executedSql.some((sql) => sql.includes('insert into "record_history"'))).toBe(false);

    await dataKnex.destroy();
  });
});
