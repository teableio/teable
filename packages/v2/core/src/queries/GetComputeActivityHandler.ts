import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import { IComputedActivityReader } from '../ports/ComputedActivityReader';
import type { TableComputeActivitySnapshot } from '../ports/ComputedActivityReader';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { ILogger } from '../ports/Logger';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
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
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.computedActivityReader)
    private readonly activityReader: IComputedActivityReader,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.tableOperationPluginRunner)
    private readonly tableOperationPluginRunner: TableOperationPluginRunner
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

    const result = await this.activityReader.getByTableId(
      context,
      query.tableId.toString(),
      query.baseId.toString()
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
    return ok(GetComputeActivityResult.create(snapshot));
  }
}
