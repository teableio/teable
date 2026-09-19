import { readFileSync } from 'node:fs';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { DomainEventOutboxWorker } from '@teable/v2-adapter-table-repository-postgres';
import {
  BaseId,
  ProjectionMessageCodecRegistry,
  RecordCreated,
  RecordId,
  TableId,
  recordCreatedProjectionCodec,
  recordProjectionCodecs,
} from '@teable/v2-core';
import type { IDurableProjectionHandler, ProjectionMessageJson } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PinoLogger } from 'nestjs-pino';
import { ok } from 'neverthrow';
import type { Pool, PoolConfig } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KyselyPGlite } from '../../../../../../packages/v2/adapter-db-postgres-pglite/src/kyselyPgliteBrowser';
import type { IComputedOutboxMaintenanceTarget } from '../../../global/data-db-client-manager.service';
import {
  DataDbRuntimeCacheService,
  V2_CONTAINER_CACHE_NAMESPACE,
} from '../../../global/data-db-runtime-cache.service';
import { PinoLoggerAdapter } from '../v2-logger.adapter';
import { DomainEventOutboxRelayService } from './domain-event-outbox-relay.service';

const schema = 'domain_event_lifecycle';
const consumerId = 'test.held-delivery.v1';
const messageName = 'table.record.created.v1';
const targets: IComputedOutboxMaintenanceTarget[] = [
  {
    cacheKey: 'active-a',
    url: 'postgresql://localhost/active_a',
    internalSchema: schema,
    isMetaFallback: true,
    storage: 'default',
  },
  {
    cacheKey: 'idle-b',
    url: 'postgresql://localhost/idle_b',
    internalSchema: schema,
    isMetaFallback: false,
    storage: 'byodb',
  },
];

const createDatabase = async () => {
  const { client } = await KyselyPGlite.create('memory://');
  await client.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
  for (const migration of [
    '20260831120000_add_domain_event_outbox',
    '20260901120000_add_domain_event_outbox_settled_at',
    '20260908120000_domain_event_delivery_lease_timestamptz',
  ]) {
    await client.exec(
      readFileSync(
        new URL(
          `../../../../../../packages/db-data-prisma/prisma/migrations/${migration}/migration.sql`,
          import.meta.url
        ),
        'utf8'
      )
    );
  }
  // Raw worker SQL must honor the target schema, not the connection's search path.
  await client.exec('SET search_path TO public');
  return client;
};

const insertFamily = async (
  client: KyselyPGlite['client'],
  id: string,
  status: 'pending' | 'succeeded',
  expired = false
) => {
  const baseId = BaseId.generate()._unsafeUnwrap();
  const event = RecordCreated.create({
    baseId,
    tableId: TableId.generate()._unsafeUnwrap(),
    recordId: RecordId.generate()._unsafeUnwrap(),
    fieldValues: [],
  });
  const payload = JSON.stringify(recordCreatedProjectionCodec.encode(event)._unsafeUnwrap());
  await client.query(
    `INSERT INTO ${schema}.domain_event_outbox
      (id, base_id, message_name, schema_version, payload, payload_bytes,
       catalog_generation, required_consumers, unpublished, settled, settled_at)
     VALUES ($1, $6, $2, 1, $5::jsonb, $7, 1, '[]'::jsonb, false,
       $3, CASE WHEN $4 THEN now() - interval '16 days' ELSE NULL END)`,
    [
      id,
      messageName,
      expired ? 'succeeded' : null,
      expired,
      payload,
      baseId.toString(),
      Buffer.byteLength(payload),
    ]
  );
  await client.query(
    `INSERT INTO ${schema}.domain_event_delivery (id, event_id, consumer_id, status)
     VALUES ($1, $2, $3, $4)`,
    [`delivery-${id}`, id, consumerId, status]
  );
  if (expired) {
    await client.query(
      `INSERT INTO ${schema}.domain_event_inbox (event_id, consumer_id) VALUES ($1, $2)`,
      [id, consumerId]
    );
  }
};

describe('DomainEventOutboxRelayService resource ownership', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['success', 'SQL failure'] as const)(
    'keeps an active delivery alive in a capacity-one runtime cache and releases idle maintenance resources on %s',
    async (outcome) => {
      vi.stubEnv('BYODB_RUNTIME_CACHE_MAX', '1');
      const runtimeCache = new DataDbRuntimeCacheService();
      const a = await createDatabase();
      const b = await createDatabase();
      const physicalPools: Array<{
        database: string;
        ended: boolean;
        checkouts: number;
      }> = [];
      // Only the wire transport is substituted. The real pg Kysely adapter, pool
      // registry, runtime cache, relay and workers execute against PGlite SQL.
      const poolRegistry = new PgPoolRegistry((config: PoolConfig) => {
        const database = new URL(config.connectionString!).pathname.slice(1);
        const client = database === 'active_a' ? a : b;
        const state = { database, ended: false, checkouts: 0 };
        physicalPools.push(state);
        return {
          connect: async () => {
            if (state.ended) throw new Error('Pool already closed');
            state.checkouts += 1;
            return {
              query: async (text: string, parameters: unknown[] = []) => {
                if (state.ended) throw new Error('Pool already closed');
                const result = await client.query(text, parameters);
                return {
                  rows: result.rows,
                  rowCount: result.affectedRows,
                  // The pg driver only exposes affected rows for a write command tag.
                  command: result.affectedRows === undefined ? 'SELECT' : 'UPDATE',
                };
              },
              release: () => {
                state.checkouts -= 1;
              },
            };
          },
          end: async () => {
            if (state.checkouts !== 0) throw new Error('Closing a checked-out pool');
            state.ended = true;
          },
        } as unknown as Pool;
      });
      const pinoLogger = new PinoLogger({});
      const logger = new PinoLoggerAdapter(pinoLogger);
      let releaseHandler!: () => void;
      let handlerStarted!: () => void;
      const held = new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      const started = new Promise<void>((resolve) => {
        handlerStarted = resolve;
      });
      let delivery: Promise<void> | undefined;
      let service: DomainEventOutboxRelayService | undefined;
      try {
        await insertFamily(a, 'active', 'pending');
        await insertFamily(b, 'expired', 'succeeded', true);
        await insertFamily(b, 'orphan', 'succeeded');
        if (outcome === 'SQL failure') {
          await b.exec(`DROP TABLE ${schema}.domain_event_inbox`);
        }
        const getContainerForMaintenanceTarget = async (target: IComputedOutboxMaintenanceTarget) =>
          runtimeCache.getOrCreate(
            V2_CONTAINER_CACHE_NAMESPACE,
            target.cacheKey,
            async () => {
              const lease = poolRegistry.acquire(target.url);
              const db = await createV2PostgresDb<V1TeableDatabase>(
                { pg: { connectionString: target.url, schema: target.internalSchema } },
                { pool: lease.pool }
              );
              const handler: IDurableProjectionHandler<ProjectionMessageJson> = {
                consumerId,
                handle: async (context) => {
                  handlerStarted();
                  await held;
                  await db
                    .insertInto('domain_event_inbox')
                    .values({ event_id: context.eventId, consumer_id: consumerId })
                    .execute();
                  return ok({
                    kind: 'applied',
                    effectReceipt: { kind: 'destination-inbox', identity: consumerId },
                  });
                },
              };
              const worker = new DomainEventOutboxWorker(
                db,
                new Map([[consumerId, handler]]),
                ProjectionMessageCodecRegistry.create(recordProjectionCodecs)._unsafeUnwrap(),
                logger,
                target.internalSchema,
                [{ consumerId, messageName, schemaVersion: 1 }]
              );
              return { db, lease, resolve: () => worker };
            },
            async (runtime) => {
              await runtime.db.destroy();
              await runtime.lease.release();
            }
          );
        service = new DomainEventOutboxRelayService(
          { getContainerForMaintenanceTarget } as never,
          {
            listComputedOutboxMaintenanceTargets: async () => targets,
            peekDueDomainEventWork: async (target: IComputedOutboxMaintenanceTarget) =>
              target.cacheKey === 'active-a',
          } as never,
          { setnx: async (key: string) => key.endsWith(':idle-b') } as never,
          poolRegistry,
          pinoLogger
        );
        delivery = service['pollAllContainers']();
        await started;
        await service['maintainAllContainers']();
        releaseHandler();
        await delivery;

        expect(
          (
            await a.query(
              `SELECT status FROM ${schema}.domain_event_delivery WHERE event_id = 'active'`
            )
          ).rows
        ).toEqual([{ status: 'succeeded' }]);
        expect(
          (await a.query(`SELECT settled FROM ${schema}.domain_event_outbox WHERE id = 'active'`))
            .rows
        ).toEqual([{ settled: 'succeeded' }]);
        expect(
          (await b.query(`SELECT id, settled FROM ${schema}.domain_event_outbox ORDER BY id`)).rows
        ).toEqual(
          outcome === 'success'
            ? [{ id: 'orphan', settled: 'succeeded' }]
            : [
                { id: 'expired', settled: 'succeeded' },
                { id: 'orphan', settled: null },
              ]
        );
        if (outcome === 'success') {
          expect(
            (
              await b.query(
                `SELECT event_id FROM ${schema}.domain_event_delivery ORDER BY event_id`
              )
            ).rows
          ).toEqual([{ event_id: 'orphan' }]);
          expect((await b.query(`SELECT * FROM ${schema}.domain_event_inbox`)).rows).toEqual([]);
        }
        expect(runtimeCache.size).toBe(1);
        expect(physicalPools).toEqual([
          { database: 'active_a', ended: false, checkouts: 0 },
          { database: 'idle_b', ended: true, checkouts: 0 },
        ]);
        expect(poolRegistry.snapshot()).toEqual([
          expect.objectContaining({ database: 'active_a', references: 1 }),
        ]);
        const active = await getContainerForMaintenanceTarget(targets[0]);
        await expect(
          active.db.selectFrom('domain_event_inbox').select('event_id').execute()
        ).resolves.toEqual([{ event_id: 'active' }]);
      } finally {
        releaseHandler();
        await delivery;
        service?.onModuleDestroy();
        await runtimeCache.onModuleDestroy();
        await poolRegistry.onApplicationShutdown();
        await Promise.all([a.close(), b.close()]);
      }
    },
    30_000
  );
});
