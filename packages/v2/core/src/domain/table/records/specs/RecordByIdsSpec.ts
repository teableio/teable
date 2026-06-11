import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { RecordId } from '../RecordId';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';

export class RecordByIdsSpec<
  V extends ITableRecordConditionSpecVisitor = ITableRecordConditionSpecVisitor,
> implements ISpecification<TableRecord, V>
{
  private constructor(private readonly recordIdsValue: ReadonlyArray<RecordId>) {}

  static create(recordIds: ReadonlyArray<RecordId>): RecordByIdsSpec {
    return new RecordByIdsSpec(recordIds);
  }

  recordIds(): ReadonlyArray<RecordId> {
    return this.recordIdsValue;
  }

  isSatisfiedBy(r: TableRecord): boolean {
    return this.recordIdsValue.some((recordId) => r.id().equals(recordId));
  }

  mutate(r: TableRecord): Result<TableRecord, DomainError> {
    return ok(r);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitRecordByIds(this).map(() => undefined);
  }
}
