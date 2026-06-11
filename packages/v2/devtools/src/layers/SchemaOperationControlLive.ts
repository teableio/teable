import {
  ActorId,
  type ISchemaOperationRepository,
  type SchemaOperationRecord,
  type SchemaOperationSelector,
  type SchemaOperationStatus,
  v2CoreTokens,
} from '@teable/v2-core';
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  SchemaOperationControl,
  type ListSchemaOperationsInput,
  type MarkSchemaOperationDeadInput,
  type RetrySchemaOperationInput,
  type SchemaOperationRow,
  type SchemaOperationTable,
} from '../services/SchemaOperationControl';

const defaultStatuses: ReadonlyArray<SchemaOperationStatus> = [
  'pending',
  'running',
  'error',
  'dead',
];
const defaultLimit = 100;

const createContext = () => {
  const actorIdResult = ActorId.create('cli-schema-operation');
  if (actorIdResult.isErr()) {
    throw CliError.fromUnknown(actorIdResult.error);
  }
  return { actorId: actorIdResult.value };
};

const toIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const makeTable = <Row>(
  columns: ReadonlyArray<keyof Row & string>,
  rows: ReadonlyArray<Row>
): SchemaOperationTable<Row> => ({ columns, rows });

const toRow = (operation: SchemaOperationRecord): SchemaOperationRow => ({
  id: operation.id,
  type: operation.type,
  status: operation.status,
  phase: operation.phase,
  resourceType: operation.target.resourceType,
  resourceId: operation.target.resourceId,
  baseId: operation.target.baseId ?? null,
  tableId: operation.target.tableId ?? null,
  idempotencyKey: operation.idempotencyKey,
  attempts: operation.attempts,
  maxAttempts: operation.maxAttempts,
  nextRunAt: operation.nextRunAt.toISOString(),
  lockedAt: toIso(operation.lockedAt),
  lockedBy: operation.lockedBy ?? null,
  lastError: operation.lastError ?? null,
  createdAt: operation.createdTime.toISOString(),
  updatedAt: toIso(operation.lastModifiedTime),
});

const selectorFromInput = (input: {
  operationId?: string;
  idempotencyKey?: string;
}): SchemaOperationSelector => {
  if (input.operationId && input.idempotencyKey) {
    throw new CliError({
      message: 'Use either --operation-id or --idempotency-key, not both',
      code: 'INVALID_SELECTOR',
    });
  }
  if (input.operationId) {
    return { id: input.operationId };
  }
  if (input.idempotencyKey) {
    return { idempotencyKey: input.idempotencyKey };
  }
  throw new CliError({
    message: 'Missing schema operation selector: provide --operation-id or --idempotency-key',
    code: 'MISSING_SELECTOR',
  });
};

export const SchemaOperationControlLive = Layer.effect(
  SchemaOperationControl,
  Effect.gen(function* () {
    const { container } = yield* Database;
    const repository = container.resolve(
      v2CoreTokens.schemaOperationRepository
    ) as ISchemaOperationRepository;

    return {
      listOperations: (input: ListSchemaOperationsInput) =>
        Effect.tryPromise({
          try: async () => {
            const statuses = input.statuses?.length ? input.statuses : defaultStatuses;
            const limit = input.limit ?? defaultLimit;
            const offset = input.offset ?? 0;
            const result = await repository.list(createContext(), {
              statuses,
              types: input.types,
              baseIds: input.baseIds,
              tableIds: input.tableIds,
              resourceIds: input.resourceIds,
              limit,
              offset,
            });
            if (result.isErr()) throw result.error;
            const rows = result.value.items.map(toRow);

            return {
              snapshotAt: new Date().toISOString(),
              scope: {
                statuses,
                ...(input.types?.length ? { types: input.types } : {}),
                ...(input.baseIds?.length ? { baseIds: input.baseIds } : {}),
                ...(input.tableIds?.length ? { tableIds: input.tableIds } : {}),
                ...(input.resourceIds?.length ? { resourceIds: input.resourceIds } : {}),
                limit,
                offset,
              },
              total: result.value.total,
              operationTable: makeTable<SchemaOperationRow>(
                [
                  'id',
                  'type',
                  'status',
                  'phase',
                  'resourceType',
                  'resourceId',
                  'baseId',
                  'tableId',
                  'idempotencyKey',
                  'attempts',
                  'maxAttempts',
                  'nextRunAt',
                  'lockedAt',
                  'lockedBy',
                  'lastError',
                  'updatedAt',
                ],
                rows
              ),
              notes: [
                'Default listing includes pending, running, error, and dead operations; ready operations are hidden unless requested with --statuses.',
              ],
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),
      retryOperation: (input: RetrySchemaOperationInput) =>
        Effect.tryPromise({
          try: async () => {
            const resetAttempts = input.resetAttempts ?? true;
            const result = await repository.manualRetry(createContext(), {
              selector: selectorFromInput(input),
              resetAttempts,
              lastError: input.lastError,
            });
            if (result.isErr()) throw result.error;

            return {
              operation: toRow(result.value),
              resetAttempts,
              notes: [
                'Operation is now due in error state. The background runner can claim it on the next polling cycle.',
              ],
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),
      markDeadOperation: (input: MarkSchemaOperationDeadInput) =>
        Effect.tryPromise({
          try: async () => {
            const result = await repository.markDead(createContext(), {
              selector: selectorFromInput(input),
              reason: input.reason,
            });
            if (result.isErr()) throw result.error;

            return {
              operation: toRow(result.value),
              notes: [
                'Operation is terminal and will not be claimed by the background runner unless retried manually.',
              ],
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),
    };
  })
);
