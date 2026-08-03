import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  DeleteTableCommand,
  DeleteTableHandler,
  FieldCrossTableUpdateSideEffectService,
  FieldUpdateSideEffectService,
  LinkFieldUpdateSideEffectService,
  NoopLogger,
  TableByIdSpec,
  TableDeletionSideEffectService,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  v2CoreTokens,
} from '@teable/v2-core';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdatePlanner,
} from '@teable/v2-adapter-table-repository-postgres';
import { formulaSqlPgTokens, type IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { Kysely } from 'kysely';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';

import type { ICommandAnalyzer } from './ICommandAnalyzer';
import {
  buildFieldSqlExplains,
  createFieldExplainDryRunEnvironment,
} from './FieldCommandAnalyzeHelpers';
import type { CommandExplainInfo, ExplainOptions, ExplainResult } from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { NoopEventBus, NoopUnitOfWork } from '../utils/FieldCommandExplainHarness';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';

@injectable()
export class DeleteTableAnalyzer implements ICommandAnalyzer<DeleteTableCommand> {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2CommandExplainTokens.sqlExplainRunner)
    private readonly sqlExplainRunner: SqlExplainRunner,
    @inject(v2CommandExplainTokens.complexityCalculator)
    private readonly complexityCalculator: ComplexityCalculator,
    @inject(formulaSqlPgTokens.typeValidationStrategy)
    private readonly typeValidationStrategy: IPgTypeValidationStrategy
  ) {}

  async analyze(
    context: IExecutionContext,
    command: DeleteTableCommand,
    options: ExplainOptions,
    startTime: number
  ): Promise<Result<ExplainResult, DomainError>> {
    const analyzer = this;
    const mergedOptions = { ...DEFAULT_EXPLAIN_OPTIONS, ...options };

    return safeTry<ExplainResult, DomainError>(async function* () {
      const beforeTableResult = await analyzer.tableRepository.findOne(
        context,
        TableByIdSpec.create(command.tableId)
      );
      if (beforeTableResult.isErr()) {
        return err(beforeTableResult.error);
      }
      const beforeTable = beforeTableResult.value;

      const dryRun = createFieldExplainDryRunEnvironment({
        db: analyzer.db,
        tableRepository: analyzer.tableRepository,
        computedUpdatePlanner: analyzer.computedUpdatePlanner,
        typeValidationStrategy: analyzer.typeValidationStrategy,
      });

      const fieldCrossTableUpdateSideEffectService = new FieldCrossTableUpdateSideEffectService(
        dryRun.overlayTableRepository,
        dryRun.tableUpdateFlow
      );
      const linkFieldUpdateSideEffectService = new LinkFieldUpdateSideEffectService(
        dryRun.tableUpdateFlow
      );
      const fieldUpdateSideEffectService = new FieldUpdateSideEffectService(
        dryRun.tableUpdateFlow,
        dryRun.overlayTableRepository,
        linkFieldUpdateSideEffectService,
        fieldCrossTableUpdateSideEffectService
      );
      const tableDeletionSideEffectService = new TableDeletionSideEffectService(
        dryRun.overlayTableRepository,
        dryRun.tableUpdateFlow,
        fieldUpdateSideEffectService
      );

      const handler = new DeleteTableHandler(
        dryRun.overlayTableRepository,
        dryRun.captureTableSchemaRepository,
        tableDeletionSideEffectService,
        new NoopEventBus(),
        new NoopLogger(),
        new NoopUnitOfWork()
      );

      const commandResult = await handler.handle(context, command);
      if (commandResult.isErr()) {
        return err(commandResult.error);
      }

      const deletedTable = commandResult.value.table;
      const commandInfo: CommandExplainInfo = {
        type: 'DeleteTable',
        tableId: deletedTable.id().toString(),
        tableName: beforeTable.name().toString(),
        recordIds: [],
        changeType: 'delete',
      };

      const sqlExplainStartTime = Date.now();
      const sqlExplains = mergedOptions.includeSql
        ? await buildFieldSqlExplains(
            analyzer.sqlExplainRunner,
            analyzer.db,
            dryRun.captureTableSchemaRepository.getStatements(),
            mergedOptions.analyze
          )
        : [];
      const sqlExplainMs = Date.now() - sqlExplainStartTime;

      const complexity = analyzer.complexityCalculator.calculate({
        commandInfo,
        computedImpact: null,
        sqlExplains,
      });

      return ok({
        command: commandInfo,
        computedImpact: null,
        computedLocks: null,
        linkLocks: null,
        sqlExplains,
        complexity,
        timing: {
          totalMs: Date.now() - startTime,
          dependencyGraphMs: 0,
          planningMs: 0,
          sqlExplainMs,
        },
      });
    });
  }
}
