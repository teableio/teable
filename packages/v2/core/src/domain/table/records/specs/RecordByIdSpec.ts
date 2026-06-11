import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { RecordId } from '../RecordId';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';

export class RecordByIdSpec<
  V extends ITableRecordConditionSpecVisitor = ITableRecordConditionSpecVisitor,
> implements ISpecification<TableRecord, V>
{
  private constructor(private readonly recordIdValue: RecordId) {}

  static create(recordId: RecordId): RecordByIdSpec {
    return new RecordByIdSpec(recordId);
  }

  recordId(): RecordId {
    return this.recordIdValue;
  }

  isSatisfiedBy(r: TableRecord): boolean {
    return r.id().equals(this.recordIdValue);
  }

  mutate(r: TableRecord): Result<TableRecord, DomainError> {
    return ok(r);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitRecordById(this).map(() => undefined);
  }
}
