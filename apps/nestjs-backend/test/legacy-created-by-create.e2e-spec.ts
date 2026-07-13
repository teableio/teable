/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

const parseSchemaAndTable = (dbTableName: string): [string, string] => {
  const trimQuotes = (value: string) =>
    value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  const parts = dbTableName.split('.');
  return [trimQuotes(parts[0] ?? dbTableName), trimQuotes(parts[1] ?? dbTableName)];
};

/**
 * T6146: Legacy CreatedBy columns may still be GENERATED ALWAYS AS (__created_by) STORED
 * while field meta says they are writable JSON columns. Insert must not write to them.
 */
describe('Legacy createdBy create compatibility (e2e) T6146', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates records when CreatedBy is a physical GENERATED ALWAYS column', async () => {
    const table: ITableFullVo = await createTable(baseId, {
      name: 'legacy_created_by_create',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [],
    });

    try {
      const nameField = table.fields.find((field) => field.name === 'Name');
      expect(nameField).toBeDefined();

      const createdByField = await createField(table.id, {
        name: 'Created By',
        type: FieldType.CreatedBy,
      });

      const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: table.id },
        select: { dbTableName: true },
      });
      const [schemaName, rawTableName] = parseSchemaAndTable(tableMeta.dbTableName);
      const quotedTableName = `"${schemaName}"."${rawTableName}"`;

      // Simulate legacy: drop JSON column and recreate as GENERATED from __created_by
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${quotedTableName} DROP COLUMN "${createdByField.dbFieldName}"`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${quotedTableName} ADD COLUMN "${createdByField.dbFieldName}" TEXT GENERATED ALWAYS AS (__created_by) STORED`
      );
      // Meta may still claim non-generated (writable) storage
      await prisma.$executeRawUnsafe(
        `UPDATE field SET meta = '{"persistedAsGeneratedColumn":false}' WHERE id = '${createdByField.id}'`
      );

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [nameField!.id]: 'legacy-created-by-row',
            },
          },
        ],
      });

      expect(created.records).toHaveLength(1);
      const recordId = created.records[0].id;

      const rows = await prisma.$queryRawUnsafe<
        {
          created_by: string | null;
          legacy_created_by: string | null;
        }[]
      >(
        `SELECT "__created_by" AS created_by,
                "${createdByField.dbFieldName}" AS legacy_created_by
           FROM ${quotedTableName}
          WHERE "__id" = '${recordId}'`
      );

      expect(rows[0]?.created_by).toBeTruthy();
      // Generated column mirrors system __created_by
      expect(rows[0]?.legacy_created_by).toBe(rows[0]?.created_by);

      const list = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const target = list.records.find((r) => r.id === recordId);
      expect(target?.fields[nameField!.id]).toBe('legacy-created-by-row');
      // Display may resolve via system column fallback
      expect(target?.fields[createdByField.id]).toBeTruthy();
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
