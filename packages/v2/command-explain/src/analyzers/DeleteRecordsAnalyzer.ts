import { inject, injectable } from '@teable/v2-di';
import { ok, err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  TableQueryService,
  DeleteRecordsCommand,
  v2CoreTokens,
  type Table,
  type LinkField,
  RecordId,
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
  UpdateFromSelectBuilder,
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
} from '../types';
import { DEFAULT_EXPLAIN_OPTIONS } from '../types';
import { v2CommandExplainTokens } from '../di/tokens';
import {
  SqlExplainRunner,
  type SetupStatement,
  type BatchExplainStatement,
} from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { buildComputedUpdateReason } from '../utils/ComputedUpdateReasonBuilder';
import { buildComputedUpdateLockInfo } from '../utils/ComputedUpdateLockInfoBuilder';
import { buildDirtyTableSetupStatements } from '../utils/DirtyTableSetupBuilder';

type LinkCleanupStatement = {
  stepDescription: string;
  sql: string;
};

/**
 * Analyzer for DeleteRecordsCommand.
 * Generates real SQL for the delete operation and computed field updates.
 */
@injectable()
export class DeleteRecordsAnalyzer implements ICommandAnalyzer<DeleteRecordsCommand> {
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
    command: DeleteRecordsCommand,
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

      // 2. Build command info
      const commandInfo: CommandExplainInfo = {
        type: 'DeleteRecords',
        tableId: command.tableId.toString(),
        tableName: table.name().toString(),
        recordIds: command.recordIds.map((id) => id.toString()),
        changeType: 'delete',
      };

      // 3. For delete, we need to consider link fields that may affect other tables
      // Also need to handle conditionalLookup/conditionalRollup fields that depend on this table
      const linkFields = table.getFields().filter((f) => f.type().equals(FieldType.link()));
      const linkFieldIds = linkFields.map((f) => f.id());

      // 4. Plan computed field updates for delete
      // Always call planner - even without link fields, conditionalLookup/conditionalRollup
      // fields in other tables may depend on fields in this table
      const graphStartTime = Date.now();

      let plan: ComputedUpdatePlan | null = null;
      let tableById: Map<string, Table> | null = null;
      let graphData: FieldDependencyGraphData | null = null;

      // Always call planner for delete operations to detect conditional field dependencies
      plan = yield* await analyzer.planner.plan({
        table,
        changedFieldIds: linkFieldIds,
        changedRecordIds: command.recordIds,
        changeType: 'delete',
        cyclePolicy: 'skip',
      });
      planningMs = Date.now() - graphStartTime;

      graphData = yield* await analyzer.dependencyGraph.load(table.baseId());
      dependencyGraphMs = Date.now() - graphStartTime;

      // Load tables for name resolution
      tableById = yield* await analyzer.loadTables(plan, context, table);

      const computedImpact = analyzer.buildComputedImpact(
        plan,
        graphData,
        table,
        tableById,
        mergedOptions
      );

      const computedLocks =
        mergedOptions.includeLocks && plan && tableById
          ? buildComputedUpdateLockInfo({
              plan,
              tableById,
              hasSteps: plan.steps.length > 0,
              config: analyzer.lockConfig,
            })
          : null;

      // 5. Generate real SQL and run EXPLAIN
      const sqlExplainStartTime = Date.now();
      const sqlExplains: SqlExplainInfo[] = [];

      if (mergedOptions.includeSql) {
        // Generate DELETE statement with real record IDs
        const recordIdList = command.recordIds.map((id) => `'${id.toString()}'`).join(', ');
        const quotedTableName = analyzer.quoteTableName(tableName);
        const deleteSql = `DELETE FROM ${quotedTableName} WHERE "__id" IN (${recordIdList})`;

        const runExplainForSql = async (
          stepDescription: string,
          sql: string
        ): Promise<SqlExplainInfo> => {
          let explainAnalyze: ExplainAnalyzeOutput | null = null;
          let explainOnly: ExplainOutput | null = null;
          let explainError: string | null = null;

          if (mergedOptions.analyze) {
            const analyzeResult = await analyzer.sqlExplainRunner.explain(
              analyzer.db,
              sql,
              [],
              true
            );
            if (analyzeResult.isOk()) {
              explainAnalyze = analyzeResult.value as ExplainAnalyzeOutput;
            } else {
              explainError = analyzeResult.error.message;
            }
          } else {
            const explainResult = await analyzer.sqlExplainRunner.explain(
              analyzer.db,
              sql,
              [],
              false
            );
            if (explainResult.isOk()) {
              explainOnly = explainResult.value as ExplainOutput;
            } else {
              explainError = explainResult.error.message;
            }
          }

          return {
            stepDescription,
            sql,
            parameters: [],
            explainAnalyze,
            explainOnly,
            explainError,
          };
        };

        const cleanupStatementsResult = analyzer.buildLinkCleanupStatements(
          table,
          command.recordIds
        );
        const deleteStepDescription = `Delete ${command.recordIds.length} record(s) from ${table
          .name()
          .toString()}`;

        if (mergedOptions.analyze) {
          const batchStatements: BatchExplainStatement[] = [];
          if (cleanupStatementsResult.isOk()) {
            for (const statement of cleanupStatementsResult.value) {
              batchStatements.push({
                sql: statement.sql,
                parameters: [],
                description: statement.stepDescription,
              });
            }
          }
          batchStatements.push({
            sql: deleteSql,
            parameters: [],
            description: deleteStepDescription,
          });

          const batchResult = await analyzer.sqlExplainRunner.explainBatchInTransaction(
            analyzer.db,
            batchStatements
          );

          if (batchResult.isOk()) {
            batchResult.value.forEach((result, index) => {
              const statement = batchStatements[index];
              if ('error' in result) {
                sqlExplains.push({
                  stepDescription: statement.description,
                  sql: statement.sql,
                  parameters: statement.parameters,
                  explainAnalyze: null,
                  explainOnly: null,
                  explainError: result.error,
                });
                return;
              }

              const explainAnalyze = 'executionTimeMs' in result ? result : null;
              const explainOnly = 'executionTimeMs' in result ? null : result;

              sqlExplains.push({
                stepDescription: statement.description,
                sql: statement.sql,
                parameters: statement.parameters,
                explainAnalyze,
                explainOnly,
                explainError: null,
              });
            });
          } else {
            sqlExplains.push({
              stepDescription: 'Explain batch failed',
              sql: '-- Failed to run batch explain',
              parameters: [],
              explainAnalyze: null,
              explainOnly: null,
              explainError: batchResult.error.message,
            });
          }
        } else {
          if (cleanupStatementsResult.isOk()) {
            for (const statement of cleanupStatementsResult.value) {
              sqlExplains.push(await runExplainForSql(statement.stepDescription, statement.sql));
            }
          } else {
            sqlExplains.push({
              stepDescription: 'Clear link references before delete (failed)',
              sql: `-- Failed to build cleanup SQL: ${cleanupStatementsResult.error.message}`,
              parameters: [],
              explainAnalyze: null,
              explainOnly: null,
              explainError: cleanupStatementsResult.error.message,
            });
          }

          sqlExplains.push(await runExplainForSql(deleteStepDescription, deleteSql));
        }

        // Generate SQL for computed field updates on linked tables
        if (plan && plan.sameTableBatches.length > 0 && tableById && graphData) {
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
              changedFieldIds: linkFieldIds,
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
              sqlExplains.push({
                stepDescription: `Computed update batch ${i + 1}: ${batchTableName} (prepare failed)`,
                sql: `-- Failed to prepare: ${prepareResult.error.message}`,
                parameters: [],
                explainAnalyze: null,
                explainOnly: null,
                explainError: prepareResult.error.message,
                computedReason,
              });
              continue;
            }

            const selectQueryResult = selectBuilder.build();
            if (selectQueryResult.isErr()) {
              sqlExplains.push({
                stepDescription: `Computed update batch ${i + 1}: ${batchTableName} (build failed)`,
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
            const updateBuilder = new UpdateFromSelectBuilder(analyzer.db as any);
            const compiledResult = updateBuilder.build({
              table: batchTable,
              fieldIds: batchFieldIds,
              selectQuery: selectQueryResult.value,
              dirtyFilter: { tableId: batch.tableId },
            });

            if (compiledResult.isErr()) {
              sqlExplains.push({
                stepDescription: `Computed update batch ${i + 1}: ${batchTableName} (update build failed)`,
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
            let explainError: string | null = null;

            if (mergedOptions.analyze) {
              const analyzeResult = await analyzer.sqlExplainRunner.explainCompiled(
                analyzer.db,
                compiled,
                true,
                setupStatements
              );
              if (analyzeResult.isOk()) {
                explainAnalyze = analyzeResult.value as ExplainAnalyzeOutput;
              } else {
                explainError = analyzeResult.error.message;
              }
            } else {
              const explainResult = await analyzer.sqlExplainRunner.explainCompiled(
                analyzer.db,
                compiled,
                false,
                setupStatements
              );
              if (explainResult.isOk()) {
                explainOnly = explainResult.value as ExplainOutput;
              } else {
                explainError = explainResult.error.message;
              }
            }

            sqlExplains.push({
              stepDescription,
              sql: compiled.sql,
              parameters: compiled.parameters as unknown[],
              explainAnalyze,
              explainOnly,
              explainError,
              computedReason,
            });
          }
        }
      }
      sqlExplainMs = Date.now() - sqlExplainStartTime;

      // 6. Calculate complexity
      const complexity = analyzer.complexityCalculator.calculate({
        commandInfo,
        computedImpact,
        sqlExplains,
      });

      return ok({
        command: commandInfo,
        computedImpact,
        computedLocks,
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

  private quoteTableName(tableName: string): string {
    return tableName
      .split('.')
      .map((part) => `"${part}"`)
      .join('.');
  }

  private buildLinkCleanupStatements(
    table: Table,
    recordIds: ReadonlyArray<RecordId>
  ): Result<LinkCleanupStatement[], DomainError> {
    if (recordIds.length === 0) return ok([]);

    const statements: LinkCleanupStatement[] = [];
    const recordIdList = recordIds.map((id) => `'${id.toString()}'`).join(', ');
    const linkFields = table
      .getFields()
      .filter((field): field is LinkField => field.type().equals(FieldType.link()));

    for (const linkField of linkFields) {
      const relationship = linkField.relationship().toString();

      if (relationship === 'manyMany' || (relationship === 'oneMany' && linkField.isOneWay())) {
        const junctionTableResult = linkField.fkHostTableNameString();
        if (junctionTableResult.isErr()) return err(junctionTableResult.error);
        const selfKeyResult = linkField.selfKeyNameString();
        if (selfKeyResult.isErr()) return err(selfKeyResult.error);

        statements.push({
          stepDescription: `Clear link references for ${linkField.name().toString()} (junction)`,
          sql: `DELETE FROM ${this.quoteTableName(
            junctionTableResult.value
          )} WHERE "${selfKeyResult.value}" IN (${recordIdList})`,
        });
        continue;
      }

      if (relationship === 'oneMany') {
        const foreignTableResult = linkField.fkHostTableNameString();
        if (foreignTableResult.isErr()) return err(foreignTableResult.error);
        const selfKeyResult = linkField.selfKeyNameString();
        if (selfKeyResult.isErr()) return err(selfKeyResult.error);
        const orderColumnNameResult = linkField.hasOrderColumn()
          ? linkField.orderColumnName()
          : ok(null);
        if (orderColumnNameResult.isErr()) return err(orderColumnNameResult.error);
        const orderColumnName = orderColumnNameResult.value;

        const assignments = [`"${selfKeyResult.value}" = NULL`];
        if (orderColumnName) {
          assignments.push(`"${orderColumnName}" = NULL`);
        }

        statements.push({
          stepDescription: `Clear link references for ${linkField.name().toString()}`,
          sql: `UPDATE ${this.quoteTableName(
            foreignTableResult.value
          )} SET ${assignments.join(', ')} WHERE "${selfKeyResult.value}" IN (${recordIdList})`,
        });
      }
    }

    return ok(statements);
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
      async function* (this: DeleteRecordsAnalyzer) {
        yield* ok(undefined);
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

  private buildSimpleComputedImpact(
    graphData: FieldDependencyGraphData,
    table: Table,
    recordCount: number,
    _options: Required<ExplainOptions>
  ): ComputedImpactInfo {
    const tableId = table.id().toString();

    return {
      baseId: table.baseId().toString(),
      seedTableId: tableId,
      seedRecordCount: recordCount,
      dependencyGraph: {
        fieldCount: graphData.fieldsById.size,
        edgeCount: 0,
        edges: [],
      },
      updateSteps: [],
      sameTableBatches: [],
      affectedRecordEstimates: [
        {
          tableId,
          tableName: tableId,
          estimatedCount: recordCount,
          source: 'seed',
        },
      ],
    };
  }
}
