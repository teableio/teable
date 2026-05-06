import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  domainError,
  isDomainError,
  type DomainError,
  type DomainErrorTag,
} from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as SchemaOperationRepositoryPort from '../../ports/SchemaOperationRepository';
import type {
  SchemaOperationPhase,
  SchemaOperationRecord,
  SchemaOperationStatus,
  SchemaOperationType,
} from '../../ports/SchemaOperationRepository';
import { v2CoreTokens } from '../../ports/tokens';

export type SchemaOperationHandlerResult = {
  phase?: SchemaOperationPhase;
  result?: unknown;
};

export interface ISchemaOperationHandler {
  readonly type: SchemaOperationType | ReadonlyArray<SchemaOperationType>;
  run(
    context: IExecutionContext,
    operation: SchemaOperationRecord
  ): Promise<Result<SchemaOperationHandlerResult | void, DomainError>>;
}

export type SchemaOperationRunnerOptions = {
  workerId?: string;
  now?: Date;
  staleRunningBefore?: Date;
};

export type SchemaOperationRunNextResult =
  | {
      status: 'idle';
      reason: 'no_handler' | 'unsupported' | 'empty';
    }
  | {
      status: 'completed';
      operation: SchemaOperationRecord;
    }
  | {
      status: 'failed';
      operation: SchemaOperationRecord;
      terminal: boolean;
      retryable: boolean;
      error: DomainError;
    };

const retryDelayMs = (attempts: number): number => Math.min(60_000, 1_000 * 2 ** attempts);
const nonRetryableTags = new Set<DomainErrorTag>([
  'validation',
  'conflict',
  'not-found',
  'invariant',
  'not-implemented',
  'unauthorized',
  'forbidden',
]);
const nonRetryableCodes = new Set(['schema_operation.repair_not_supported']);

const handlerTypes = (handler: ISchemaOperationHandler): ReadonlyArray<SchemaOperationType> =>
  Array.isArray(handler.type) ? handler.type : [handler.type];

const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

const isRetryableFailure = (error: DomainError): boolean => {
  if (nonRetryableCodes.has(error.code)) return false;
  return !error.tags.some((tag) => nonRetryableTags.has(tag));
};

@injectable()
export class SchemaOperationRunnerService {
  constructor(
    @inject(v2CoreTokens.schemaOperationRepository)
    private readonly schemaOperationRepository: SchemaOperationRepositoryPort.ISchemaOperationRepository,
    @inject(v2CoreTokens.schemaOperationHandlers)
    private readonly handlers: ReadonlyArray<ISchemaOperationHandler>
  ) {}

  async runNext(
    context: IExecutionContext,
    options: SchemaOperationRunnerOptions = {}
  ): Promise<Result<SchemaOperationRunNextResult, DomainError>> {
    const repository = this.schemaOperationRepository;
    if (!repository.claimNextRunnable) {
      return ok({ status: 'idle', reason: 'unsupported' });
    }

    const claimTypes = [...new Set(this.handlers.flatMap((handler) => handlerTypes(handler)))];
    if (claimTypes.length === 0) {
      return ok({ status: 'idle', reason: 'no_handler' });
    }

    const now = options.now ?? new Date();
    const claimed = await repository.claimNextRunnable(context, {
      lockedBy: options.workerId ?? context.requestId ?? context.actorId.toString(),
      now,
      staleRunningBefore: options.staleRunningBefore,
      types: claimTypes,
    });
    if (claimed.isErr()) {
      return err(claimed.error);
    }
    const operation = claimed.value;
    if (!operation) {
      return ok({ status: 'idle', reason: 'empty' });
    }

    const handler = this.handlers.find((handler) => handlerTypes(handler).includes(operation.type));
    if (!handler) {
      return ok({ status: 'idle', reason: 'no_handler' });
    }

    const handlerResult = await invokeHandler(handler, context, operation);
    if (handlerResult.isErr()) {
      const failed = await markOperationFailed(
        repository,
        context,
        operation,
        handlerResult.error,
        now
      );
      if (failed.isErr()) {
        return err(failed.error);
      }
      return ok({
        status: 'failed',
        operation: failed.value.operation,
        terminal: failed.value.terminal,
        retryable: failed.value.retryable,
        error: handlerResult.error,
      });
    }

    const value = handlerResult.value ?? {};
    const completed = await repository.advance(context, operation.idempotencyKey, {
      status: 'ready',
      phase: value.phase ?? 'ready',
      result: value.result,
      nextRunAt: now,
    });
    if (completed.isErr()) {
      return err(completed.error);
    }
    return ok({ status: 'completed', operation: completed.value });
  }
}

const invokeHandler = async (
  handler: ISchemaOperationHandler,
  context: IExecutionContext,
  operation: SchemaOperationRecord
): Promise<Result<SchemaOperationHandlerResult | void, DomainError>> => {
  try {
    return await handler.run(context, operation);
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Schema operation handler threw: ${describeError(error)}`,
      })
    );
  }
};

const markOperationFailed = async (
  repository: SchemaOperationRepositoryPort.ISchemaOperationRepository,
  context: IExecutionContext,
  operation: SchemaOperationRecord,
  error: DomainError,
  now: Date
): Promise<
  Result<{ operation: SchemaOperationRecord; terminal: boolean; retryable: boolean }, DomainError>
> => {
  const retryable = isRetryableFailure(error);
  const nextAttempt = operation.attempts + 1;
  const terminal = !retryable || nextAttempt >= operation.maxAttempts;
  const status: SchemaOperationStatus = terminal ? 'dead' : 'error';
  const nextRunAt = terminal ? now : new Date(now.getTime() + retryDelayMs(operation.attempts));
  const advanced = await repository.advance(context, operation.idempotencyKey, {
    status,
    phase: 'error',
    lastError: error.message,
    nextRunAt,
  });
  if (advanced.isErr()) {
    return err(advanced.error);
  }
  return ok({ operation: advanced.value, terminal, retryable });
};
