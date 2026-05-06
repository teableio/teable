import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IExecutionContext } from './ExecutionContext';
import type { IFindOptions } from './RepositoryQuery';
import type {
  SchemaOperationPhase,
  SchemaOperationStatus,
  SchemaOperationType,
} from './SchemaOperationRepository';

export type TableQueryState = 'active' | 'deleted' | 'all';

export type TableFindOptions = IFindOptions<TableSortKey> & {
  state?: TableQueryState;
};

export type FieldVersionChange = {
  fieldId: string;
  oldVersion: number;
  newVersion: number;
};

export type ViewVersionChange = {
  viewId: string;
  oldVersion: number;
  newVersion: number;
};

export type TableUpdatePersistResult = {
  fieldVersionChanges?: ReadonlyArray<FieldVersionChange>;
  viewVersionChanges?: ReadonlyArray<ViewVersionChange>;
};

export type TableDeleteMode = 'soft' | 'permanent';
export type TableProvisionState = 'pending' | 'ready' | 'error' | 'deleting';

export type TableProvisionOperationOptions = {
  operationId?: string;
  idempotencyKey?: string;
  operationType?: SchemaOperationType;
  phase?: SchemaOperationPhase;
  status?: SchemaOperationStatus;
  payload?: unknown;
  result?: unknown;
  lastError?: string | null;
  maxAttempts?: number;
  nextRunAt?: Date;
};

export type TableDeleteOptions = {
  mode?: TableDeleteMode;
};

export interface ITableRepository {
  insert(context: IExecutionContext, table: Table): Promise<Result<Table, DomainError>>;
  insertMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>>;
  findOne(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: Pick<TableFindOptions, 'state'>
  ): Promise<Result<Table, DomainError>>;
  find(
    context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: TableFindOptions
  ): Promise<Result<ReadonlyArray<Table>, DomainError>>;
  // table identifies the row, mutateSpec drives update values via visitors.
  updateOne(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<TableUpdatePersistResult | void, DomainError>>;
  restore(context: IExecutionContext, table: Table): Promise<Result<void, DomainError>>;
  delete(
    context: IExecutionContext,
    table: Table,
    options?: TableDeleteOptions
  ): Promise<Result<void, DomainError>>;
  setProvisionState?(
    context: IExecutionContext,
    table: Table,
    state: TableProvisionState,
    operation?: TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>>;
  setProvisionStateMany?(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    state: TableProvisionState,
    operation?: TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>>;
}
