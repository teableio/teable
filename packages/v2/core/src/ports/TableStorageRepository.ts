import type { Result } from 'neverthrow';
import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import type { DbTableName } from '../domain/table/DbTableName';
import type { TableId } from '../domain/table/TableId';
import type { IExecutionContext } from './ExecutionContext';

export const tableStorageRepositoryToken = Symbol.for('teable.v2.port.tableStorageRepository');
export type TableStorageRenameResult = {
  previousDbTableName: string;
  dbTableName: string;
  previousVersion: number;
  previousLastModifiedTime: string | null;
  previousLastModifiedBy: string | null;
  lastModifiedTime: string;
  lastModifiedBy: string;
};

/** Atomically publishes storage metadata after physical DDL, compensating routed DDL on failure. */
export interface ITableStorageRepository {
  rename(
    context: IExecutionContext,
    input: {
      baseId: BaseId;
      tableId: TableId;
      dbTableName: DbTableName;
    }
  ): Promise<Result<TableStorageRenameResult, DomainError>>;
}
