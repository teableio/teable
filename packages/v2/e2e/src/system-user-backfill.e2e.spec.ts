/* eslint-disable @typescript-eslint/naming-convention */
/** T8450 / Y4930: synthetic historical audit actors live in metadata only. */
import type { Server } from 'node:http';

import {
  createV2PostgresPgliteDb,
  registerV2PostgresPgliteDb,
  v2DataDbTokens,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pglite';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedFieldBackfillService,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { ActorId, TableByIdSpec, TableId } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import express from 'express';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureV1MetaSchema } from '../../adapter-repository-postgres/src/db/schema';

const alice = {
  id: 'usr0000000000000001',
  title: 'Historical Alpha',
  email: 'alpha@example.invalid',
};
const bob = { id: 'usr0000000000000002', title: 'Historical Beta', email: 'beta@example.invalid' };
const missing = { id: 'usr0000000000000003', title: 'usr0000000000000003' };
// Cross the split-backfill profile lookup page boundary without a large fixture.
const recordIds = Array.from(
  { length: 502 },
  (_, index) => `rec${String(index + 1).padStart(16, '0')}`
);
const nameFieldId = 'fld0000000000000001';
const systemFieldId = 'fld0000000000000002';

describe.each(['split', 'shared'] as const)('[T8450] system-user backfill (%s DB)', (placement) => {
  let test: IV2NodeTestContainer | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    try {
      if (server) {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
        await promise;
      }
    } finally {
      await test?.dispose();
      test = undefined;
      server = undefined;
    }
  });

  it.each(['createdBy', 'lastModifiedBy'] as const)(
    'creates and persists %s snapshots through HTTP, then supports singleton and cursor backfill',
    async (fieldType) => {
      test = await createV2NodeTestContainer({
        connectionString: 'memory://',
        computedUpdate: { mode: 'sync', fieldBackfillConfig: { mode: 'sync' } },
        registerDb: async (container, config) => {
          await registerV2PostgresPgliteDb(container, config);
          if (placement === 'split') {
            const dataDb = await createV2PostgresPgliteDb<V1TeableDatabase>(config);
            // Install the canonical data-plane outbox tables, but do not leave
            // its convenience users table in the customer database.
            await ensureV1MetaSchema(dataDb);
            await sql`DROP TABLE IF EXISTS public.users`.execute(dataDb);
            const dataConfig = {
              ...config,
              pg: { ...config.pg, connectionString: 'memory://data' },
            };
            container.registerInstance(v2DataDbTokens.db, dataDb);
            container.registerInstance(v2DataDbTokens.config, dataConfig);
            container.registerInstance(v2PostgresDbTokens.db, dataDb);
            container.registerInstance(v2PostgresDbTokens.config, dataConfig);
          }
        },
      });
      const fixture = test;
      const { metaDb, dataDb, baseId, container } = fixture;
      if (placement === 'split') expect(metaDb).not.toBe(dataDb);
      else expect(metaDb).toBe(dataDb);
      const assertUsersPlacement = async () => {
        const relation = await sql<{ relation: string | null }>`
          SELECT to_regclass('public.users')::text AS relation
        `.execute(dataDb);
        expect(relation.rows[0].relation).toBe(placement === 'split' ? null : 'users');
      };
      await assertUsersPlacement();
      await metaDb
        .insertInto('users')
        .values([alice, bob].map(({ id, title, email }) => ({ id, name: title, email })))
        .execute();

      let actor = alice;
      const app = express();
      app.use(
        createV2ExpressRouter({
          createContainer: () => container,
          createExecutionContext: () => ({ actorId: ActorId.create(actor.id)._unsafeUnwrap() }),
        })
      );
      const listening = Promise.withResolvers<Server>();
      server = app.listen(0, '127.0.0.1', () => listening.resolve(server!));
      server.once('error', listening.reject);
      await listening.promise;
      server.keepAliveTimeout = 0;
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP listen address');
      const request = async (operation: string, payload: unknown) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/tables/${operation}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body: unknown = await response.json();
        expect(response.status, `${operation}: ${JSON.stringify(body)}`).toBe(
          operation === 'updateRecord' || operation === 'createField' ? 200 : 201
        );
        return body;
      };
      const table = createTableOkResponseSchema.parse(
        await request('create', {
          baseId: baseId.toString(),
          name: 'Historical audit actors',
          fields: [{ id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        })
      ).data.table;
      const storage = await metaDb
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', table.id)
        .executeTakeFirstOrThrow();
      const physicalTable = storage.db_table_name;
      // Existing records predate the user fields. Row 3 was never modified by a
      // different actor; row 4's historical actor no longer exists in metadata.
      await sql`INSERT INTO ${sql.table(physicalTable)}
        (__id, __version, __created_by, __last_modified_by) VALUES
        (${recordIds[0]}, 1, ${alice.id}, ${bob.id}),
        (${recordIds[1]}, 1, ${bob.id}, ${alice.id}),
        (${recordIds[2]}, 1, ${alice.id}, ${alice.id}),
        (${recordIds[3]}, 1, ${missing.id}, ${missing.id})`.execute(dataDb);
      await sql`INSERT INTO ${sql.table(physicalTable)}
        (__id, __version, __created_by, __last_modified_by)
        SELECT 'rec' || lpad(n::text, 16, '0'), 1,
          CASE WHEN n % 2 = 1 THEN ${alice.id} ELSE ${bob.id} END,
          CASE WHEN n % 2 = 1 THEN ${bob.id} ELSE ${alice.id} END
        FROM generate_series(5, 502) AS n`.execute(dataDb);

      createFieldOkResponseSchema.parse(
        await request('createField', {
          baseId: baseId.toString(),
          tableId: table.id,
          field: { id: systemFieldId, type: fieldType, name: 'Historical actor' },
        })
      );
      const column = await metaDb
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', systemFieldId)
        .executeTakeFirstOrThrow();
      if (!column.db_field_name) throw new Error('Missing system-user storage column');
      const storedRows = async () =>
        (
          await sql<{ id: string; snapshot: unknown }>`SELECT __id AS id,
            ${sql.ref(column.db_field_name!)} AS snapshot
            FROM ${sql.table(physicalTable)} ORDER BY __id`.execute(dataDb)
        ).rows;
      const historical =
        fieldType === 'createdBy' ? [alice, bob, alice, missing] : [bob, alice, alice, missing];
      const expectedRows = recordIds.map((id, index) => ({
        id,
        snapshot:
          index < 4
            ? historical[index]
            : fieldType === 'createdBy'
              ? index % 2 === 0
                ? alice
                : bob
              : index % 2 === 0
                ? bob
                : alice,
      }));
      // Read persisted JSON, not a read-time resolver that could hide a failed backfill.
      expect(await storedRows()).toEqual(expectedRows);
      await assertUsersPlacement();

      const context = { actorId: ActorId.create(alice.id)._unsafeUnwrap() };
      const aggregate = (
        await fixture.tableRepository.findOne(
          context,
          TableByIdSpec.create(TableId.create(table.id)._unsafeUnwrap())
        )
      )._unsafeUnwrap();
      const field = aggregate
        .getField((candidate) => candidate.id().toString() === systemFieldId)
        ._unsafeUnwrap();
      const backfill = container.resolve<ComputedFieldBackfillService>(
        v2RecordRepositoryPostgresTokens.computedFieldBackfillService
      );
      await sql`UPDATE ${sql.table(physicalTable)} SET ${sql.ref(column.db_field_name!)} = NULL`.execute(
        dataDb
      );
      (await backfill.executeSync(context, { table: aggregate, field }))._unsafeUnwrap();
      expect(await storedRows()).toEqual(expectedRows);
      await sql`UPDATE ${sql.table(physicalTable)} SET ${sql.ref(column.db_field_name!)} = NULL`.execute(
        dataDb
      );
      const first = (
        await backfill.executeSyncMany(context, {
          table: aggregate,
          fields: [field],
          recordBatch: { size: 2 },
        })
      )._unsafeUnwrap();
      expect(first.batch).toEqual({ recordCount: 2, lastRecordId: recordIds[1], hasMore: true });
      expect(await storedRows()).toEqual([
        ...expectedRows.slice(0, 2),
        ...recordIds.slice(2).map((id) => ({ id, snapshot: null })),
      ]);
      const second = (
        await backfill.executeSyncMany(context, {
          table: aggregate,
          fields: [field],
          recordBatch: { size: 500, cursor: first.batch!.lastRecordId },
        })
      )._unsafeUnwrap();
      expect(second.batch).toEqual({
        recordCount: 500,
        lastRecordId: recordIds[501],
        hasMore: false,
      });
      expect(await storedRows()).toEqual(expectedRows);

      // Subsequent real HTTP writes must use the writer without replacing the
      // historical creator or relying on a customer-side users relation.
      actor = fieldType === 'createdBy' ? bob : alice;
      updateRecordOkResponseSchema.parse(
        await request('updateRecord', {
          tableId: table.id,
          recordId: recordIds[0],
          fields: { [nameFieldId]: 'Changed after backfill' },
        })
      );
      expect((await storedRows())[0]).toEqual({ id: recordIds[0], snapshot: alice });
      actor = bob;
      const inserted = createRecordOkResponseSchema.parse(
        await request('createRecord', {
          tableId: table.id,
          fields: { [nameFieldId]: 'New record' },
        })
      ).data.record;
      expect((await storedRows()).find((row) => row.id === inserted.id)?.snapshot).toEqual(bob);
      await assertUsersPlacement();
    }
  );
});
