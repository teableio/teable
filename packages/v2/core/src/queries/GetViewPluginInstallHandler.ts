import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import type { ViewPluginInstallationInfo } from '../ports/ViewPluginRepository';
import * as ViewPluginRepositoryPort from '../ports/ViewPluginRepository';
import { GetViewPluginInstallQuery } from './GetViewPluginInstallQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

export class GetViewPluginInstallResult {
  private constructor(readonly installation: ViewPluginInstallationInfo) {}

  static create(installation: ViewPluginInstallationInfo): GetViewPluginInstallResult {
    return new GetViewPluginInstallResult(installation);
  }
}

@QueryHandler(GetViewPluginInstallQuery)
@injectable()
export class GetViewPluginInstallHandler
  implements IQueryHandler<GetViewPluginInstallQuery, GetViewPluginInstallResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.viewPluginRepository)
    private readonly viewPluginRepository: ViewPluginRepositoryPort.IViewPluginRepository
  ) {}

  async handle(
    context: IExecutionContext,
    query: GetViewPluginInstallQuery
  ): Promise<Result<GetViewPluginInstallResult, DomainError>> {
    const specResult = Table.specs().byId(query.tableId).withViewId(query.viewId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      if (isNotFoundError(tableResult.error)) {
        return err(
          domainError.notFound({
            code: 'view.not_found',
            message: `View not found: ${query.viewId.toString()}`,
          })
        );
      }
      return err(tableResult.error);
    }

    const viewResult = tableResult.value.getView(query.viewId);
    if (viewResult.isErr()) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found: ${query.viewId.toString()}`,
        })
      );
    }

    const installationResult = await this.viewPluginRepository.getViewPluginInstallation(
      context,
      tableResult.value.baseId().toString(),
      viewResult.value.id().toString()
    );
    if (installationResult.isErr()) return err(installationResult.error);
    return ok(GetViewPluginInstallResult.create(installationResult.value));
  }
}
