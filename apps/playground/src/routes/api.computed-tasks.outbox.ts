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

    const tasks = await db
      .selectFrom('computed_update_outbox as o')
      .leftJoin('computed_update_outbox_seed as s', 's.task_id', 'o.id')
      .select([
        'o.id',
        'o.base_id as baseId',
        'o.seed_table_id as seedTableId',
        'o.status',
        'o.change_type as changeType',
        'o.attempts',
        'o.max_attempts as maxAttempts',
        'o.last_error as lastError',
        'o.plan_hash as planHash',
        'o.run_id as runId',
        'o.created_at as createdAt',
        'o.updated_at as updatedAt',
        'o.next_run_at as nextRunAt',
        (eb) => eb.fn.count<number>('s.id').as('seedCount'),
      ])
      .groupBy('o.id')
      .orderBy('o.created_at', 'desc')
      .limit(100)
      .execute();

    return jsonResponse({
      items: tasks,
      total: tasks.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch outbox tasks';
    return jsonResponse({ error: message }, 500);
  }
}

export const Route = createFileRoute('/api/computed-tasks/outbox')({
  server: {
    handlers: {
      GET: handleGet,
    },
  },
});
