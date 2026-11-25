import { isRecordInitiatorKind } from '@teable/v2-core';
import type { IExecutionContext, RecordActorAttribution, Table } from '@teable/v2-core';
import { sql } from 'kysely';

export const ACTOR_COLUMNS = [
  '__created_by_actor_type',
  '__created_by_actor_id',
  '__last_modified_by_actor_type',
  '__last_modified_by_actor_id',
] as const;

/** A stored reference is either a complete scalar pair or unknown. */
export const readStoredActor = (
  type: unknown,
  id: unknown
): NonNullable<IExecutionContext['initiator']> | null =>
  isRecordInitiatorKind(type) && typeof id === 'string' && id.length > 0 ? { type, id } : null;

export const actorReturningSelections = (table: Table, qualifier?: string) =>
  ACTOR_COLUMNS.map((column) =>
    (table.actorStorageVersion() === 1
      ? sql.ref(qualifier ? `${qualifier}.${column}` : column)
      : sql`NULL::text`
    ).as(column)
  );

export const readRecordActors = (row: Record<string, unknown>): RecordActorAttribution => {
  const creator = readStoredActor(row.__created_by_actor_type, row.__created_by_actor_id);
  const modifier = readStoredActor(
    row.__last_modified_by_actor_type,
    row.__last_modified_by_actor_id
  );
  return {
    createdByActorType: creator?.type ?? null,
    createdByActorId: creator?.id ?? null,
    lastModifiedByActorType: modifier?.type ?? null,
    lastModifiedByActorId: modifier?.id ?? null,
  };
};
