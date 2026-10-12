import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  getUnitOfWorkTransaction,
  registerAfterCommit,
  type DomainError,
  type IExecutionContext,
  type ILogger,
  type ITransactionalProjectionMessageJournal,
  type ProjectionMessageDraft,
  type ProjectionMessageRef,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../record/di/tokens';

export type DomainEventWakeup = Readonly<{
  eventId: string;
  baseId: string;
}>;

export interface IDomainEventWakeupPublisher {
  publish(wakeup: DomainEventWakeup): Promise<void>;
}

export const noopDomainEventWakeupPublisher: IDomainEventWakeupPublisher = {
  publish: async () => undefined,
};

// Batch record events serialize full field dumps. 64 KiB fail-closed rolls back
// legitimate creates (T7002 hit ~965 KiB). Cap is a dump-runaway valve, not a
// TOAST budget; jsonb already TOASTs above ~2 KiB.
export const MAX_PROJECTION_PAYLOAD_BYTES = 16 * 1024 * 1024;

export const projectionPayloadTooLargeError = (payloadBytes: number): DomainError | undefined => {
  if (payloadBytes <= MAX_PROJECTION_PAYLOAD_BYTES) {
    return undefined;
  }
  return domainError.infrastructure({
    code: 'projection_message.payload_too_large',
    message: `Projection payload exceeds ${MAX_PROJECTION_PAYLOAD_BYTES} bytes (${payloadBytes} bytes)`,
  });
};

@injectable()
export class PostgresTransactionalProjectionMessageJournal
  implements ITransactionalProjectionMessageJournal
{
  constructor(
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.domainEventWakeupPublisher)
    private readonly wakeupPublisher: IDomainEventWakeupPublisher
  ) {}

  async append(
    context: IExecutionContext,
    messages: ReadonlyArray<ProjectionMessageDraft>
  ): Promise<Result<ReadonlyArray<ProjectionMessageRef>, DomainError>> {
    const transaction = getPostgresTransaction(context) as
      | import('kysely').Transaction<V1TeableDatabase>
      | undefined;
    if (!transaction) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.transaction_required',
          message: 'Projection journal requires an active data transaction',
        })
      );
    }

    const refs: ProjectionMessageRef[] = [];
    const wakeups: DomainEventWakeup[] = [];
    for (const message of messages) {
      if (message.mode === 'shadow') {
        continue;
      }
      const payloadJson = JSON.stringify(message.payload);
      const payloadBytes = Buffer.byteLength(payloadJson, 'utf8');
      const tooLarge = projectionPayloadTooLargeError(payloadBytes);
      if (tooLarge) {
        return err(tooLarge);
      }
      const baseId = message.route.baseId;
      if (!baseId) {
        return err(
          domainError.infrastructure({
            code: 'projection_message.append_failed',
            message: 'Projection message is missing baseId',
          })
        );
      }
      await transaction
        .insertInto('domain_event_outbox')
        .values({
          id: message.eventId,
          base_id: baseId,
          table_id: message.route.tableId ?? null,
          message_name: message.messageName,
          schema_version: message.schemaVersion,
          aggregate_id: message.route.streamKey ?? null,
          payload: sql`${payloadJson}::jsonb`,
          payload_bytes: payloadBytes,
          catalog_generation: message.catalogGeneration,
          required_consumers: sql`${JSON.stringify(
            message.requiredConsumers.map((target) => target.consumerId)
          )}::jsonb`,
          unpublished: true,
          settled: null,
        } as never)
        .execute();
      refs.push({ eventId: message.eventId });
      wakeups.push({ eventId: message.eventId, baseId });
    }

    if (getUnitOfWorkTransaction(context, 'data')) {
      registerAfterCommit(context, () => {
        void this.publishWakeups(wakeups);
      });
    }

    return ok(refs);
  }

  private async publishWakeups(wakeups: ReadonlyArray<DomainEventWakeup>): Promise<void> {
    for (const wakeup of wakeups) {
      try {
        await this.wakeupPublisher.publish(wakeup);
      } catch (error) {
        this.logger.warn('domain_event:wakeup_publish_failed', {
          eventId: wakeup.eventId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
  }
}
