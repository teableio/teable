import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DeleteTableCommand, DeleteTableMode } from '../../commands/DeleteTableCommand';
import type { BaseId } from '../../domain/base/BaseId';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
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

  /**
   * Prepares moving several tables of one base to the trash with two metadata reads: the tables,
   * and every table linking to any of them. Each preparation is what `prepare` gives for that
   * table deleted on its own, so links between the tables are reported too. Tables that are not
   * active are left out.
   */
  async prepareSoftDeleteMany(
    context: IExecutionContext,
    baseId: BaseId,
    tableIds: ReadonlyArray<TableId>
  ): Promise<Result<ReadonlyArray<TableDeletionPreparation>, DomainError>> {
    const service = this;
    return safeTry<ReadonlyArray<TableDeletionPreparation>, DomainError>(async function* () {
      if (tableIds.length === 0) return ok([]);
      const tablesSpec = yield* TableAggregate.specs(baseId).byIds(tableIds).build();
      const tables = yield* await service.tableRepository.find(context, tablesSpec, {
        state: 'activeAnyProvision',
      });
      const linkingSpec = yield* TableAggregate.specs()
        .orGroup((builder) =>
          tableIds.reduce((group, tableId) => group.byIncomingReferenceToTable(tableId), builder)
        )
        .build();
      const linkingTables = yield* await service.tableRepository.find(context, linkingSpec);

      const preparations: TableDeletionPreparation[] = [];
      for (const table of tables) {
        const linksToTable = TableAggregate.specs().byIncomingReferenceToTable(table.id()).build();
        if (linksToTable.isErr()) return err(linksToTable.error);
        const sideEffects = yield* await service.tableDeletionSideEffectService.prepare(context, {
          table,
          candidateTables: linkingTables.filter(
            (candidate) =>
              !candidate.id().equals(table.id()) && linksToTable.value.isSatisfiedBy(candidate)
          ),
        });
        preparations.push({
          table,
          mode: 'soft',
          sourceState: 'active',
          sideEffects,
          blockers: [],
        });
      }
      return ok(preparations);
    });
  }
}
