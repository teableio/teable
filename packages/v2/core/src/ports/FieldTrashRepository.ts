import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
export interface FieldTrashRecordSnapshot {
  readonly id: string;
  readonly fields?: Readonly<Record<string, unknown>> | null;
}

export interface FieldTrashSnapshot {
  readonly trashId: string;
  readonly tableId: string;
  readonly fields: ReadonlyArray<unknown>;
  readonly records: ReadonlyArray<FieldTrashRecordSnapshot>;
}

export interface IFieldTrashRepository {
  getFieldTrash(
    context: IExecutionContext,
    tableId: string,
    trashId: string
  ): Promise<Result<FieldTrashSnapshot, DomainError>>;

  deleteFieldTrash(
    context: IExecutionContext,
    tableId: string,
    trashId: string
  ): Promise<Result<void, DomainError>>;
}
