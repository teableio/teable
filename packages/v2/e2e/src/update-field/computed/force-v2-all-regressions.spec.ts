/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { sql } from 'kysely';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

describe('update-field: FORCE_V2_ALL regressions', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test(
    'converts threshold to text without throwing and marks conditionalRollup errored for numeric comparison',
    { timeout: 120_000 },
    async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;

      try {
        const foreignScoreFieldId = createFieldId();
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-cond-rollup-foreign'),
          fields: [
            { type: 'singleLineText', name: 'Player', isPrimary: true },
            { type: 'number', name: 'Score', id: foreignScoreFieldId },
          ],
          records: [
            { fields: { Player: 'Alpha', [foreignScoreFieldId]: 10 } },
            { fields: { Player: 'Beta', [foreignScoreFieldId]: 7 } },
          ],
        });
        foreignTableId = foreignTable.id;

        const thresholdFieldId = createFieldId();
        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-cond-rollup-host'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Threshold', id: thresholdFieldId },
          ],
          records: [{ fields: { Name: 'Host-1', [thresholdFieldId]: 8 } }],
        });
        hostTableId = hostTable.id;

        const rollupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'conditionalRollup',
            id: rollupFieldId,
            name: 'Scores Above Threshold',
            options: {
              expression: 'sum({values})',
              timeZone: 'utc',
            },
            config: {
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignScoreFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignScoreFieldId,
                      operator: 'isGreater',
                      value: thresholdFieldId,
                      isSymbol: true,
                    },
                  ],
                },
              },
            },
          },
        });

        await ctx.drainOutbox();

        await ctx.updateField({
          tableId: hostTable.id,
          fieldId: thresholdFieldId,
          field: {
            type: 'singleLineText',
            options: {},
          },
        });

        await ctx.drainOutbox();

        const refreshed = await ctx.getTableById(hostTable.id);
        const rollupField = refreshed.fields.find((field) => field.id === rollupFieldId);
        expect(rollupField?.type).toBe('conditionalRollup');
        expect(rollupField?.hasError).toBe(true);
      } finally {
        if (hostTableId) {
          await ctx.deleteTable(hostTableId).catch(() => undefined);
        }
        if (foreignTableId) {
          await ctx.deleteTable(foreignTableId).catch(() => undefined);
        }
      }
    }
  );

  test(
    'converts benchmark number text->number with dependent formula without backfill type mismatch',
    { timeout: 120_000 },
    async () => {
      let tableId: string | undefined;

      try {
        const numberFieldId = createFieldId();
        const numberFieldBId = createFieldId();
        const formulaFieldId = createFieldId();

        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-benchmark-formula'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: numberFieldId,
              name: 'Benchmark Number',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
            {
              type: 'number',
              id: numberFieldBId,
              name: 'Benchmark Number B',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
          ],
        });
        tableId = table.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: formulaFieldId,
            name: 'Benchmark Formula',
            options: { expression: `({${numberFieldId}}) + ({${numberFieldBId}})` },
          },
        });

        const records = Array.from({ length: 500 }, (_, index) => ({
          fields: {
            Name: `R-${index + 1}`,
            [numberFieldId]: (index % 11) + 1,
            [numberFieldBId]: (index % 7) + 0.5,
          },
        }));
        await ctx.createRecords(tableId, records);

        await ctx.drainOutbox();

        await ctx.updateField({
          tableId,
          fieldId: numberFieldId,
          field: {
            type: 'singleLineText',
            options: {},
          },
        });

        await ctx.updateField({
          tableId,
          fieldId: numberFieldId,
          field: {
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
        });

        await ctx.drainOutbox();

        const rows = await ctx.listRecords(tableId, { limit: 20, offset: 0 });
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.fields[formulaFieldId]).not.toBeNull();
          expect(row.fields[formulaFieldId]).not.toBeUndefined();
        }
      } finally {
        if (tableId) {
          await ctx.deleteTable(tableId).catch(() => undefined);
        }
      }
    }
  );

  test(
    'ignores malformed numeric text in conditional rollup backfill instead of throwing pg cast errors',
    { timeout: 120_000 },
    async () => {
      let sourceTableId: string | undefined;
      let middleTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const sourceScoreFieldId = createFieldId();
        const sourceTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-numeric-fallback-source'),
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', name: 'Score', id: sourceScoreFieldId },
          ],
          records: [
            { fields: { Name: 'S1', [sourceScoreFieldId]: 10 } },
            { fields: { Name: 'S2', [sourceScoreFieldId]: 20 } },
          ],
        });
        sourceTableId = sourceTable.id;
        const sourcePrimaryFieldId = sourceTable.fields.find((field) => field.isPrimary)?.id;
        if (!sourcePrimaryFieldId) throw new Error('Missing source primary field id');

        const middleNameFieldId = createFieldId();
        const middleLinkFieldId = createFieldId();
        const middleLookupFieldId = createFieldId();
        const middleTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-numeric-fallback-middle'),
          fields: [
            { type: 'singleLineText', id: middleNameFieldId, name: 'Bucket', isPrimary: true },
            {
              type: 'link',
              id: middleLinkFieldId,
              name: 'Source Link',
              options: {
                relationship: 'manyMany',
                foreignTableId: sourceTable.id,
                lookupFieldId: sourcePrimaryFieldId,
              },
            },
            {
              type: 'lookup',
              id: middleLookupFieldId,
              name: 'Scores',
              options: {
                linkFieldId: middleLinkFieldId,
                foreignTableId: sourceTable.id,
                lookupFieldId: sourceScoreFieldId,
              },
            },
          ],
        });
        middleTableId = middleTable.id;

        const sourceRecords = await ctx.listRecords(sourceTable.id, { limit: 10, offset: 0 });
        const s1 = sourceRecords.find((record) => record.fields[sourcePrimaryFieldId] === 'S1');
        const s2 = sourceRecords.find((record) => record.fields[sourcePrimaryFieldId] === 'S2');
        if (!s1 || !s2) throw new Error('Missing source records');

        await ctx.createRecord(middleTable.id, {
          [middleNameFieldId]: 'BucketA',
          [middleLinkFieldId]: [{ id: s1.id }, { id: s2.id }],
        });

        const hostNameFieldId = createFieldId();
        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName('v1p-numeric-fallback-host'),
          fields: [
            { type: 'singleLineText', id: hostNameFieldId, name: 'Bucket', isPrimary: true },
          ],
          records: [{ fields: { [hostNameFieldId]: 'BucketA' } }],
        });
        hostTableId = hostTable.id;

        const rollupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: hostTable.id,
          field: {
            type: 'conditionalRollup',
            id: rollupFieldId,
            name: 'Sum Score',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: middleTable.id,
              lookupFieldId: middleLookupFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: middleNameFieldId,
                      operator: 'is',
                      value: hostNameFieldId,
                      isSymbol: true,
                    },
                  ],
                },
              },
            },
          },
        });

        await ctx.drainOutbox();

        const middleMeta = await ctx.testContainer.db
          .selectFrom('table_meta')
          .select('db_table_name')
          .where('id', '=', middleTable.id)
          .executeTakeFirst();
        const middleDbTableName = middleMeta?.db_table_name;
        if (!middleDbTableName) throw new Error('Missing middle db table name');

        const lookupFieldMeta = await ctx.testContainer.db
          .selectFrom('field')
          .select('db_field_name')
          .where('id', '=', middleLookupFieldId)
          .executeTakeFirst();
        const middleLookupDbFieldName = lookupFieldMeta?.db_field_name;
        if (!middleLookupDbFieldName) throw new Error('Missing middle lookup db field name');

        const middleRecords = await ctx.listRecords(middleTable.id, { limit: 10, offset: 0 });
        const middleRecord = middleRecords.find(
          (record) => record.fields[middleNameFieldId] === 'BucketA'
        );
        if (!middleRecord) throw new Error('Missing middle record');

        const malformedNumeric = '16.0514.5411200000000016.2222222222222227.56.47.5';
        await sql`
          UPDATE ${sql.table(middleDbTableName)}
          SET ${sql.ref(middleLookupDbFieldName)} = ${JSON.stringify([malformedNumeric])}::jsonb
          WHERE "__id" = ${middleRecord.id}
        `.execute(ctx.testContainer.db);

        await ctx.updateField({
          tableId: hostTable.id,
          fieldId: rollupFieldId,
          field: {
            type: 'conditionalRollup',
            description: 'trigger malformed numeric backfill',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: middleTable.id,
              lookupFieldId: middleLookupFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: middleNameFieldId,
                      operator: 'is',
                      value: hostNameFieldId,
                      isSymbol: true,
                    },
                  ],
                },
              },
            },
          },
        });

        await ctx.drainOutbox();

        const refreshedHost = await ctx.getTableById(hostTable.id);
        const rollupField = refreshedHost.fields.find((field) => field.id === rollupFieldId);
        expect(rollupField?.hasError ?? false).toBe(false);

        const hostRecords = await ctx.listRecords(hostTable.id, { limit: 10, offset: 0 });
        const resultValue = hostRecords[0]?.fields[rollupFieldId];
        expect(typeof resultValue).toBe('number');
        expect(resultValue as number).toBeCloseTo(30, 4);
      } finally {
        if (hostTableId) {
          await ctx.deleteTable(hostTableId).catch(() => undefined);
        }
        if (middleTableId) {
          await ctx.deleteTable(middleTableId).catch(() => undefined);
        }
        if (sourceTableId) {
          await ctx.deleteTable(sourceTableId).catch(() => undefined);
        }
      }
    }
  );
});
