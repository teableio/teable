import type { Result } from 'neverthrow';

import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

export interface ITableSchemaRepository {
  insert(context: IExecutionContext, table: Table): Promise<Result<void, string>>;
  update(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>>;
  delete(context: IExecutionContext, table: Table): Promise<Result<void, string>>;
}
