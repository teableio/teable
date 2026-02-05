import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { TableId } from '../domain/table/TableId';
import type { IExecutionContext } from './ExecutionContext';

export interface IRecordCreateConstraint {
  checkCreate(
    context: IExecutionContext,
    tableId: TableId,
    recordCount: number
  ): Promise<Result<void, DomainError>>;
}

export interface IRecordCreateConstraintService {
  register(constraint: IRecordCreateConstraint): void;

  checkCreate(
    context: IExecutionContext,
    tableId: TableId,
    recordCount: number
  ): Promise<Result<void, DomainError>>;
}
