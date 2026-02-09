import { createFileRoute } from '@tanstack/react-router';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import { createPlaygroundContainer } from '@/server/playgroundContainer';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function handleGet() {
  try {
    const container = await createPlaygroundContainer();
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

    const deadLetters = await db
      .selectFrom('computed_update_dead_letter')
      .select([
        'id',
        'base_id as baseId',
        'seed_table_id as seedTableId',
        'status',
        'change_type as changeType',
        'attempts',
        'max_attempts as maxAttempts',
        'last_error as lastError',
        'plan_hash as planHash',
        'run_id as runId',
        'failed_at as failedAt',
        'created_at as createdAt',
        'trace_data as traceData',
      ])
      .orderBy('failed_at', 'desc')
      .limit(100)
      .execute();

    // Get seed counts for each dead letter
    const deadLetterIds = deadLetters.map((dl) => dl.id);
    const seedCounts: Map<string, number> = new Map();

    if (deadLetterIds.length > 0) {
      // Dead letters don't have a seed table, use seed_record_ids JSON field
      for (const dl of deadLetters) {
        const raw = (dl as unknown as { seedRecordIds?: unknown }).seedRecordIds;
        if (Array.isArray(raw)) {
          seedCounts.set(dl.id, raw.length);
        } else {
          seedCounts.set(dl.id, 0);
        }
      }
    }

    const items = deadLetters.map((dl) => ({
      ...dl,
      seedCount: seedCounts.get(dl.id) ?? 0,
    }));

    return jsonResponse({
      items,
      total: items.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch dead letters';
    return jsonResponse({ error: message }, 500);
  }
}

export const Route = createFileRoute('/api/computed-tasks/dead-letters')({
  server: {
    handlers: {
      GET: handleGet,
    },
  },
});
