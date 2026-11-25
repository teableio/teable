import type { Server } from 'node:http';

import {
  buildFieldBackfillTaskInput,
  v2RecordRepositoryPostgresTokens,
  type ComputedFieldBackfillService,
  type ComputedFieldUpdater,
  type ComputedUpdateWorker,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import { createStandaloneExecutionContext } from '@teable/v2-container-node-test';
import {
  apiErrorResponseDtoSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  deleteFieldOkResponseSchema,
  deleteTableOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import {
  ActorId,
  BaseId,
  FieldId,
  TableId,
  getRandomString,
  v2CoreTokens,
  type IHasher,
  type ITableDeletionPreparationService,
  type ITableRepository,
  type ITableSchemaCoordination,
  type ITableSchemaCoordinationLease,
} from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { createE2eTestContainer } from './shared/createE2eTestContainer';
import { observeSchemaAcquisitions } from './shared/observeSchemaAcquisitions';

/**
 * T8549: sanitized manyOne/oneMany + filtered multi-value lookup, with a real
 * record-delete task overtaken by deletion of its link's FK/order storage.
 * Only scheduling is controlled; API writes, metadata, DDL and the worker are real.
 */
describe('computed work racing with link deletion (postgres e2e)', () => {
  it('returns a busy conflict for a bounded record-create wait and recovers after release', async () => {
    const runtime = await createE2eTestContainer({
      dbMode: 'postgres',
      schemaCoordination: { lockTimeoutMillis: 150 },
    });
    const executionContext = await createStandaloneExecutionContext(runtime);
    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => runtime.container,
        createExecutionContext: () => executionContext,
      })
    );
    const listening = Promise.withResolvers<Server>();
    const server = app.listen(0, '127.0.0.1', () => listening.resolve(server));
    server.once('error', listening.reject);
    await listening.promise;
    server.keepAliveTimeout = 0;
    let lease: ITableSchemaCoordinationLease | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP test address');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const tableResponse = await fetch(`${baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: runtime.baseId.toString(),
          name: 'Bounded record-create contention',
          fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
        }),
      });
      expect(tableResponse.status).toBe(201);
      const { table } = createTableOkResponseSchema.parse(await tableResponse.json()).data;
      const coordination = runtime.container.resolve<ITableSchemaCoordination>(
        v2CoreTokens.tableSchemaCoordination
      );
      lease = (
        await coordination.acquire(
          { actorId: ActorId.create('system')._unsafeUnwrap() },
          [table.id],
          'exclusive'
        )
      )._unsafeUnwrap();
      const createRecord = () =>
        fetch(`${baseUrl}/tables/createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tableId: table.id, fields: {} }),
        });

      const blocked = await createRecord();
      expect(blocked.status).toBe(409);
      expect(apiErrorResponseDtoSchema.parse(await blocked.json()).error).toMatchObject({
        code: 'schema_coordination.busy',
        tags: ['conflict'],
        details: { tableIds: [table.id], mode: 'shared' },
      });

      await lease.release();
      const recovered = await createRecord();
      expect(recovered.status).toBe(201);
      expect(
        createRecordOkResponseSchema.parse(await recovered.json()).data.record.id
      ).toBeTruthy();
    } finally {
      await lease?.release();
      const closed = Promise.withResolvers<void>();
      server.close((error) => (error ? closed.reject(error) : closed.resolve()));
      await closed.promise;
      await runtime.dispose();
    }
  }, 120_000);

  it('settles a record-delete task when its loaded lookup link is deleted concurrently', async () => {
    const runtime = await createE2eTestContainer({
      dbMode: 'postgres',
      computedUpdate: {
        mode: 'hybrid',
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
      },
    });
    const executionContext = await createStandaloneExecutionContext(runtime);
    const acquisitions = observeSchemaAcquisitions(runtime.container);
    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => runtime.container,
        createExecutionContext: () => executionContext,
      })
    );
    const listening = Promise.withResolvers<Server>();
    const server = app.listen(0, '127.0.0.1', () => listening.resolve(server));
    server.once('error', listening.reject);
    await listening.promise;
    server.keepAliveTimeout = 0;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP test address');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const baseId = runtime.baseId.toString();
    const request = async (operation: string, payload: unknown, method = 'POST', status = 200) => {
      const response = await fetch(`${baseUrl}/tables/${operation}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(status);
      return body;
    };
    const drain = async () => {
      for (let round = 0; round < 50; round++) {
        await runtime.processOutboxOnce();
        const remaining = await runtime.db
          .selectFrom('computed_update_outbox')
          .select('id')
          .where('base_id', '=', baseId)
          .execute();
        if (remaining.length === 0) return;
      }
      throw new Error('Computed work did not settle');
    };
    const fieldId = () => `fld${getRandomString(16)}`;
    const f = {
      targetName: fieldId(),
      sourceName: fieldId(),
      category: fieldId(),
      retiredLink: fieldId(),
      retiredInverse: fieldId(),
      activeLink: fieldId(),
      activeInverse: fieldId(),
      retiredLookup: fieldId(),
      activeLookup: fieldId(),
    };
    const releaseSnapshot = Promise.withResolvers<void>();
    let restoreRepository: (() => void) | undefined;
    let workerRun: Promise<unknown> | undefined;
    let deletion: Promise<unknown> | undefined;
    try {
      const target = createTableOkResponseSchema.parse(
        await request(
          'create',
          {
            baseId,
            name: 'Targets',
            fields: [{ id: f.targetName, name: 'Name', type: 'singleLineText', isPrimary: true }],
            views: [{ type: 'grid' }],
          },
          'POST',
          201
        )
      ).data.table;
      const source = createTableOkResponseSchema.parse(
        await request(
          'create',
          {
            baseId,
            name: 'Sources',
            fields: [
              { id: f.sourceName, name: 'Name', type: 'singleLineText', isPrimary: true },
              { id: f.category, name: 'Category', type: 'singleLineText' },
              ...[
                { id: f.retiredLink, inverse: f.retiredInverse, name: 'Retired target' },
                { id: f.activeLink, inverse: f.activeInverse, name: 'Active target' },
              ].map((link) => ({
                id: link.id,
                name: link.name,
                type: 'link',
                options: {
                  relationship: 'manyOne',
                  foreignTableId: target.id,
                  lookupFieldId: f.targetName,
                  symmetricFieldId: link.inverse,
                },
              })),
            ],
            views: [{ type: 'grid' }],
          },
          'POST',
          201
        )
      ).data.table;
      for (const [id, linkFieldId, name] of [
        [f.retiredLookup, f.retiredInverse, 'Retired values'],
        [f.activeLookup, f.activeInverse, 'Active values'],
      ]) {
        await request('createField', {
          baseId,
          tableId: target.id,
          field: {
            id,
            name,
            type: 'lookup',
            options: {
              linkFieldId,
              foreignTableId: source.id,
              lookupFieldId: f.sourceName,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: f.category, operator: 'is', value: 'included' }],
              },
            },
          },
        });
      }
      const targetRecord = createRecordOkResponseSchema.parse(
        await request(
          'createRecord',
          { tableId: target.id, fields: { [f.targetName]: 'Target' } },
          'POST',
          201
        )
      ).data.record;
      const records = [];
      for (const name of ['Keep', 'Remove']) {
        records.push(
          createRecordOkResponseSchema.parse(
            await request(
              'createRecord',
              {
                tableId: source.id,
                fields: {
                  [f.sourceName]: name,
                  [f.category]: 'included',
                  [f.retiredLink]: { id: targetRecord.id },
                  [f.activeLink]: { id: targetRecord.id },
                },
              },
              'POST',
              201
            )
          ).data.record
        );
      }
      await drain();
      const before = await runtime.db
        .selectFrom('computed_update_dead_letter')
        .select('last_error')
        .where('base_id', '=', baseId)
        .execute();
      expect(before).toEqual([]);
      const activeColumn = await runtime.db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', f.activeLookup)
        .executeTakeFirstOrThrow();
      const retiredColumn = await runtime.db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', f.retiredLookup)
        .executeTakeFirstOrThrow();
      const baseline = await sql<{ active: unknown; retired: unknown }>`
        SELECT ${sql.ref(activeColumn.db_field_name)} AS active,
          ${sql.ref(retiredColumn.db_field_name)} AS retired
        FROM ${sql.table(`${baseId}.${target.id}`)} WHERE __id = ${targetRecord.id}
      `.execute(runtime.db);
      expect(baseline.rows).toEqual([{ active: ['Keep', 'Remove'], retired: ['Keep', 'Remove'] }]);

      await request('deleteRecords', { tableId: source.id, recordIds: [records[1].id] }, 'DELETE');
      const task = await runtime.db
        .selectFrom('computed_update_outbox')
        .select('id')
        .where('base_id', '=', baseId)
        .where('seed_table_id', '=', source.id)
        .executeTakeFirstOrThrow();
      const repository = runtime.container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const find = repository.find.bind(repository);
      const snapshotLoaded = Promise.withResolvers<void>();
      const requestId = `schema-race-${getRandomString(8)}`;
      let stopped = false;
      const updater = runtime.container.resolve<ComputedFieldUpdater>(
        v2RecordRepositoryPostgresTokens.computedFieldUpdater
      );
      const prepare = updater.prepareDirtyState.bind(updater);
      let preparingDirtyState = false;
      const preparationSpy = vi
        .spyOn(updater, 'prepareDirtyState')
        .mockImplementation(async (...args) => {
          preparingDirtyState =
            args[1].requestId === requestId &&
            args[0].steps.some((step) =>
              step.fieldIds.some((id) => id.toString() === f.retiredLookup)
            );
          try {
            return await prepare(...args);
          } finally {
            preparingDirtyState = false;
          }
        });
      const spy = vi
        .spyOn(repository, 'find')
        .mockImplementation(async (context, spec, options) => {
          const result = await find(context, spec, options);
          if (
            !stopped &&
            preparingDirtyState &&
            context.requestId === requestId &&
            options?.state === 'activeWithPending' &&
            result.isOk() &&
            result.value.some(
              (table) =>
                table.id().toString() === target.id &&
                table.getFields().some((field) => field.id().toString() === f.retiredInverse)
            )
          ) {
            stopped = true;
            snapshotLoaded.resolve();
            await releaseSnapshot.promise;
          }
          return result;
        });
      restoreRepository = () => {
        spy.mockRestore();
        preparationSpy.mockRestore();
      };
      const worker = runtime.container.resolve<ComputedUpdateWorker>(
        v2RecordRepositoryPostgresTokens.computedUpdateWorker
      );
      workerRun = worker.runTaskById({
        taskId: task.id,
        workerId: 'schema-race-worker',
        requestId,
      });
      await Promise.race([
        snapshotLoaded.promise,
        workerRun.then(() => {
          throw new Error('Worker never loaded the original lookup structure');
        }),
      ]);
      let deletionSettled = false;
      deletion = request(
        'deleteField',
        { baseId, tableId: source.id, fieldId: f.retiredLink },
        'DELETE'
      ).then((body) => {
        deleteFieldOkResponseSchema.parse(body);
        deletionSettled = true;
      });
      // A coordinated implementation may block deletion. Otherwise let the real
      // deletion commit before returning the worker's already-loaded snapshot.
      await expect
        .poll(() => deletionSettled || acquisitions.count(source.id) > 0, { timeout: 10_000 })
        .toBe(true);
      releaseSnapshot.resolve();
      await Promise.all([workerRun, deletion]);
      restoreRepository();
      await drain();

      const dead = await runtime.db
        .selectFrom('computed_update_dead_letter')
        .select(['last_error', 'trace_data'])
        .where('base_id', '=', baseId)
        .execute();
      expect(dead, 'The original lookup must not fail with a missing FK/order column').toEqual([]);
      const metadata = await runtime.db
        .selectFrom('field')
        .select(['id', 'has_error', 'deleted_time'])
        .where('id', 'in', [f.retiredLink, f.retiredInverse, f.retiredLookup])
        .execute();
      expect(metadata.find((field) => field.id === f.retiredLink)?.deleted_time).toBeTruthy();
      expect(metadata.find((field) => field.id === f.retiredInverse)?.deleted_time).toBeTruthy();
      expect(metadata.find((field) => field.id === f.retiredLookup)?.has_error).toBe(true);
      const stored = await sql<{
        value: unknown;
      }>`SELECT ${sql.ref(activeColumn.db_field_name)} AS value
        FROM ${sql.table(`${baseId}.${target.id}`)} WHERE __id = ${targetRecord.id}`.execute(
        runtime.db
      );
      expect(stored.rows[0].value).toEqual(['Keep']);
    } finally {
      releaseSnapshot.resolve();
      restoreRepository?.();
      await Promise.allSettled([workerRun, deletion].filter((work) => work !== undefined));
      acquisitions.restore();
      const closed = Promise.withResolvers<void>();
      server.close((error) => (error ? closed.reject(error) : closed.resolve()));
      await closed.promise;
      await runtime.dispose();
    }
  }, 120_000);

  it.each(['seed', 'backfill'] as const)(
    'settles a queued %s when link deletion starts before execution',
    async (taskType) => {
      const runtime = await createE2eTestContainer({
        dbMode: 'postgres',
        computedUpdate: {
          mode: 'hybrid',
          hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        },
      });
      const executionContext = await createStandaloneExecutionContext(runtime);
      const acquisitions = observeSchemaAcquisitions(runtime.container);
      const app = express();
      app.use(
        createV2ExpressRouter({
          createContainer: () => runtime.container,
          createExecutionContext: () => executionContext,
        })
      );
      const listening = Promise.withResolvers<Server>();
      const server = app.listen(0, '127.0.0.1', () => listening.resolve(server));
      server.once('error', listening.reject);
      await listening.promise;
      server.keepAliveTimeout = 0;
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP test address');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const baseId = runtime.baseId.toString();
      const request = async (
        operation: string,
        payload: unknown,
        method = 'POST',
        status = 200
      ) => {
        const response = await fetch(`${baseUrl}/tables/${operation}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body: unknown = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(status);
        return body;
      };
      const drain = async () => {
        for (let round = 0; round < 50; round++) {
          await runtime.processOutboxOnce();
          const remaining = await runtime.db
            .selectFrom('computed_update_outbox')
            .select('id')
            .where('base_id', '=', baseId)
            .execute();
          if (remaining.length === 0) return;
        }
        throw new Error('Computed work did not settle');
      };
      const fieldId = () => `fld${getRandomString(16)}`;
      const f = {
        targetName: fieldId(),
        sourceName: fieldId(),
        category: fieldId(),
        link: fieldId(),
        inverse: fieldId(),
        lookup: fieldId(),
        survivingLink: fieldId(),
        survivingInverse: fieldId(),
        survivingLookup: fieldId(),
      };
      const releasePropagation = Promise.withResolvers<void>();
      let restorePropagation: (() => void) | undefined;
      let workerRun: Promise<unknown> | undefined;
      let deletion: Promise<unknown> | undefined;
      try {
        const target = createTableOkResponseSchema.parse(
          await request(
            'create',
            {
              baseId,
              name: 'Targets',
              fields: [{ id: f.targetName, name: 'Name', type: 'singleLineText', isPrimary: true }],
              views: [{ type: 'grid' }],
            },
            'POST',
            201
          )
        ).data.table;
        const source = createTableOkResponseSchema.parse(
          await request(
            'create',
            {
              baseId,
              name: 'Sources',
              fields: [
                { id: f.sourceName, name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: f.category, name: 'Category', type: 'singleLineText' },
                {
                  id: f.link,
                  name: 'Target',
                  type: 'link',
                  options: {
                    relationship: 'manyOne',
                    foreignTableId: target.id,
                    lookupFieldId: f.targetName,
                    symmetricFieldId: f.inverse,
                  },
                },
                {
                  id: f.survivingLink,
                  name: 'Surviving target',
                  type: 'link',
                  options: {
                    relationship: 'manyOne',
                    foreignTableId: target.id,
                    lookupFieldId: f.targetName,
                    symmetricFieldId: f.survivingInverse,
                  },
                },
              ],
              views: [{ type: 'grid' }],
            },
            'POST',
            201
          )
        ).data.table;
        for (const [lookupId, inverseId] of [
          [f.lookup, f.inverse],
          [f.survivingLookup, f.survivingInverse],
        ]) {
          await request('createField', {
            baseId,
            tableId: target.id,
            field: {
              id: lookupId,
              name: lookupId === f.lookup ? 'Retired values' : 'Surviving values',
              type: 'lookup',
              options: {
                linkFieldId: inverseId,
                foreignTableId: source.id,
                lookupFieldId: f.sourceName,
                filter: {
                  conjunction: 'and',
                  filterSet: [{ fieldId: f.category, operator: 'is', value: 'included' }],
                },
              },
            },
          });
        }
        const targetRecord = createRecordOkResponseSchema.parse(
          await request(
            'createRecord',
            { tableId: target.id, fields: { [f.targetName]: 'Target' } },
            'POST',
            201
          )
        ).data.record;
        const records = [];
        for (const name of ['Keep', 'Remove']) {
          records.push(
            createRecordOkResponseSchema.parse(
              await request(
                'createRecord',
                {
                  tableId: source.id,
                  fields: {
                    [f.sourceName]: name,
                    [f.category]: 'included',
                    [f.link]: { id: targetRecord.id },
                    [f.survivingLink]: { id: targetRecord.id },
                  },
                },
                'POST',
                201
              )
            ).data.record
          );
        }
        await drain();
        const column = await runtime.db
          .selectFrom('field')
          .select('db_field_name')
          .where('id', '=', f.survivingLookup)
          .executeTakeFirstOrThrow();
        const baseline = await sql<{ value: unknown }>`
       SELECT ${sql.ref(column.db_field_name)} AS value
       FROM ${sql.table(`${baseId}.${target.id}`)} WHERE __id = ${targetRecord.id}
     `.execute(runtime.db);
        expect(baseline.rows).toEqual([{ value: ['Keep', 'Remove'] }]);

        await request(
          'deleteRecords',
          { tableId: source.id, recordIds: [records[1].id] },
          'DELETE'
        );
        let taskId: string;
        const executionStarted = Promise.withResolvers<void>();
        if (taskType === 'seed') {
          const task = await runtime.db
            .selectFrom('computed_update_outbox')
            .select('id')
            .where('base_id', '=', baseId)
            .where('seed_table_id', '=', source.id)
            .executeTakeFirstOrThrow();
          taskId = task.id;
          const updater = runtime.container.resolve<ComputedFieldUpdater>(
            v2RecordRepositoryPostgresTokens.computedFieldUpdater
          );
          const execution = updater.execute.bind(updater);
          const spy = vi.spyOn(updater, 'execute').mockImplementation(async (...args) => {
            executionStarted.resolve();
            await releasePropagation.promise;
            return execution(...args);
          });
          restorePropagation = () => spy.mockRestore();
        } else {
          await drain();
          // Backfill must restore a missing stored value, not preserve an already-correct one.
          await sql`UPDATE ${sql.table(`${baseId}.${target.id}`)}
            SET ${sql.ref(column.db_field_name)} = NULL
            WHERE __id = ${targetRecord.id}`.execute(runtime.db);
          const outbox = runtime.container.resolve<IComputedUpdateOutbox>(
            v2RecordRepositoryPostgresTokens.computedUpdateOutbox
          );
          const enqueued = await outbox.enqueueFieldBackfill(
            buildFieldBackfillTaskInput({
              baseId: BaseId.create(baseId)._unsafeUnwrap(),
              tableId: TableId.create(target.id)._unsafeUnwrap(),
              fieldIds: [f.lookup, f.survivingLookup].map((id) =>
                FieldId.create(id)._unsafeUnwrap()
              ),
              hasher: runtime.container.resolve<IHasher>(v2CoreTokens.hasher),
              runId: `bfr${getRandomString(16)}`,
              estimatedRowCount: 1,
            })
          );
          taskId = enqueued._unsafeUnwrap().taskId;
          const backfill = runtime.container.resolve<ComputedFieldBackfillService>(
            v2RecordRepositoryPostgresTokens.computedFieldBackfillService
          );
          const execution = backfill.executeSyncMany.bind(backfill);
          const spy = vi.spyOn(backfill, 'executeSyncMany').mockImplementation(async (...args) => {
            executionStarted.resolve();
            await releasePropagation.promise;
            return execution(...args);
          });
          restorePropagation = () => spy.mockRestore();
        }
        const worker = runtime.container.resolve<ComputedUpdateWorker>(
          v2RecordRepositoryPostgresTokens.computedUpdateWorker
        );
        workerRun = worker.runTaskById({
          taskId,
          workerId: 'seed-schema-race-worker',
          requestId: `seed-schema-race-${getRandomString(8)}`,
        });
        await Promise.race([
          executionStarted.promise,
          workerRun.then(() => {
            throw new Error('Queued worker never reached execution');
          }),
        ]);
        let deletionSettled = false;
        deletion = request(
          'deleteField',
          { baseId, tableId: source.id, fieldId: f.link },
          'DELETE'
        ).then((body) => {
          deleteFieldOkResponseSchema.parse(body);
          deletionSettled = true;
        });
        await expect
          .poll(() => deletionSettled || acquisitions.count(source.id) > 0, { timeout: 10_000 })
          .toBe(true);
        releasePropagation.resolve();
        await Promise.all([workerRun, deletion]);
        restorePropagation();
        await drain();

        const dead = await runtime.db
          .selectFrom('computed_update_dead_letter')
          .select(['last_error', 'trace_data'])
          .where('base_id', '=', baseId)
          .execute();
        expect(dead, 'Seed propagation must not fail with a missing FK column').toEqual([]);
        const stored = await sql<{
          value: unknown;
        }>`SELECT ${sql.ref(column.db_field_name)} AS value
       FROM ${sql.table(`${baseId}.${target.id}`)} WHERE __id = ${targetRecord.id}`.execute(
          runtime.db
        );
        expect(stored.rows[0].value).toEqual(['Keep']);
        const metadata = await runtime.db
          .selectFrom('field')
          .select(['id', 'has_error', 'deleted_time'])
          .where('id', 'in', [f.link, f.inverse, f.lookup, f.survivingLookup])
          .execute();
        expect(metadata.find((field) => field.id === f.link)?.deleted_time).toBeTruthy();
        expect(metadata.find((field) => field.id === f.inverse)?.deleted_time).toBeTruthy();
        expect(metadata.find((field) => field.id === f.lookup)?.has_error).toBe(true);
        expect(metadata.find((field) => field.id === f.survivingLookup)?.has_error).not.toBe(true);
      } finally {
        releasePropagation.resolve();
        restorePropagation?.();
        await Promise.allSettled([workerRun, deletion].filter((work) => work !== undefined));
        acquisitions.restore();
        const closed = Promise.withResolvers<void>();
        server.close((error) => (error ? closed.reject(error) : closed.resolve()));
        await closed.promise;
        await runtime.dispose();
      }
    },
    120_000
  );

  it.each(['complete', 'timeout', 'discovery-timeout'] as const)(
    'settles a record-delete seed with a %s source-table deletion wait',
    async (waitMode) => {
      const runtime = await createE2eTestContainer({
        dbMode: 'postgres',
        // Let the five-second deletion deadline expire before a queued shared writer's bound.
        schemaCoordination: { lockTimeoutMillis: 10_000 },
        computedUpdate: {
          mode: 'hybrid',
          hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        },
      });
      const executionContext = await createStandaloneExecutionContext(runtime);
      const acquisitions = observeSchemaAcquisitions(runtime.container);
      const app = express();
      app.use(
        createV2ExpressRouter({
          createContainer: () => runtime.container,
          createExecutionContext: () => executionContext,
        })
      );
      const listening = Promise.withResolvers<Server>();
      const server = app.listen(0, '127.0.0.1', () => listening.resolve(server));
      server.once('error', listening.reject);
      await listening.promise;
      server.keepAliveTimeout = 0;
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP test address');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const baseId = runtime.baseId.toString();
      const request = async (
        operation: string,
        payload: unknown,
        method = 'POST',
        status = 200
      ) => {
        const response = await fetch(`${baseUrl}/tables/${operation}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body: unknown = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(status);
        return body;
      };
      const drain = async () => {
        for (let round = 0; round < 50; round++) {
          await runtime.processOutboxOnce();
          const remaining = await runtime.db
            .selectFrom('computed_update_outbox')
            .select('id')
            .where('base_id', '=', baseId)
            .execute();
          if (remaining.length === 0) return;
        }
        throw new Error('Computed work did not settle');
      };
      const fieldId = () => `fld${getRandomString(16)}`;
      const f = {
        targetName: fieldId(),
        sourceName: fieldId(),
        category: fieldId(),
        link: fieldId(),
        inverse: fieldId(),
        lookup: fieldId(),
      };
      const releasePropagation = Promise.withResolvers<void>();
      let restorePropagation: (() => void) | undefined;
      let workerRun: Promise<unknown> | undefined;
      let deletion: Promise<unknown> | undefined;
      const releasePreparation = Promise.withResolvers<void>();
      let restorePreparation: (() => void) | undefined;
      let deferredPreparation: ReturnType<ITableDeletionPreparationService['prepare']> | undefined;
      try {
        const target = createTableOkResponseSchema.parse(
          await request(
            'create',
            {
              baseId,
              name: 'Targets',
              fields: [{ id: f.targetName, name: 'Name', type: 'singleLineText', isPrimary: true }],
              views: [{ type: 'grid' }],
            },
            'POST',
            201
          )
        ).data.table;
        const source = createTableOkResponseSchema.parse(
          await request(
            'create',
            {
              baseId,
              name: 'Sources',
              fields: [
                { id: f.sourceName, name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: f.category, name: 'Category', type: 'singleLineText' },
                {
                  id: f.link,
                  name: 'Target',
                  type: 'link',
                  options: {
                    relationship: 'manyOne',
                    foreignTableId: target.id,
                    lookupFieldId: f.targetName,
                    symmetricFieldId: f.inverse,
                  },
                },
              ],
              views: [{ type: 'grid' }],
            },
            'POST',
            201
          )
        ).data.table;
        const physicalSource = sql<{ table_exists: boolean }>`
          SELECT to_regclass(quote_ident(${baseId}) || '.' || quote_ident(${source.id}))
            IS NOT NULL AS table_exists
        `;
        expect((await physicalSource.execute(runtime.db)).rows[0].table_exists).toBe(true);
        await request('createField', {
          baseId,
          tableId: target.id,
          field: {
            id: f.lookup,
            name: 'Values',
            type: 'lookup',
            options: {
              linkFieldId: f.inverse,
              foreignTableId: source.id,
              lookupFieldId: f.sourceName,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: f.category, operator: 'is', value: 'included' }],
              },
            },
          },
        });
        const targetRecord = createRecordOkResponseSchema.parse(
          await request(
            'createRecord',
            { tableId: target.id, fields: { [f.targetName]: 'Target' } },
            'POST',
            201
          )
        ).data.record;
        const records = [];
        for (const name of ['Keep', 'Remove']) {
          records.push(
            createRecordOkResponseSchema.parse(
              await request(
                'createRecord',
                {
                  tableId: source.id,
                  fields: {
                    [f.sourceName]: name,
                    [f.category]: 'included',
                    [f.link]: { id: targetRecord.id },
                  },
                },
                'POST',
                201
              )
            ).data.record
          );
        }
        await drain();
        await request(
          'deleteRecords',
          { tableId: source.id, recordIds: [records[1].id] },
          'DELETE'
        );
        const task = await runtime.db
          .selectFrom('computed_update_outbox')
          .select('id')
          .where('base_id', '=', baseId)
          .where('seed_table_id', '=', source.id)
          .executeTakeFirstOrThrow();
        const updater = runtime.container.resolve<ComputedFieldUpdater>(
          v2RecordRepositoryPostgresTokens.computedFieldUpdater
        );
        const executionStarted = Promise.withResolvers<void>();
        const execution = updater.execute.bind(updater);
        const spy = vi.spyOn(updater, 'execute').mockImplementation(async (...args) => {
          if (args[0].seedTableId.toString() === source.id) executionStarted.resolve();
          await releasePropagation.promise;
          return execution(...args);
        });
        restorePropagation = () => spy.mockRestore();
        const worker = runtime.container.resolve<ComputedUpdateWorker>(
          v2RecordRepositoryPostgresTokens.computedUpdateWorker
        );
        if (waitMode === 'discovery-timeout') releasePropagation.resolve();
        workerRun = worker.runTaskById({
          taskId: task.id,
          workerId: 'table-delete-schema-race-worker',
          requestId: `table-delete-schema-race-${getRandomString(8)}`,
        });
        await Promise.race([
          executionStarted.promise,
          workerRun.then(() => {
            throw new Error('Seed worker never reached planned execution');
          }),
        ]);
        const discoveryStarted = Promise.withResolvers<void>();
        if (waitMode === 'discovery-timeout') {
          await workerRun;
          await drain();
          const preparationService = runtime.container.resolve<ITableDeletionPreparationService>(
            v2CoreTokens.tableDeletionPreparationService
          );
          const prepare = preparationService.prepare.bind(preparationService);
          const preparationSpy = vi
            .spyOn(preparationService, 'prepare')
            .mockImplementationOnce((...args) => {
              deferredPreparation = (async () => {
                discoveryStarted.resolve();
                await releasePreparation.promise;
                return prepare(...args);
              })();
              return deferredPreparation;
            });
          restorePreparation = () => preparationSpy.mockRestore();
        }
        let deletionSettled = false;
        deletion = request(
          'delete',
          { baseId, tableId: source.id, mode: 'permanent' },
          'DELETE',
          waitMode !== 'complete' ? 409 : 200
        ).then((body) => {
          if (waitMode !== 'complete') {
            expect(apiErrorResponseDtoSchema.parse(body).error.code).toBe(
              'schema_coordination.busy'
            );
          } else {
            deleteTableOkResponseSchema.parse(body);
          }
          deletionSettled = true;
        });
        if (waitMode === 'discovery-timeout') await discoveryStarted.promise;
        else {
          await expect
            .poll(() => deletionSettled || acquisitions.count(source.id) > 0, { timeout: 10_000 })
            .toBe(true);
        }
        if (waitMode !== 'complete') {
          // This write must finish before the paused worker or preparation resumes,
          // proving the expired exclusive request no longer blocks shared coverage.
          const linkedWrite = request(
            'createRecord',
            {
              tableId: source.id,
              fields: {
                [f.sourceName]: 'Created after bounded deletion wait',
                [f.category]: 'excluded',
                [f.link]: { id: targetRecord.id },
              },
            },
            'POST',
            201
          );
          await deletion;
          const created = createRecordOkResponseSchema.parse(await linkedWrite).data.record;
          expect(created.fields[f.sourceName]).toBe('Created after bounded deletion wait');
          const state = await runtime.db
            .selectFrom('table_meta')
            .select(['deleted_time', 'provision_state'])
            .where('id', '=', source.id)
            .executeTakeFirstOrThrow();
          expect(state.deleted_time).toBeNull();
          expect(state.provision_state).toBe('ready');
        }
        releasePreparation.resolve();
        if (deferredPreparation) await deferredPreparation;
        restorePreparation?.();
        releasePropagation.resolve();
        await Promise.all([workerRun, deletion]);
        restorePropagation();
        await drain();
        if (waitMode !== 'complete') {
          // The same request remains valid once the worker has committed.
          deleteTableOkResponseSchema.parse(
            await request(
              'delete',
              {
                baseId,
                tableId: source.id,
                mode: 'permanent',
              },
              'DELETE'
            )
          );
          await drain();
        }

        const dead = await runtime.db
          .selectFrom('computed_update_dead_letter')
          .select(['last_error', 'trace_data'])
          .where('base_id', '=', baseId)
          .execute();
        expect(dead, 'Deleting the source table must not dead-letter the planned seed').toEqual([]);
        expect((await physicalSource.execute(runtime.db)).rows[0].table_exists).toBe(false);
        const metadata = await runtime.db
          .selectFrom('field')
          .select(['id', 'has_error'])
          .where('id', '=', f.lookup)
          .executeTakeFirstOrThrow();
        expect(metadata.has_error).toBe(true);
      } finally {
        releasePreparation.resolve();
        restorePreparation?.();
        releasePropagation.resolve();
        restorePropagation?.();
        await Promise.allSettled(
          [workerRun, deletion, deferredPreparation].filter((work) => work !== undefined)
        );
        acquisitions.restore();
        const closed = Promise.withResolvers<void>();
        server.close((error) => (error ? closed.reject(error) : closed.resolve()));
        await closed.promise;
        await runtime.dispose();
      }
    },
    120_000
  );
});
