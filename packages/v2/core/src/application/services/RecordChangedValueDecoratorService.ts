import { injectable } from '@teable/v2-di';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';

export interface IRecordChangedValueDecoratorService {
  decorateChangedFields(
    table: Table,
    changedFields?: ReadonlyMap<string, unknown>,
    previousFields?: Record<string, unknown>
  ): Promise<Result<ReadonlyMap<string, unknown> | undefined, DomainError>>;

  decorateChangedFieldsByRecord(
    table: Table,
    changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ): Promise<Result<ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined, DomainError>>;
}

@injectable()
export class NullRecordChangedValueDecoratorService implements IRecordChangedValueDecoratorService {
  async decorateChangedFields(
    _table: Table,
    changedFields?: ReadonlyMap<string, unknown>,
    _previousFields?: Record<string, unknown>
  ): Promise<Result<ReadonlyMap<string, unknown> | undefined, DomainError>> {
    return ok(changedFields);
  }

  async decorateChangedFieldsByRecord(
    _table: Table,
    changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ): Promise<Result<ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined, DomainError>> {
    return ok(changedFieldsByRecord);
  }
}
