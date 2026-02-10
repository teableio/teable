import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import type { ISpecification } from '../../../../shared/specification/ISpecification';
import type { TableRecord } from '../../TableRecord';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * No-op cell value spec.
 *
 * Used when an input targets a field that should be ignored (e.g., button fields).
 * It performs no mutation and produces no persistence operations.
 */
export class NoopCellValueSpec implements ISpecification<TableRecord, ICellValueSpecVisitor> {
  static create(): NoopCellValueSpec {
    return new NoopCellValueSpec();
  }

  isSatisfiedBy(_record: TableRecord): boolean {
    return true;
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return ok(record);
  }

  accept(_visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return ok(undefined);
  }
}
