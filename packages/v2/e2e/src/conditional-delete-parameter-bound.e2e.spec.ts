/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Y3905: a conditional delete that matches more rows than the PostgreSQL
 * per-statement bind-parameter ceiling (65535) must still commit in one
 * operation, including incoming link cleanup over the same selection.
 *
 * A single statement that binds one parameter per matched id cannot pass on a
 * real PostgreSQL server, so a successful commit with the exact committed count
 * is the observable proof that the selection is not carried as per-row bind
 * parameters. This spec must run against real PostgreSQL: PGlite does not
 * enforce the PostgreSQL wire-protocol parameter ceiling, so a green PGlite run
 * proves nothing about the bound.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const MATCHED_FILL_ROWS = 65_536;
const CREATE_BATCH_SIZE = 1_000;

const isPgliteConnection = () => {
  const connectionString =
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;
  return connectionString?.startsWith('pglite://') || connectionString === 'memory://';
};

const linkRecordIds = (value: unknown): string[] => {
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) =>
    item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? [item.id] : []
  );
};

describe.skipIf(isPgliteConnection())(
  '[Y3905] v2 conditional delete beyond the PostgreSQL bind-parameter ceiling (e2e)',
  () => {
    let ctx: SharedTestContext;
    let tableIdToDrop: string | undefined;

    beforeAll(async () => {
      ctx = await getSharedTestContext({ dbMode: 'postgres' });
      expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
    }, 120_000);

    afterAll(async () => {
      if (tableIdToDrop) {
        await ctx.deleteTable(tableIdToDrop, { mode: 'permanent' });
      }
    }, 120_000);

    it('Y3905 deletes more than 65535 conditional matches with linked cleanup in one commit', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Conditional Delete Parameter Bound ${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'singleLineText', name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });
      tableIdToDrop = table.id;
      const titleId = table.fields.find((field) => field.isPrimary)!.id;
      const statusId = table.fields.find((field) => field.name === 'Status')!.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'link',
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: table.id,
            lookupFieldId: titleId,
            isOneWay: false,
          },
        },
      });
      const tableWithLink = await ctx.getTableById(table.id);
      const parentFieldId = tableWithLink.fields.find((field) => field.name === 'Parent')!.id;
      const childrenFieldId = tableWithLink.fields.find(
        (field) => field.type === 'link' && field.id !== parentFieldId
      )!.id;

      const tableMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', table.id)
        .executeTakeFirstOrThrow();
      const fieldMeta = await ctx.testContainer.db
        .selectFrom('field')
        .select(['options', 'db_field_name'])
        .where('id', '=', parentFieldId)
        .executeTakeFirstOrThrow();
      const rawLinkOptions: unknown = fieldMeta.options;
      const linkOptions = (
        typeof rawLinkOptions === 'string' ? JSON.parse(rawLinkOptions) : rawLinkOptions
      ) as { foreignKeyName?: string } | null;
      const fkColumn = linkOptions?.foreignKeyName ?? '';
      const displayColumn = fieldMeta.db_field_name;
      if (!fkColumn || !displayColumn) {
        throw new Error(`Missing stored link columns for ${parentFieldId}`);
      }
      const readStoredLink = async (recordId: string) => {
        const result = await sql<{ fk: unknown; cell: unknown }>`
            SELECT ${sql.ref(fkColumn)} AS fk, ${sql.ref(displayColumn)} AS cell
            FROM ${sql.table(tableMeta.db_table_name)}
            WHERE ${sql.ref('__id')} = ${recordId}
          `.execute(ctx.testContainer.db);
        expect(result.rows).toHaveLength(1);
        return result.rows[0]!;
      };

      // One linked pair and one surviving inbound link are enough to make both
      // the incoming-cleanup statement and the delete statement carry the whole
      // matched selection.
      const target = await ctx.createRecord(table.id, {
        [titleId]: 'a-target',
        [statusId]: 'remove',
      });
      const source = await ctx.createRecord(table.id, {
        [titleId]: 'a-source',
        [statusId]: 'remove',
        [parentFieldId]: { id: target.id },
      });
      const survivor = await ctx.createRecord(table.id, {
        [titleId]: 'a-survivor',
        [statusId]: 'keep',
        [parentFieldId]: { id: target.id },
      });

      const createdFillIds: string[] = [];
      for (let offset = 0; offset < MATCHED_FILL_ROWS; offset += CREATE_BATCH_SIZE) {
        const size = Math.min(CREATE_BATCH_SIZE, MATCHED_FILL_ROWS - offset);
        const created = await ctx.createRecords(
          table.id,
          Array.from({ length: size }, (_, index) => ({
            fields: { [titleId]: `zfill-${offset + index}`, [statusId]: 'remove' },
          }))
        );
        createdFillIds.push(...created.map((record) => record.id));
      }
      expect(createdFillIds).toHaveLength(MATCHED_FILL_ROWS);
      expect(new Set(createdFillIds).size).toBe(MATCHED_FILL_ROWS);

      const totalRows = MATCHED_FILL_ROWS + 2;
      const countRows = async () => {
        const result = await sql<{ total: string }>`
            SELECT count(*)::text AS total
            FROM ${sql.table(tableMeta.db_table_name)}
          `.execute(ctx.testContainer.db);
        return Number(result.rows[0]!.total);
      };
      expect(await countRows()).toBe(totalRows + 1);

      // Anchor rows sort ahead of every fill row by title, so the pre-delete
      // cells are read without assuming any list page position.
      const anchors = await ctx.listRecords(table.id, {
        sort: [{ fieldId: titleId, order: 'asc' }],
        limit: 3,
      });
      expect(anchors.map((row) => row.id).sort()).toEqual(
        [source.id, survivor.id, target.id].sort()
      );
      const anchorById = new Map(anchors.map((row) => [row.id, row]));
      const originalSurvivorCell = anchorById.get(survivor.id)!.fields[parentFieldId];
      expect(linkRecordIds(originalSurvivorCell)).toEqual([target.id]);
      expect(linkRecordIds(anchorById.get(source.id)!.fields[parentFieldId])).toEqual([target.id]);
      const originalSurvivorStored = await readStoredLink(survivor.id);
      expect(originalSurvivorStored.fk).toBe(target.id);
      expect(originalSurvivorStored.cell).not.toBeNull();

      const deleteByStatus = () =>
        fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: table.id,
            filter: { fieldId: statusId, operator: 'is', value: 'remove' },
          }),
        });

      const first = await deleteByStatus();
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ ok: true, data: { deletedCount: totalRows } });
      expect(await countRows()).toBe(1);
      const afterDelete = await ctx.listRecords(table.id, { limit: 1000 });
      expect(afterDelete.map((row) => row.id)).toEqual([survivor.id]);
      expect(linkRecordIds(afterDelete[0]!.fields[parentFieldId])).toEqual([]);
      expect(linkRecordIds(afterDelete[0]!.fields[childrenFieldId])).toEqual([]);
      const cleanedStored = await readStoredLink(survivor.id);
      expect(cleanedStored.fk).toBeNull();
      expect(cleanedStored.cell).toBeNull();

      const repeat = await deleteByStatus();
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toMatchObject({ ok: true, data: { deletedCount: 0 } });
      expect(await countRows()).toBe(1);
      expect((await ctx.listRecords(table.id, { limit: 1000 })).map((row) => row.id)).toEqual([
        survivor.id,
      ]);
    }, 900_000);
  }
);
