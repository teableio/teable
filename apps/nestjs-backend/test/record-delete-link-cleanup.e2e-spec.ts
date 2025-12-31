/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import type { Knex } from 'knex';
import {
  createField,
  createRecords,
  createTable,
  deleteRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Record delete link cleanup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let knex: Knex;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    knex = app.get('CUSTOM_KNEX' as any);
  });

  afterAll(async () => {
    await app.close();
  });

  it('deletes records with junction links even when link column is null', async () => {
    let hostTable: ITableFullVo | null = null;
    let foreignTable: ITableFullVo | null = null;

    try {
      foreignTable = await createTable(baseId, {
        name: 'Delete Link Foreign',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      hostTable = await createTable(baseId, {
        name: 'Delete Link Host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      const linkField = await createField(hostTable.id, {
        name: 'Links',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
        },
      } as IFieldRo);

      const { records: foreignRecords } = await createRecords(foreignTable.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { Name: 'Target' } }],
      });
      const foreignRecord = foreignRecords[0];

      const { records: hostRecords } = await createRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { Name: 'Host' } }],
      });
      const hostRecord = hostRecords[0];

      await updateRecordByApi(hostTable.id, hostRecord.id, linkField.id, [
        { id: foreignRecord.id },
      ]);

      const linkOptions = linkField.options as ILinkFieldOptions;
      const beforeRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        knex(linkOptions.fkHostTableName)
          .where(linkOptions.selfKeyName, hostRecord.id)
          .count({ count: '*' })
          .toQuery()
      );
      expect(Number(beforeRows[0]?.count ?? 0)).toBe(1);

      const hostMeta = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: hostTable.id },
        select: { dbTableName: true },
      });
      const linkDbFieldName = (linkField as any).dbFieldName as string;
      expect(linkDbFieldName).toBeTruthy();

      const clearSql = knex(hostMeta.dbTableName)
        .update({ [linkDbFieldName]: null })
        .where('__id', hostRecord.id)
        .toQuery();
      await prisma.$executeRawUnsafe(clearSql);

      const linkColRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        knex(hostMeta.dbTableName).select(linkDbFieldName).where('__id', hostRecord.id).toQuery()
      );
      expect(linkColRows[0]?.[linkDbFieldName]).toBeNull();

      await deleteRecords(hostTable.id, [hostRecord.id]);

      const afterRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        knex(linkOptions.fkHostTableName)
          .where(linkOptions.selfKeyName, hostRecord.id)
          .count({ count: '*' })
          .toQuery()
      );
      expect(Number(afterRows[0]?.count ?? 0)).toBe(0);
    } finally {
      if (hostTable) {
        await permanentDeleteTable(baseId, hostTable.id);
      }
      if (foreignTable) {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    }
  });
});
