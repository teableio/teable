import { inject, injectable } from '@teable/v2-di';
import { ok, err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  TableQueryService,
  CreateRecordCommand,
  v2CoreTokens,
  type Table,
  FieldId,
  RecordId,
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
  UpdateFromSelectBuilder,
  type DynamicDB,
  RecordInsertBuilder,
  defaultComputedUpdateLockConfig,
  type ComputedUpdateLockConfig,
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
  ComputedUpdateReason,
} from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import {
  SqlExplainRunner,
  type BatchExplainStatement,
  type SetupStatement,
} from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { buildComputedUpdateReason } from '../utils/ComputedUpdateReasonBuilder';
import { buildComputedUpdateLockInfo } from '../utils/ComputedUpdateLockInfoBuilder';
import { buildLinkRecordLocksInfo } from '../utils/LinkRecordLockInfoBuilder';
import { buildDirtyTableSetupStatements } from '../utils/DirtyTableSetupBuilder';

/**
 * Analyzer for CreateRecordCommand.
 * Generates real SQL for computed field updates that would follow the insert.
 */
@injectable()
export class CreateRecordAnalyzer implements ICommandAnalyzer<CreateRecordCommand> {
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
    command: CreateRecordCommand,
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

      // 2. Get field IDs being set from fieldValues map
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

      // 3. Build command info (use generated placeholder record ID since record doesn't exist yet)
      const placeholderRecordId = yield* RecordId.generate();
      const commandInfo: CommandExplainInfo = {
        type: 'CreateRecord',
        tableId: command.tableId.toString(),
        tableName: table.name().toString(),
        recordIds: ['(new record)'],
        changedFieldIds: changedFieldIds.map((id) => id.toString()),
        changedFieldNames,
        changedFieldTypes,
        changeType: 'insert',
      };

      // 4. Plan computed field updates
      const graphStartTime = Date.now();
      const plan = yield* await analyzer.planner.plan({
        table,
        changedFieldIds,
        changedRecordIds: [placeholderRecordId],
        changeType: 'insert',
        cyclePolicy: 'skip',
      });
      planningMs = Date.now() - graphStartTime;

      // 5. Load dependency graph
      const graphData = yield* await analyzer.dependencyGraph.load(table.baseId());
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

      // Initialize linkLocks (will be populated when building INSERT)
      let linkLocks: import('../types').LinkRecordLocksInfo | null = null;

      // 8. Generate real SQL and run EXPLAIN
      const sqlExplainStartTime = Date.now();
      const sqlExplains: SqlExplainInfo[] = [];

      if (mergedOptions.includeSql) {
        // Build the INSERT statement using RecordInsertBuilder
        const insertBuilder = new RecordInsertBuilder(analyzer.db as unknown as Kysely<DynamicDB>);
        const insertResult = insertBuilder.build({
          table,
          tableName,
          fieldValues: command.fieldValues,
          context: {
            recordId: placeholderRecordId.toString(),
            actorId: 'explain_placeholder',
            now: new Date().toISOString(),
          },
        });

        if (insertResult.isOk()) {
          const { mainInsert, additionalStatements, linkedRecordLocks } = insertResult.value;

          // Build link locks info if enabled
          if (mergedOptions.includeLocks) {
            linkLocks = buildLinkRecordLocksInfo({
              baseId: table.baseId().toString(),
              linkedRecordLocks,
              tableById,
            });
          }

          // Collect all statement metadata
          type StatementMeta = BatchExplainStatement & {
            computedReason?: ComputedUpdateReason;
          };
          const statementMetas: StatementMeta[] = [];

          // Add main INSERT
          statementMetas.push({
            description: mainInsert.description,
            sql: mainInsert.compiled.sql,
            parameters: mainInsert.compiled.parameters as unknown[],
          });

          // Add additional statements (FK updates, junction table inserts)
          for (const stmt of additionalStatements) {
            statementMetas.push({
              description: stmt.description,
              sql: stmt.compiled.sql,
              parameters: stmt.compiled.parameters as unknown[],
            });
          }

          // Build computed update statements
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

            // Build SELECT query using ComputedTableRecordQueryBuilder
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const selectBuilder = new ComputedTableRecordQueryBuilder(analyzer.db as any, {
              typeValidationStrategy: analyzer.typeValidationStrategy,
            });
            selectBuilder.from(batchTable).select(batchFieldIds);

            // Prepare foreign tables for link/lookup/rollup
            const prepareResult = await selectBuilder.prepare({
              context,
              tableRepository: analyzer.tableRepository,
            });
            if (prepareResult.isErr()) {
              statementMetas.push({
                description: `Computed update batch ${i + 1}: ${batchTableName} (prepare failed)`,
                sql: `-- Failed to prepare: ${prepareResult.error.message}`,
                parameters: [],
                computedReason,
              });
              continue;
            }

            const selectQueryResult = selectBuilder.build();
            if (selectQueryResult.isErr()) {
              statementMetas.push({
                description: `Computed update batch ${i + 1}: ${batchTableName} (build failed)`,
                sql: `-- Failed to build SELECT: ${selectQueryResult.error.message}`,
                parameters: [],
                computedReason,
              });
              continue;
            }

            // Build UPDATE query using UpdateFromSelectBuilder
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updateBuilder = new UpdateFromSelectBuilder(analyzer.db as any);
            const compiledResult = updateBuilder.build({
              table: batchTable,
              fieldIds: batchFieldIds,
              selectQuery: selectQueryResult.value,
              dirtyFilter: { tableId: batch.tableId },
            });

            if (compiledResult.isErr()) {
              statementMetas.push({
                description: `Computed update batch ${i + 1}: ${batchTableName} (update build failed)`,
                sql: `-- Failed to build UPDATE: ${compiledResult.error.message}`,
                parameters: [],
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

            statementMetas.push({
              description: stepDescription,
              sql: compiled.sql,
              parameters: compiled.parameters as unknown[],
              computedReason,
            });
          }

          // Run EXPLAIN on all statements
          if (mergedOptions.analyze) {
            // Filter out failed statements (those starting with --)
            const validStatements = statementMetas.filter((m) => !m.sql.startsWith('--'));
            const failedStatements = statementMetas.filter((m) => m.sql.startsWith('--'));

            // Add failed statements directly to results
            for (const meta of failedStatements) {
              sqlExplains.push({
                stepDescription: meta.description,
                sql: meta.sql,
                parameters: meta.parameters as unknown[],
                explainAnalyze: null,
                explainOnly: null,
                explainError: 'SQL build failed',
                computedReason: meta.computedReason,
              });
            }

            // Run all valid statements in a single transaction
            if (validStatements.length > 0) {
              // Build setup statements to create tmp_computed_dirty table for computed updates
              const setupStatements: SetupStatement[] =
                plan.sameTableBatches.length > 0
                  ? buildDirtyTableSetupStatements(plan.seedTableId, plan.seedRecordIds)
                  : [];

              const batchResult = await analyzer.sqlExplainRunner.explainBatchInTransaction(
                analyzer.db,
                validStatements,
                setupStatements
              );

              if (batchResult.isOk()) {
                const results = batchResult.value;
                for (let i = 0; i < validStatements.length; i++) {
                  const meta = validStatements[i];
                  const result = results[i];
                  if ('error' in result) {
                    sqlExplains.push({
                      stepDescription: meta.description,
                      sql: meta.sql,
                      parameters: meta.parameters as unknown[],
                      explainAnalyze: null,
                      explainOnly: null,
                      explainError: result.error,
                      computedReason: meta.computedReason,
                    });
                  } else {
                    const explainAnalyze =
                      'executionTimeMs' in result || 'planningTimeMs' in result
                        ? (result as ExplainAnalyzeOutput)
                        : null;
                    const explainOnly = explainAnalyze ? null : (result as ExplainOutput);
                    sqlExplains.push({
                      stepDescription: meta.description,
                      sql: meta.sql,
                      parameters: meta.parameters as unknown[],
                      explainAnalyze,
                      explainOnly,
                      explainError: explainOnly?.analyzeError ?? null,
                      computedReason: meta.computedReason,
                    });
                  }
                }
              } else {
                // Batch failed entirely, add error to all statements
                for (const meta of validStatements) {
                  sqlExplains.push({
                    stepDescription: meta.description,
                    sql: meta.sql,
                    parameters: meta.parameters as unknown[],
                    explainAnalyze: null,
                    explainOnly: null,
                    explainError: batchResult.error.message,
                    computedReason: meta.computedReason,
                  });
                }
              }
            }
          } else {
            // Run EXPLAIN only (no transaction needed, each statement independent)
            // Build setup statements for computed update statements
            const setupStatements: SetupStatement[] =
              plan.sameTableBatches.length > 0
                ? buildDirtyTableSetupStatements(plan.seedTableId, plan.seedRecordIds)
                : [];

            for (const meta of statementMetas) {
              if (meta.sql.startsWith('--')) {
                // Failed statement
                sqlExplains.push({
                  stepDescription: meta.description,
                  sql: meta.sql,
                  parameters: meta.parameters as unknown[],
                  explainAnalyze: null,
                  explainOnly: null,
                  explainError: 'SQL build failed',
                  computedReason: meta.computedReason,
                });
                continue;
              }

              // Only pass setup statements for computed update statements (those with computedReason)
              const stmtSetupStatements = meta.computedReason ? setupStatements : undefined;

              const explainResult = await analyzer.sqlExplainRunner.explain(
                analyzer.db,
                meta.sql,
                meta.parameters,
                false,
                stmtSetupStatements
              );

              if (explainResult.isOk()) {
                sqlExplains.push({
                  stepDescription: meta.description,
                  sql: meta.sql,
                  parameters: meta.parameters as unknown[],
                  explainAnalyze: null,
                  explainOnly: explainResult.value as ExplainOutput,
                  explainError: null,
                  computedReason: meta.computedReason,
                });
              } else {
                sqlExplains.push({
                  stepDescription: meta.description,
                  sql: meta.sql,
                  parameters: meta.parameters as unknown[],
                  explainAnalyze: null,
                  explainOnly: null,
                  explainError: explainResult.error.message,
                  computedReason: meta.computedReason,
                });
              }
            }
          }
        } else {
          // Fallback to placeholder if building real SQL fails
          sqlExplains.push({
            stepDescription: `Insert new record into ${tableName}`,
            sql: `-- INSERT INTO "${tableName}" (...) VALUES (...)\n-- Failed to build SQL: ${insertResult.error.message}`,
            parameters: [],
            explainAnalyze: null,
            explainOnly: null,
            explainError: insertResult.error.message,
          });
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

  /**
   * Load all tables needed for the update plan.
   */
  private async loadTables(
    plan: ComputedUpdatePlan,
    context: IExecutionContext,
    seedTable: Table
  ): Promise<Result<Map<string, Table>, DomainError>> {
    return safeTry<Map<string, Table>, DomainError>(
      async function* (this: CreateRecordAnalyzer) {
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
