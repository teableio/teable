/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { RecordCreateService } from '../src/features/record/record-modify/record-create.service';
import type { IClsStore } from '../src/types/cls';
import {
  createField,
  createRecords,
  createTable,
  initApp,
  permanentDeleteTable,
  getRecords,
  runWithTestUser,
} from './utils/init-app';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseSchemaAndTable = (dbTableName: string): [string, string] => {
  const trimQuotes = (value: string) =>
    value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  const parts = dbTableName.split('.');
  return [trimQuotes(parts[0] ?? dbTableName), trimQuotes(parts[1] ?? dbTableName)];
};

describe('Legacy createdTime create compatibility (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clsService: ClsService<IClsStore>;
  let recordCreateService: RecordCreateService;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    clsService = app.get<ClsService<IClsStore>>(ClsService);
    recordCreateService = app.get(RecordCreateService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('fills legacy plain createdTime columns during create so dependent formulas stay correct', async () => {
    const table: ITableFullVo = await createTable(baseId, {
      name: 'legacy_created_time_create',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [],
    });

    try {
      const nameField = table.fields.find((field) => field.name === 'Name');
      expect(nameField).toBeDefined();

      const createdTimeField = await createField(table.id, {
        name: 'Created Time',
        type: FieldType.CreatedTime,
      });
      const statusField = await createField(table.id, {
        name: 'Created Status',
        type: FieldType.Formula,
        options: {
          expression: `IF({${createdTimeField.id}}, "ok", "bad")`,
        },
      });

      const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: table.id },
        select: { dbTableName: true },
      });
      const [schemaName, rawTableName] = parseSchemaAndTable(tableMeta.dbTableName);
      const quotedTableName = `"${schemaName}"."${rawTableName}"`;

      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${quotedTableName} DROP COLUMN "${createdTimeField.dbFieldName}"`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${quotedTableName} ADD COLUMN "${createdTimeField.dbFieldName}" TIMESTAMPTZ`
      );
      await prisma.$executeRawUnsafe(
        `UPDATE field SET meta = NULL WHERE id = '${createdTimeField.id}'`
      );

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [nameField!.id]: 'legacy-row',
            },
          },
        ],
      });

      const recordId = created.records[0].id;
      let row:
        | {
            created_time: Date | string | null;
            legacy_created_time: Date | string | null;
            created_status: string | null;
          }
        | undefined;

      for (let i = 0; i < 20; i++) {
        const rows = await prisma.$queryRawUnsafe<
          {
            created_time: Date | string | null;
            legacy_created_time: Date | string | null;
            created_status: string | null;
          }[]
        >(
          `SELECT "__created_time" AS created_time,
                  "${createdTimeField.dbFieldName}" AS legacy_created_time,
                  "${statusField.dbFieldName}" AS created_status
             FROM ${quotedTableName}
            WHERE "__id" = '${recordId}'`
        );
        row = rows[0];
        if (row?.legacy_created_time && row.created_status === 'ok') {
          break;
        }
        await sleep(200);
      }

      expect(row?.created_time).toBeTruthy();
      expect(row?.legacy_created_time).toBeTruthy();
      expect(row?.created_status).toBe('ok');
      expect(new Date(row!.legacy_created_time as string | Date).toISOString()).toEqual(
        new Date(row!.created_time as string | Date).toISOString()
      );
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('keeps createRecordsOnlySql working for tables without legacy createdTime columns', async () => {
    const table: ITableFullVo = await createTable(baseId, {
      name: 'create_records_only_sql_plain',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [],
    });

    try {
      const nameField = table.fields.find((field) => field.name === 'Name');
      expect(nameField).toBeDefined();

      await runWithTestUser(clsService, async () => {
        await recordCreateService.createRecordsOnlySql(table.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              fields: {
                [nameField!.id]: 'plain-row',
              },
            },
          ],
        });
      });

      const result = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].fields[nameField!.id]).toBe('plain-row');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
