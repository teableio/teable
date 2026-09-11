import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordQueryPluginRunner } from '../application/services/RecordQueryPluginRunner';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import type { TableComputeActivitySnapshot } from '../ports/ComputedActivityReader';
import * as ComputeActivityReaderPort from '../ports/ComputedActivityReader';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import { RecordQueryOperationKind } from '../ports/RecordQueryPlugin';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { filterComputeActivitySnapshot } from './filterComputeActivitySnapshot';
import { GetComputeActivityQuery } from './GetComputeActivityQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetComputeActivityResult {
  private constructor(readonly snapshot: TableComputeActivitySnapshot) {}

  static create(snapshot: TableComputeActivitySnapshot): GetComputeActivityResult {
    return new GetComputeActivityResult(snapshot);
  }
}

@QueryHandler(GetComputeActivityQuery)
@injectable()
export class GetComputeActivityHandler
  implements IQueryHandler<GetComputeActivityQuery, GetComputeActivityResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.computedActivityReader)
    private readonly activityReader: ComputeActivityReaderPort.IComputedActivityReader,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.tableOperationPluginRunner)
    private readonly tableOperationPluginRunner: TableOperationPluginRunner,
    @inject(v2CoreTokens.recordQueryPluginRunner)
    private readonly recordQueryPluginRunner: RecordQueryPluginRunner
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetComputeActivityQuery
  ): Promise<Result<GetComputeActivityResult, DomainError>> {
    const logger = this.logger.scope('query', { name: GetComputeActivityHandler.name }).child({
      baseId: query.baseId.toString(),
      tableId: query.tableId.toString(),
    });
    logger.debug('GetComputeActivityHandler.start');

    const specResult = Table.specs(query.baseId).byId(query.tableId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
      }
      return err(tableResult.error);
    }

    const pluginExecutionResult = await this.tableOperationPluginRunner.prepare({
      kind: TableOperationKind.read,
      executionContext: context,
      payload: {
        baseId: query.baseId,
        table: tableResult.value,
      },
      isTransactionBound: false,
    });
    if (pluginExecutionResult.isErr()) return err(pluginExecutionResult.error);

    const guardResult = await pluginExecutionResult.value.guard();
    if (guardResult.isErr()) return err(guardResult.error);

    const readExecution = await this.recordQueryPluginRunner.prepare({
      kind: RecordQueryOperationKind.list,
      executionContext: context,
      table: tableResult.value,
      payload: {},
    });
    if (readExecution.isErr()) return err(readExecution.error);
    const readGuard = await readExecution.value.guard();
    if (readGuard.isErr()) return err(readGuard.error);
    const scope = readExecution.value.getScope();
    if (scope.isErr()) return err(scope.error);

    const readScope = scope.value;
    const restricted =
      readScope?.readableFieldIds || readScope?.fieldMasks?.length || readScope?.recordSpec;
    const masked = new Set(readScope?.fieldMasks?.map(({ fieldId }) => fieldId));
    const readableFieldIds = restricted
      ? tableResult.value
          .getFields()
          .map((field) => field.id().toString())
          .filter(
            (fieldId) =>
              !readScope?.recordSpec &&
              !masked.has(fieldId) &&
              (readScope?.readableFieldIds?.has(fieldId) ?? true)
          )
      : undefined;
    const result = await this.activityReader.getByTableId(
      context,
      query.tableId.toString(),
      query.baseId.toString(),
      {
        budgetMs: 2000,
        includePauseDiagnostics: true,
        ...(readableFieldIds === undefined ? {} : { readableFieldIds }),
      }
    );
    if (result.isErr()) return err(result.error);

    // Ensure baseId is populated when activity rows are empty.
    const snapshot =
      result.value.baseId || !query.baseId
        ? result.value
        : { ...result.value, baseId: query.baseId.toString() };

    logger.debug('GetComputeActivityHandler.success', {
      fieldCount: snapshot.fields.length,
      activeFieldCount: snapshot.diagnostics.activeFieldCount,
    });
    return ok(
      GetComputeActivityResult.create(filterComputeActivitySnapshot(snapshot, scope.value))
    );
  }
}
