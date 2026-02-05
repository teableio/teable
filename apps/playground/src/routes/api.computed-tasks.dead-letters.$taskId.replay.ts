import { createFileRoute } from '@tanstack/react-router';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { generateUuid } from '@teable/v2-core';

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

    // Get the dead letter
    const deadLetter = await db
      .selectFrom('computed_update_dead_letter')
      .selectAll()
      .where('id', '=', taskId)
      .executeTakeFirst();

    if (!deadLetter) {
      return jsonResponse({ error: 'Dead letter not found' }, 404);
    }

    const newTaskId = generateUuid();
    const now = new Date();

    // Create a new outbox task from the dead letter
    await db
      .insertInto('computed_update_outbox')
      .values({
        id: newTaskId,
        base_id: deadLetter.base_id,
        seed_table_id: deadLetter.seed_table_id,
        seed_record_ids: deadLetter.seed_record_ids,
        change_type: deadLetter.change_type,
        steps: deadLetter.steps,
        edges: deadLetter.edges,
        status: 'pending',
        attempts: 0,
        max_attempts: deadLetter.max_attempts,
        next_run_at: now,
        estimated_complexity: deadLetter.estimated_complexity,
        plan_hash: deadLetter.plan_hash,
        dirty_stats: deadLetter.dirty_stats,
        run_id: generateUuid(),
        origin_run_ids: [deadLetter.run_id, ...(deadLetter.origin_run_ids ?? [])],
        run_total_steps: deadLetter.run_total_steps,
        run_completed_steps_before: deadLetter.run_completed_steps_before,
        affected_table_ids: deadLetter.affected_table_ids,
        affected_field_ids: deadLetter.affected_field_ids,
        sync_max_level: deadLetter.sync_max_level,
        created_at: now,
        updated_at: now,
      })
      .execute();

    // Delete the dead letter
    await db.deleteFrom('computed_update_dead_letter').where('id', '=', taskId).execute();

    return jsonResponse({ success: true, newTaskId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to replay dead letter';
    return jsonResponse({ error: message }, 500);
  }
}

export const Route = createFileRoute('/api/computed-tasks/dead-letters/$taskId/replay')({
  server: {
    handlers: {
      POST: handlePost,
    },
  },
});
