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

async function handleDelete({ params }: { params: { taskId: string } }) {
  try {
    const { taskId } = params;
    const container = await createPlaygroundContainer();
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

    const result = await db
      .deleteFrom('computed_update_dead_letter')
      .where('id', '=', taskId)
      .executeTakeFirst();

    if (!result.numDeletedRows || result.numDeletedRows === 0n) {
      return jsonResponse({ error: 'Dead letter not found' }, 404);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete dead letter';
    return jsonResponse({ error: message }, 500);
  }
}

export const Route = createFileRoute('/api/computed-tasks/dead-letters/$taskId')({
  server: {
    handlers: {
      DELETE: handleDelete,
    },
  },
});
