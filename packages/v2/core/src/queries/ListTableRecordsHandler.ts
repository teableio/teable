import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../domain/base/BaseId';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { LinkForeignTableReferenceVisitor } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';
import { buildRecordConditionSpec } from './RecordFilterMapper';

export class ListTableRecordsResult {
  private constructor(readonly records: ReadonlyArray<TableRecordReadModel>) {}

  static create(records: ReadonlyArray<TableRecordReadModel>): ListTableRecordsResult {
    return new ListTableRecordsResult(records);
  }
}

@QueryHandler(ListTableRecordsQuery)
@injectable()
export class ListTableRecordsHandler
  implements IQueryHandler<ListTableRecordsQuery, ListTableRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListTableRecordsQuery
  ): Promise<Result<ListTableRecordsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: ListTableRecordsHandler.name }).child({
      baseId: query.baseId.toString(),
      tableId: query.tableId.toString(),
    });
    logger.debug('ListTableRecordsHandler.start', { actorId: context.actorId.toString() });

    return safeTry<ListTableRecordsResult, DomainError>(
      async function* (this: ListTableRecordsHandler) {
        // 1. Load main table
        const tableSpec = yield* TableAggregate.specs(query.baseId).byId(query.tableId).build();
        const table = yield* (await this.tableRepository.findOne(context, tableSpec)).mapErr(
          (error: DomainError) =>
            isNotFoundError(error)
              ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
              : error
        );

        // 2. Load foreign tables for link/lookup/rollup fields
        const foreignTables = yield* await this.loadForeignTables(context, query.baseId, table);

        // 3. Build filter spec
        const filterSpec = query.filter
          ? yield* buildRecordConditionSpec(table, query.filter)
          : undefined;

        // 4. Query records
        const records = yield* await this.tableRecordQueryRepository.find(
          context,
          table,
          filterSpec,
          { foreignTables }
        );

        logger.debug('ListTableRecordsHandler.success', { count: records.length });
        return ok(ListTableRecordsResult.create(records));
      }.bind(this)
    );
  }

  private async loadForeignTables(
    context: IExecutionContext,
    baseId: BaseId,
    table: Table
  ): Promise<Result<ReadonlyMap<string, Table>, DomainError>> {
    return safeTry<ReadonlyMap<string, Table>, DomainError>(
      async function* (this: ListTableRecordsHandler) {
        const refs = yield* new LinkForeignTableReferenceVisitor().collect(table.getFields());
        if (refs.length === 0) return ok(new Map<string, Table>());

        const foreignTables = new Map<string, Table>();

        for (const ref of refs) {
          // Self-referential: reuse same table
          if (ref.foreignTableId.equals(table.id())) {
            foreignTables.set(ref.foreignTableId.toString(), table);
            continue;
          }

          const spec = yield* TableAggregate.specs(baseId).byId(ref.foreignTableId).build();
          const foreignTable = yield* (await this.tableRepository.findOne(context, spec)).mapErr(
            (error: DomainError) =>
              isNotFoundError(error)
                ? domainError.notFound({
                    code: 'foreign_table.not_found',
                    message: `Foreign table not found: ${ref.foreignTableId.toString()}`,
                  })
                : error
          );
          foreignTables.set(ref.foreignTableId.toString(), foreignTable);
        }

        return ok(foreignTables as ReadonlyMap<string, Table>);
      }.bind(this)
    );
  }
}
