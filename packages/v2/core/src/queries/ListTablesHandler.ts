import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListTablesQuery } from './ListTablesQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class ListTablesResult {
  private constructor(readonly tables: ReadonlyArray<Table>) {}

  static create(tables: ReadonlyArray<Table>): ListTablesResult {
    return new ListTablesResult(tables);
  }
}

@QueryHandler(ListTablesQuery)
@injectable()
export class ListTablesHandler implements IQueryHandler<ListTablesQuery, ListTablesResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListTablesQuery
  ): Promise<Result<ListTablesResult, DomainError>> {
    const handler = this;
    return safeTry<ListTablesResult, DomainError>(async function* () {
      const specBuilder = TableAggregate.specs(query.baseId);
      if (query.nameQuery) {
        specBuilder.byNameLike(query.nameQuery);
      }

      const spec = yield* specBuilder.build();
      const table = yield* await handler.tableRepository.find(context, spec, {
        sort: query.sort,
        pagination: query.pagination,
      });

      return ok(ListTablesResult.create(table));
    });
  }
}
