/* eslint-disable @typescript-eslint/naming-convention */
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 HTTP field deletion with legacy shared link columns', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it.each(['direct', 'symmetric'] as const)(
    'keeps the surviving relation readable after %s deletion and drops its last cache column',
    async (deletionSide) => {
      const owners = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Owners ${getRandomString(8)}`,
        fields: [{ name: 'Name', type: 'singleLineText' }],
      });
      const items = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Items ${getRandomString(8)}`,
        fields: [{ name: 'Name', type: 'singleLineText' }],
      });
      const ownerTitle = owners.fields.find((field) => field.isPrimary)!;
      const itemTitle = items.fields.find((field) => field.isPrimary)!;
      const createOwnerLink = async (name: string) => {
        const fieldId = `fld${getRandomString(16)}`;
        const table = await ctx.createField({
          baseId: ctx.baseId,
          tableId: items.id,
          field: {
            id: fieldId,
            name,
            type: 'link',
            options: {
              relationship: 'manyOne',
              foreignTableId: owners.id,
              lookupFieldId: ownerTitle.id,
            },
          },
        });
        const field = table.fields.find((candidate) => candidate.id === fieldId);
        if (field?.type !== 'link' || !field.options.symmetricFieldId) {
          throw new Error('Missing symmetric owner link');
        }
        return { fieldId, symmetricFieldId: field.options.symmetricFieldId };
      };
      const primary = await createOwnerLink('Primary owner');
      const secondary = await createOwnerLink('Secondary owner');
      const ownerA = await ctx.createRecord(owners.id, { [ownerTitle.id]: 'Owner A' });
      const ownerB = await ctx.createRecord(owners.id, { [ownerTitle.id]: 'Owner B' });
      const item = await ctx.createRecord(items.id, {
        [itemTitle.id]: 'Item A',
        [primary.fieldId]: { id: ownerA.id },
        [secondary.fieldId]: { id: ownerB.id },
      });
      await ctx.drainOutbox();

      const db = ctx.testContainer.db;
      const ownerTable = await db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', owners.id)
        .executeTakeFirstOrThrow();
      const primaryRow = await db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', primary.symmetricFieldId)
        .executeTakeFirstOrThrow();
      const secondaryRow = await db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', secondary.symmetricFieldId)
        .executeTakeFirstOrThrow();
      const sharedColumn = primaryRow.db_field_name!;
      const secondaryColumn = secondaryRow.db_field_name!;

      // Preserve the incident's structure without customer names or values:
      // distinct source FKs, two live reverse links, one shared JSON cache.
      await db
        .updateTable('field')
        .set({ db_field_name: sharedColumn })
        .where('id', '=', secondary.symmetricFieldId)
        .execute();
      await sql`ALTER TABLE ${sql.table(ownerTable.db_table_name)} DROP COLUMN ${sql.ref(secondaryColumn)}`.execute(
        db
      );

      await ctx.deleteField({
        tableId: deletionSide === 'direct' ? owners.id : items.id,
        fieldId: deletionSide === 'direct' ? secondary.symmetricFieldId : secondary.fieldId,
      });

      const remainingOwners = await ctx.listRecords(owners.id);
      expect(
        remainingOwners.find(({ id }) => id === ownerA.id)?.fields[primary.symmetricFieldId]
      ).toEqual([{ id: item.id, title: 'Item A' }]);
      expect(
        remainingOwners.find(({ id }) => id === ownerB.id)?.fields[primary.symmetricFieldId]
      ).toBeNull();
      const remainingItems = await ctx.listRecords(items.id);
      expect(remainingItems.find(({ id }) => id === item.id)?.fields[primary.fieldId]).toEqual({
        id: ownerA.id,
        title: 'Owner A',
      });
      expect((await ctx.getTableById(owners.id)).fields.map(({ id }) => id)).not.toContain(
        secondary.symmetricFieldId
      );
      expect((await ctx.getTableById(items.id)).fields.map(({ id }) => id)).not.toContain(
        secondary.fieldId
      );

      await ctx.updateRecord(items.id, item.id, { [primary.fieldId]: { id: ownerB.id } });
      const reassignedOwners = await ctx.listRecords(owners.id);
      expect(
        reassignedOwners.find(({ id }) => id === ownerA.id)?.fields[primary.symmetricFieldId]
      ).toBeNull();
      expect(
        reassignedOwners.find(({ id }) => id === ownerB.id)?.fields[primary.symmetricFieldId]
      ).toEqual([{ id: item.id, title: 'Item A' }]);

      await ctx.deleteField({ tableId: owners.id, fieldId: primary.symmetricFieldId });
      const physicalRows = await sql<
        Record<string, unknown>
      >`SELECT * FROM ${sql.table(ownerTable.db_table_name)}`.execute(db);
      expect(physicalRows.rows.map((row) => row.__id).sort()).toEqual(
        [ownerA.id, ownerB.id].sort()
      );
      for (const row of physicalRows.rows) {
        expect(row).not.toHaveProperty(sharedColumn);
      }
      const finalOwners = await ctx.listRecords(owners.id);
      expect(finalOwners.map((record) => record.fields[ownerTitle.id]).sort()).toEqual([
        'Owner A',
        'Owner B',
      ]);
    }
  );
});
