/* eslint-disable @typescript-eslint/naming-convention */
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  TablePhysicalStats,
  TableQueryDecisionLogEntry,
  TableQueryIndexInspection,
  TableQueryObservationWindow,
  TableQueryRecommendation,
  TableQueryRiskPolicy,
  TableQueryShape,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PostgresTableQueryDecisionLogRepository,
  PostgresTableQueryObservationRepository,
  PostgresTableQueryRecommendationRepository,
} from './repositories';
import {
  ensureTableQueryObservationSchema,
  ensureTableQueryOpsSchema,
  type TableQueryObservationDatabase,
  type TableQueryOpsDatabase,
} from './schema';
const testDatabaseUrl = process.env.PRISMA_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

const unwrap = <T, E>(result: Result<T, E>, label: string): T => {
  if (result.isErr()) {
    throw new Error(`${label}: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

describeWithPostgres('PostgresTableQueryRecommendationRepository', () => {
  let db: Kysely<TableQueryOpsDatabase>;

  beforeAll(async () => {
    db = await createV2PostgresDb<TableQueryOpsDatabase>({
      pg: {
        connectionString: testDatabaseUrl!,
        pool: {
          max: 1,
          allowExitOnIdle: true,
        },
      },
    });
    await ensureTableQueryOpsSchema(db);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('upserts open recommendations by table, shape, and policy', async () => {
    const tableId = `tblTqOpsRepo${process.pid}`;
    await sql`DELETE FROM table_query_recommendation WHERE table_id = ${tableId}`.execute(db);

    const repository = new PostgresTableQueryRecommendationRepository(db);
    const observation = unwrap(
      TableQueryObservationWindow.create({
        baseId: `bseTqOpsRepo${process.pid}`,
        tableId,
        windowStart: new Date('2026-06-01T00:00:00.000Z'),
        windowSizeSeconds: 300,
        shape: unwrap(
          TableQueryShape.create({
            queryKind: 'filter',
            whereShape: {
              conditionCount: 1,
              andDepth: 1,
              orDepth: 0,
              fields: [
                {
                  fieldId: 'fldTqOpsRepoText',
                  fieldType: 'singleLineText',
                  operatorFamily: 'text_contains',
                },
              ],
            },
            executionShape: {
              durationMs: 12_000,
              dbDurationMs: 11_500,
              timedOut: false,
              resultCountBucket: 'small',
            },
          }),
          'shape'
        ),
        requestCount: 6,
        slowCount: 6,
        timeoutCount: 0,
        dbErrorCount: 0,
        totalDurationMs: 72_000,
        maxDurationMs: 12_000,
      }),
      'observation'
    );
    const report = new TableQueryRiskPolicy()
      .evaluate({
        observation,
        physicalStats: unwrap(
          TablePhysicalStats.create({
            estimatedRows: 100_000,
            totalBytes: 1024,
          }),
          'physicalStats'
        ),
        indexInspection: unwrap(
          TableQueryIndexInspection.create({
            state: 'missing',
            usefulIndexes: [],
            missingIndexCandidates: [
              {
                fieldId: 'fldTqOpsRepoText',
                fieldDbName: 'fld_text',
                kind: 'gin_trgm',
                reason: 'text contains filter needs trigram index',
              },
            ],
            abnormalIndexes: [],
          }),
          'indexInspection'
        ),
      })
      .match(
        (value) => value,
        (error) => {
          throw new Error(`report: ${JSON.stringify(error)}`);
        }
      );

    const first = unwrap(
      TableQueryRecommendation.createOpen({
        observation,
        report,
        now: new Date('2026-06-01T00:05:00.000Z'),
      }),
      'firstRecommendation'
    );
    const second = unwrap(
      TableQueryRecommendation.createOpen({
        observation,
        report,
        now: new Date('2026-06-01T00:06:00.000Z'),
      }),
      'secondRecommendation'
    );

    const savedFirst = unwrap(await repository.save({} as never, first), 'saveFirst');
    const savedSecond = unwrap(await repository.save({} as never, second), 'saveSecond');
    const rows = await db
      .selectFrom('table_query_recommendation')
      .select(['id', 'shape_hash'])
      .where('table_id', '=', tableId)
      .execute();

    expect(first.snapshot().id).not.toBe(second.snapshot().id);
    expect(savedSecond.snapshot().id).toBe(savedFirst.snapshot().id);
    expect(rows).toEqual([{ id: savedFirst.snapshot().id, shape_hash: observation.shapeHash() }]);

    await sql`DELETE FROM table_query_recommendation WHERE table_id = ${tableId}`.execute(db);
  });
});
describeWithPostgres('PostgresTableQueryDecisionLogRepository', () => {
  let db: Kysely<TableQueryOpsDatabase>;

  beforeAll(async () => {
    db = await createV2PostgresDb<TableQueryOpsDatabase>({
      pg: {
        connectionString: testDatabaseUrl!,
        pool: {
          max: 1,
          allowExitOnIdle: true,
        },
      },
    });
    await ensureTableQueryOpsSchema(db);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('persists decisions, updates outcomes by id, and reads newest-first by scope', async () => {
    const tableId = `tblTqOpsDecision${process.pid}`;
    await sql`DELETE FROM table_query_decision_log WHERE table_id = ${tableId}`.execute(db);

    const repository = new PostgresTableQueryDecisionLogRepository(db);
    const now = new Date('2026-06-01T00:00:00.000Z');
    const entryAt = (decidedAt: Date) =>
      unwrap(
        TableQueryDecisionLogEntry.create({
          baseId: `bseTqOpsDecision${process.pid}`,
          tableId,
          scopeKey: 'scope-a',
          decision: {
            action: 'auto_accept',
            wouldAutoAccept: true,
            reasonCodes: ['auto_accept_criteria_met'],
            cooldownUntil: new Date(decidedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
          },
          actor: 'system_policy',
          recommendationId: 'tqr_decision_spec',
          now: decidedAt,
        }),
        'entry'
      );

    const first = unwrap(await repository.save({} as never, entryAt(now)), 'saveFirst');
    const second = unwrap(
      await repository.save({} as never, entryAt(new Date(now.getTime() + 60_000))),
      'saveSecond'
    );

    const failed = unwrap(
      first.withOutcome('post_verify_failed', new Date(now.getTime() + 120_000)),
      'withOutcome'
    );
    const savedFailed = unwrap(await repository.save({} as never, failed), 'saveFailed');
    expect(savedFailed.snapshot().outcome).toBe('post_verify_failed');

    const entries = unwrap(
      await repository.findRecentByScope({} as never, {
        tableId,
        scopeKey: 'scope-a',
        limit: 10,
      }),
      'findRecentByScope'
    );
    expect(entries.map((entry) => entry.snapshot().id)).toEqual([
      second.snapshot().id,
      first.snapshot().id,
    ]);
    expect(entries[1].snapshot().outcome).toBe('post_verify_failed');
    expect(entries[0].snapshot().recommendationId).toBe('tqr_decision_spec');

    const otherScope = unwrap(
      await repository.findRecentByScope({} as never, {
        tableId,
        scopeKey: 'scope-b',
        limit: 10,
      }),
      'findOtherScope'
    );
    expect(otherScope).toEqual([]);

    await sql`DELETE FROM table_query_decision_log WHERE table_id = ${tableId}`.execute(db);
  });
});

describeWithPostgres('PostgresTableQueryObservationRepository', () => {
  let db: Kysely<TableQueryObservationDatabase>;

  beforeAll(async () => {
    db = await createV2PostgresDb<TableQueryObservationDatabase>({
      pg: {
        connectionString: testDatabaseUrl!,
        pool: {
          max: 1,
          allowExitOnIdle: true,
        },
      },
    });
    await ensureTableQueryObservationSchema(db);
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('persists batches in writer shards and aggregates them into logical windows', async () => {
    const tableId = `tblTqOpsObservation${process.pid}`;
    const otherTableId = `tblTqOpsObservationBatch${process.pid}`;
    const baseId = `bseTqOpsObservation${process.pid}`;
    const windowStart = new Date('2026-06-01T00:00:00.000Z');
    await sql`DELETE FROM table_query_observation_shard WHERE table_id IN (${tableId}, ${otherTableId})`.execute(
      db
    );

    const shape = unwrap(
      TableQueryShape.create({
        queryKind: 'filter',
        whereShape: {
          conditionCount: 1,
          andDepth: 1,
          orDepth: 0,
          fields: [
            {
              fieldId: 'fldTqOpsObservationText',
              fieldType: 'singleLineText',
              operatorFamily: 'text_contains',
            },
          ],
        },
        executionShape: {
          durationMs: 100,
          dbDurationMs: 80,
          timedOut: false,
          resultCountBucket: 'small',
        },
      }),
      'shape'
    );
    const observation = (
      targetTableId: string,
      requestCount: number,
      totalDurationMs: number,
      maxDurationMs: number,
      observedAt: Date = windowStart,
      spaceId?: string
    ) =>
      unwrap(
        TableQueryObservationWindow.create({
          spaceId,
          baseId,
          tableId: targetTableId,
          windowStart: observedAt,
          windowSizeSeconds: 300,
          shape,
          requestCount,
          slowCount: requestCount - 1,
          timeoutCount: requestCount > 2 ? 1 : 0,
          dbErrorCount: requestCount > 2 ? 1 : 0,
          totalDurationMs,
          maxDurationMs,
          totalDbDurationMs: totalDurationMs - 10,
          maxDbDurationMs: maxDurationMs - 5,
        }),
        'observation'
      );

    const repository = new PostgresTableQueryObservationRepository(db, {
      directWriterId: 'direct',
    });
    unwrap(
      await repository.recordBatch({} as never, {
        writerId: 'writer-a',
        observations: [observation(tableId, 2, 200, 120), observation(otherTableId, 1, 90, 90)],
      }),
      'recordBatchA'
    );
    unwrap(
      await repository.recordBatch({} as never, {
        writerId: 'writer-b',
        observations: [observation(tableId, 3, 450, 200, windowStart, 'spc-observation')],
      }),
      'recordBatchB'
    );
    unwrap(
      await repository.record({} as never, observation(otherTableId, 1, 80, 80)),
      'recordDirect'
    );

    const physicalRows = await db
      .selectFrom('table_query_observation_shard')
      .select(['writer_id', 'request_count'])
      .where('table_id', '=', tableId)
      .orderBy('writer_id')
      .execute();
    expect(physicalRows).toEqual([
      { writer_id: 'writer-a', request_count: 2 },
      { writer_id: 'writer-b', request_count: 3 },
    ]);
    const otherTableRows = await db
      .selectFrom('table_query_observation_shard')
      .select('writer_id')
      .where('table_id', '=', otherTableId)
      .orderBy('writer_id')
      .execute();
    expect(otherTableRows).toEqual([{ writer_id: 'direct' }, { writer_id: 'writer-a' }]);

    const logical = unwrap(
      await repository.findRecent({} as never, {
        since: new Date('2026-05-31T23:59:00.000Z'),
        limit: 10,
        tableId,
      }),
      'findRecent'
    );
    expect(logical).toHaveLength(1);
    expect(logical[0].snapshot()).toMatchObject({
      spaceId: 'spc-observation',
      requestCount: 5,
      slowCount: 3,
      timeoutCount: 1,
      dbErrorCount: 1,
      totalDurationMs: 650,
      maxDurationMs: 200,
      totalDbDurationMs: 630,
      maxDbDurationMs: 195,
    });
    const searchShape = unwrap(
      TableQueryShape.create({
        queryKind: 'search',
        executionShape: {
          durationMs: 25,
          timedOut: false,
          resultCountBucket: 'small',
        },
      }),
      'searchShape'
    );
    const searchObservation = (observedAt: Date) =>
      unwrap(
        TableQueryObservationWindow.create({
          baseId,
          tableId,
          windowStart: observedAt,
          windowSizeSeconds: 300,
          shape: searchShape,
          requestCount: 1,
          slowCount: 0,
          timeoutCount: 0,
          dbErrorCount: 0,
          totalDurationMs: 25,
          maxDurationMs: 25,
        }),
        'searchObservation'
      );
    unwrap(
      await repository.recordBatch({} as never, {
        writerId: 'writer-a',
        observations: [
          searchObservation(new Date('2026-04-01T00:00:00.000Z')),
          searchObservation(new Date('2026-04-02T00:00:00.000Z')),
        ],
      }),
      'recordSearchActivity'
    );
    unwrap(
      await repository.recordBatch({} as never, {
        writerId: 'writer-a',
        observations: [observation(tableId, 1, 50, 50, new Date('2026-04-01T00:00:00.000Z'))],
      }),
      'recordExpired'
    );
    expect(
      unwrap(await repository.pruneBefore(new Date('2026-05-01T00:00:00.000Z')), 'pruneBefore')
    ).toBe(2);
    const remaining = await db
      .selectFrom('table_query_observation_shard')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('table_id', '=', tableId)
      .executeTakeFirstOrThrow();
    expect(Number(remaining.count)).toBe(3);
    const retainedSearch = await db
      .selectFrom('table_query_observation_shard')
      .select('window_start')
      .where('table_id', '=', tableId)
      .where('query_kind', '=', 'search')
      .execute();
    expect(retainedSearch).toEqual([{ window_start: new Date('2026-04-02T00:00:00.000Z') }]);
    const batchTableId = `tblTqOpsObservationPrune${process.pid}`;
    await sql`
      INSERT INTO table_query_observation_shard (
        base_id, table_id, query_kind, shape_hash, window_start, writer_id,
        window_size_seconds, request_count, slow_count, timeout_count, db_error_count,
        total_duration_ms, max_duration_ms, shape
      )
      SELECT
        ${baseId},
        ${batchTableId},
        'filter',
        'shape-' || value,
        '2026-03-01T00:00:00.000Z'::timestamptz + value * interval '1 second',
        'writer-batch',
        300, 1, 0, 0, 0, 10, 10, '{}'::jsonb
      FROM generate_series(1, 1001) AS value
    `.execute(db);
    expect(
      unwrap(await repository.pruneBefore(new Date('2026-05-01T00:00:00.000Z')), 'pruneBatch')
    ).toBe(1001);
    const prunedBatch = await db
      .selectFrom('table_query_observation_shard')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('table_id', '=', batchTableId)
      .executeTakeFirstOrThrow();
    expect(Number(prunedBatch.count)).toBe(0);

    await sql`DELETE FROM table_query_observation_shard WHERE table_id IN (${tableId}, ${otherTableId})`.execute(
      db
    );
  });

  it('keeps completed prune batches when a later batch fails', async () => {
    const tableId = `tblTqOpsObservationPruneFailure${process.pid}`;
    await sql`
      INSERT INTO table_query_observation_shard (
        base_id, table_id, query_kind, shape_hash, window_start, writer_id,
        window_size_seconds, request_count, slow_count, timeout_count, db_error_count,
        total_duration_ms, max_duration_ms, shape
      )
      SELECT
        'bse-prune-failure',
        ${tableId},
        'filter',
        'shape-' || value,
        '1899-01-01T00:00:00.000Z'::timestamptz + value * interval '1 second',
        'writer-prune-failure',
        300, 1, 0, 0, 0, 10, 10, '{}'::jsonb
      FROM generate_series(1, 1001) AS value
    `.execute(db);
    await sql`
      CREATE OR REPLACE FUNCTION table_query_observation_prune_failure_test()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.table_id LIKE 'tblTqOpsObservationPruneFailure%'
          AND OLD.shape_hash = 'shape-1001' THEN
          RAISE EXCEPTION 'forced second prune batch failure';
        END IF;
        RETURN OLD;
      END
      $$
    `.execute(db);
    await sql`
      DROP TRIGGER IF EXISTS table_query_observation_prune_failure_test
      ON table_query_observation_shard
    `.execute(db);
    await sql`
      CREATE TRIGGER table_query_observation_prune_failure_test
      BEFORE DELETE ON table_query_observation_shard
      FOR EACH ROW EXECUTE FUNCTION table_query_observation_prune_failure_test()
    `.execute(db);

    try {
      const repository = new PostgresTableQueryObservationRepository(db);
      const result = await repository.pruneBefore(new Date('1900-01-01T00:00:00.000Z'));
      expect(result.isErr()).toBe(true);
      const remaining = await db
        .selectFrom('table_query_observation_shard')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('table_id', '=', tableId)
        .executeTakeFirstOrThrow();
      expect(Number(remaining.count)).toBe(1);
    } finally {
      await sql`
        DROP TRIGGER IF EXISTS table_query_observation_prune_failure_test
        ON table_query_observation_shard
      `.execute(db);
      await sql`DROP FUNCTION IF EXISTS table_query_observation_prune_failure_test()`.execute(db);
      await sql`DELETE FROM table_query_observation_shard WHERE table_id = ${tableId}`.execute(db);
    }
  });
});
