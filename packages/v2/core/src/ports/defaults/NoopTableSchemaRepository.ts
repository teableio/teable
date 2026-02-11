/* eslint-disable @typescript-eslint/naming-convention */
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type { ITableSchemaRepository } from '../TableSchemaRepository';

export class NoopTableSchemaRepository implements ITableSchemaRepository {
  async insert(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
