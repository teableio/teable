import { createFileRoute } from '@tanstack/react-router';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import type { ComputedUpdateWorker } from '@teable/v2-adapter-table-repository-postgres';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import { createPlaygroundContainer } from '@/server/playgroundContainer';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function handlePost({ params }: { params: { taskId: string } }) {
  try {
    const { taskId } = params;
    const container = await createPlaygroundContainer();
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

    // Update the task to run immediately
    const result = await db
      .updateTable('computed_update_outbox')
      .set({
        next_run_at: new Date(),
        locked_at: null,
        locked_by: null,
      })
      .where('id', '=', taskId)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirst();

    if (!result.numUpdatedRows || result.numUpdatedRows === 0n) {
      return jsonResponse({ error: 'Task not found or not in retryable state' }, 404);
    }

    // Dispatch worker to process the task (non-blocking)
    const worker = container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
    setImmediate(() => {
      void worker.runOnce({
        workerId: 'playground-retry',
        limit: 10,
      });
    });

    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retry task';
    return jsonResponse({ error: message }, 500);
  }
}

export const Route = createFileRoute('/api/computed-tasks/$taskId/retry-now')({
  server: {
    handlers: {
      POST: handlePost,
    },
  },
});
