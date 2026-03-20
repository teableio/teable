import { createFileRoute } from '@tanstack/react-router';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';
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
    const outboxConfig = container.resolve<ComputedUpdateOutboxConfig>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig
    );
    const now = new Date();

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
        'o.locked_at as lockedAt',
        'o.locked_by as lockedBy',
        (eb) => eb.fn.count<number>('s.id').as('seedCount'),
      ])
      .groupBy('o.id')
      .orderBy('o.created_at', 'desc')
      .limit(100)
      .execute();

    const items = tasks.map((task) => {
      const lockedAt = task.lockedAt ? new Date(task.lockedAt) : null;
      const leaseExpiresAt = lockedAt
        ? new Date(lockedAt.getTime() + outboxConfig.processingLeaseMs)
        : null;
      const lockedBy = task.lockedBy ?? null;
      const lockedWorkerId =
        typeof lockedBy === 'string' && lockedBy.includes(':')
          ? lockedBy.split(':', 1)[0]
          : lockedBy;
      const isStaleProcessing =
        task.status === 'processing' && leaseExpiresAt
          ? leaseExpiresAt.getTime() <= now.getTime()
          : false;

      return {
        ...task,
        lockedAt,
        lockedBy,
        lockedWorkerId,
        processingLeaseMs: outboxConfig.processingLeaseMs,
        leaseExpiresAt,
        leaseAgeMs: lockedAt ? Math.max(now.getTime() - lockedAt.getTime(), 0) : null,
        isStaleProcessing,
      };
    });

    return jsonResponse({
      items,
      total: items.length,
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
