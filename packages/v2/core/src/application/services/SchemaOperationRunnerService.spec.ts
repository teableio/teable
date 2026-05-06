import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ISchemaOperationRepository,
  SchemaOperationAdvanceInput,
  SchemaOperationClaimInput,
  SchemaOperationRecord,
} from '../../ports/SchemaOperationRepository';
import {
  SchemaOperationRunnerService,
  type ISchemaOperationHandler,
} from './SchemaOperationRunnerService';

const context = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
  requestId: 'req-runner',
});

const operation = (overrides: Partial<SchemaOperationRecord> = {}): SchemaOperationRecord => ({
  id: 'sgoRunner000000001',
  type: 'table.create',
  status: 'pending',
  phase: 'metadata_pending',
  target: {
    resourceType: 'table',
    resourceId: 'tblRunner000000001',
    tableId: 'tblRunner000000001',
  },
  idempotencyKey: 'req-runner:table:tblRunner000000001',
  attempts: 0,
  maxAttempts: 8,
  nextRunAt: new Date('2026-04-28T00:00:00.000Z'),
  lockedAt: null,
  lockedBy: null,
  lastError: null,
  createdTime: new Date('2026-04-28T00:00:00.000Z'),
  createdBy: 'system',
  lastModifiedTime: null,
  lastModifiedBy: null,
  ...overrides,
});

class FakeSchemaOperationRepository implements ISchemaOperationRepository {
  readonly claimNextRunnable = vi.fn(
    async (
      _: IExecutionContext,
      __: SchemaOperationClaimInput
    ): Promise<Result<SchemaOperationRecord | undefined, DomainError>> => ok(this.nextOperation)
  );

  readonly advance = vi.fn(
    async (
      _: IExecutionContext,
      __: string,
      input: SchemaOperationAdvanceInput
    ): Promise<Result<SchemaOperationRecord, DomainError>> =>
      ok({
        ...(this.nextOperation ?? operation()),
        status: input.status,
        phase: input.phase,
        result: input.result,
        lastError: input.lastError ?? null,
        nextRunAt: input.nextRunAt ?? new Date('2026-04-28T00:00:00.000Z'),
      })
  );

  constructor(private readonly nextOperation?: SchemaOperationRecord) {}

  async upsert(): Promise<Result<SchemaOperationRecord, DomainError>> {
    return ok(this.nextOperation ?? operation());
  }

  async list(): Promise<
    Result<{ items: ReadonlyArray<SchemaOperationRecord>; total: number }, DomainError>
  > {
    const item = this.nextOperation ?? operation();
    return ok({ items: [item], total: 1 });
  }

  async manualRetry(): Promise<Result<SchemaOperationRecord, DomainError>> {
    return ok(this.nextOperation ?? operation());
  }

  async markDead(): Promise<Result<SchemaOperationRecord, DomainError>> {
    return ok(this.nextOperation ?? operation());
  }
}

describe('SchemaOperationRunnerService', () => {
  it('does not claim operations when no handlers are registered', async () => {
    const repository = new FakeSchemaOperationRepository(operation());
    const runner = new SchemaOperationRunnerService(repository, []);

    const result = await runner.runNext(context());

    expect(result._unsafeUnwrap()).toEqual({ status: 'idle', reason: 'no_handler' });
    expect(repository.claimNextRunnable).not.toHaveBeenCalled();
  });

  it('claims supported operation types and marks successful operations ready', async () => {
    const repository = new FakeSchemaOperationRepository(operation());
    const handler: ISchemaOperationHandler = {
      type: 'table.create',
      run: vi.fn(async () => ok({ result: { repaired: true } })),
    };
    const now = new Date('2026-04-28T01:00:00.000Z');
    const runner = new SchemaOperationRunnerService(repository, [handler]);

    const result = await runner.runNext(context(), { workerId: 'repair-worker', now });

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'completed' });
    expect(repository.claimNextRunnable).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        lockedBy: 'repair-worker',
        now,
        types: ['table.create'],
      })
    );
    expect(repository.advance).toHaveBeenCalledWith(
      expect.any(Object),
      'req-runner:table:tblRunner000000001',
      expect.objectContaining({
        phase: 'ready',
        result: { repaired: true },
        status: 'ready',
      })
    );
  });

  it('marks exhausted failures dead', async () => {
    const repository = new FakeSchemaOperationRepository(
      operation({ attempts: 7, maxAttempts: 8 })
    );
    const failure = domainError.infrastructure({ message: 'data repair failed' });
    const handler: ISchemaOperationHandler = {
      type: 'table.create',
      run: vi.fn(async () => err(failure)),
    };
    const runner = new SchemaOperationRunnerService(repository, [handler]);

    const result = await runner.runNext(context(), {
      now: new Date('2026-04-28T01:00:00.000Z'),
    });

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'failed',
      terminal: true,
      retryable: true,
    });
    expect(repository.advance).toHaveBeenCalledWith(
      expect.any(Object),
      'req-runner:table:tblRunner000000001',
      expect.objectContaining({
        lastError: 'data repair failed',
        phase: 'error',
        status: 'dead',
      })
    );
  });

  it('schedules retryable failures with backoff while attempts remain', async () => {
    const repository = new FakeSchemaOperationRepository(
      operation({ attempts: 1, maxAttempts: 8 })
    );
    const failure = domainError.infrastructure({ message: 'database temporarily unavailable' });
    const handler: ISchemaOperationHandler = {
      type: 'table.create',
      run: vi.fn(async () => err(failure)),
    };
    const now = new Date('2026-04-28T01:00:00.000Z');
    const runner = new SchemaOperationRunnerService(repository, [handler]);

    const result = await runner.runNext(context(), { now });

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'failed',
      terminal: false,
      retryable: true,
    });
    expect(repository.advance).toHaveBeenCalledWith(
      expect.any(Object),
      'req-runner:table:tblRunner000000001',
      expect.objectContaining({
        lastError: 'database temporarily unavailable',
        phase: 'error',
        status: 'error',
        nextRunAt: new Date('2026-04-28T01:00:02.000Z'),
      })
    );
  });

  it('marks non-retryable failures dead immediately', async () => {
    const repository = new FakeSchemaOperationRepository(
      operation({ attempts: 1, maxAttempts: 8 })
    );
    const failure = domainError.notImplemented({
      code: 'schema_operation.repair_not_supported',
      message: 'Schema operation with records requires durable record replay payload',
    });
    const handler: ISchemaOperationHandler = {
      type: 'table.create',
      run: vi.fn(async () => err(failure)),
    };
    const now = new Date('2026-04-28T01:00:00.000Z');
    const runner = new SchemaOperationRunnerService(repository, [handler]);

    const result = await runner.runNext(context(), { now });

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'failed',
      terminal: true,
      retryable: false,
    });
    expect(repository.advance).toHaveBeenCalledWith(
      expect.any(Object),
      'req-runner:table:tblRunner000000001',
      expect.objectContaining({
        lastError: 'Schema operation with records requires durable record replay payload',
        phase: 'error',
        status: 'dead',
        nextRunAt: now,
      })
    );
  });
});
