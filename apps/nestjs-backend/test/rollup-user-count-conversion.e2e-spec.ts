import type { INestApplication } from '@nestjs/common';
import {
  CellValueType,
  DbFieldType,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  Relationship,
} from '@teable/core';
import {
  convertField,
  createField,
  createRecords,
  createTable,
  getField,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Rollup user count conversion (e2e)', () => {
  let app: INestApplication;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;
  const tableIds: string[] = [];

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    app = (await initApp()).app;
  });

  afterEach(async () => {
    for (const tableId of tableIds.splice(0).reverse()) {
      await permanentDeleteTable(baseId, tableId);
    }
  });

  afterAll(async () => {
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    await app.close();
  });

  // Sanitized, structure-equivalent fixture: a one-to-many link to scalar users,
  // and a string-array rollup whose options contain no numeric formatting.
  it.each(['newly created', 'persisted and reloaded'])(
    'converts a %s unique-user rollup to a numeric count through the API',
    async (state) => {
      const source = await createTable(baseId, {
        name: 'Member source',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });
      tableIds.push(source.id);
      const member = await createField(source.id, {
        name: 'Member',
        type: FieldType.User,
        options: { isMultiple: false, shouldNotify: false, defaultValue: 'me' },
      });
      const members = await createRecords(source.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [member.id]: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
              },
            },
          },
          {
            fields: {
              [member.id]: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
              },
            },
          },
        ],
      });

      const host = await createTable(baseId, {
        name: 'Rollup host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });
      tableIds.push(host.id);
      const link = await createField(host.id, {
        name: 'Members',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: source.id },
      });
      const lookupOptions = {
        foreignTableId: source.id,
        linkFieldId: link.id,
        lookupFieldId: member.id,
      };
      const originalOptions = {
        expression: 'array_unique({values})',
        timeZone: 'Asia/Singapore',
      };
      const rollup = await createField(host.id, {
        name: 'Member aggregate',
        type: FieldType.Rollup,
        lookupOptions,
        options: originalOptions,
      });
      const { records } = await createRecords(host.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [link.id]: members.records.map(({ id }) => ({ id })) } }],
      });

      const before =
        state === 'persisted and reloaded' ? await getField(host.id, rollup.id) : rollup;
      expect(before).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        options: originalOptions,
      });
      expect(before.options).not.toHaveProperty('formatting');
      const beforeRecord = await getRecord(host.id, records[0].id);
      expect(beforeRecord.fields[rollup.id]).toHaveLength(1);

      // convertField calls PUT /api/table/:tableId/field/:fieldId/convert.
      const converted = await convertField(host.id, rollup.id, {
        name: rollup.name,
        type: FieldType.Rollup,
        lookupOptions,
        options: {
          expression: 'countall({values})',
          timeZone: 'Asia/Singapore',
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });
      expect(converted).toMatchObject({
        cellValueType: CellValueType.Number,
        options: {
          expression: 'countall({values})',
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });
      expect(converted.isMultipleCellValue).not.toBe(true);
      const afterRecord = await getRecord(host.id, records[0].id);
      expect(afterRecord.fields[rollup.id]).toBe(2);
      expect(await getField(host.id, rollup.id)).toMatchObject({
        cellValueType: CellValueType.Number,
        options: { expression: 'countall({values})' },
      });
    },
    60000
  );
});
