/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized, structure-equivalent regression for T6844.
 *
 * Retained structure:
 * - host table has a oneMany json-stored link
 * - lookup of a numeric text title (array storage)
 * - a later scalar number formula uses VALUE({lookup})
 * - formula multiplicity is single, cellValueType is number
 *
 * The failing computed UPDATE used to wrap jsonb_agg(...) in
 * `::double precision`, which raises 22P02 for values like `[0.0003]`.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 scalar number formula over json array link (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldSequence = 0;
  const cleanupTableIds: string[] = [];

  const createFieldId = (label: string) => {
    fieldSequence += 1;
    const suffix = `${label}${fieldSequence}`.replaceAll(/[^a-z0-9]/gi, '').slice(0, 16);
    return `fld${suffix.padEnd(16, '0')}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  afterEach(async () => {
    for (const tableId of [...cleanupTableIds].reverse()) {
      await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    }
    cleanupTableIds.length = 0;
    await ctx.testContainer.db
      .deleteFrom('computed_update_dead_letter')
      .where('base_id', '=', ctx.baseId)
      .execute()
      .catch(() => undefined);
  });

  it('backfills VALUE() of a oneMany numeric lookup without 22P02', async () => {
    const rateTitleFieldId = createFieldId('rateTitle');
    const rateTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'scalar-number-json-array-rate',
      fields: [{ type: 'singleLineText', id: rateTitleFieldId, name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(rateTable.id);

    const rateRecord = await ctx.createRecord(rateTable.id, {
      [rateTitleFieldId]: '0.0003',
    });

    const hostNameFieldId = createFieldId('hostName');
    const linkFieldId = createFieldId('rateLink');
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'scalar-number-json-array-host',
      fields: [
        { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Rates',
          options: {
            relationship: 'oneMany',
            foreignTableId: rateTable.id,
            lookupFieldId: rateTitleFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(hostTable.id);

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostNameFieldId]: 'Contract 1',
      [linkFieldId]: [{ id: rateRecord.id }],
    });
    await ctx.drainOutbox();

    const lookupFieldId = createFieldId('rateLookup');
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Rate Titles',
        options: {
          foreignTableId: rateTable.id,
          lookupFieldId: rateTitleFieldId,
          linkFieldId,
        },
      },
    });

    const formulaFieldId = createFieldId('convRate');
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Conversion Rate',
        options: {
          expression: `VALUE({${lookupFieldId}})`,
        },
      },
    });
    await ctx.drainOutbox();

    await ctx.updateRecord(rateTable.id, rateRecord.id, {
      [rateTitleFieldId]: '0.0003',
    });
    await ctx.drainOutbox();

    const deadLetters = await ctx.testContainer.db
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error', 'affected_field_ids'])
      .where('base_id', '=', ctx.baseId)
      .execute();
    expect(deadLetters.filter((task) => task.affected_field_ids.includes(formulaFieldId))).toEqual(
      []
    );

    const records = await ctx.listRecords(hostTable.id);
    const record = records.find((item) => item.id === hostRecord.id);
    expect(record).toBeDefined();
    expect(record?.fields[formulaFieldId]).toBeCloseTo(0.0003);
  });
});
