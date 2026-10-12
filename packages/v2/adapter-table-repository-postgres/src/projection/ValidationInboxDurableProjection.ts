import {
  DurableProjectionHandler,
  RecordCreated,
  RecordReordered,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  RecordUpdated,
  type IDurableProjectionContext,
  type IDurableProjectionHandler,
  type ProjectionDeliveryError,
  type ProjectionDeliveryOutcome,
  type ProjectionMessageJson,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

export const RECORD_VALIDATION_CONSUMER_ID = 'record.validation.v1';

const durableOptions = {
  id: RECORD_VALIDATION_CONSUMER_ID,
  ordering: 'none' as const,
  idempotency: 'destination-inbox' as const,
  replay: 'safe' as const,
};

const quoteIdent = (value: string): string => `"${value.replaceAll('"', '""')}"`;

@DurableProjectionHandler(RecordCreated, 'table.record.created.v1', durableOptions)
@DurableProjectionHandler(RecordsBatchCreated, 'table.records.batch-created.v1', durableOptions)
@DurableProjectionHandler(RecordUpdated, 'table.record.updated.v1', durableOptions)
@DurableProjectionHandler(RecordsBatchUpdated, 'table.records.batch-updated.v1', durableOptions)
@DurableProjectionHandler(RecordsDeleted, 'table.records.deleted.v1', durableOptions)
@DurableProjectionHandler(RecordReordered, 'table.record.reordered.v1', durableOptions)
export class ValidationInboxDurableProjection
  implements IDurableProjectionHandler<ProjectionMessageJson>
{
  readonly consumerId = RECORD_VALIDATION_CONSUMER_ID;

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private readonly schema?: string
  ) {}

  private table(name: string) {
    return sql.raw(
      this.schema ? `${quoteIdent(this.schema)}.${quoteIdent(name)}` : quoteIdent(name)
    );
  }

  async handle(
    context: IDurableProjectionContext,
    _message: ProjectionMessageJson
  ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
    try {
      await sql`
        INSERT INTO ${this.table('domain_event_inbox')} (consumer_id, event_id)
        VALUES (${this.consumerId}, ${context.eventId})
        ON CONFLICT DO NOTHING
      `.execute(this.db);
    } catch (error) {
      return err({
        code: 'domain_event.inbox_write_failed',
        retryability: 'retryable',
        message: error instanceof Error ? error.message : 'Failed to persist destination inbox',
      });
    }
    return ok({
      kind: 'applied',
      effectReceipt: {
        kind: 'destination-inbox',
        identity: RECORD_VALIDATION_CONSUMER_ID,
      },
    });
  }
}
