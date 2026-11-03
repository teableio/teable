import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DeleteTableCommand, DeleteTableMode } from '../../commands/DeleteTableCommand';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import type {
  TableDeletionSideEffectPreparation,
  TableDeletionSideEffectService,
} from './TableDeletionSideEffectService';

export type TableDeletionSourceState = 'active' | 'trashed';
export type TableDeletionPreparation = {
  readonly table: Table;
  readonly mode: DeleteTableMode;
  readonly sourceState: TableDeletionSourceState;
  readonly sideEffects: TableDeletionSideEffectPreparation;
  readonly blockers: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
  }>;
};

export interface ITableDeletionPreparationService {
  prepare(
    context: IExecutionContext,
    command: DeleteTableCommand
  ): Promise<Result<TableDeletionPreparation, DomainError>>;
}

@injectable()
export class TableDeletionPreparationService implements ITableDeletionPreparationService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableDeletionSideEffectService)
    private readonly tableDeletionSideEffectService: TableDeletionSideEffectService
  ) {}

  async prepare(
    context: IExecutionContext,
    command: DeleteTableCommand
  ): Promise<Result<TableDeletionPreparation, DomainError>> {
    const service = this;
    return safeTry<TableDeletionPreparation, DomainError>(async function* () {
      const spec = yield* TableAggregate.specs(command.baseId).byId(command.tableId).build();
      const activeTableResult = await service.tableRepository.findOne(context, spec, {
        state: 'activeAnyProvision',
      });

      let tableResult = activeTableResult;
      let sourceState: TableDeletionSourceState = 'active';
      if (
        command.mode === 'permanent' &&
        activeTableResult.isErr() &&
        isNotFoundError(activeTableResult.error)
      ) {
        tableResult = await service.tableRepository.findOne(context, spec, { state: 'all' });
        sourceState = 'trashed';
      }

      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
        }
        return err(tableResult.error);
      }

      const table = tableResult.value;
      const sideEffects = yield* await service.tableDeletionSideEffectService.prepare(context, {
        table,
      });

      return ok({
        table,
        mode: command.mode,
        sourceState,
        sideEffects,
        blockers: [],
      });
    });
  }
}
