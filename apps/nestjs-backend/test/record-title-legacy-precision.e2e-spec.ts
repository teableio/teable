import type { INestApplication } from '@nestjs/common';
import { DateFormattingPreset, FieldType, NumberFormattingType, TimeFormatting } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { RecordTitleReader } from '../src/features/v2/record-title-reader';
import { DatabaseRouter } from '../src/global/database-router.service';
import type { IClsStore } from '../src/types/cls';
import { createTable, initApp, permanentDeleteTable, runWithTestUser } from './utils/init-app';

describe('Record title reads (e2e)', () => {
  const baseId = globalThis.testConfig.baseId;
  let app: INestApplication;
  let tableId: string | undefined;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterEach(async () => {
    if (tableId) {
      await permanentDeleteTable(baseId, tableId);
      tableId = undefined;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads a title with stored fractional precision on primary and non-primary fields', async () => {
    const formatting = { type: NumberFormattingType.Decimal, precision: 2 } as const;
    const table = await createTable(baseId, {
      name: 'legacy-precision-title',
      fields: [
        { name: 'Amount', type: FieldType.Number, options: { formatting } },
        { name: 'Rate', type: FieldType.Number, options: { formatting } },
      ],
      records: [{ fields: { Amount: 12.34, Rate: 0.1234 } }],
    });
    tableId = table.id;
    const [primaryField, nonPrimaryField] = table.fields;
    const recordId = table.records[0].id;
    const storedOptions = JSON.stringify({ formatting });
    const legacyOptions = JSON.stringify({ formatting: { ...formatting, precision: 1.5 } });
    const prisma = app.get(PrismaService);
    const reader = app.get(RecordTitleReader);
    const cls = app.get<ClsService<IClsStore>>(ClsService);

    try {
      await prisma.field.update({
        where: { id: nonPrimaryField.id },
        data: { options: legacyOptions },
      });
      await expect(runWithTestUser(cls, () => reader.byIds(table.id, [recordId]))).resolves.toEqual([
        { id: recordId, title: '12.34' },
      ]);

      await prisma.field.update({
        where: { id: primaryField.id },
        data: { options: legacyOptions },
      });
      await expect(runWithTestUser(cls, () => reader.byIds(table.id, [recordId]))).resolves.toEqual([
        { id: recordId, title: '12.3' },
      ]);
    } finally {
      await prisma.field.updateMany({
        where: { id: { in: [primaryField.id, nonPrimaryField.id] } },
        data: { options: storedOptions },
      });
    }
  });

  it('reads its own uncommitted primary field value in a v1 write transaction', async () => {
    const table = await createTable(baseId, {
      name: 'transaction-title',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [{ fields: { Title: 'committed title' } }],
    });
    tableId = table.id;
    const recordId = table.records[0].id;
    const prisma = app.get(PrismaService);
    const router = app.get(DatabaseRouter);
    const reader = app.get(RecordTitleReader);
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    const update = router
      .dataKnex()(table.dbTableName)
      .where('__id', recordId)
      .update({ [table.fields[0].dbFieldName]: 'uncommitted title' })
      .toSQL()
      .toNative();
    const rollback = new Error('Roll back the title update');

    await runWithTestUser(cls, async () => {
      await expect(
        prisma.$tx(async (tx) => {
          expect(await tx.$executeRawUnsafe(update.sql, ...update.bindings)).toBe(1);
          await expect(reader.byIds(table.id, [recordId])).resolves.toEqual([
            { id: recordId, title: 'uncommitted title' },
          ]);
          throw rollback;
        })
      ).rejects.toBe(rollback);

      await expect(reader.byIds(table.id, [recordId])).resolves.toEqual([
        { id: recordId, title: 'committed title' },
      ]);
    });
  });

  it('keeps an errored primary formula blank when the stored value still exists', async () => {
    const table = await createTable(baseId, {
      name: 'errored-formula-title',
      fields: [
        { name: 'Title', type: FieldType.Formula, options: { expression: '"retained"' } },
        { name: 'Note', type: FieldType.SingleLineText },
      ],
      records: [{ fields: { Note: 'row' } }],
    });
    tableId = table.id;
    const id = table.records[0].id;
    const prisma = app.get(PrismaService);
    const reader = app.get(RecordTitleReader);
    const read = () => reader.byIds(table.id, [id]);
    await runWithTestUser(app.get(ClsService), async () => {
      await expect(read()).resolves.toEqual([{ id, title: 'retained' }]);
      await prisma.field.update({ where: { id: table.fields[0].id }, data: { hasError: true } });
      try {
        await expect(read()).resolves.toEqual([{ id, title: '' }]);
        await expect(prisma.$tx(read)).resolves.toEqual([{ id, title: '' }]);
      } finally {
        await prisma.field.update({ where: { id: table.fields[0].id }, data: { hasError: false } });
      }
    });
  });

  it('preserves the date title instant in a positive-offset transaction session', async () => {
    const table = await createTable(baseId, {
      name: 'date-title-offset',
      fields: [{
        name: 'Date',
        type: FieldType.Date,
        options: { formatting: { date: DateFormattingPreset.ISO, time: TimeFormatting.Hour24, timeZone: 'UTC' } },
      }],
      records: [{ fields: { Date: '2025-12-15T02:00:00.000Z' } }],
    });
    tableId = table.id;
    const id = table.records[0].id;
    const prisma = app.get(PrismaService);
    const reader = app.get(RecordTitleReader);
    await runWithTestUser(app.get(ClsService), async () => {
      const expected = await reader.byIds(table.id, [id]);
      expect(expected).toEqual([{ id, title: expect.stringContaining('02:00') }]);
      await prisma.$tx(async (tx) => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Singapore'`;
        await expect(reader.byIds(table.id, [id])).resolves.toEqual(expected);
      });
    });
  });
});
