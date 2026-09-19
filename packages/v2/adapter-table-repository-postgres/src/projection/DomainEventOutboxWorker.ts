import {
  createEventDispatchScope,
  domainError,
  generateUuid,
  getDurableProjectionRegistrations,
  type DomainError,
  type IDurableProjectionContext,
  type IDurableProjectionHandler,
  type ILogger,
  type IProjectionMessageCodecRegistry,
  type ProjectionDeliveryError,
  type ProjectionMessageJson,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

export type DomainEventClaimIdentity = Readonly<{
  consumerId: string;
  messageName: string;
  schemaVersion: number;
}>;

const deriveClaimIdentities = (
  handlers: ReadonlyMap<string, IDurableProjectionHandler<ProjectionMessageJson>>,
  codecs: IProjectionMessageCodecRegistry
): ReadonlyArray<DomainEventClaimIdentity> => {
  const handlerIds = new Set(handlers.keys());
  const versionsByMessage = new Map<string, number[]>();
  for (const identity of codecs.registeredDecoderIdentities()) {
    const versions = versionsByMessage.get(identity.messageName) ?? [];
    if (!versions.includes(identity.schemaVersion)) {
      versions.push(identity.schemaVersion);
    }
    versionsByMessage.set(identity.messageName, versions);
  }
  const identities: DomainEventClaimIdentity[] = [];
  const seen = new Set<string>();
  for (const registration of getDurableProjectionRegistrations()) {
    if (!handlerIds.has(registration.id)) {
      continue;
    }
    const versions = versionsByMessage.get(registration.messageName);
    if (!versions) {
      continue;
    }
    for (const schemaVersion of versions) {
      const key = `${registration.id}\0${registration.messageName}\0${schemaVersion}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      identities.push({
        consumerId: registration.id,
        messageName: registration.messageName,
        schemaVersion,
      });
    }
  }
  return identities;
};

type ClaimedDelivery = Readonly<{
  id: string;
  eventId: string;
  consumerId: string;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
  messageName: string;
  schemaVersion: number;
  payload: unknown;
  catalogGeneration: number;
}>;

type OwnedDelivery = ClaimedDelivery & Readonly<{ remainingMs: number }>;

const quoteIdent = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const DOMAIN_EVENT_RETENTION_DAYS = 14;
const DOMAIN_EVENT_PURGE_BATCH = 1000;
const DOMAIN_EVENT_RECONCILE_BATCH = 1000;
const DOMAIN_EVENT_MAINTENANCE_BUDGET_MS = 5_000;
const DOMAIN_EVENT_LEASE_MS = 120_000;

export class DomainEventOutboxWorker {
  private readonly claimIdentities: ReadonlyArray<DomainEventClaimIdentity>;

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private readonly handlers: ReadonlyMap<
      string,
      IDurableProjectionHandler<ProjectionMessageJson>
    >,
    private readonly codecs: IProjectionMessageCodecRegistry,
    private readonly logger: ILogger,
    private readonly schema?: string,
    claimIdentities?: ReadonlyArray<DomainEventClaimIdentity>
  ) {
    this.claimIdentities = claimIdentities ?? deriveClaimIdentities(handlers, codecs);
  }

  private table(name: string) {
    return sql.raw(
      this.schema ? `${quoteIdent(this.schema)}.${quoteIdent(name)}` : quoteIdent(name)
    );
  }

  async pollOnce(): Promise<Result<number, DomainError>> {
    const expanded = await this.expandUnpublished();
    if (expanded.isErr()) {
      return err(expanded.error);
    }
    const claimed = await this.claimDueDeliveries(20);
    if (claimed.isErr()) {
      return err(claimed.error);
    }
    let processed = 0;
    for (const delivery of claimed.value) {
      const result = await this.processDelivery(delivery);
      if (result.isOk()) {
        processed += 1;
        continue;
      }
      this.logger.warn('domain_event:delivery_failed', {
        deliveryId: delivery.id,
        eventId: delivery.eventId,
        consumerId: delivery.consumerId,
        errorCode: result.error.code,
      });
    }
    return ok(processed);
  }

  async maintainOnce(): Promise<Result<{ reconciled: number; purged: number }, DomainError>> {
    let phase: 'maintenance' | 'reconcile' | 'purge' = 'maintenance';
    try {
      const result = await this.db.transaction().execute(async (executor) => {
        const deadline = Date.now() + DOMAIN_EVENT_MAINTENANCE_BUDGET_MS;
        await this.setMaintenanceStatementTimeout(executor, deadline);
        const lock = await sql<{ acquired: boolean }>`
          SELECT pg_try_advisory_xact_lock(
            hashtext(${`domain-event-maintenance:${this.schema ?? 'public'}`})
          ) AS acquired
        `.execute(executor);
        if (!lock.rows[0]?.acquired) {
          return { reconciled: 0, purged: 0 };
        }

        await this.setMaintenanceStatementTimeout(executor, deadline);
        phase = 'reconcile';
        const reconciled = await this.reconcileUnsettled(executor);
        phase = 'maintenance';
        await this.setMaintenanceStatementTimeout(executor, deadline);
        phase = 'purge';
        const purged = await this.purgeSettled(executor);
        phase = 'maintenance';
        if (Date.now() >= deadline) {
          throw new Error('Domain event maintenance budget exhausted');
        }
        return { reconciled, purged };
      });
      return ok(result);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: `domain_event.${phase}_failed`,
          message: error instanceof Error ? error.message : 'Failed to maintain domain events',
        })
      );
    }
  }

  private async setMaintenanceStatementTimeout(
    executor: Transaction<V1TeableDatabase>,
    deadline: number
  ): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('Domain event maintenance budget exhausted');
    }
    await sql`SELECT set_config('statement_timeout', ${String(remaining)}, true)`.execute(executor);
    if (Date.now() >= deadline) {
      throw new Error('Domain event maintenance budget exhausted');
    }
  }

  private async expandUnpublished(): Promise<Result<number, DomainError>> {
    try {
      const result = await this.db.transaction().execute(async (trx) => {
        const unpublished = await sql<{
          id: string;
          required_consumers: unknown;
        }>`
          SELECT id, required_consumers
          FROM ${this.table('domain_event_outbox')}
          WHERE unpublished
          ORDER BY created_at
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        `.execute(trx);

        let inserted = 0;
        for (const row of unpublished.rows) {
          if (!Array.isArray(row.required_consumers)) {
            continue;
          }
          const consumers = row.required_consumers.flatMap((value) => {
            if (typeof value === 'string') {
              return [value];
            }
            if (
              value &&
              typeof value === 'object' &&
              'consumerId' in value &&
              typeof value.consumerId === 'string'
            ) {
              return [value.consumerId];
            }
            return [];
          });
          const expected = [...new Set(consumers)].sort();
          if (expected.length === 0) {
            continue;
          }
          for (const consumerId of expected) {
            await sql`
              INSERT INTO ${this.table('domain_event_delivery')} (id, event_id, consumer_id, status, attempts, max_attempts)
              VALUES (${generateUuid()}, ${row.id}, ${consumerId}, 'pending', 0, 12)
              ON CONFLICT (event_id, consumer_id) DO NOTHING
            `.execute(trx);
            inserted += 1;
          }
          const existing = await sql<{ consumer_id: string }>`
            SELECT consumer_id
            FROM ${this.table('domain_event_delivery')}
            WHERE event_id = ${row.id}
          `.execute(trx);
          const actual = [...new Set(existing.rows.map((item) => item.consumer_id))].sort();
          if (actual.join('\0') !== expected.join('\0')) {
            continue;
          }
          await sql`
            UPDATE ${this.table('domain_event_outbox')}
            SET unpublished = false
            WHERE id = ${row.id}
          `.execute(trx);
        }
        return inserted;
      });
      return ok(result);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.expand_failed',
          message: error instanceof Error ? error.message : 'Failed to expand unpublished events',
        })
      );
    }
  }

  private async claimDueDeliveries(
    limit: number
  ): Promise<Result<ReadonlyArray<ClaimedDelivery>, DomainError>> {
    if (this.claimIdentities.length === 0) {
      return ok([]);
    }
    try {
      const leaseToken = generateUuid();
      const subscriptionFilter = sql.join(
        this.claimIdentities.map(
          (identity) =>
            sql`(${identity.consumerId}, ${identity.messageName}, ${identity.schemaVersion})`
        ),
        sql`, `
      );
      const rows = await sql<ClaimedDelivery>`
        WITH due AS (
          SELECT d.id
          FROM ${this.table('domain_event_delivery')} d
          INNER JOIN ${this.table('domain_event_outbox')} o ON o.id = d.event_id
          WHERE d.status IN ('pending', 'processing')
            AND d.next_attempt_at <= now()
            AND (d.lease_expires_at IS NULL OR d.lease_expires_at < now())
            AND (d.consumer_id, o.message_name, o.schema_version) IN (${subscriptionFilter})
          ORDER BY d.next_attempt_at
          LIMIT ${limit}
          FOR UPDATE OF d SKIP LOCKED
        ),
        claimed AS (
          UPDATE ${this.table('domain_event_delivery')} d
          SET
            status = 'processing',
            lease_token = ${leaseToken},
            lease_expires_at = now() + (${DOMAIN_EVENT_LEASE_MS} * interval '1 millisecond'),
            attempts = d.attempts + 1
          FROM due
          WHERE d.id = due.id
          RETURNING
            d.id,
            d.event_id,
            d.consumer_id,
            d.attempts,
            d.max_attempts,
            d.lease_token,
            d.lease_expires_at
        )
        SELECT
          claimed.id,
          claimed.event_id as "eventId",
          claimed.consumer_id as "consumerId",
          claimed.attempts,
          claimed.max_attempts as "maxAttempts",
          claimed.lease_token as "leaseToken",
          claimed.lease_expires_at as "leaseExpiresAt",
          o.message_name as "messageName",
          o.schema_version as "schemaVersion",
          o.payload,
          o.catalog_generation as "catalogGeneration"
        FROM claimed
        JOIN ${this.table('domain_event_outbox')} o ON o.id = claimed.event_id
      `.execute(this.db);
      return ok(rows.rows);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.claim_failed',
          message: error instanceof Error ? error.message : 'Failed to claim deliveries',
        })
      );
    }
  }

  private async inboxExists(delivery: ClaimedDelivery): Promise<boolean> {
    const already = await sql<{ exists: boolean }>`
      SELECT true as exists
      FROM ${this.table('domain_event_inbox')}
      WHERE consumer_id = ${delivery.consumerId}
        AND event_id = ${delivery.eventId}
      LIMIT 1
    `.execute(this.db);
    return Boolean(already.rows[0]?.exists);
  }

  private async renewOwnedLease(
    delivery: ClaimedDelivery
  ): Promise<Result<OwnedDelivery, DomainError>> {
    try {
      // Remaining time must come from PostgreSQL. node-pg parses
      // `timestamp without time zone` as process-local time, so a JS Date
      // comparison against Date.now() can report lease_lost while the row
      // is still valid in the database.
      const rows = await sql<{ remainingMs: number | string }>`
        UPDATE ${this.table('domain_event_delivery')}
        SET lease_expires_at = now() + (${DOMAIN_EVENT_LEASE_MS} * interval '1 millisecond')
        WHERE id = ${delivery.id}
          AND lease_token = ${delivery.leaseToken}
          AND status = 'processing'
          AND lease_expires_at > now()
        RETURNING (EXTRACT(EPOCH FROM (lease_expires_at - now())) * 1000)::double precision as "remainingMs"
      `.execute(this.db);
      const remainingMs = Number(rows.rows[0]?.remainingMs);
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        return err(
          domainError.infrastructure({
            code: 'domain_event.lease_lost',
            message: `Lost lease on delivery ${delivery.id}`,
          })
        );
      }
      return ok({
        ...delivery,
        remainingMs,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.lease_renew_failed',
          message: error instanceof Error ? error.message : 'Failed to renew delivery lease',
        })
      );
    }
  }

  private async processDelivery(delivery: ClaimedDelivery): Promise<Result<void, DomainError>> {
    const owned = await this.renewOwnedLease(delivery);
    if (owned.isErr()) {
      return err(owned.error);
    }
    const liveDelivery = owned.value;
    const remainingMs = liveDelivery.remainingMs;

    if (await this.inboxExists(liveDelivery)) {
      return this.markSucceeded(liveDelivery);
    }

    const payload = liveDelivery.payload as ProjectionMessageJson;
    const decoded = this.codecs.decode(
      liveDelivery.messageName,
      liveDelivery.schemaVersion,
      payload
    );
    if (decoded.isErr()) {
      return this.markFailed(liveDelivery, {
        code: decoded.error.code,
        retryability:
          decoded.error.code === 'projection_message.schema_version_unsupported'
            ? 'retryable'
            : 'terminal',
        message: decoded.error.message,
      });
    }

    const handler = this.handlers.get(liveDelivery.consumerId);
    if (!handler) {
      return this.markFailed(liveDelivery, {
        code: 'domain_event.handler_missing',
        retryability: 'retryable',
        message: `No durable handler for ${liveDelivery.consumerId}`,
      });
    }

    const abort = new AbortController();
    const leaseTimer = setTimeout(() => abort.abort(), remainingMs);
    leaseTimer.unref?.();
    const context: IDurableProjectionContext = {
      eventId: liveDelivery.eventId,
      deliveryId: liveDelivery.id,
      consumerId: liveDelivery.consumerId,
      catalogGeneration: liveDelivery.catalogGeneration,
      consumerGeneration: 1,
      replayGeneration: 0,
      invocationAttempt: liveDelivery.attempts,
      actorId: 'system',
      occurredAt: new Date(),
      dispatchScope: createEventDispatchScope(),
      leaseSignal: abort.signal,
    };
    let handled: Awaited<ReturnType<typeof handler.handle>>;
    try {
      handled = await handler.handle(context, decoded.value);
    } catch (error) {
      return this.markFailed(liveDelivery, {
        code: 'domain_event.handler_threw',
        retryability: 'retryable',
        message: error instanceof Error ? error.message : 'Durable handler threw',
      });
    } finally {
      clearTimeout(leaseTimer);
    }
    if (handled.isErr()) {
      return this.markFailed(liveDelivery, handled.error);
    }

    if (
      handled.value.kind === 'applied' &&
      handled.value.effectReceipt.kind === 'destination-inbox'
    ) {
      if (!(await this.inboxExists(liveDelivery))) {
        return this.markFailed(liveDelivery, {
          code: 'domain_event.inbox_missing',
          retryability: 'terminal',
          message:
            'destination-inbox handler returned applied without persisting the inbox receipt',
        });
      }
    }

    return this.markSucceeded(liveDelivery);
  }

  private async markSucceeded(delivery: ClaimedDelivery): Promise<Result<void, DomainError>> {
    try {
      const owned = await this.db.transaction().execute(async (trx) => {
        const updated = await this.completeOwnedDelivery(trx, delivery, {
          status: 'succeeded',
          lastError: null,
        });
        if (updated) {
          await this.settleOutboxIfTerminal(trx, delivery.eventId);
        }
        return updated;
      });
      if (!owned) {
        return err(
          domainError.infrastructure({
            code: 'domain_event.lease_lost',
            message: `Lost lease on delivery ${delivery.id}`,
          })
        );
      }
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.settle_failed',
          message: error instanceof Error ? error.message : 'Failed to settle succeeded delivery',
        })
      );
    }
  }

  private async markFailed(
    delivery: ClaimedDelivery,
    failure: ProjectionDeliveryError
  ): Promise<Result<void, DomainError>> {
    const exhausted =
      failure.retryability === 'terminal' || delivery.attempts >= delivery.maxAttempts;
    if (exhausted) {
      try {
        const owned = await this.db.transaction().execute(async (trx) => {
          const updated = await this.completeOwnedDelivery(trx, delivery, {
            status: 'dead',
            lastError: failure.message,
          });
          if (updated) {
            await this.settleOutboxIfTerminal(trx, delivery.eventId);
          }
          return updated;
        });
        if (!owned) {
          return err(
            domainError.infrastructure({
              code: 'domain_event.lease_lost',
              message: `Lost lease on delivery ${delivery.id}`,
            })
          );
        }
      } catch (error) {
        return err(
          domainError.infrastructure({
            code: 'domain_event.settle_failed',
            message: error instanceof Error ? error.message : 'Failed to settle dead delivery',
          })
        );
      }
      return err(
        domainError.infrastructure({
          code: failure.code,
          message: failure.message,
        })
      );
    }
    const released = await this.completeOwnedDelivery(this.db, delivery, {
      status: 'pending',
      lastError: failure.message,
    });
    if (!released) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.lease_lost',
          message: `Lost lease on delivery ${delivery.id}`,
        })
      );
    }
    return err(
      domainError.infrastructure({
        code: failure.code,
        message: failure.message,
      })
    );
  }

  private async completeOwnedDelivery(
    executor: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    delivery: ClaimedDelivery,
    patch: {
      status: 'succeeded' | 'dead' | 'pending';
      lastError: string | null;
    }
  ): Promise<boolean> {
    const result =
      patch.status === 'pending'
        ? await sql`
            UPDATE ${this.table('domain_event_delivery')}
            SET
              status = 'pending',
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = ${patch.lastError},
              next_attempt_at = now() + interval '1 seconds'
            WHERE id = ${delivery.id}
              AND lease_token = ${delivery.leaseToken}
              AND status = 'processing'
              AND lease_expires_at > now()
          `.execute(executor)
        : await sql`
            UPDATE ${this.table('domain_event_delivery')}
            SET
              status = ${patch.status},
              lease_token = NULL,
              lease_expires_at = NULL,
              last_error = ${patch.lastError}
            WHERE id = ${delivery.id}
              AND lease_token = ${delivery.leaseToken}
              AND status = 'processing'
              AND lease_expires_at > now()
          `.execute(executor);
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  private async settleOutboxIfTerminal(
    executor: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    eventId: string
  ): Promise<void> {
    await sql`
      UPDATE ${this.table('domain_event_outbox')} AS outbox
      SET
        settled = CASE
          WHEN EXISTS (
            SELECT 1 FROM ${this.table('domain_event_delivery')} delivery
            WHERE delivery.event_id = outbox.id AND delivery.status = 'dead'
          ) THEN 'partial_failed'
          ELSE 'succeeded'
        END,
        settled_at = now()
      WHERE outbox.id = ${eventId}
        AND NOT EXISTS (
          SELECT 1 FROM ${this.table('domain_event_delivery')} delivery
          WHERE delivery.event_id = ${eventId}
            AND delivery.status NOT IN ('succeeded', 'cancelled', 'dead')
        )
    `.execute(executor);
  }

  private async reconcileUnsettled(executor: Transaction<V1TeableDatabase>): Promise<number> {
    const result = await sql`
      WITH candidates AS MATERIALIZED (
        SELECT outbox.id
        FROM ${this.table('domain_event_outbox')} AS outbox
        WHERE outbox.settled IS NULL
          AND NOT outbox.unpublished
          AND EXISTS (
            SELECT 1 FROM ${this.table('domain_event_delivery')} delivery
            WHERE delivery.event_id = outbox.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${this.table('domain_event_delivery')} delivery
            WHERE delivery.event_id = outbox.id
              AND delivery.status NOT IN ('succeeded', 'cancelled', 'dead')
          )
        ORDER BY outbox.id
        LIMIT ${DOMAIN_EVENT_RECONCILE_BATCH}
        FOR UPDATE OF outbox SKIP LOCKED
      )
      UPDATE ${this.table('domain_event_outbox')} AS outbox
      SET
        settled = CASE
          WHEN EXISTS (
            SELECT 1 FROM ${this.table('domain_event_delivery')} delivery
            WHERE delivery.event_id = outbox.id AND delivery.status = 'dead'
          ) THEN 'partial_failed'
          ELSE 'succeeded'
        END,
        settled_at = COALESCE(outbox.settled_at, now())
      FROM candidates
      WHERE outbox.id = candidates.id
    `.execute(executor);
    return Number(result.numAffectedRows ?? 0);
  }

  private async purgeSettled(executor: Transaction<V1TeableDatabase>): Promise<number> {
    const deleted = await sql<{ count: string | number }>`
      WITH modern AS MATERIALIZED (
        SELECT id, settled_at AS expiry_time
        FROM ${this.table('domain_event_outbox')}
        WHERE settled IS NOT NULL
          AND settled_at < now() - (${DOMAIN_EVENT_RETENTION_DAYS} * interval '1 day')
        ORDER BY settled_at
        LIMIT ${DOMAIN_EVENT_PURGE_BATCH}
        FOR UPDATE SKIP LOCKED
      ),
      legacy AS MATERIALIZED (
        SELECT id, created_at AS expiry_time
        FROM ${this.table('domain_event_outbox')}
        WHERE settled IS NOT NULL
          AND settled_at IS NULL
          AND created_at < now() - (${DOMAIN_EVENT_RETENTION_DAYS} * interval '1 day')
        ORDER BY created_at
        LIMIT ${DOMAIN_EVENT_PURGE_BATCH}
        FOR UPDATE SKIP LOCKED
      ),
      expired AS MATERIALIZED (
        SELECT id
        FROM (
          SELECT id, expiry_time FROM modern
          UNION ALL
          SELECT id, expiry_time FROM legacy
        ) AS branches
        ORDER BY expiry_time, id
        LIMIT ${DOMAIN_EVENT_PURGE_BATCH}
      ),
      deleted_inbox AS (
        DELETE FROM ${this.table('domain_event_inbox')} inbox
        USING expired
        WHERE inbox.event_id = expired.id
      ),
      deleted_delivery AS (
        DELETE FROM ${this.table('domain_event_delivery')} delivery
        USING expired
        WHERE delivery.event_id = expired.id
      ),
      deleted_outbox AS (
        DELETE FROM ${this.table('domain_event_outbox')} outbox
        USING expired
        WHERE outbox.id = expired.id
        RETURNING 1
      )
      SELECT COUNT(*) AS count FROM deleted_outbox
    `.execute(executor);
    return Number(deleted.rows[0]?.count ?? 0);
  }
}
