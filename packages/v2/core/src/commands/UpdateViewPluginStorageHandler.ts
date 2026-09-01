import { inject, injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';

import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import * as ViewPluginRepositoryPort from '../ports/ViewPluginRepository';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateViewPluginStorageCommand } from './UpdateViewPluginStorageCommand';

export class UpdateViewPluginStorageResult {
  private constructor(
    readonly tableId: string,
    readonly viewId: string,
    readonly pluginInstallId: string,
    readonly storage: Readonly<Record<string, unknown>> | undefined
  ) {}

  static create(command: UpdateViewPluginStorageCommand): UpdateViewPluginStorageResult {
    return new UpdateViewPluginStorageResult(
      command.tableId.toString(),
      command.viewId.toString(),
      command.pluginInstallId,
      command.storage
    );
  }
}

@CommandHandler(UpdateViewPluginStorageCommand)
@injectable()
export class UpdateViewPluginStorageHandler
  implements ICommandHandler<UpdateViewPluginStorageCommand, UpdateViewPluginStorageResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.viewPluginRepository)
    private readonly viewPluginRepository: ViewPluginRepositoryPort.IViewPluginRepository,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: UpdateViewPluginStorageCommand
  ): Promise<Result<UpdateViewPluginStorageResult, DomainError>> {
    const handler = this;
    return this.unitOfWork.withTransaction(
      context,
      async (transactionContext) => {
        const specResult = Table.specs().byId(command.tableId).withViewId(command.viewId).build();
        if (specResult.isErr()) return err(specResult.error);

        const tableResult = await handler.tableRepository.findOne(
          transactionContext,
          specResult.value,
          { lock: 'forUpdate' }
        );
        if (tableResult.isErr()) {
          if (isNotFoundError(tableResult.error)) {
            return err(
              domainError.notFound({
                code: 'view.not_found',
                message: `View not found: ${command.viewId.toString()}`,
              })
            );
          }
          return err(tableResult.error);
        }

        const viewResult = tableResult.value.getView(command.viewId);
        if (viewResult.isErr()) {
          return err(
            domainError.notFound({
              code: 'view.not_found',
              message: `View not found: ${command.viewId.toString()}`,
            })
          );
        }

        const updateResult = await handler.viewPluginRepository.updateViewPluginStorage(
          transactionContext,
          {
            baseId: tableResult.value.baseId().toString(),
            viewId: viewResult.value.id().toString(),
            pluginInstallId: command.pluginInstallId,
            storage: command.storage,
          }
        );
        if (updateResult.isErr()) return err(updateResult.error);
        return ok(UpdateViewPluginStorageResult.create(command));
      },
      { scope: 'meta' }
    );
  }
}
