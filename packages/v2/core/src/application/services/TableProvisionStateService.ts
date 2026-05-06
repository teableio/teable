import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ITableRepository,
  TableProvisionOperationOptions,
  TableProvisionState,
} from '../../ports/TableRepository';
import type { IUnitOfWork } from '../../ports/UnitOfWork';

export const setTableProvisionState = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  table: Table,
  state: TableProvisionState,
  operation?: TableProvisionOperationOptions
): Promise<Result<void, DomainError>> => {
  if (!tableRepository.setProvisionState) {
    return ok(undefined);
  }

  return unitOfWork.withTransaction(
    context,
    async (metaContext) => tableRepository.setProvisionState!(metaContext, table, state, operation),
    { scope: 'meta' }
  );
};

export const setTablesProvisionState = async (
  unitOfWork: IUnitOfWork,
  tableRepository: ITableRepository,
  context: IExecutionContext,
  tables: ReadonlyArray<Table>,
  state: TableProvisionState,
  operation?: TableProvisionOperationOptions
): Promise<Result<void, DomainError>> => {
  if (!tables.length || !tableRepository.setProvisionStateMany) {
    return ok(undefined);
  }

  return unitOfWork.withTransaction(
    context,
    async (metaContext) =>
      tableRepository.setProvisionStateMany!(metaContext, tables, state, operation),
    { scope: 'meta' }
  );
};
