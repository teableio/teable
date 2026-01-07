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
  UpdateFromSelectBuilder,
  RecordUpdateBuilder,
  type DynamicDB,
} from '@teable/v2-adapter-record-repository-postgres';

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
} from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';

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
    @inject(v2CommandExplainTokens.sqlExplainRunner)
    private readonly sqlExplainRunner: SqlExplainRunner,
    @inject(v2CommandExplainTokens.complexityCalculator)
    private readonly complexityCalculator: ComplexityCalculator
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

      // 4. Plan computed field updates
      const graphStartTime = Date.now();
      const plan = yield* await analyzer.planner.plan({
        table,
        changedFieldIds,
        changedRecordIds: [command.recordId],
        changeType: 'update',
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

      // 8. Generate real SQL and run EXPLAIN
      const sqlExplainStartTime = Date.now();
      const sqlExplains: SqlExplainInfo[] = [];

      if (mergedOptions.includeSql) {
        // First, generate the primary UPDATE statement using RecordUpdateBuilder
        const updateBuilder = new RecordUpdateBuilder(analyzer.db as unknown as Kysely<DynamicDB>);
        const updateResult = updateBuilder.build({
          table,
          tableName,
          tableDisplayName: table.name().toString(),
          fieldValues: command.fieldValues,
          recordId: command.recordId.toString(),
          context: {
            actorId: 'explain_placeholder',
            now: new Date().toISOString(),
          },
        });

        if (updateResult.isOk()) {
          const { mainUpdate, additionalStatements } = updateResult.value;

          // Run EXPLAIN on main UPDATE
          let mainExplainAnalyze: ExplainAnalyzeOutput | null = null;
          let mainExplainOnly: ExplainOutput | null = null;

          if (mergedOptions.analyze) {
            const analyzeResult = await analyzer.sqlExplainRunner.explain(
              analyzer.db,
              mainUpdate.compiled.sql,
              mainUpdate.compiled.parameters as unknown[],
              true
            );
            if (analyzeResult.isOk()) {
              mainExplainAnalyze = analyzeResult.value as ExplainAnalyzeOutput;
            }
          } else {
            const explainResult = await analyzer.sqlExplainRunner.explain(
              analyzer.db,
              mainUpdate.compiled.sql,
              mainUpdate.compiled.parameters as unknown[],
              false
            );
            if (explainResult.isOk()) {
              mainExplainOnly = explainResult.value as ExplainOutput;
            }
          }

          sqlExplains.push({
            stepDescription: mainUpdate.description,
            sql: mainUpdate.compiled.sql,
            parameters: mainUpdate.compiled.parameters as unknown[],
            explainAnalyze: mainExplainAnalyze,
            explainOnly: mainExplainOnly,
          });

          // Add additional SQLs (link field operations)
          for (const stmt of additionalStatements) {
            let additionalExplainAnalyze: ExplainAnalyzeOutput | null = null;
            let additionalExplainOnly: ExplainOutput | null = null;

            if (mergedOptions.analyze) {
              const analyzeResult = await analyzer.sqlExplainRunner.explain(
                analyzer.db,
                stmt.compiled.sql,
                stmt.compiled.parameters as unknown[],
                true
              );
              if (analyzeResult.isOk()) {
                additionalExplainAnalyze = analyzeResult.value as ExplainAnalyzeOutput;
              }
            } else {
              const explainResult = await analyzer.sqlExplainRunner.explain(
                analyzer.db,
                stmt.compiled.sql,
                stmt.compiled.parameters as unknown[],
                false
              );
              if (explainResult.isOk()) {
                additionalExplainOnly = explainResult.value as ExplainOutput;
              }
            }

            sqlExplains.push({
              stepDescription: stmt.description,
              sql: stmt.compiled.sql,
              parameters: stmt.compiled.parameters as unknown[],
              explainAnalyze: additionalExplainAnalyze,
              explainOnly: additionalExplainOnly,
            });
          }
        }

        // Then generate SQL for computed field updates
        if (plan.sameTableBatches.length > 0) {
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

            // Get batch table name
            const batchTableNameResult = batchTable.dbTableName();
            const batchTableName = batchTableNameResult.isOk()
              ? batchTableNameResult.value.value().unwrapOr(batch.tableId.toString())
              : batch.tableId.toString();

            // Build SELECT query using ComputedTableRecordQueryBuilder
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const selectBuilder = new ComputedTableRecordQueryBuilder(analyzer.db as any);
            selectBuilder.from(batchTable).select(batchFieldIds);

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
              });
              continue;
            }

            const selectQueryResult = selectBuilder.build();
            if (selectQueryResult.isErr()) {
              sqlExplains.push({
                stepDescription: `Update batch ${i + 1}: ${batchTableName} (build failed)`,
                sql: `-- Failed to build SELECT: ${selectQueryResult.error.message}`,
                parameters: [],
                explainAnalyze: null,
                explainOnly: null,
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
            });

            if (compiledResult.isErr()) {
              sqlExplains.push({
                stepDescription: `Update batch ${i + 1}: ${batchTableName} (update build failed)`,
                sql: `-- Failed to build UPDATE: ${compiledResult.error.message}`,
                parameters: [],
                explainAnalyze: null,
                explainOnly: null,
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

            if (mergedOptions.analyze) {
              const analyzeResult = await analyzer.sqlExplainRunner.explainCompiled(
                analyzer.db,
                compiled,
                true
              );
              if (analyzeResult.isOk()) {
                explainAnalyze = analyzeResult.value as ExplainAnalyzeOutput;
              }
            } else {
              const explainResult = await analyzer.sqlExplainRunner.explainCompiled(
                analyzer.db,
                compiled,
                false
              );
              if (explainResult.isOk()) {
                explainOnly = explainResult.value as ExplainOutput;
              }
            }

            sqlExplains.push({
              stepDescription,
              sql: compiled.sql,
              parameters: compiled.parameters as unknown[],
              explainAnalyze,
              explainOnly,
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

    return {
      baseId: plan.baseId.toString(),
      seedTableId: plan.seedTableId.toString(),
      seedRecordCount: plan.seedRecordIds.length,
      dependencyGraph,
      updateSteps,
      sameTableBatches,
      affectedRecordEstimates,
    };
  }
}
