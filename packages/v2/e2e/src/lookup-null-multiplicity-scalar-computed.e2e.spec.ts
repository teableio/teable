/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized, structure-equivalent regression for historical lookup metadata
 * where `is_multiple_cell_value` is NULL while the physical column stays scalar TEXT.
 *
 * Retained structure:
 * - manyOne link to another table
 * - lookup of a singleLineText source
 * - TEXT physical storage
 * - NULL multiplicity metadata
 * - computed refresh via an upstream record update
 * - lookup → singleLineText conversion
 *
 * Customer names, ids, and cell values are not copied.
 */
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('lookup NULL multiplicity scalar computed (e2e)', () => {
  let ctx: SharedTestContext;
  let foreignTableId: string | undefined;
  let hostTableId: string | undefined;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterAll(async () => {
    if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  it('refreshes a scalar lookup and converts it to text when multiplicity metadata is NULL', async () => {
    const foreignNameFieldId = `fld${getRandomString(16)}`;
    const hostNameFieldId = `fld${getRandomString(16)}`;
    const linkFieldId = `fld${getRandomString(16)}`;
    const lookupFieldId = `fld${getRandomString(16)}`;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Related records ${getRandomString(6)}`,
      fields: [
        {
          type: 'singleLineText',
          id: foreignNameFieldId,
          name: 'Related title',
          isPrimary: true,
        },
      ],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreignTable.id;

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Host records ${getRandomString(6)}`,
      fields: [
        {
          type: 'singleLineText',
          id: hostNameFieldId,
          name: 'Host title',
          isPrimary: true,
        },
      ],
      views: [{ type: 'grid' }],
    });
    hostTableId = hostTable.id;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'link',
        id: linkFieldId,
        name: 'Related',
        options: {
          foreignTableId: foreignTable.id,
          relationship: 'manyOne',
          lookupFieldId: foreignNameFieldId,
          isOneWay: true,
        },
      },
    });

    const hostWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Related title lookup',
        options: {
          linkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignNameFieldId,
        },
      },
    });
    const lookupField = hostWithLookup.fields.find((field) => field.id === lookupFieldId);
    if (!lookupField) throw new Error('Lookup field was not created');

    const foreignRecord = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: 'alpha',
    });
    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostNameFieldId]: 'host',
      [linkFieldId]: { id: foreignRecord.id, title: 'alpha' },
    });
    await ctx.drainOutbox();

    const fieldStorage = await ctx.testContainer.db
      .selectFrom('field')
      .select(['db_field_name', 'db_field_type', 'is_multiple_cell_value'])
      .where('id', '=', lookupFieldId)
      .executeTakeFirstOrThrow();
    const lookupDbFieldName = fieldStorage.db_field_name;
    if (!lookupDbFieldName) throw new Error('Lookup db field name was not persisted');

    // Historical leftover: scalar TEXT storage with NULL multiplicity metadata.
    const hostTableRef = sql.table(`${ctx.baseId}.${hostTable.id}`);
    const lookupColumn = sql.ref(lookupDbFieldName);
    await sql`
      ALTER TABLE ${hostTableRef}
      ALTER COLUMN ${lookupColumn} TYPE text
      USING (
        CASE
          WHEN pg_typeof(${lookupColumn})::text IN ('jsonb', 'json') THEN
            CASE
              WHEN jsonb_typeof(${lookupColumn}::jsonb) = 'array' THEN ${lookupColumn}::jsonb ->> 0
              WHEN jsonb_typeof(${lookupColumn}::jsonb) = 'string' THEN ${lookupColumn}::jsonb #>> '{}'
              ELSE NULLIF(${lookupColumn}::text, '')
            END
          ELSE NULLIF(${lookupColumn}::text, '')
        END
      )
    `.execute(ctx.testContainer.db);

    await sql`
      UPDATE "field"
      SET "db_field_type" = 'TEXT',
          "is_multiple_cell_value" = NULL
      WHERE "id" = ${lookupFieldId}
    `.execute(ctx.testContainer.db);

    const nulledStorage = await ctx.testContainer.db
      .selectFrom('field')
      .select(['db_field_type', 'is_multiple_cell_value'])
      .where('id', '=', lookupFieldId)
      .executeTakeFirstOrThrow();
    expect(nulledStorage.db_field_type).toBe('TEXT');
    expect(nulledStorage.is_multiple_cell_value).toBeNull();

    const physicalValue = await sql<{ v: string | null }>`
      SELECT ${lookupColumn} as v
      FROM ${hostTableRef}
      WHERE "__id" = ${hostRecord.id}
    `.execute(ctx.testContainer.db);
    expect(physicalValue.rows[0]?.v).toBe('alpha');

    await ctx.updateRecord(foreignTable.id, foreignRecord.id, {
      [foreignNameFieldId]: 'beta',
    });
    await ctx.drainOutbox();

    const refreshed = await ctx.listRecordsWithoutDrain(hostTable.id);
    expect(refreshed.find((record) => record.id === hostRecord.id)?.fields[lookupFieldId]).toBe(
      'beta'
    );

    const deadLetters = await ctx.testContainer.db
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error', 'affected_field_ids'])
      .where('base_id', '=', ctx.baseId)
      .execute();
    expect(deadLetters.filter((task) => task.affected_field_ids.includes(lookupFieldId))).toEqual(
      []
    );

    const convertedTable = await ctx.updateField({
      tableId: hostTable.id,
      fieldId: lookupField.id,
      field: { type: 'singleLineText' },
    });
    const converted = convertedTable.fields.find((field) => field.id === lookupFieldId);
    expect(converted?.type).toBe('singleLineText');
    expect(converted?.isLookup).toBeFalsy();

    const afterConversion = await ctx.listRecords(hostTable.id);
    expect(
      afterConversion.find((record) => record.id === hostRecord.id)?.fields[lookupFieldId]
    ).toBe('beta');
  });
});
