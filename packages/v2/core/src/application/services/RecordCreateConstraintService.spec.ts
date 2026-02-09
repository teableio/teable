import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IRecordCreateConstraint } from '../../ports/RecordCreateConstraintService';
import { RecordCreateConstraintService } from './RecordCreateConstraintService';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

class FakeConstraint implements IRecordCreateConstraint {
  calls = 0;

  constructor(private readonly result: Result<void, DomainError>) {}

  async checkCreate(): Promise<Result<void, DomainError>> {
    this.calls += 1;
    return this.result;
  }
}

describe('RecordCreateConstraintService', () => {
  it('skips constraints when recordCount <= 0', async () => {
    const constraint = new FakeConstraint(
      err(
        domainError.validation({
          code: 'validation.record.limit',
          message: 'Limit exceeded',
        })
      )
    );
    const service = new RecordCreateConstraintService([constraint]);

    const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.checkCreate(createContext(), tableId, 0);

    expect(result.isOk()).toBe(true);
    expect(constraint.calls).toBe(0);
  });

  it('returns error when any constraint fails', async () => {
    const okConstraint = new FakeConstraint(ok(undefined));
    const errorConstraint = new FakeConstraint(
      err(
        domainError.validation({
          code: 'validation.record.limit',
          message: 'Limit exceeded',
        })
      )
    );
    const service = new RecordCreateConstraintService([okConstraint, errorConstraint]);

    const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.checkCreate(createContext(), tableId, 3);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.record.limit');
  });

  it('returns ok when all constraints pass', async () => {
    const service = new RecordCreateConstraintService([
      new FakeConstraint(ok(undefined)),
      new FakeConstraint(ok(undefined)),
    ]);

    const tableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.checkCreate(createContext(), tableId, 2);

    expect(result.isOk()).toBe(true);
  });
});
