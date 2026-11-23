import { inject, injectable } from '@teable/v2-di';
import { err, safeTry, type Result } from 'neverthrow';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import {
  tableStorageRepositoryToken,
  type ITableStorageRepository,
  type TableStorageRenameResult,
} from '../ports/TableStorageRepository';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import { TableByIdSpec } from '../domain/table/specs/TableByIdSpec';
import { TableOperationKind } from '../ports/TableOperationPlugin';
import type { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { RenameTableStorageCommand } from './RenameTableStorageCommand';

@CommandHandler(RenameTableStorageCommand)
@injectable()
export class RenameTableStorageHandler implements ICommandHandler<
  RenameTableStorageCommand,
  TableStorageRenameResult
> {
  constructor(
    @inject(tableStorageRepositoryToken) private readonly repository: ITableStorageRepository,
    @inject(v2CoreTokens.tableRepository) private readonly tables: ITableRepository,
    @inject(v2CoreTokens.tableOperationPluginRunner)
    private readonly plugins: TableOperationPluginRunner
  ) {}

  async handle(
    context: IExecutionContext,
    command: RenameTableStorageCommand
  ): Promise<Result<TableStorageRenameResult, DomainError>> {
    const handler = this;
    return await safeTry<TableStorageRenameResult, DomainError>(async function* () {
      const table = yield* await handler.tables.findOne(
        context,
        TableByIdSpec.create(command.tableId)
      );
      if (!table.baseId().equals(command.baseId)) {
        return err(
          domainError.notFound({
            code: 'table.not_found',
            message: `table ${command.tableId.toString()} not found`,
          })
        );
      }
      const execution = yield* await handler.plugins.prepare({
        kind: TableOperationKind.rename,
        executionContext: context,
        payload: { baseId: command.baseId, table, tableName: table.name() },
        isTransactionBound: false,
      });
      yield* await execution.guard();
      return await handler.repository.rename(context, command);
    });
  }
}
