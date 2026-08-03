import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  CreateFieldCommand,
  CreateFieldHandler,
  FieldCreationSideEffectService,
  FieldUndoRedoSnapshotService,
  ForeignTableLoaderService,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  TableByIdSpec,
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
export class CreateFieldAnalyzer implements ICommandAnalyzer<CreateFieldCommand> {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
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
    command: CreateFieldCommand,
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

      const dryRun = createFieldExplainDryRunEnvironment({
        db: analyzer.db,
        tableRepository: analyzer.tableRepository,
        computedUpdatePlanner: analyzer.computedUpdatePlanner,
        typeValidationStrategy: analyzer.typeValidationStrategy,
      });

      const handler = new CreateFieldHandler(
        dryRun.overlayTableRepository,
        dryRun.tableUpdateFlow,
        new FieldCreationSideEffectService(dryRun.tableUpdateFlow),
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
      const beforeFieldIds = new Set(beforeTable.getFields().map((field) => field.id().toString()));
      const createdField =
        afterTable.getFields().find((field) => !beforeFieldIds.has(field.id().toString())) ??
        afterTable
          .getFields()
          .find((field) => command.field.id != null && field.id().toString() === command.field.id);

      const commandInfo: CommandExplainInfo = {
        type: 'CreateField',
        tableId: afterTable.id().toString(),
        tableName: afterTable.name().toString(),
        recordIds: [],
        changedFieldIds: createdField ? [createdField.id().toString()] : undefined,
        changedFieldNames: createdField ? [createdField.name().toString()] : undefined,
        changedFieldTypes: createdField ? [createdField.type().toString()] : undefined,
        changeType: 'insert',
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
