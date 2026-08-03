import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  FieldCrossTableUpdateSideEffectService,
  FieldUndoRedoSnapshotService,
  FieldUpdateSideEffectService,
  ForeignTableLoaderService,
  LinkFieldUpdateSideEffectService,
  TableByIdSpec,
  UpdateFieldCommand,
  UpdateFieldHandler,
  type DomainError,
  type IExecutionContext,
  type ITableMapper,
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
  createNoopFieldOperationPluginRunner,
  createNoopUndoRedoService,
} from './FieldCommandAnalyzeHelpers';
import type { CommandExplainInfo, ExplainOptions, ExplainResult } from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';

@injectable()
export class UpdateFieldAnalyzer implements ICommandAnalyzer<UpdateFieldCommand> {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService,
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
    command: UpdateFieldCommand,
    options: ExplainOptions,
    startTime: number
  ): Promise<Result<ExplainResult, DomainError>> {
    const analyzer = this;
    const mergedOptions = { ...DEFAULT_EXPLAIN_OPTIONS, ...options };

    return safeTry<ExplainResult, DomainError>(async function* () {
      const beforeTableSpec = TableByIdSpec.create(command.tableId);
      const beforeTableResult = await analyzer.tableRepository.findOne(context, beforeTableSpec);
      if (beforeTableResult.isErr()) {
        return err(beforeTableResult.error);
      }
      const beforeTable = beforeTableResult.value;
      const previousFieldResult = beforeTable.getField((field) =>
        field.id().equals(command.fieldId)
      );
      if (previousFieldResult.isErr()) {
        return err(previousFieldResult.error);
      }

      const dryRun = createFieldExplainDryRunEnvironment({
        db: analyzer.db,
        tableRepository: analyzer.tableRepository,
        computedUpdatePlanner: analyzer.computedUpdatePlanner,
        typeValidationStrategy: analyzer.typeValidationStrategy,
      });

      const tableUpdateFlow = dryRun.tableUpdateFlow;
      const fieldUpdateSideEffectService = new FieldUpdateSideEffectService(
        tableUpdateFlow,
        dryRun.overlayTableRepository,
        new LinkFieldUpdateSideEffectService(tableUpdateFlow),
        new FieldCrossTableUpdateSideEffectService(dryRun.overlayTableRepository, tableUpdateFlow)
      );

      const handler = new UpdateFieldHandler(
        dryRun.overlayTableRepository,
        analyzer.tableMapper,
        tableUpdateFlow,
        fieldUpdateSideEffectService,
        analyzer.foreignTableLoaderService,
        createNoopFieldOperationPluginRunner(),
        createNoopUndoRedoService() as never,
        analyzer.fieldUndoRedoSnapshotService
      );

      const commandResult = await handler.handle(context, command);
      if (commandResult.isErr()) {
        return err(commandResult.error);
      }

      const afterTable = commandResult.value.table;
      const effectiveFieldResult = afterTable.getField((field) =>
        field.id().equals(command.fieldId)
      );
      const effectiveField = effectiveFieldResult.isOk()
        ? effectiveFieldResult.value
        : previousFieldResult.value;

      const commandInfo: CommandExplainInfo = {
        type: 'UpdateField',
        tableId: afterTable.id().toString(),
        tableName: afterTable.name().toString(),
        recordIds: [],
        changedFieldIds: [command.fieldId.toString()],
        changedFieldNames: [effectiveField.name().toString()],
        changedFieldTypes: [effectiveField.type().toString()],
        changeType: 'update',
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
