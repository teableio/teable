/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T8446: sanitized, structure-equivalent to the reported production damage.
 *
 * Retained facts only:
 * - a target-side link field owns a JSONB cache column; a second live reverse
 *   link field was given the same physical name, so the column disappeared when
 *   the other field was removed;
 * - the source-side FK of each relation survives, so relation identity can be
 *   rebuilt from storage rather than from the missing cache;
 * - repair recreates the column structure only, and link backfill must then run
 *   with two-way oneMany enabled to restore values.
 *
 * Customer names, ids and values are not copied.
 */
import {
  PostgresSchemaIntrospector,
  createSchemaRepairer,
  v2RecordRepositoryPostgresTokens,
  type ComputedFieldBackfillService,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  TableByIdSpec,
  TableId,
  getRandomString,
  v2CoreTokens,
  type ITableRepository,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type Fixture = {
  ownersTableId: string;
  ownerTitleFieldId: string;
  ownerDbTableName: string;
  itemRecordId: string;
  ownerARecordId: string;
  ownerBRecordId: string;
  primaryReverseFieldId: string;
  secondaryReverseFieldId: string;
  sharedColumn: string;
  secondaryColumn: string;
};

describe('[T8446] link cache column recovery for duplicate physical names', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 60_000);

  const createFixture = async (): Promise<Fixture> => {
    const owners = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Owners ${getRandomString(6)}`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const items = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Items ${getRandomString(6)}`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const ownerTitleFieldId = owners.fields.find((field) => field.isPrimary)!.id;
    const itemTitleFieldId = items.fields.find((field) => field.isPrimary)!.id;

    const createReverseLink = async (name: string) => {
      const id = `fld${getRandomString(16)}`;
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId: items.id,
        field: {
          id,
          name,
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: owners.id,
            lookupFieldId: ownerTitleFieldId,
          },
        },
      });
      const field = table.fields.find((candidate) => candidate.id === id);
      if (field?.type !== 'link' || !field.options.symmetricFieldId) {
        throw new Error('Missing generated reverse link');
      }
      return { sourceFieldId: id, reverseFieldId: field.options.symmetricFieldId };
    };

    const primary = await createReverseLink('Primary owner');
    const secondary = await createReverseLink('Secondary owner');
    const ownerA = await ctx.createRecord(owners.id, { [ownerTitleFieldId]: 'Owner A' });
    const ownerB = await ctx.createRecord(owners.id, { [ownerTitleFieldId]: 'Owner B' });
    const item = await ctx.createRecord(items.id, {
      [itemTitleFieldId]: 'Item A',
      [primary.sourceFieldId]: { id: ownerA.id },
      [secondary.sourceFieldId]: { id: ownerB.id },
    });
    await ctx.drainOutbox();

    const ownerTable = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', owners.id)
      .executeTakeFirstOrThrow();
    const columns = new Map(
      (
        await ctx.testContainer.db
          .selectFrom('field')
          .select(['id', 'db_field_name'])
          .where('id', 'in', [primary.reverseFieldId, secondary.reverseFieldId])
          .execute()
      ).map((row) => [row.id, row.db_field_name!])
    );

    return {
      ownersTableId: owners.id,
      ownerTitleFieldId,
      ownerDbTableName: ownerTable.db_table_name,
      itemRecordId: item.id,
      ownerARecordId: ownerA.id,
      ownerBRecordId: ownerB.id,
      primaryReverseFieldId: primary.reverseFieldId,
      secondaryReverseFieldId: secondary.reverseFieldId,
      sharedColumn: columns.get(primary.reverseFieldId)!,
      secondaryColumn: columns.get(secondary.reverseFieldId)!,
    };
  };

  const repairAndBackfill = async (tableId: string, fieldId: string) => {
    const db = ctx.testContainer.db;
    const tableRepository = ctx.testContainer.container.resolve<ITableRepository>(
      v2CoreTokens.tableRepository
    );
    const backfillService = ctx.testContainer.container.resolve<ComputedFieldBackfillService>(
      v2RecordRepositoryPostgresTokens.computedFieldBackfillService
    );
    const context = { actorId: ActorId.create(ctx.testUser.id)._unsafeUnwrap() };

    const table = (
      await tableRepository.findOne(
        context,
        TableByIdSpec.create(TableId.create(tableId)._unsafeUnwrap())
      )
    )._unsafeUnwrap();
    const repairer = createSchemaRepairer({
      db,
      metaDb: db,
      introspector: new PostgresSchemaIntrospector(db),
      schema: ctx.baseId,
    });

    const repairStatuses: string[] = [];
    for await (const result of repairer.repairRule(
      table,
      fieldId,
      `link_value_column:${fieldId}`
    )) {
      repairStatuses.push(result.status);
      expect(result.status, JSON.stringify(result)).not.toBe('error');
    }
    const field = table.getFields().find((candidate) => candidate.id().toString() === fieldId);
    if (!field) throw new Error(`Field ${fieldId} is not part of the table aggregate`);
    (
      await backfillService.backfillMany(context, {
        table,
        fields: [field],
        includeOneManyTwoWay: true,
      })
    )._unsafeUnwrap();
    await ctx.drainOutbox();
    return repairStatuses;
  };

  const expectRelation = async (fixture: Fixture) => {
    const owners = await ctx.listRecords(fixture.ownersTableId);
    expect(owners.find(({ id }) => id === fixture.ownerARecordId)?.fields).toMatchObject({
      [fixture.primaryReverseFieldId]: [{ id: fixture.itemRecordId, title: 'Item A' }],
      [fixture.secondaryReverseFieldId]: null,
    });
    expect(owners.find(({ id }) => id === fixture.ownerBRecordId)?.fields).toMatchObject({
      [fixture.primaryReverseFieldId]: null,
      [fixture.secondaryReverseFieldId]: [{ id: fixture.itemRecordId, title: 'Item A' }],
    });
  };

  it('splits duplicate physical names and rebuilds each relation from its own FK', async () => {
    const fixture = await createFixture();
    const db = ctx.testContainer.db;
    await db
      .updateTable('field')
      .set({ db_field_name: fixture.sharedColumn })
      .where('id', '=', fixture.secondaryReverseFieldId)
      .execute();
    await sql`ALTER TABLE ${sql.table(fixture.ownerDbTableName)} DROP COLUMN ${sql.ref(fixture.secondaryColumn)}`.execute(
      db
    );

    // Both relations wrote this one column before the split, so it can carry
    // either payload. A split that rebuilds only the moved field would leave
    // this stale value on screen for the field that stayed.
    const staleRecordId = `rec${getRandomString(16)}`;
    const stalePayload = JSON.stringify([{ id: staleRecordId, title: 'Stale link' }]);
    await sql`UPDATE ${sql.table(fixture.ownerDbTableName)} SET ${sql.ref(fixture.sharedColumn)} = ${stalePayload}::jsonb`.execute(
      db
    );

    // Keep the shared column where it is and give the second metadata row a
    // fresh name: the column must never be renamed away from its other owner.
    const splitColumn = `split_${getRandomString(16)}`;
    await db
      .updateTable('field')
      .set({ db_field_name: splitColumn })
      .where('id', '=', fixture.secondaryReverseFieldId)
      .execute();

    expect(
      await repairAndBackfill(fixture.ownersTableId, fixture.secondaryReverseFieldId)
    ).toContain('success');
    const movedField = await ctx.listRecords(fixture.ownersTableId);
    expect(movedField.find(({ id }) => id === fixture.ownerBRecordId)?.fields).toMatchObject({
      [fixture.secondaryReverseFieldId]: [{ id: fixture.itemRecordId, title: 'Item A' }],
    });
    // Rebuilding only the moved field leaves the shared cache contaminated for
    // the field that stayed, so that step is required and not optional.
    expect(
      movedField.find(({ id }) => id === fixture.ownerARecordId)?.fields[
        fixture.primaryReverseFieldId
      ]
    ).toEqual([{ id: staleRecordId, title: 'Stale link' }]);

    await repairAndBackfill(fixture.ownersTableId, fixture.primaryReverseFieldId);
    await expectRelation(fixture);

    // Repair and backfill are repeatable and must not disturb rebuilt values.
    await repairAndBackfill(fixture.ownersTableId, fixture.secondaryReverseFieldId);
    await expectRelation(fixture);
  }, 120_000);

  it('restores a dropped cache column and backfills the surviving relation', async () => {
    const fixture = await createFixture();
    const db = ctx.testContainer.db;
    await sql`ALTER TABLE ${sql.table(fixture.ownerDbTableName)} DROP COLUMN ${sql.ref(fixture.sharedColumn)}`.execute(
      db
    );

    const repairStatuses = await repairAndBackfill(
      fixture.ownersTableId,
      fixture.primaryReverseFieldId
    );
    expect(repairStatuses.at(-1)).toBe('success');

    const owners = await ctx.listRecords(fixture.ownersTableId);
    expect(owners.find(({ id }) => id === fixture.ownerARecordId)?.fields).toMatchObject({
      [fixture.primaryReverseFieldId]: [{ id: fixture.itemRecordId, title: 'Item A' }],
    });
    expect(
      owners.find(({ id }) => id === fixture.ownerBRecordId)?.fields[fixture.primaryReverseFieldId]
    ).toBeNull();
    expect(
      owners.find(({ id }) => id === fixture.ownerARecordId)?.fields[fixture.ownerTitleFieldId]
    ).toBe('Owner A');
  }, 120_000);
});
