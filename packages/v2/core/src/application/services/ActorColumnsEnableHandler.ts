import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ActorColumnsTarget,
  ISchemaOperationRepository,
  SchemaOperationRecord,
} from '../../ports/SchemaOperationRepository';
import type { ITableRepository } from '../../ports/TableRepository';
import type { ITableSchemaCoordination } from '../../ports/TableSchemaCoordination';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork } from '../../ports/UnitOfWork';
import type {
  ISchemaOperationHandler,
  SchemaOperationHandlerResult,
} from './SchemaOperationRunnerService';

const targetSchema = z
  .object({
    baseId: z.string(),
    tableId: z.string(),
    dbTableName: z.string(),
    connectionId: z.string().nullable(),
    internalSchema: z.string().nullable(),
    storageEpoch: z.string(),
    tableVersion: z.number().int(),
    runtimeRouteKey: z.string(),
  })
  .strict();

/** Only this handler owns capability publication; the generic runner must not advance it. */
export class ActorColumnsEnableHandler implements ISchemaOperationHandler {
  readonly type = 'table.actor_columns.enable';

  constructor(
    private readonly operations: ISchemaOperationRepository,
    private readonly tables: ITableRepository,
    private readonly schema: ITableSchemaRepository,
    private readonly coordination: ITableSchemaCoordination,
    private readonly unitOfWork: IUnitOfWork,
    private readonly runtimeRouteKey: string,
    private readonly onPublished?: (
      context: IExecutionContext,
      target: ActorColumnsTarget
    ) => Promise<void>
  ) {}

  async run(
    context: IExecutionContext,
    operation: SchemaOperationRecord
  ): Promise<Result<SchemaOperationHandlerResult, DomainError>> {
    const parsed = targetSchema.safeParse(operation.payload);
    if (
      !parsed.success ||
      !this.operations.getActorColumnsTarget ||
      !this.operations.completeActorColumns
    ) {
      return err(
        domainError.conflict({
          code: 'actor_columns.target_invalid',
          message: 'Record attribution target is invalid or unsupported',
        })
      );
    }
    const target = parsed.data;
    if (
      operation.target.tableId !== target.tableId ||
      operation.target.baseId !== target.baseId ||
      operation.idempotencyKey !== `table:${target.tableId}:actor_columns:v1` ||
      target.runtimeRouteKey !== this.runtimeRouteKey
    ) {
      return err(
        domainError.conflict({
          code: 'actor_columns.route_mismatch',
          message: 'Record attribution target database binding changed',
        })
      );
    }
    const acquired = await this.coordination.acquire(context, [target.tableId], 'exclusive');
    if (acquired.isErr()) return err(acquired.error);
    const lease = acquired.value;
    try {
      if (!lease.fence || !lease.assertHeld) {
        return err(
          domainError.conflict({
            code: 'actor_columns.lease_unfenced',
            message: 'Record attribution requires a fenced schema lease',
          })
        );
      }
      const current = await this.operations.getActorColumnsTarget(
        context,
        target.baseId,
        target.tableId,
        this.runtimeRouteKey
      );
      if (current.isErr()) return err(current.error);
      if (
        Object.keys(target).some(
          (key) => target[key as keyof typeof target] !== current.value[key as keyof typeof target]
        )
      ) {
        return err(
          domainError.conflict({
            code: 'actor_columns.route_mismatch',
            message: 'Record attribution target database binding changed',
          })
        );
      }
      const id = TableId.create(target.tableId);
      if (id.isErr()) return err(id.error);
      const spec = Table.specs().byId(id.value).build();
      if (spec.isErr()) return err(spec.error);
      const table = await this.tables.findOne(context, spec.value);
      if (table.isErr()) return err(table.error);
      const physical = table.value.dbTableName().andThen((name) => name.value());
      if (physical.isErr()) return err(physical.error);
      if (
        physical.value !== target.dbTableName ||
        table.value.baseId().toString() !== target.baseId
      ) {
        return err(
          domainError.conflict({
            code: 'actor_columns.route_mismatch',
            message: 'Record attribution target table binding changed',
          })
        );
      }
      const held = await lease.assertHeld();
      if (held.isErr()) return err(held.error);
      // retry:false: unknown commit must remain disabled. A later operation retry
      // re-verifies the catalog under a new lease instead of guessing commit success.
      const ddl = await this.unitOfWork.withTransaction(
        context,
        (dataContext) => this.schema.ensureActorColumns(dataContext, table.value),
        { scope: 'data', retry: false }
      );
      if (ddl.isErr()) return err(ddl.error);
      const stillHeld = await lease.assertHeld();
      if (stillHeld.isErr()) return err(stillHeld.error);
      const completed = await this.unitOfWork.withTransaction(
        context,
        (metaContext) =>
          this.operations.completeActorColumns!(metaContext, {
            operation,
            target,
            leaseFence: lease.fence!,
          }),
        { scope: 'meta', retry: false }
      );
      if (completed.isOk() && this.onPublished) {
        try {
          await this.onPublished(context, target);
          if (this.operations.markActorColumnsNotified) {
            const acknowledged = await this.operations.markActorColumnsNotified(
              context,
              completed.value
            );
            if (acknowledged.isErr()) {
              return ok({
                managedCompletion: completed.value,
                result: { notificationPending: true },
              });
            }
          }
        } catch {
          // Capability + op completion are already committed. Notification cannot
          // reclassify that result; polling readers reload authoritative metadata.
          return ok({ managedCompletion: completed.value, result: { notificationPending: true } });
        }
      }
      return completed.isErr() ? err(completed.error) : ok({ managedCompletion: completed.value });
    } finally {
      await lease.release();
    }
  }
}
