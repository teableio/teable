/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { RecordWritePluginRunner, TableQueryService } from '@teable/v2-core';
import {
  ActorId,
  CreateTableCommand,
  RestoreRecordsStreamCommand,
  RestoreRecordsStreamHandler,
  NoopTableSchemaCoordination,
  domainError,
  v2CoreTokens,
  type CreateTableResult,
  type ICommandBus,
  type IDurableSubscriptionCatalog,
  type ITransactionalProjectionMessageJournal,
  type ITableRecordRepository,
  type IUnitOfWork,
  type RestoreRecordsStreamEvent,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';
import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

const catalog: IDurableSubscriptionCatalog = {
  snapshot: () =>
    ok({
      generation: 1,
      resolve: () =>
        ok({
          messageName: 'table.records.batch-created.v1',
          durableMode: 'active',
          sameTxTargets: [],
          directTargets: [],
          durableTargets: [
            {
              consumerId: 'test.restore.operation-audit',
              consumerGeneration: 1,
              retry: { maxAttempts: 3, policy: 'exponential-jitter' },
              ordering: 'none',
              idempotency: 'destination-inbox',
              replay: 'safe',
            },
          ],
        }),
    }),
};

describe('RestoreRecordsStreamHandler journal (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it.each([
    ['restore', false],
    ['restore', true],
    ['import', false],
    ['import', true],
  ] as const)(
    'commits bounded %s actor rows and journal together (journal failure %s)',
    async (mode, failJournal) => {
      const { container, baseId } = getV2NodeTestContainer();
      const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const executor = ActorId.create('system')._unsafeUnwrap();
      const created = (
        await commandBus.execute<CreateTableCommand, CreateTableResult>(
          { actorId: executor },
          CreateTableCommand.create({
            baseId: baseId.toString(),
            name: 'Restore journal proof',
            fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
            views: [{ type: 'grid' }],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const table = created.table;
      const fieldId = table.getFields()[0].id().toString();
      const tableName = table
        .dbTableName()
        .andThen((name) => name.value())
        ._unsafeUnwrap();
      const qualified = tableName
        .split('.')
        .map((part) => `"${part.replaceAll('"', '""')}"`)
        .join('.');
      const realJournal = container.resolve<ITransactionalProjectionMessageJournal>(
        v2CoreTokens.projectionMessageJournal
      );
      const journal: ITransactionalProjectionMessageJournal = {
        append: async (context, messages) => {
          const persisted = await realJournal.append(context, messages);
          if (persisted.isErr()) return persisted;
          return failJournal
            ? err(
                domainError.infrastructure({
                  code: 'test.restore_journal_failed',
                  message: 'Injected journal failure',
                })
              )
            : persisted;
        },
      };
      const handler = new RestoreRecordsStreamHandler(
        container.resolve<TableQueryService>(v2CoreTokens.tableQueryService),
        container.resolve<ITableRecordRepository>(v2CoreTokens.tableRecordRepository),
        container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork),
        container.resolve<RecordWritePluginRunner>(v2CoreTokens.recordWritePluginRunner),
        new NoopTableSchemaCoordination(),
        catalog,
        journal
      );
      const knownId = `rec${'a'.repeat(16)}`;
      const unknownId = `rec${'b'.repeat(16)}`;
      const command = RestoreRecordsStreamCommand.create(
        {
          tableId: table.id().toString(),
          batchSize: 1,
          records: (async function* () {
            yield {
              recordId: knownId,
              fields: { [fieldId]: 'Original creator' },
              lastModifiedBy: 'system',
              createdByActorType: 'appUser',
              createdByActorId: 'forgedArchiveCreator',
            };
            yield {
              recordId: unknownId,
              fields: { [fieldId]: 'Old unknown creator' },
              lastModifiedBy: 'system',
              createdByActorType: 'user',
              createdByActorId: 'forgedArchiveUser',
            };
          })(),
        },
        mode === 'restore'
          ? {
              trustedCreatedActorsByRecordId: new Map([
                [knownId, { type: 'user' as const, id: 'usrOriginal' }],
                [unknownId, null],
              ]),
            }
          : undefined
      )._unsafeUnwrap();
      const result = await handler.handle(
        { actorId: executor, initiator: { type: 'appUser', id: 'apuCurrent' } },
        command
      );
      const events: RestoreRecordsStreamEvent[] = [];
      for await (const event of result._unsafeUnwrap()) events.push(event);
      const rows = await sql<
        Record<string, unknown>
      >`SELECT "__id", "__created_by_actor_type", "__created_by_actor_id",
      "__last_modified_by_actor_type", "__last_modified_by_actor_id" FROM ${sql.raw(qualified)} ORDER BY "__id"`.execute(
        db
      );
      const messages = await sql<{
        payload: { recordCount: number };
        attribution: { operationId: string };
      }>`
      SELECT payload, attribution FROM domain_event_outbox WHERE table_id = ${table.id().toString()}
      AND message_name = 'table.records.batch-created.v1'`.execute(db);
      if (failJournal) {
        expect(rows.rows).toEqual([]);
        expect(messages.rows).toEqual([]);
        expect(events).toEqual([
          expect.objectContaining({
            id: 'error',
            code: 'test.restore_journal_failed',
            totalInserted: 0,
          }),
        ]);
      } else {
        expect(events).toEqual([
          { id: 'progress', phase: 'restoring', batchIndex: 0, insertedCount: 1, totalInserted: 1 },
          { id: 'progress', phase: 'restoring', batchIndex: 1, insertedCount: 1, totalInserted: 2 },
          { id: 'done', restoredCount: 2 },
        ]);
        expect(rows.rows).toEqual([
          {
            __id: knownId,
            __created_by_actor_type: mode === 'restore' ? 'user' : 'appUser',
            __created_by_actor_id: mode === 'restore' ? 'usrOriginal' : 'apuCurrent',
            __last_modified_by_actor_type: 'appUser',
            __last_modified_by_actor_id: 'apuCurrent',
          },
          {
            __id: unknownId,
            __created_by_actor_type: mode === 'restore' ? null : 'appUser',
            __created_by_actor_id: mode === 'restore' ? null : 'apuCurrent',
            __last_modified_by_actor_type: 'appUser',
            __last_modified_by_actor_id: 'apuCurrent',
          },
        ]);
        expect(messages.rows.map((message) => message.payload.recordCount)).toEqual([1, 1]);
        expect(new Set(messages.rows.map((message) => message.attribution.operationId)).size).toBe(
          1
        );
      }
    }
  );
});
