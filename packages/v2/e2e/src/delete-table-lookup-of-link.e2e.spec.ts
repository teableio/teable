/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7539: sanitized, structure-equivalent to a failed soft delete.
 *
 * Retained structural facts:
 * - manyOne link on the middle table points at the table being deleted
 * - manyOne host link looks up that middle link field
 * - the lookup is single-valued, persisted as JSON, and stored in jsonb
 * - rows exist on every table before the delete
 *
 * Customer names, ids, and cell values are not copied.
 */
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 delete table with lookup of link (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = `dltlnk${fieldIdCounter.toString(36)}`.padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it(
    'soft-deletes a table referenced by a single-value lookup of a link',
    { timeout: 120_000 },
    async () => {
      const farTitleFieldId = createFieldId();
      const middleTitleFieldId = createFieldId();
      const middleLinkFieldId = createFieldId();
      const hostTitleFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      let farTableId: string | undefined;
      let middleTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const far = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('Far'),
          fields: [{ type: 'singleLineText', id: farTitleFieldId, name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        });
        farTableId = far.id;
        const farRecord = await ctx.createRecord(far.id, {
          [farTitleFieldId]: 'Far A',
        });

        const middle = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('Middle'),
          fields: [
            { type: 'singleLineText', id: middleTitleFieldId, name: 'Title', isPrimary: true },
            {
              type: 'link',
              id: middleLinkFieldId,
              name: 'Far Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: far.id,
                lookupFieldId: farTitleFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        middleTableId = middle.id;
        const middleRecord = await ctx.createRecord(middle.id, {
          [middleTitleFieldId]: 'Middle A',
          [middleLinkFieldId]: { id: farRecord.id },
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('Host'),
          fields: [
            { type: 'singleLineText', id: hostTitleFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: hostLinkFieldId,
              name: 'Middle Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: middle.id,
                lookupFieldId: middleTitleFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        hostTableId = host.id;
        const hostRecord = await ctx.createRecord(host.id, {
          [hostTitleFieldId]: 'Host A',
          [hostLinkFieldId]: { id: middleRecord.id },
        });

        const createdLookup = await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Far Lookup',
            legacyMultiplicityDerivation: true,
            options: {
              foreignTableId: middle.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: middleLinkFieldId,
            },
          },
        });
        const lookupField = createdLookup.fields.find((field) => field.id === lookupFieldId);
        expect(lookupField).toMatchObject({
          type: 'link',
          isLookup: true,
          isMultipleCellValue: false,
        });
        await drainOutbox();

        const column = await sql<{ data_type: string; db_field_type: string }>`
          SELECT c.data_type, f.db_field_type
          FROM field f
          JOIN information_schema.columns c
            ON c.table_schema = ${ctx.baseId}
           AND c.table_name = ${host.id}
           AND c.column_name = f.db_field_name
          WHERE f.id = ${lookupFieldId}
        `.execute(ctx.testContainer.db);
        expect(column.rows[0]).toMatchObject({
          db_field_type: 'JSON',
          data_type: 'jsonb',
        });

        const before = (await ctx.listRecords(host.id)).find(
          (record) => record.id === hostRecord.id
        );
        expect(JSON.stringify(before?.fields[lookupFieldId])).toContain('Far A');

        await ctx.deleteTable(far.id, { mode: 'soft' });
        await drainOutbox();

        const farMeta = await sql<{
          provision_state: string;
          deleted_time: Date | null;
        }>`
          SELECT provision_state, deleted_time
          FROM table_meta
          WHERE id = ${far.id}
        `.execute(ctx.testContainer.db);
        expect(farMeta.rows[0]?.provision_state).toBe('ready');
        expect(farMeta.rows[0]?.deleted_time).not.toBeNull();

        const afterColumn = await sql<{ data_type: string; db_field_type: string }>`
          SELECT c.data_type, f.db_field_type
          FROM field f
          JOIN information_schema.columns c
            ON c.table_schema = ${ctx.baseId}
           AND c.table_name = ${host.id}
           AND c.column_name = f.db_field_name
          WHERE f.id = ${lookupFieldId}
        `.execute(ctx.testContainer.db);
        expect(afterColumn.rows[0]).toMatchObject({
          db_field_type: 'TEXT',
          data_type: 'text',
        });

        const after = (await ctx.listRecords(host.id)).find(
          (record) => record.id === hostRecord.id
        );
        expect(JSON.stringify(after?.fields[lookupFieldId])).toContain('Far A');
      } finally {
        if (hostTableId)
          await ctx.deleteTable(hostTableId, { mode: 'permanent' }).catch(() => undefined);
        if (middleTableId) {
          await ctx.deleteTable(middleTableId, { mode: 'permanent' }).catch(() => undefined);
        }
        if (farTableId)
          await ctx.deleteTable(farTableId, { mode: 'permanent' }).catch(() => undefined);
      }
    }
  );
});
