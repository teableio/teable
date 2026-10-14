import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, NumberFormattingType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  axios,
  createField,
  deleteField,
  ensureUndoRedoWindowIdHeader,
  getField,
  getFields,
  getRecord,
  getRecords,
  undo,
  updateRecord,
} from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { X_TEABLE_V2_HEADER } from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { X_TEABLE_UNDO_REDO_ENGINE_HEADER } from '../src/features/undo-redo/open-api/undo-redo.service';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('T7748 conditional rollup source deletion undo (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tables: ITableFullVo[] = [];
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
  }, 120_000);

  afterAll(async () => {
    for (const table of tables.reverse()) {
      await permanentDeleteTable(baseId, table.id);
    }
    await app?.close();
  });

  it.each(['undo', 'undo-stream'])(
    'restores source values and computed values through %s',
    async (route) => {
      const source = await createTable(baseId, {
        name: 'Undo source',
        fields: [
          { name: 'Label', type: FieldType.SingleLineText },
          {
            name: 'Amount',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
          },
        ],
        records: [
          { fields: { Label: 'A', Amount: 10 } },
          { fields: { Label: 'B', Amount: 20 } },
          { fields: { Label: 'C', Amount: 30 } },
        ],
      });
      tables.push(source);
      const host = await createTable(baseId, {
        name: 'Undo host',
        fields: [{ name: 'Label', type: FieldType.SingleLineText }],
        records: ['H1', 'H2', 'H3'].map((Label) => ({ fields: { Label } })),
      });
      tables.push(host);
      const amount = source.fields.find((field) => field.name === 'Amount')!;
      const link = (
        await createField(host.id, {
          name: 'Sources',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyMany, foreignTableId: source.id },
        })
      ).data;
      await updateRecord(host.id, host.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [link.id]: [{ id: source.records[0].id }] } },
      });
      const lookup = (
        await createField(host.id, {
          name: 'Linked amount',
          type: FieldType.Number,
          isLookup: true,
          lookupOptions: {
            linkFieldId: link.id,
            foreignTableId: source.id,
            lookupFieldId: amount.id,
          },
        })
      ).data;
      const conditional = (
        await createField(host.id, {
          name: 'Positive total',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: source.id,
            lookupFieldId: amount.id,
            expression: 'sum({values})',
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: amount.id, operator: 'isGreater', value: 0 }],
            },
          },
        })
      ).data;
      const hostMeta = await prisma.tableMeta.findUniqueOrThrow({ where: { id: host.id } });
      const quotedTable = hostMeta.dbTableName
        .split('.')
        .map((part) => `"${part.replaceAll('"', '""')}"`)
        .join('.');
      const storedSql = `SELECT "__id", "${lookup.dbFieldName}", "${conditional.dbFieldName}" FROM ${quotedTable} ORDER BY "__auto_number"`;
      const snapshot = async () => ({
        sourceFields: (await getFields(source.id)).data,
        sourceRecords: (await getRecords(source.id, { fieldKeyType: FieldKeyType.Id })).data
          .records,
        lookup: (await getField(host.id, lookup.id)).data,
        conditional: (await getField(host.id, conditional.id)).data,
        hostRecords: (await getRecords(host.id, { fieldKeyType: FieldKeyType.Id })).data.records,
        stored: await prisma.$queryRawUnsafe(storedSql),
      });
      const readHost = async () =>
        (await getRecord(host.id, host.records[0].id, { fieldKeyType: FieldKeyType.Id })).data;
      await expect
        .poll(async () => (await readHost()).fields[conditional.id], { timeout: 10_000 })
        .toBe(60);
      expect((await readHost()).fields[lookup.id]).toEqual([10]);

      const windowId = `win-t7748-${Date.now()}`;
      ensureUndoRedoWindowIdHeader(windowId);
      const deleted = await deleteField(source.id, amount.id);
      const deletedState = await snapshot();
      expect(deleted.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(deletedState.sourceFields.some((field) => field.id === amount.id)).toBe(false);
      expect(deletedState.lookup.hasError).toBe(true);
      expect(deletedState.conditional.hasError).toBe(true);

      const undone =
        route === 'undo'
          ? await undo(source.id)
          : await axios.post<string>(`/table/${source.id}/undo-redo/undo-stream`, undefined, {
              responseType: 'text',
            });
      const events =
        typeof undone.data === 'string'
          ? undone.data
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => JSON.parse(line.slice(6)))
          : [];
      const done = events.find((event) => event.id === 'done');
      const engine =
        route === 'undo' ? undone.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER] : done?.engine;
      const status =
        route === 'undo' && typeof undone.data !== 'string' ? undone.data.status : done?.status;
      const restored = await snapshot();

      expect(undone.status).toBe(route === 'undo' ? 201 : 200);
      expect(status).toBe('fulfilled');
      expect(engine).toBe('v2');
      expect(restored.sourceFields.find((field) => field.name === 'Amount')?.id).toBe(amount.id);
      expect(
        restored.sourceRecords
          .map((record) => record.fields[amount.id])
          .sort((a, b) => Number(a) - Number(b))
      ).toEqual([10, 20, 30]);
      expect(restored.lookup.hasError).toBeFalsy();
      expect(restored.conditional.hasError).toBeFalsy();
      await expect
        .poll(async () => (await readHost()).fields, { timeout: 10_000 })
        .toMatchObject({
          [lookup.id]: [10],
          [conditional.id]: 60,
        });
      const stored = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(storedSql);
      expect(stored.map((row) => row[conditional.dbFieldName])).toEqual([60, 60, 60]);
    },
    60_000
  );
});
