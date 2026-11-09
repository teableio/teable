/* eslint-disable @typescript-eslint/naming-convention */
import { randomUUID } from 'node:crypto';
import { createTableOkResponseSchema } from '@teable/v2-contract-http';
import {
  ActorId,
  v2CoreTokens,
  type ICreateTableCommandInput,
  type IExecutionContext,
  type ISchemaOperationRepository,
  type SchemaOperationRunnerService,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type LinkStorage = {
  id: string;
  db_field_name: string;
  relationship: string;
  symmetric_id: string;
  fk_host: string;
  self_key: string;
  foreign_key: string;
};

type Fixture = {
  foreignId: string;
  foreignPrimaryId: string;
  foreignRecordIds: string[];
  sourceId: string;
  legacyName: string;
  payload: ICreateTableCommandInput;
};

describe('v2 createTable with a legacy foreign physical name (T8412)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  const relationExists = async (name: string) => {
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${ctx.baseId} AND c.relname = ${name}
      ) AS "exists"
    `.execute(ctx.testContainer.db);
    return result.rows[0]!.exists;
  };

  const readLink = async (tableId: string) => {
    const result = await sql<LinkStorage>`
      SELECT "id", "db_field_name", options::jsonb->>'relationship' AS "relationship",
        options::jsonb->>'symmetricFieldId' AS "symmetric_id",
        options::jsonb->>'fkHostTableName' AS "fk_host",
        options::jsonb->>'selfKeyName' AS "self_key",
        options::jsonb->>'foreignKeyName' AS "foreign_key"
      FROM "field"
      WHERE "table_id" = ${tableId} AND "type" = 'link' AND "deleted_time" IS NULL
    `.execute(ctx.testContainer.db);
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  };

  const renameForeign = async (fixture: Fixture) => {
    await sql`
      ALTER TABLE ${sql.id(ctx.baseId, fixture.foreignId)}
      RENAME TO ${sql.id(fixture.legacyName)}
    `.execute(ctx.testContainer.db);
    await sql`
      UPDATE "table_meta" SET "db_table_name" = ${`${ctx.baseId}.${fixture.legacyName}`}
      WHERE "id" = ${fixture.foreignId}
    `.execute(ctx.testContainer.db);
    expect(await relationExists(fixture.legacyName)).toBe(true);
    expect(await relationExists(fixture.foreignId)).toBe(false);
  };

  const withFixture = async (run: (fixture: Fixture) => Promise<void>) => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Legacy foreign target',
      fields: [{ type: 'singleSelect', name: 'Status', isPrimary: true, options: ['Synthetic'] }],
    });
    const foreignPrimaryId = foreign.fields.find((field) => field.isPrimary)!.id;
    const sourceId = `tbl${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const fixture: Fixture = {
      foreignId: foreign.id,
      foreignPrimaryId,
      foreignRecordIds: [],
      sourceId,
      legacyName: `Legacy_Target_${foreign.id}`,
      payload: {
        baseId: ctx.baseId,
        tableId: sourceId,
        name: 'Legacy source',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Related',
            options: {
              relationship: 'oneMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryId,
              isOneWay: false,
            },
          },
        ],
      },
    };
    try {
      for (let index = 0; index < 2; index += 1) {
        const record = await ctx.createRecord(foreign.id, { [foreignPrimaryId]: 'Synthetic' });
        fixture.foreignRecordIds.push(record.id);
      }
      await ctx.drainOutbox();
      await run(fixture);
    } finally {
      // Restore only this fixture's storage names before normal API deletion. This also
      // cleans up a RED create that admitted metadata but never created its relation.
      if (await relationExists(fixture.legacyName)) {
        await sql`
          ALTER TABLE ${sql.id(ctx.baseId, fixture.legacyName)}
          RENAME TO ${sql.id(fixture.foreignId)}
        `.execute(ctx.testContainer.db);
      }
      await sql`
        UPDATE "table_meta" SET "db_table_name" = ${`${ctx.baseId}.${fixture.foreignId}`}
        WHERE "id" = ${fixture.foreignId}
      `.execute(ctx.testContainer.db);
      await sql`
        UPDATE "field"
        SET "options" = jsonb_set(options::jsonb, '{fkHostTableName}',
          to_jsonb(${`${ctx.baseId}.${fixture.foreignId}`}::text))::text
        WHERE "table_id" IN (${sourceId}, ${fixture.foreignId}) AND "type" = 'link'
      `.execute(ctx.testContainer.db);
      await sql`
        UPDATE "table_meta" SET "provision_state" = 'ready' WHERE "id" = ${sourceId}
      `.execute(ctx.testContainer.db);
      const source = await sql<{ id: string }>`
        SELECT "id" FROM "table_meta" WHERE "id" = ${sourceId}
      `.execute(ctx.testContainer.db);
      try {
        if (source.rows.length) await ctx.deleteTable(sourceId, { mode: 'permanent' });
      } finally {
        await ctx.deleteTable(fixture.foreignId, { mode: 'permanent' });
        await sql`
          DELETE FROM "schema_operation"
          WHERE "table_id" IN (${sourceId}, ${fixture.foreignId})
        `.execute(ctx.testContainer.db);
      }
    }
  };

  const assertLegacyStorageAndRecords = async (fixture: Fixture) => {
    const sourceLink = await readLink(fixture.sourceId);
    const reciprocal = await readLink(fixture.foreignId);
    const actualHost = `${ctx.baseId}.${fixture.legacyName}`;
    expect(sourceLink).toMatchObject({
      relationship: 'oneMany',
      symmetric_id: reciprocal.id,
      fk_host: actualHost,
    });
    expect(reciprocal).toMatchObject({
      relationship: 'manyOne',
      symmetric_id: sourceLink.id,
      fk_host: actualHost,
    });
    expect(await relationExists(fixture.sourceId)).toBe(true);
    expect(await relationExists(fixture.foreignId)).toBe(false);
    expect(await ctx.listRecords(fixture.sourceId)).toEqual([]);
    const before = await ctx.listRecords(fixture.foreignId);
    expect(before.map((record) => record.id).sort()).toEqual([...fixture.foreignRecordIds].sort());
    expect(before.map((record) => record.fields[fixture.foreignPrimaryId])).toEqual([
      'Synthetic',
      'Synthetic',
    ]);

    const fkColumn = sourceLink.self_key === '__id' ? sourceLink.foreign_key : sourceLink.self_key;
    const orderColumn = `${fkColumn}_order`;
    const columns = await sql<{ column_name: string; data_type: string }>`
      SELECT "column_name", "data_type" FROM information_schema.columns
      WHERE "table_schema" = ${ctx.baseId} AND "table_name" = ${fixture.legacyName}
        AND "column_name" IN (${fkColumn}, ${orderColumn})
    `.execute(ctx.testContainer.db);
    expect(columns.rows).toEqual(
      expect.arrayContaining([
        { column_name: fkColumn, data_type: 'text' },
        { column_name: orderColumn, data_type: 'double precision' },
      ])
    );

    const source = await ctx.getTableById(fixture.sourceId);
    const primaryId = source.fields.find((field) => field.isPrimary)!.id;
    const [firstForeignId, secondForeignId] = fixture.foreignRecordIds;
    const parent = await ctx.createRecord(fixture.sourceId, {
      [primaryId]: 'Parent',
      [sourceLink.id]: [{ id: secondForeignId }, { id: firstForeignId }],
    });
    const sourceRows = await ctx.listRecords(fixture.sourceId);
    expect(sourceRows.find((record) => record.id === parent.id)?.fields[sourceLink.id]).toEqual([
      { id: secondForeignId, title: 'Synthetic' },
      { id: firstForeignId, title: 'Synthetic' },
    ]);
    const foreignRows = await ctx.listRecords(fixture.foreignId);
    for (const record of foreignRows) {
      expect(record.fields[reciprocal.id]).toEqual({ id: parent.id, title: 'Parent' });
    }
    const stored = await sql<{ id: string; parent_id: string; position: number }>`
      SELECT "__id" AS "id", ${sql.id(fkColumn)} AS "parent_id",
        ${sql.id(orderColumn)} AS "position"
      FROM ${sql.id(ctx.baseId, fixture.legacyName)}
      ORDER BY ${sql.id(orderColumn)}
    `.execute(ctx.testContainer.db);
    expect(stored.rows.map((row) => row.id)).toEqual([secondForeignId, firstForeignId]);
    expect(stored.rows.map((row) => row.parent_id)).toEqual([parent.id, parent.id]);
    expect(stored.rows.every((row) => typeof row.position === 'number')).toBe(true);

    const otherParent = await ctx.createRecord(fixture.sourceId, { [primaryId]: 'Other parent' });
    await ctx.updateRecord(fixture.foreignId, firstForeignId!, {
      [reciprocal.id]: { id: otherParent.id },
    });
    const movedSourceRows = await ctx.listRecords(fixture.sourceId);
    expect(
      movedSourceRows.find((record) => record.id === parent.id)?.fields[sourceLink.id]
    ).toEqual([{ id: secondForeignId, title: 'Synthetic' }]);
    expect(
      movedSourceRows.find((record) => record.id === otherParent.id)?.fields[sourceLink.id]
    ).toEqual([{ id: firstForeignId, title: 'Synthetic' }]);
    const movedForeignRows = await ctx.listRecords(fixture.foreignId);
    expect(
      movedForeignRows.find((record) => record.id === firstForeignId)?.fields[reciprocal.id]
    ).toEqual({ id: otherParent.id, title: 'Other parent' });
    expect(movedForeignRows.map((record) => record.fields[fixture.foreignPrimaryId])).toEqual([
      'Synthetic',
      'Synthetic',
    ]);
    expect(await relationExists(fixture.foreignId)).toBe(false);
  };

  it(
    'creates a schema-only two-way oneMany link on the existing legacy host via HTTP',
    { timeout: 180_000 },
    async () => {
      await withFixture(async (fixture) => {
        await renameForeign(fixture);
        const response = await fetch(`${ctx.baseUrl}/tables/create`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(fixture.payload),
        });
        const body: unknown = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(201);
        const parsed = createTableOkResponseSchema.parse(body);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error('Expected a successful create response');
        expect(parsed.data.table.id).toBe(fixture.sourceId);
        await assertLegacyStorageAndRecords(fixture);
      });
    }
  );

  it(
    'repairs admitted schema-only create metadata with a stale host and no reciprocal field',
    { timeout: 180_000 },
    async () => {
      await withFixture(async (fixture) => {
        // Capture a real create operation before reconstructing the failed commit boundary:
        // source metadata survives, but source DDL and reciprocal side effects do not.
        await ctx.createTable(fixture.payload);
        const staleLink = await readLink(fixture.sourceId);
        const reciprocal = await readLink(fixture.foreignId);
        expect(staleLink.fk_host).toBe(`${ctx.baseId}.${fixture.foreignId}`);
        await renameForeign(fixture);
        const fkColumn = staleLink.self_key === '__id' ? staleLink.foreign_key : staleLink.self_key;
        await sql`DROP TABLE ${sql.id(ctx.baseId, fixture.sourceId)} CASCADE`.execute(
          ctx.testContainer.db
        );
        await sql`
          ALTER TABLE ${sql.id(ctx.baseId, fixture.legacyName)}
          DROP COLUMN ${sql.id(fkColumn)} CASCADE,
          DROP COLUMN ${sql.id(`${fkColumn}_order`)},
          DROP COLUMN ${sql.id(reciprocal.db_field_name)}
        `.execute(ctx.testContainer.db);
        await sql`
          UPDATE "view" SET "column_meta" = ("column_meta"::jsonb - ${reciprocal.id})::text
          WHERE "table_id" = ${fixture.foreignId}
        `.execute(ctx.testContainer.db);
        await sql`
          DELETE FROM "reference"
          WHERE "from_field_id" = ${reciprocal.id} OR "to_field_id" = ${reciprocal.id}
        `.execute(ctx.testContainer.db);
        await sql`DELETE FROM "field" WHERE "id" = ${reciprocal.id}`.execute(ctx.testContainer.db);
        await sql`
          UPDATE "table_meta" SET "provision_state" = 'error' WHERE "id" = ${fixture.sourceId}
        `.execute(ctx.testContainer.db);
        expect(await relationExists(fixture.sourceId)).toBe(false);
        const absentReciprocal = await sql<{ id: string }>`
          SELECT "id" FROM "field" WHERE "id" = ${staleLink.symmetric_id}
        `.execute(ctx.testContainer.db);
        expect(absentReciprocal.rows).toEqual([]);
        // Rewriting the metadata to the desired value would bypass the repair under test.
        expect((await readLink(fixture.sourceId)).fk_host).toBe(
          `${ctx.baseId}.${fixture.foreignId}`
        );

        const context: IExecutionContext = {
          actorId: ActorId.create('system')._unsafeUnwrap(),
          requestId: `e2e-legacy-host-${fixture.sourceId}`,
        };
        const repository = ctx.testContainer.container.resolve<ISchemaOperationRepository>(
          v2CoreTokens.schemaOperationRepository
        );
        const operations = (
          await repository.list(context, {
            tableIds: [fixture.sourceId],
            types: ['table.create'],
          })
        )._unsafeUnwrap();
        expect(operations.items).toHaveLength(1);
        const operation = operations.items[0]!;
        expect(operation.payload).toMatchObject({ recordCount: 0 });
        const failed = (
          await repository.advance(context, operation.idempotencyKey, {
            status: 'error',
            phase: 'error',
            lastError: 'Interrupted schema-only create',
          })
        )._unsafeUnwrap();
        const runner = ctx.testContainer.container.resolve<SchemaOperationRunnerService>(
          v2CoreTokens.schemaOperationRunnerService
        );
        // Execute only this operation through the public runner seam; never claim another
        // shared-context test's work or advance its retry clock.
        const result = (await runner.runOperation(context, failed))._unsafeUnwrap();
        expect(result.status).toBe('completed');
        const settled = (
          await repository.list(context, {
            tableIds: [fixture.sourceId],
            types: ['table.create'],
          })
        )._unsafeUnwrap().items[0]!;
        expect(settled).toMatchObject({ status: 'ready', phase: 'ready', lastError: null });
        const availability = await sql<{ provision_state: string }>`
          SELECT "provision_state" FROM "table_meta" WHERE "id" = ${fixture.sourceId}
        `.execute(ctx.testContainer.db);
        expect(availability.rows[0]?.provision_state).toBe('ready');
        await assertLegacyStorageAndRecords(fixture);
      });
    }
  );
});
