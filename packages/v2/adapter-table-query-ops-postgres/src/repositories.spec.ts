/* eslint-disable @typescript-eslint/naming-convention */
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  TablePhysicalStats,
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

import { PostgresTableQueryRecommendationRepository } from './repositories';
import { ensureTableQueryOpsSchema, type TableQueryOpsDatabase } from './schema';

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
