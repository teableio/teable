import { inject, injectable } from '@teable/v2-di';
import { ok, err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  TableQueryService,
  UpdateRecordCommand,
  v2CoreTokens,
  type Table,
  FieldType,
  FieldId,
  TableId,
} from '@teable/v2-core';
import type { Kysely } from 'kysely';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  ComputedUpdatePlanner,
  FieldDependencyGraph,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdatePlan,
  type FieldDependencyGraphData,
  ComputedTableRecordQueryBuilder,
  SameTableBatchQueryBuilder,
  UpdateFromSelectBuilder,
  RecordUpdateBuilder,
  type RecordUpdateSqlResult,
  type UpdateImpactHint,
  type DynamicDB,
  type QB,
  type ComputedUpdateLockConfig,
  type SameTableFieldLevel,
  defaultComputedUpdateLockConfig,
} from '@teable/v2-adapter-table-repository-postgres';
import { formulaSqlPgTokens, type IPgTypeValidationStrategy } from '@teable/v2-formula-sql-pg';

import type { ICommandAnalyzer } from './ICommandAnalyzer';
import type {
  ExplainResult,
  ExplainOptions,
  CommandExplainInfo,
  ComputedImpactInfo,
  DependencyGraphInfo,
  UpdateStepInfo,
  SameTableBatchInfo,
  AffectedRecordEstimate,
  SqlExplainInfo,
  ExplainAnalyzeOutput,
  ExplainOutput,
  ExplainTextOutput,
  SqlDiagnosticsInfo,
} from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import { SqlExplainRunner, type SetupStatement } from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { buildComputedUpdateReason } from '../utils/ComputedUpdateReasonBuilder';
import { buildComputedUpdateLockInfo } from '../utils/ComputedUpdateLockInfoBuilder';
import { buildLinkRecordLocksInfo } from '../utils/LinkRecordLockInfoBuilder';
import { buildDirtyTableSetupStatements } from '../utils/DirtyTableSetupBuilder';

/**
 * Analyzer for UpdateRecordCommand.
 * Generates real SQL using ComputedTableRecordQueryBuilder and UpdateFromSelectBuilder,
 * then runs EXPLAIN on the generated SQL.
 */
@injectable()
export class UpdateRecordAnalyzer implements ICommandAnalyzer<UpdateRecordCommand> {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
    private readonly dependencyGraph: FieldDependencyGraph,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly planner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateLockConfig)
    private readonly lockConfig: ComputedUpdateLockConfig = defaultComputedUpdateLockConfig,
    @inject(v2CommandExplainTokens.sqlExplainRunner)
    private readonly sqlExplainRunner: SqlExplainRunner,
    @inject(v2CommandExplainTokens.complexityCalculator)
    private readonly complexityCalculator: ComplexityCalculator,
    @inject(formulaSqlPgTokens.typeValidationStrategy)
    private readonly typeValidationStrategy: IPgTypeValidationStrategy
  ) {}

  async analyze(
    context: IExecutionContext,
    command: UpdateRecordCommand,
    options: ExplainOptions,
    startTime: number
  ): Promise<Result<ExplainResult, DomainError>> {
    const analyzer = this;
    const mergedOptions = { ...DEFAULT_EXPLAIN_OPTIONS, ...options };

    return safeTry<ExplainResult, DomainError>(async function* () {
      let dependencyGraphMs = 0;
      let planningMs = 0;
      let sqlExplainMs = 0;

      // 1. Get table information
      const table = yield* await analyzer.tableQueryService.getById(context, command.tableId);
      const dbTableNameResult = table.dbTableName();
      if (dbTableNameResult.isErr()) {
        return err(dbTableNameResult.error);
      }
      const tableNameValueResult = dbTableNameResult.value.value();
      if (tableNameValueResult.isErr()) {
        return err(tableNameValueResult.error);
      }
      const tableName = tableNameValueResult.value;

      // 2. Get changed field IDs from fieldValues map
      const changedFieldIds: FieldId[] = [];
      const changedFieldNames: string[] = [];
      const changedFieldTypes: string[] = [];
      for (const fieldIdStr of command.fieldValues.keys()) {
        const fieldIdResult = FieldId.create(fieldIdStr);
        if (fieldIdResult.isOk()) {
          changedFieldIds.push(fieldIdResult.value);
          const fieldResult = table.getField((f) => f.id().equals(fieldIdResult.value));
          if (fieldResult.isOk()) {
            changedFieldNames.push(fieldResult.value.name().toString());
            changedFieldTypes.push(fieldResult.value.type().toString());
          }
        }
      }

      // 3. Build command info
      const commandInfo: CommandExplainInfo = {
        type: 'UpdateRecord',
        tableId: command.tableId.toString(),
        tableName: table.name().toString(),
        recordIds: [command.recordId.toString()],
        changedFieldIds: changedFieldIds.map((id) => id.toString()),
        changedFieldNames,
        changedFieldTypes,
        changeType: 'update',
      };

      const recordUpdateResult = table.updateRecord(command.recordId, command.fieldValues);
      let updateSqlResult: RecordUpdateSqlResult | null = null;
      let updateBuildError: DomainError | null = null;
      let impactHint: UpdateImpactHint | undefined;

      if (recordUpdateResult.isOk()) {
        const { mutateSpec } = recordUpdateResult.value;
        const updateBuilder = new RecordUpdateBuilder(analyzer.db as unknown as Kysely<DynamicDB>);
        const updateResult = await updateBuilder.build({
          table,
          tableName,
          tableDisplayName: table.name().toString(),
          mutateSpec,
          recordId: command.recordId.toString(),
          context: {
            actorId: 'explain_placeholder',
            now: new Date().toISOString(),
          },
        });

        if (updateResult.isOk()) {
          updateSqlResult = updateResult.value;
          impactHint = updateResult.value.impact.impactHint;
        } else {
          updateBuildError = updateResult.error;
        }
      }

      // 4. Plan computed field updates
      const graphStartTime = Date.now();
      const plan = yield* await analyzer.planner.plan({
        table,
        changedFieldIds: updateSqlResult?.changedFieldIds ?? changedFieldIds,
        changedRecordIds: [command.recordId],
        changeType: 'update',
        cyclePolicy: 'skip',
        impact: impactHint,
      });
      planningMs = Date.now() - graphStartTime;

      // 5. Load dependency graph
      const graphSeedFieldIds = updateSqlResult?.changedFieldIds ?? changedFieldIds;
      const graphData = yield* await analyzer.dependencyGraph.load(table.baseId(), context, {
        requiredFieldIds: graphSeedFieldIds,
      });
      dependencyGraphMs = Date.now() - graphStartTime;

      // 6. Load tables for name resolution
      const tableById = yield* await analyzer.loadTables(plan, context, table);

      // 7. Build computed impact info with resolved names
      const computedImpact = analyzer.buildComputedImpact(
        plan,
        graphData,
        table,
        tableById,
        mergedOptions
      );
      const computedLocks = mergedOptions.includeLocks
        ? buildComputedUpdateLockInfo({
            plan,
            tableById,
            hasSteps: plan.steps.length > 0,
            config: analyzer.lockConfig,
          })
        : null;

      // Build link locks info
      const linkLocks =
        mergedOptions.includeLocks && updateSqlResult
          ? buildLinkRecordLocksInfo({
              baseId: table.baseId().toString(),
              linkedRecordLocks: updateSqlResult.linkedRecordLocks,
              tableById,
            })
          : null;

      // 8. Generate real SQL and run EXPLAIN
      const sqlExplainStartTime = Date.now();
      const sqlExplains: SqlExplainInfo[] = [];
      const sqlExplainMode = mergedOptions.sqlExplainMode;
      const sqlExplainFormat = sqlExplainMode === 'text' ? 'text' : 'json';
      const dumpSqlOnly = sqlExplainMode === 'dump';
      const statementTimeoutMs = mergedOptions.statementTimeoutMs;

      if (mergedOptions.includeSql) {
        if (recordUpdateResult.isErr()) {
          // If domain validation fails (e.g., button field), add an error entry
          sqlExplains.push({
            stepDescription: `Update record in ${table.name().toString()} (domain error)`,
            sql: `-- Failed: ${recordUpdateResult.error.message}`,
            parameters: [],
            explainAnalyze: null,
            explainOnly: null,
            explainError: recordUpdateResult.error.message,
          });
        } else if (!updateSqlResult) {
          const errorMessage = updateBuildError
            ? updateBuildError.message
            : 'Failed to build update SQL';
          sqlExplains.push({
            stepDescription: `Update record in ${table.name().toString()} (build failed)`,
            sql: `-- Failed: ${errorMessage}`,
            parameters: [],
            explainAnalyze: null,
            explainOnly: null,
            explainError: errorMessage,
          });
        } else {
          const { mainUpdate, additionalStatements } = updateSqlResult;

          if (
            !dumpSqlOnly &&
            sqlExplainFormat === 'json' &&
            mergedOptions.analyze &&
            additionalStatements.length > 0
          ) {
            // When analyzing, link-field statements often depend on each other (DELETE then INSERTs).
            // Run them all within a single transaction (rollback once) so EXPLAIN ANALYZE reflects
            // the real execution order and doesn't hit unique constraint errors from existing rows.
            const batchStatements = [
              {
                description: mainUpdate.description,
                sql: mainUpdate.compiled.sql,
                parameters: mainUpdate.compiled.parameters as unknown[],
              },
              ...additionalStatements.map((stmt) => ({
                description: stmt.description,
                sql: stmt.compiled.sql,
                parameters: stmt.compiled.parameters as unknown[],
              })),
            ];

            const batchResult = await analyzer.sqlExplainRunner.explainBatchInTransaction(
              analyzer.db,
              batchStatements
            );

            if (batchResult.isOk()) {
              const results = batchResult.value;
              for (let i = 0; i < batchStatements.length; i++) {
                const meta = batchStatements[i];
                const result = results[i];

                if ('error' in result) {
                  sqlExplains.push({
                    stepDescription: meta.description,
                    sql: meta.sql,
                    parameters: meta.parameters,
                    sqlDiagnostics: analyzer.buildSqlDiagnostics(meta.sql, meta.parameters),
                    explainAnalyze: null,
                    explainOnly: null,
                    explainError: result.error,
                  });
                  continue;
                }

                // Explain outputs are structurally similar; discriminate by known fields.
                const explainAnalyze =
                  'executionTimeMs' in result || 'planningTimeMs' in result
                    ? (result as ExplainAnalyzeOutput)
                    : null;
                const explainOnly = explainAnalyze ? null : (result as ExplainOutput);
                const analyzeError =
                  'analyzeError' in result && typeof result.analyzeError === 'string'
                    ? result.analyzeError
                    : null;

                sqlExplains.push({
                  stepDescription: meta.description,
                  sql: meta.sql,
                  parameters: meta.parameters,
                  sqlDiagnostics: analyzer.buildSqlDiagnostics(meta.sql, meta.parameters),
                  explainAnalyze,
                  explainOnly,
                  explainError: analyzeError,
                });
              }
            } else {
              for (const meta of batchStatements) {
                sqlExplains.push({
                  stepDescription: meta.description,
                  sql: meta.sql,
                  parameters: meta.parameters,
                  sqlDiagnostics: analyzer.buildSqlDiagnostics(meta.sql, meta.parameters),
                  explainAnalyze: null,
                  explainOnly: null,
                  explainError: batchResult.error.message,
                });
              }
            }
          } else {
            // Run EXPLAIN on main UPDATE
            let mainExplainAnalyze: ExplainAnalyzeOutput | null = null;
            let mainExplainOnly: ExplainOutput | null = null;
            let mainExplainText: ExplainTextOutput | null = null;
            let mainExplainError: string | null = null;

            if (dumpSqlOnly) {
              // SQL dump mode intentionally skips EXPLAIN execution.
            } else if (mergedOptions.analyze) {
              const analyzeResult = await analyzer.sqlExplainRunner.explain(
                analyzer.db,
                mainUpdate.compiled.sql,
                mainUpdate.compiled.parameters as unknown[],
                true,
                undefined,
                sqlExplainFormat,
                statementTimeoutMs
              );
              if (analyzeResult.isOk()) {
                const output = analyzer.splitExplainOutput(analyzeResult.value, true);
                mainExplainAnalyze = output.explainAnalyze;
                mainExplainText = output.explainText;
              } else {
                mainExplainError = analyzeResult.error.message;
              }
            } else {
              const explainResult = await analyzer.sqlExplainRunner.explain(
                analyzer.db,
                mainUpdate.compiled.sql,
                mainUpdate.compiled.parameters as unknown[],
                false,
                undefined,
                sqlExplainFormat,
                statementTimeoutMs
              );
              if (explainResult.isOk()) {
                const output = analyzer.splitExplainOutput(explainResult.value, false);
                mainExplainOnly = output.explainOnly;
                mainExplainText = output.explainText;
              } else {
                mainExplainError = explainResult.error.message;
              }
            }

            sqlExplains.push({
              stepDescription: mainUpdate.description,
              sql: mainUpdate.compiled.sql,
              parameters: mainUpdate.compiled.parameters as unknown[],
              sqlDiagnostics: analyzer.buildSqlDiagnostics(
                mainUpdate.compiled.sql,
                mainUpdate.compiled.parameters as unknown[]
              ),
              explainAnalyze: mainExplainAnalyze,
              explainOnly: mainExplainOnly,
              explainText: mainExplainText,
              explainError: mainExplainError,
            });

            // Add additional SQLs (link field operations)
            for (const stmt of additionalStatements) {
              let additionalExplainAnalyze: ExplainAnalyzeOutput | null = null;
              let additionalExplainOnly: ExplainOutput | null = null;
              let additionalExplainText: ExplainTextOutput | null = null;
              let additionalExplainError: string | null = null;

              if (dumpSqlOnly) {
                // SQL dump mode intentionally skips EXPLAIN execution.
              } else if (mergedOptions.analyze) {
                const analyzeResult = await analyzer.sqlExplainRunner.explain(
                  analyzer.db,
                  stmt.compiled.sql,
                  stmt.compiled.parameters as unknown[],
                  true,
                  undefined,
                  sqlExplainFormat,
                  statementTimeoutMs
                );
                if (analyzeResult.isOk()) {
                  const output = analyzer.splitExplainOutput(analyzeResult.value, true);
                  additionalExplainAnalyze = output.explainAnalyze;
                  additionalExplainText = output.explainText;
                } else {
                  additionalExplainError = analyzeResult.error.message;
                }
              } else {
                const explainResult = await analyzer.sqlExplainRunner.explain(
                  analyzer.db,
                  stmt.compiled.sql,
                  stmt.compiled.parameters as unknown[],
                  false,
                  undefined,
                  sqlExplainFormat,
                  statementTimeoutMs
                );
                if (explainResult.isOk()) {
                  const output = analyzer.splitExplainOutput(explainResult.value, false);
                  additionalExplainOnly = output.explainOnly;
                  additionalExplainText = output.explainText;
                } else {
                  additionalExplainError = explainResult.error.message;
                }
              }

              sqlExplains.push({
                stepDescription: stmt.description,
                sql: stmt.compiled.sql,
                parameters: stmt.compiled.parameters as unknown[],
                sqlDiagnostics: analyzer.buildSqlDiagnostics(
                  stmt.compiled.sql,
                  stmt.compiled.parameters as unknown[]
                ),
                explainAnalyze: additionalExplainAnalyze,
                explainOnly: additionalExplainOnly,
                explainText: additionalExplainText,
                explainError: additionalExplainError,
              });
            }
          }
        }

        // Then generate SQL for computed field updates
        if (plan.sameTableBatches.length > 0) {
          // Build setup statements to create tmp_computed_dirty table
          const setupStatements: SetupStatement[] = buildDirtyTableSetupStatements(
            plan.seedTableId,
            plan.seedRecordIds
          );

          for (let i = 0; i < plan.sameTableBatches.length; i++) {
            const batch = plan.sameTableBatches[i];
            const batchTable = tableById.get(batch.tableId.toString());

            if (!batchTable) {
              continue;
            }

            // Collect all field IDs in this batch
            const batchFieldIds: FieldId[] = [];
            for (const step of batch.steps) {
              batchFieldIds.push(...step.fieldIds);
            }
            const computedReason = buildComputedUpdateReason({
              plan,
              graphData,
              tableById,
              changedFieldIds,
              targetFieldIds: batchFieldIds,
              changeType: plan.changeType,
            });

            // Get batch table name
            const batchTableNameResult = batchTable.dbTableName();
            const batchTableName = batchTableNameResult.isOk()
              ? batchTableNameResult.value.value().unwrapOr(batch.tableId.toString())
              : batch.tableId.toString();

            const formulaOnlyFieldLevelsResult = safeTry<SameTableFieldLevel[], DomainError>(
              function* () {
                const fieldLevels: SameTableFieldLevel[] = [];

                for (const step of [...batch.steps].sort((a, b) => a.level - b.level)) {
                  const levelFieldIds: FieldId[] = [];
                  for (const fieldId of step.fieldIds) {
                    const field = yield* batchTable.getField((f) => f.id().equals(fieldId));
                    if (!field.type().equals(FieldType.formula())) {
                      return ok([]);
                    }
                    levelFieldIds.push(fieldId);
                  }
                  if (levelFieldIds.length > 0) {
                    fieldLevels.push({ level: step.level, fieldIds: levelFieldIds });
                  }
                }

                return ok(fieldLevels);
              }
            );

            if (formulaOnlyFieldLevelsResult.isErr()) {
              sqlExplains.push({
                stepDescription: `Update batch ${i + 1}: ${batchTableName} (field inspection failed)`,
                sql: `-- Failed to inspect fields: ${formulaOnlyFieldLevelsResult.error.message}`,
                parameters: [],
                explainAnalyze: null,
                explainOnly: null,
                explainError: formulaOnlyFieldLevelsResult.error.message,
                computedReason,
              });
              continue;
            }

            let selectQueryResult: Result<QB, DomainError>;
            if (formulaOnlyFieldLevelsResult.value.length > 0) {
              const batchBuilder = new SameTableBatchQueryBuilder(
                analyzer.db as unknown as Kysely<DynamicDB>,
                analyzer.typeValidationStrategy
              );
              selectQueryResult = batchBuilder
                .build({
                  table: batchTable,
                  fieldLevels: formulaOnlyFieldLevelsResult.value,
                  dirtyFilter: {
                    tableId: batch.tableId.toString(),
                    dirtyTableName: 'tmp_computed_dirty',
                    tableIdColumn: 'table_id',
                    recordIdColumn: 'record_id',
                  },
                })
                .map((result) => result.selectQuery);
            } else {
              // Build SELECT query using ComputedTableRecordQueryBuilder
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const selectBuilder = new ComputedTableRecordQueryBuilder(analyzer.db as any, {
                typeValidationStrategy: analyzer.typeValidationStrategy,
              });
              selectBuilder
                .from(batchTable)
                .select(batchFieldIds)
                .withDirtyFilter({ tableId: batch.tableId.toString() });

              // Prepare foreign tables for link/lookup/rollup
              const prepareResult = await selectBuilder.prepare({
                context,
                tableRepository: analyzer.tableRepository,
              });
              if (prepareResult.isErr()) {
                // Skip this batch if prepare fails
                sqlExplains.push({
                  stepDescription: `Update batch ${i + 1}: ${batchTableName} (prepare failed)`,
                  sql: `-- Failed to prepare: ${prepareResult.error.message}`,
                  parameters: [],
                  explainAnalyze: null,
                  explainOnly: null,
                  explainError: prepareResult.error.message,
                  computedReason,
                });
                continue;
              }

              selectQueryResult = selectBuilder.build();
            }

            if (selectQueryResult.isErr()) {
              sqlExplains.push({
                stepDescription: `Update batch ${i + 1}: ${batchTableName} (build failed)`,
                sql: `-- Failed to build SELECT: ${selectQueryResult.error.message}`,
                parameters: [],
                explainAnalyze: null,
                explainOnly: null,
                explainError: selectQueryResult.error.message,
                computedReason,
              });
              continue;
            }

            // Build UPDATE query using UpdateFromSelectBuilder
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updateBuilder2 = new UpdateFromSelectBuilder(analyzer.db as any);
            const compiledResult = updateBuilder2.build({
              table: batchTable,
              fieldIds: batchFieldIds,
              selectQuery: selectQueryResult.value,
              // Note: dirtyFilter is applied on the ComputedTableRecordQueryBuilder above
              // This ensures the dirty JOIN is placed BEFORE lateral joins for optimal query planning
            });

            if (compiledResult.isErr()) {
              sqlExplains.push({
                stepDescription: `Update batch ${i + 1}: ${batchTableName} (update build failed)`,
                sql: `-- Failed to build UPDATE: ${compiledResult.error.message}`,
                parameters: [],
                explainAnalyze: null,
                explainOnly: null,
                explainError: compiledResult.error.message,
                computedReason,
              });
              continue;
            }

            const compiled = compiledResult.value;

            // Get field names and types for description
            const fieldDescriptions = batchFieldIds.map((fid) => {
              const fieldResult = batchTable.getField((f) => f.id().equals(fid));
              if (fieldResult.isOk()) {
                const field = fieldResult.value;
                return `${field.name().toString()} (${field.type().toString()})`;
              }
              return fid.toString();
            });

            // Use human-readable table name for description
            const batchTableDisplayName = batchTable.name().toString();
            const stepDescription = `Computed update batch ${i + 1}: table ${batchTableDisplayName}, fields [${fieldDescriptions.join(', ')}], levels ${batch.minLevel}-${batch.maxLevel}`;

            // Run EXPLAIN on the compiled SQL
            let explainAnalyze: ExplainAnalyzeOutput | null = null;
            let explainOnly: ExplainOutput | null = null;
            let explainText: ExplainTextOutput | null = null;
            let explainError: string | null = null;

            if (dumpSqlOnly) {
              // SQL dump mode intentionally skips EXPLAIN execution.
            } else if (mergedOptions.analyze) {
              const analyzeResult = await analyzer.sqlExplainRunner.explainCompiled(
                analyzer.db,
                compiled,
                true,
                setupStatements,
                sqlExplainFormat,
                statementTimeoutMs
              );
              if (analyzeResult.isOk()) {
                const output = analyzer.splitExplainOutput(analyzeResult.value, true);
                explainAnalyze = output.explainAnalyze;
                explainText = output.explainText;
              } else {
                explainError = analyzeResult.error.message;
              }
            } else {
              const explainResult = await analyzer.sqlExplainRunner.explainCompiled(
                analyzer.db,
                compiled,
                false,
                setupStatements,
                sqlExplainFormat,
                statementTimeoutMs
              );
              if (explainResult.isOk()) {
                const output = analyzer.splitExplainOutput(explainResult.value, false);
                explainOnly = output.explainOnly;
                explainText = output.explainText;
              } else {
                explainError = explainResult.error.message;
              }
            }

            sqlExplains.push({
              stepDescription,
              sql: compiled.sql,
              parameters: compiled.parameters as unknown[],
              sqlDiagnostics: analyzer.buildSqlDiagnostics(
                compiled.sql,
                compiled.parameters as unknown[]
              ),
              explainAnalyze,
              explainOnly,
              explainText,
              explainError,
              computedReason,
            });
          }
        }
      }
      sqlExplainMs = Date.now() - sqlExplainStartTime;

      // 8. Calculate complexity
      const complexity = analyzer.complexityCalculator.calculate({
        commandInfo,
        computedImpact,
        sqlExplains,
      });

      return ok({
        command: commandInfo,
        computedImpact,
        computedLocks,
        linkLocks,
        sqlExplains,
        complexity,
        timing: {
          totalMs: Date.now() - startTime,
          dependencyGraphMs,
          planningMs,
          sqlExplainMs,
        },
      });
    });
  }

  private splitExplainOutput(
    output: ExplainAnalyzeOutput | ExplainOutput | ExplainTextOutput,
    analyze: boolean
  ): {
    explainAnalyze: ExplainAnalyzeOutput | null;
    explainOnly: ExplainOutput | null;
    explainText: ExplainTextOutput | null;
  } {
    if ('format' in output && output.format === 'text') {
      return { explainAnalyze: null, explainOnly: null, explainText: output };
    }

    if (analyze) {
      return {
        explainAnalyze: output as ExplainAnalyzeOutput,
        explainOnly: null,
        explainText: null,
      };
    }

    return {
      explainAnalyze: null,
      explainOnly: output as ExplainOutput,
      explainText: null,
    };
  }

  private buildSqlDiagnostics(sql: string, parameters: ReadonlyArray<unknown>): SqlDiagnosticsInfo {
    const count = (pattern: RegExp) => sql.match(pattern)?.length ?? 0;

    return {
      sqlLength: sql.length,
      parameterCount: parameters.length,
      lateralJoinCount: count(/\blateral\b/gi),
      regexpReplaceCount: count(/\bregexp_replace\b/gi),
      pgInputIsValidCount: count(/\bpg_input_is_valid\b/gi),
      stringAggCount: count(/\bstring_agg\b/gi),
      jsonbAggCount: count(/\bjsonb_agg\b/gi),
    };
  }

  /**
   * Load all tables needed for the update plan.
   */
  private async loadTables(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    seedTable: Table
  ): Promise<Result<Map<string, Table>, DomainError>> {
    return safeTry<Map<string, Table>, DomainError>(
      async function* (this: UpdateRecordAnalyzer) {
        const tableById = new Map<string, Table>();
        tableById.set(seedTable.id().toString(), seedTable);

        // Collect unique table IDs from plan (keep as TableId)
        const tableIdMap = new Map<string, TableId>();
        for (const step of plan.steps) {
          tableIdMap.set(step.tableId.toString(), step.tableId);
        }
        for (const batch of plan.sameTableBatches) {
          tableIdMap.set(batch.tableId.toString(), batch.tableId);
        }

        // Load tables not yet in map
        for (const [tableIdStr, tableId] of tableIdMap) {
          if (!tableById.has(tableIdStr)) {
            // Try to find by specs
            const specResult = seedTable.specs().withoutBaseId().byId(tableId).build();
            if (specResult.isOk()) {
              const tableResult = await this.tableRepository.findOne(context, specResult.value);
              if (tableResult.isOk() && tableResult.value) {
                tableById.set(tableIdStr, tableResult.value);
              }
            }
          }
        }

        return ok(tableById);
      }.bind(this)
    );
  }

  private buildComputedImpact(
    plan: ComputedUpdatePlan,
    graphData: FieldDependencyGraphData,
    table: Table,
    tableById: Map<string, Table>,
    options: Required<ExplainOptions>
  ): ComputedImpactInfo {
    const { fieldsById } = graphData;

    // Helper to resolve table name
    const getTableName = (tableId: TableId): string => {
      const t = tableById.get(tableId.toString());
      if (t) {
        return t.name().toString();
      }
      return tableId.toString();
    };

    // Helper to resolve field name
    const getFieldName = (tableId: TableId, fieldId: FieldId): string => {
      const t = tableById.get(tableId.toString());
      if (t) {
        const fieldResult = t.getField((f) => f.id().equals(fieldId));
        if (fieldResult.isOk()) {
          return fieldResult.value.name().toString();
        }
      }
      return fieldId.toString();
    };

    // Count only fields involved in this operation
    const involvedFieldIds = new Set<string>();
    for (const step of plan.steps) {
      for (const fieldId of step.fieldIds) {
        involvedFieldIds.add(fieldId.toString());
      }
    }
    for (const edge of plan.edges) {
      involvedFieldIds.add(edge.fromFieldId.toString());
      involvedFieldIds.add(edge.toFieldId.toString());
    }

    const dependencyGraph: DependencyGraphInfo = {
      fieldCount: involvedFieldIds.size,
      edgeCount: plan.edges.length, // Use plan.edges, not global edges
      edges: options.includeGraph
        ? plan.edges.map((edge) => ({
            fromFieldId: edge.fromFieldId.toString(),
            fromFieldName: getFieldName(edge.fromTableId, edge.fromFieldId),
            fromTableId: edge.fromTableId.toString(),
            fromTableName: getTableName(edge.fromTableId),
            toFieldId: edge.toFieldId.toString(),
            toFieldName: getFieldName(edge.toTableId, edge.toFieldId),
            toTableId: edge.toTableId.toString(),
            toTableName: getTableName(edge.toTableId),
            kind:
              edge.fromTableId.toString() === edge.toTableId.toString()
                ? ('same_record' as const)
                : ('cross_record' as const),
            linkFieldId: edge.linkFieldId?.toString(),
          }))
        : [],
    };

    const updateSteps: UpdateStepInfo[] = plan.steps.map((step) => ({
      level: step.level,
      tableId: step.tableId.toString(),
      tableName: getTableName(step.tableId),
      fieldIds: step.fieldIds.map((f) => f.toString()),
      fieldNames: step.fieldIds.map((f) => getFieldName(step.tableId, f)),
      fieldTypes: step.fieldIds.map((f) => {
        const meta = fieldsById.get(f.toString());
        return meta?.type ?? 'unknown';
      }),
      estimatedRecordCount: plan.seedRecordIds.length,
    }));

    if (plan.cycleInfo && plan.cycleInfo.unsortedFieldIds.length > 0) {
      const blockedFieldIds = plan.cycleInfo.unsortedFieldIds;
      let cycleTableId: TableId | null = null;
      for (const fieldId of blockedFieldIds) {
        const meta = fieldsById.get(fieldId);
        if (!meta) continue;
        if (!cycleTableId) {
          cycleTableId = meta.tableId;
        } else if (!cycleTableId.equals(meta.tableId)) {
          cycleTableId = null;
          break;
        }
      }

      const tableIdValue = cycleTableId ? cycleTableId.toString() : 'cycle';
      const tableNameValue = cycleTableId ? getTableName(cycleTableId) : 'Cycle detected';
      const fieldNames = blockedFieldIds.map((fieldId) => {
        const meta = fieldsById.get(fieldId);
        return meta ? getFieldName(meta.tableId, meta.id) : fieldId;
      });
      const fieldTypes = blockedFieldIds.map(
        (fieldId) => fieldsById.get(fieldId)?.type ?? 'unknown'
      );
      const lastLevel = updateSteps.reduce((max, step) => Math.max(max, step.level), -1);

      updateSteps.push({
        level: Math.max(0, lastLevel + 1),
        tableId: tableIdValue,
        tableName: tableNameValue,
        fieldIds: blockedFieldIds,
        fieldNames,
        fieldTypes,
        estimatedRecordCount: plan.seedRecordIds.length,
        status: 'blocked',
        warning: plan.cycleInfo.message,
      });
    }

    const sameTableBatches: SameTableBatchInfo[] = plan.sameTableBatches.map((batch) => ({
      tableId: batch.tableId.toString(),
      tableName: getTableName(batch.tableId),
      stepCount: batch.steps.length,
      minLevel: batch.minLevel,
      maxLevel: batch.maxLevel,
      totalFieldCount: batch.steps.reduce((sum, s) => sum + s.fieldIds.length, 0),
      canOptimize: batch.steps.length > 1,
    }));

    const affectedTables = new Map<string, { tableId: TableId; count: number }>();
    affectedTables.set(plan.seedTableId.toString(), {
      tableId: plan.seedTableId,
      count: plan.seedRecordIds.length,
    });

    for (const step of plan.steps) {
      const tableIdStr = step.tableId.toString();
      if (!affectedTables.has(tableIdStr)) {
        affectedTables.set(tableIdStr, { tableId: step.tableId, count: plan.seedRecordIds.length });
      }
    }

    const affectedRecordEstimates: AffectedRecordEstimate[] = Array.from(
      affectedTables.entries()
    ).map(([, { tableId, count }], index) => ({
      tableId: tableId.toString(),
      tableName: getTableName(tableId),
      estimatedCount: count,
      source: index === 0 ? ('seed' as const) : ('propagation' as const),
    }));

    const warnings = plan.cycleInfo ? [plan.cycleInfo.message] : undefined;

    return {
      baseId: plan.baseId.toString(),
      seedTableId: plan.seedTableId.toString(),
      seedRecordCount: plan.seedRecordIds.length,
      dependencyGraph,
      updateSteps,
      sameTableBatches,
      affectedRecordEstimates,
      warnings,
    };
  }
}
