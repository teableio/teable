import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import { Table } from '../domain/table/Table';
import type { View } from '../domain/table/views/View';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { ListFieldsQuery } from './ListFieldsQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class ListFieldsResult {
  private constructor(
    readonly fields: ReadonlyArray<Field>,
    readonly primaryFieldId: FieldId,
    readonly view?: View
  ) {}

  static create(
    fields: ReadonlyArray<Field>,
    primaryFieldId: FieldId,
    view?: View
  ): ListFieldsResult {
    return new ListFieldsResult(fields, primaryFieldId, view);
  }
}

@QueryHandler(ListFieldsQuery)
@injectable()
export class ListFieldsHandler implements IQueryHandler<ListFieldsQuery, ListFieldsResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async handle(
    context: IExecutionContext,
    query: ListFieldsQuery
  ): Promise<Result<ListFieldsResult, DomainError>> {
    const logger = this.logger.scope('query', { name: ListFieldsHandler.name }).child({
      tableId: query.tableId.toString(),
    });
    logger.debug('ListFieldsHandler.start', { actorId: context.actorId.toString() });

    const specBuilder = Table.specs().byId(query.tableId);
    if (query.viewId) specBuilder.withViewId(query.viewId);
    const specResult = specBuilder.build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        if (query.viewId) {
          return err(
            domainError.notFound({
              code: 'view.not_found',
              message: `View not found: ${query.viewId.toString()}`,
            })
          );
        }
        return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
      }
      return err(tableResult.error);
    }

    const fields = tableResult.value.getFields();
    const viewResult = query.viewId ? tableResult.value.getView(query.viewId) : undefined;
    if (viewResult?.isErr()) return err(viewResult.error);
    logger.debug('ListFieldsHandler.success', { count: fields.length });
    return ok(
      ListFieldsResult.create(
        fields,
        tableResult.value.primaryFieldId(),
        viewResult?.isOk() ? viewResult.value : undefined
      )
    );
  }
}
