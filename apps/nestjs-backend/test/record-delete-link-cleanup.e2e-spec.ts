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

  it('deletes records when an errored link field points to a missing foreign table', async () => {
    let hostTable: ITableFullVo | null = null;
    let foreignTable: ITableFullVo | null = null;

    try {
      foreignTable = await createTable(baseId, {
        name: 'Delete Missing Link Foreign',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      hostTable = await createTable(baseId, {
        name: 'Delete Missing Link Host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      const linkField = await createField(hostTable.id, {
        name: 'Broken Links',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
        },
      } as IFieldRo);

      const { records: hostRecords } = await createRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { Name: 'Host' } }],
      });
      const hostRecord = hostRecords[0];
      const linkOptions = linkField.options as ILinkFieldOptions;

      await prisma.field.update({
        where: { id: linkField.id },
        data: {
          hasError: true,
          options: JSON.stringify({
            ...linkOptions,
            foreignTableId: 'tblMissingForeignTable',
            fkHostTableName: `${linkOptions.fkHostTableName}_missing`,
          }),
        },
      });

      await expect(deleteRecords(hostTable.id, [hostRecord.id])).resolves.toBeDefined();
    } finally {
      if (hostTable) {
        await permanentDeleteTable(baseId, hostTable.id);
      }
      if (foreignTable) {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    }
  });

  it('deletes foreign record when junction has data but symmetric link column is null (ManyMany)', async () => {
    // This test simulates the user's scenario:
    // - Table A has a ManyMany link to Table B
    // - Records are linked via junction table
    // - The link column in Table B (symmetric field) is manually set to null
    // - Deleting Table B record should succeed and clean up junction table
    let tableA: ITableFullVo | null = null;
    let tableB: ITableFullVo | null = null;

    try {
      tableA = await createTable(baseId, {
        name: 'Table A',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      tableB = await createTable(baseId, {
        name: 'Table B',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      // Create link field on Table A pointing to Table B
      const linkFieldA = await createField(tableA.id, {
        name: 'Link to B',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: tableB.id,
        },
      } as IFieldRo);

      const linkOptionsA = linkFieldA.options as ILinkFieldOptions;
      const symmetricFieldId = linkOptionsA.symmetricFieldId;
      expect(symmetricFieldId).toBeTruthy();

      // Create records
      const { records: recordsA } = await createRecords(tableA.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { Name: 'Record A' } }],
      });
      const recordA = recordsA[0];

      const { records: recordsB } = await createRecords(tableB.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { Name: 'Record B' } }],
      });
      const recordB = recordsB[0];

      // Establish link from A to B
      await updateRecordByApi(tableA.id, recordA.id, linkFieldA.id, [{ id: recordB.id }]);

      // Verify junction table has the link
      const beforeJunctionCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        knex(linkOptionsA.fkHostTableName)
          .where(linkOptionsA.foreignKeyName, recordB.id)
          .count({ count: '*' })
          .toQuery()
      );
      expect(Number(beforeJunctionCount[0]?.count ?? 0)).toBe(1);

      // Manually clear the symmetric link column on Table B (simulate data inconsistency)
      const tableBMeta = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: tableB.id },
        select: { dbTableName: true },
      });

      const symmetricField = await prisma.field.findUniqueOrThrow({
        where: { id: symmetricFieldId! },
        select: { dbFieldName: true },
      });

      const clearSymmetricSql = knex(tableBMeta.dbTableName)
        .update({ [symmetricField.dbFieldName]: null })
        .where('__id', recordB.id)
        .toQuery();
      await prisma.$executeRawUnsafe(clearSymmetricSql);

      // Verify the symmetric link column is now null
      const linkColRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        knex(tableBMeta.dbTableName)
          .select(symmetricField.dbFieldName)
          .where('__id', recordB.id)
          .toQuery()
      );
      expect(linkColRows[0]?.[symmetricField.dbFieldName]).toBeNull();

      // Delete record B - this should succeed even though symmetric link column is null
      // but junction table still has the reference
      await deleteRecords(tableB.id, [recordB.id]);

      // Verify junction table is cleaned up
      const afterJunctionCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        knex(linkOptionsA.fkHostTableName)
          .where(linkOptionsA.foreignKeyName, recordB.id)
          .count({ count: '*' })
          .toQuery()
      );
      expect(Number(afterJunctionCount[0]?.count ?? 0)).toBe(0);
    } finally {
      if (tableA) {
        await permanentDeleteTable(baseId, tableA.id);
      }
      if (tableB) {
        await permanentDeleteTable(baseId, tableB.id);
      }
    }
  });

  it('deletes multiple records with inconsistent junction data (ManyMany)', async () => {
    // Test bulk deletion of records when some have inconsistent link column data
    let tableA: ITableFullVo | null = null;
    let tableB: ITableFullVo | null = null;

    try {
      tableA = await createTable(baseId, {
        name: 'Bulk Delete Table A',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      tableB = await createTable(baseId, {
        name: 'Bulk Delete Table B',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });

      const linkField = await createField(tableA.id, {
        name: 'Links',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: tableB.id,
        },
      } as IFieldRo);

      const linkOptions = linkField.options as ILinkFieldOptions;

      // Create multiple records in both tables
      const { records: recordsB } = await createRecords(tableB.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          { fields: { Name: 'Target 1' } },
          { fields: { Name: 'Target 2' } },
          { fields: { Name: 'Target 3' } },
        ],
      });

      const { records: recordsA } = await createRecords(tableA.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { Name: 'Source 1' } }, { fields: { Name: 'Source 2' } }],
      });

      // Link Source 1 to Target 1 and Target 2
      await updateRecordByApi(tableA.id, recordsA[0].id, linkField.id, [
        { id: recordsB[0].id },
        { id: recordsB[1].id },
      ]);

      // Link Source 2 to Target 2 and Target 3
      await updateRecordByApi(tableA.id, recordsA[1].id, linkField.id, [
        { id: recordsB[1].id },
        { id: recordsB[2].id },
      ]);

      // Verify junction table has 4 rows
      const beforeCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        knex(linkOptions.fkHostTableName).count({ count: '*' }).toQuery()
      );
      expect(Number(beforeCount[0]?.count ?? 0)).toBe(4);

      // Clear link column for Source 1 (simulate inconsistency)
      const tableAMeta = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: tableA.id },
        select: { dbTableName: true },
      });
      const linkDbFieldName = (linkField as any).dbFieldName as string;

      await prisma.$executeRawUnsafe(
        knex(tableAMeta.dbTableName)
          .update({ [linkDbFieldName]: null })
          .where('__id', recordsA[0].id)
          .toQuery()
      );

      // Delete both source records - should succeed and clean junction table
      await deleteRecords(tableA.id, [recordsA[0].id, recordsA[1].id]);

      // Verify all junction rows are cleaned up
      const afterCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        knex(linkOptions.fkHostTableName).count({ count: '*' }).toQuery()
      );
      expect(Number(afterCount[0]?.count ?? 0)).toBe(0);
    } finally {
      if (tableA) {
        await permanentDeleteTable(baseId, tableA.id);
      }
      if (tableB) {
        await permanentDeleteTable(baseId, tableB.id);
      }
    }
  });
});
