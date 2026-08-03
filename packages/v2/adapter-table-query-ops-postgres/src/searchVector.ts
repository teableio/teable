import { domainError, type IExecutionContext, type Table } from '@teable/v2-core';
import {
  buildTableSearchVectorDefinition,
  SearchScopeHeatPolicy,
  type ReconcileTableSearchVectorInput,
  type ReconcileTableSearchVectorResult,
  type SearchScopeHeatEntry,
  type SearchScopeHeatReportSnapshot,
  type TableQueryObservationWindow,
  type TableSearchVectorReconciler,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';

import { getTablePhysicalName, makePhysicalTableSql, quoteIdentifier } from './helpers';
import type { UnknownPostgresDatabase } from './types';

const DEFAULT_LANGUAGE_CONFIG = 'simple';
const LARGE_TABLE_REWRITE_ESTIMATED_ROWS = 50_000;
const MIN_RECOMMENDED_COST_IMPROVEMENT_PCT = 20;

// All generated columns and indexes this advisor manages carry these prefixes.
// The executor refuses to ADD/DROP anything that does not, so a hand-built or
// mistyped payload can never rewrite/drop a real user column or index.
const GENERATED_COLUMN_PREFIX = '__tqops_tsv_';
const INDEX_NAME_PREFIX = 'idx_tqops_tsv_';
const SCOPED_EXPRESSION_INDEX_PREFIX = 'idx_tqops_fts_scope_';
const SEARCH_SEMANTICS_SAMPLE_LIMIT = 3;
const SEARCH_SEMANTICS_FIELD_PREVIEW_LIMIT = 4;
const SEARCH_SEMANTICS_TOKEN_LIMIT = 16;
const SEARCH_SEMANTICS_PREVIEW_LENGTH = 120;

type ExplainRow = {
  readonly 'QUERY PLAN': unknown;
};

type ExplainPlan = {
  readonly startupCost?: number;
  readonly totalCost?: number;
  readonly nodeType?: string;
  readonly indexName?: string;
  readonly rawPlan?: unknown;
};

export type TableQuerySearchVectorNextAction =
  | 'ready_for_confirmation'
  | 'no_index_change'
  | 'candidate_not_recommended'
  | 'needs_plan_validation'
  | 'manual_investigation';

export type TableQuerySearchVectorFieldSummary = {
  readonly fieldId: string;
  readonly fieldDbName?: string;
  readonly fieldType: string;
  readonly valueType?: string;
  readonly included: boolean;
  readonly skippedReason?: string;
};

export type TableQuerySearchVectorInventory = {
  readonly state: 'ready' | 'missing' | 'stale' | 'invalid' | 'unknown';
  readonly existingGeneratedColumn?: string;
  readonly existingIndexName?: string;
  readonly existingIndexValid?: boolean;
  readonly staleReasons: readonly string[];
};

export type TableQuerySearchVectorPlanEvidence = {
  readonly explainStatus: 'validated' | 'skipped' | 'failed';
  readonly explainMethod?: 'explain' | 'hypothetical_index' | 'real_index';
  readonly explainReason?: string;
  readonly costBefore?: number;
  readonly costAfter?: number;
  readonly costDeltaPct?: number;
  readonly planNodeBefore?: string;
  readonly planNodeAfter?: string;
  readonly usesCandidateIndex?: boolean;
  readonly hypotheticalIndexStatement?: string;
  readonly sqlDetails?: TableQuerySearchVectorSqlDetails;
};

export type TableQuerySearchVectorSqlDetails = {
  readonly beforeSql: string;
  readonly afterSql: string;
  readonly searchProbeLengthBucket: 'none' | 'short' | 'medium' | 'long';
  readonly placeholders: {
    readonly likePattern: string;
    readonly tsquery: string;
  };
  readonly redaction: 'search_probe_parameterized';
};

export type TableQuerySearchSemanticsStrategy =
  | 'ilike'
  | 'trigram'
  | 'tsvector_simple'
  | 'tsvector_english'
  | 'tsvector_pg_jieba';

export type TableQuerySearchSemanticsToken = {
  readonly token: string;
  readonly alias?: string;
  readonly lexemes: readonly string[];
};

export type TableQuerySearchSemanticsSampleResult = {
  readonly recordId?: string;
  readonly fieldPreviews: readonly {
    readonly fieldId: string;
    readonly fieldDbName: string;
    readonly preview: string;
    readonly previewLength: number;
    readonly truncated: boolean;
  }[];
};

export type TableQuerySearchSemanticsAssessment = {
  readonly status: 'needs_llm_review' | 'not_evaluated';
  readonly reasonCodes: readonly string[];
  readonly instruction: string;
};

export type TableQuerySearchSemanticsComparison = {
  readonly strategy: TableQuerySearchSemanticsStrategy;
  readonly label: string;
  readonly semantics: 'substring' | 'trigram_substring' | 'full_text';
  readonly available: boolean;
  readonly availabilityReason?: string;
  readonly tokenizer?: string;
  readonly languageConfig?: string;
  readonly indexSupport:
    | 'none'
    | 'existing_or_manual_trigram'
    | 'generated_tsvector_gin'
    | 'extension_required';
  readonly tokenPreview: readonly TableQuerySearchSemanticsToken[];
  readonly tokenCount?: number;
  readonly explainStatus: 'validated' | 'skipped' | 'failed';
  readonly explainReason?: string;
  readonly cost?: number;
  readonly planNode?: string;
  readonly usesIndex?: boolean;
  readonly matchCount?: number;
  readonly matchCountDeltaFromIlike?: number;
  readonly matchCountDeltaPctFromIlike?: number;
  readonly sampleOverlapWithIlike?: number;
  readonly sampleResults: readonly TableQuerySearchSemanticsSampleResult[];
  readonly reasonablenessAssessment: TableQuerySearchSemanticsAssessment;
};

export type TableQuerySearchSemanticsReport = {
  readonly searchProbeLengthBucket: 'none' | 'short' | 'medium' | 'long';
  readonly comparedStrategies: readonly TableQuerySearchSemanticsStrategy[];
  readonly baselineStrategy: 'ilike';
  readonly comparisons: readonly TableQuerySearchSemanticsComparison[];
  readonly llmEvaluationInput: {
    readonly status: 'needs_llm_review';
    readonly redaction: 'ephemeral_operator_probe_not_persisted';
    readonly searchProbe: string;
    readonly instruction: string;
    readonly criteria: readonly string[];
    readonly strategies: readonly {
      readonly strategy: TableQuerySearchSemanticsStrategy;
      readonly label: string;
      readonly tokenPreview: readonly TableQuerySearchSemanticsToken[];
      readonly matchCount?: number;
      readonly cost?: number;
      readonly sampleResults: readonly TableQuerySearchSemanticsSampleResult[];
    }[];
  };
};

export type TableQuerySearchVectorRecommendation = {
  readonly candidateKey: string;
  readonly tableId: string;
  readonly baseId: string;
  readonly generatedColumnName: string;
  readonly indexName: string;
  readonly indexKind: 'gin_tsvector';
  readonly accessPath: 'generated_tsvector';
  readonly languageConfig: string;
  readonly searchScope: 'selected_fields' | 'all_fields';
  readonly coveredFields: readonly TableQuerySearchVectorFieldSummary[];
  readonly skippedFields: readonly TableQuerySearchVectorFieldSummary[];
  readonly estimatedRows: number;
  readonly tableSizeBytes?: number;
  readonly inventory: TableQuerySearchVectorInventory;
  readonly planEvidence: TableQuerySearchVectorPlanEvidence;
  readonly semanticsReport?: TableQuerySearchSemanticsReport;
  readonly nextAction: TableQuerySearchVectorNextAction;
};

export type TableQueryScopedSearchIndexRecommendation = {
  readonly candidateKey: string;
  readonly tableId: string;
  readonly baseId: string;
  readonly indexName: string;
  readonly indexKind: 'gin_tsvector_expression';
  readonly accessPath: 'scoped_expression_gin';
  readonly languageConfig: string;
  readonly searchedFieldIds: readonly string[];
  readonly coveredFields: readonly TableQuerySearchVectorFieldSummary[];
  readonly scopeHeat: SearchScopeHeatEntry;
  readonly planEvidence: TableQuerySearchVectorPlanEvidence;
  readonly nextAction: TableQuerySearchVectorNextAction;
};

export type AnalyzeTableSearchVectorInput = {
  readonly table: Table;
  readonly fieldIds?: readonly string[];
  readonly languageConfig?: string;
  readonly searchProbe?: string;
  readonly includeResultSamples?: boolean;
  readonly sampleResultLimit?: number;
  readonly maxRecommendations?: number;
  readonly observations?: readonly TableQueryObservationWindow[];
};

export type AnalyzeTableSearchVectorResult = {
  readonly tableId: string;
  readonly baseId: string;
  readonly languageConfig: string;
  readonly searchProbeLengthBucket: 'none' | 'short' | 'medium' | 'long';
  readonly scannedFieldCount: number;
  readonly coveredFieldCount: number;
  readonly skippedFieldCount: number;
  readonly recommendations: readonly TableQuerySearchVectorRecommendation[];
  readonly scopeHeatReport?: SearchScopeHeatReportSnapshot;
  readonly scopedExpressionRecommendations: readonly TableQueryScopedSearchIndexRecommendation[];
  readonly inventory: TableQuerySearchVectorInventory;
  readonly coverageReport: {
    readonly scannedFieldCount: number;
    readonly coveredFieldCount: number;
    readonly skippedFieldCount: number;
    readonly skippedReasons: Readonly<Record<string, number>>;
  };
};

export type ExecuteTableSearchVectorInput = {
  readonly tableId: string;
  readonly payload: {
    readonly candidateKey: string;
    readonly languageConfig: string;
    readonly searchProbe?: string;
    readonly validationMode?: 'plan' | 'real_ddl';
    readonly generatedColumnName: string;
    readonly indexName: string;
    readonly fields: readonly {
      readonly fieldId: string;
      readonly fieldDbName: string;
      readonly fieldType?: string;
    }[];
    readonly searchScope?: 'all_fields' | 'selected_fields';
    readonly allowLargeTableRewrite?: boolean;
    readonly rebuild?: boolean;
  };
};

export type SearchVectorExecutionCandidateInput = {
  readonly candidateKey: string;
  readonly generatedColumnName: string;
  readonly indexName: string;
  readonly fields: readonly {
    readonly fieldId: string;
    readonly fieldDbName: string;
  }[];
};

export type ExecuteTableSearchVectorResult = {
  readonly action: 'created' | 'rebuilt' | 'verified';
  readonly createdOrVerified: boolean;
  readonly candidateKey: string;
  readonly generatedColumnName: string;
  readonly indexName: string;
  readonly languageConfig: string;
  readonly fieldIds: readonly string[];
  readonly fieldDbNames: readonly string[];
  readonly estimatedRows: number;
  readonly inventory: TableQuerySearchVectorInventory;
  readonly planEvidence?: TableQuerySearchVectorPlanEvidence;
};

type TableMetaRow = {
  readonly base_id: string;
  readonly space_id: string | null;
  readonly db_table_name: string;
};

type SearchVectorConfigRow = {
  readonly candidate_key: string;
  readonly generated_column_name: string;
  readonly index_name: string;
  readonly language_config: string;
  readonly field_ids: unknown;
  readonly search_scope: string;
};

type PhysicalTable = {
  readonly schema: string;
  readonly tableName: string;
};

type IncludedSearchVectorField = TableQuerySearchVectorFieldSummary & {
  readonly fieldDbName: string;
};

export class PostgresTableSearchVectorAdvisor {
  constructor(private readonly dataDb: Kysely<UnknownPostgresDatabase>) {}

  async analyze(
    _context: IExecutionContext,
    input: AnalyzeTableSearchVectorInput
  ): Promise<AnalyzeTableSearchVectorResult> {
    const table = input.table;
    const tableId = table.id().toString();
    const baseId = table.baseId().toString();
    const languageConfig = normalizeLanguageConfig(input.languageConfig);
    const definition = buildTableSearchVectorDefinition(table, {
      fieldIds: input.fieldIds,
      languageConfig,
    });
    if (definition.isErr()) throw definition.error;
    const fieldSummaries: readonly TableQuerySearchVectorFieldSummary[] = [
      ...definition.value.fields,
      ...definition.value.skippedFields,
    ];
    const coveredFields = fieldSummaries.filter(
      (field): field is IncludedSearchVectorField => field.included && Boolean(field.fieldDbName)
    );
    const skippedFields = fieldSummaries.filter((field) => !field.included);
    const physicalResult = getTablePhysicalName(table);
    if (physicalResult.isErr()) {
      return {
        tableId,
        baseId,
        languageConfig,
        searchProbeLengthBucket: lengthBucket(input.searchProbe),
        scannedFieldCount: fieldSummaries.length,
        coveredFieldCount: coveredFields.length,
        skippedFieldCount: skippedFields.length,
        recommendations: [],
        scopedExpressionRecommendations: [],
        inventory: {
          state: 'unknown',
          staleReasons: ['physical_table_name_failed'],
        },
        coverageReport: buildCoverage(fieldSummaries),
      };
    }

    const physical = physicalResult.value;
    const rowEstimate = await readRowEstimate(this.dataDb, physical);
    const estimatedRows = rowEstimate.rows;
    const tableSizeBytes = await readTableSizeBytes(this.dataDb, physical);
    const names = buildSearchVectorNames(tableId, languageConfig, coveredFields);
    const inventory = await inspectSearchVectorInventory(
      this.dataDb,
      physical,
      names,
      coveredFields
    );
    const planEvidence = await this.validatePlan({
      physical,
      languageConfig,
      fields: coveredFields,
      searchProbe: input.searchProbe,
    });
    const semanticsReport = await analyzeSearchSemantics(this.dataDb, {
      physical,
      fields: coveredFields,
      searchProbe: input.searchProbe,
      includeResultSamples: input.includeResultSamples ?? true,
      sampleResultLimit: input.sampleResultLimit ?? SEARCH_SEMANTICS_SAMPLE_LIMIT,
    });
    const nextAction = chooseNextAction({
      inventory,
      planEvidence,
      coveredFieldCount: coveredFields.length,
    });

    const recommendation: TableQuerySearchVectorRecommendation | undefined =
      coveredFields.length > 0
        ? {
            candidateKey: names.candidateKey,
            tableId,
            baseId,
            generatedColumnName: names.generatedColumnName,
            indexName: names.indexName,
            indexKind: 'gin_tsvector',
            accessPath: 'generated_tsvector',
            languageConfig,
            searchScope: input.fieldIds?.length ? 'selected_fields' : 'all_fields',
            coveredFields,
            skippedFields,
            estimatedRows,
            tableSizeBytes,
            inventory,
            planEvidence,
            ...(semanticsReport ? { semanticsReport } : {}),
            nextAction,
          }
        : undefined;

    const scopeHeatReport = this.evaluateScopeHeat(input.observations, estimatedRows);
    if (scopeHeatReport?.isErr()) throw scopeHeatReport.error;
    const scopedExpressionRecommendations = scopeHeatReport?.isOk()
      ? await this.buildScopedExpressionRecommendations({
          scopeHeatEntries: scopeHeatReport.value.hotScopes(),
          coveredFields,
          tableId,
          baseId,
          languageConfig,
          physical,
          globalGeneratedColumnName: names.generatedColumnName,
          globalInventoryState: inventory.state,
          searchProbe: input.searchProbe,
        })
      : [];

    return {
      tableId,
      baseId,
      languageConfig,
      searchProbeLengthBucket: lengthBucket(input.searchProbe),
      scannedFieldCount: fieldSummaries.length,
      coveredFieldCount: coveredFields.length,
      skippedFieldCount: skippedFields.length,
      recommendations: recommendation
        ? [recommendation].slice(0, input.maxRecommendations ?? 1)
        : [],
      ...(scopeHeatReport?.isOk() ? { scopeHeatReport: scopeHeatReport.value.snapshot() } : {}),
      scopedExpressionRecommendations: scopedExpressionRecommendations.slice(
        0,
        input.maxRecommendations ?? 5
      ),
      inventory,
      coverageReport: buildCoverage(fieldSummaries),
    };
  }

  private async buildScopedExpressionRecommendations(input: {
    readonly scopeHeatEntries: readonly SearchScopeHeatEntry[];
    readonly coveredFields: readonly IncludedSearchVectorField[];
    readonly tableId: string;
    readonly baseId: string;
    readonly languageConfig: string;
    readonly physical: PhysicalTable;
    readonly globalGeneratedColumnName: string;
    readonly globalInventoryState: TableQuerySearchVectorInventory['state'];
    readonly searchProbe?: string;
  }): Promise<readonly TableQueryScopedSearchIndexRecommendation[]> {
    const recommendations = await Promise.all(
      input.scopeHeatEntries.map(
        async (scopeHeat): Promise<TableQueryScopedSearchIndexRecommendation | undefined> => {
          const scopeFieldIds = new Set(scopeHeat.searchedFieldIds);
          const scopeFields = input.coveredFields.filter((field) =>
            scopeFieldIds.has(field.fieldId)
          );
          if (scopeFields.length !== scopeFieldIds.size) return undefined;

          const languageConfig = normalizeLanguageConfig(
            scopeHeat.languageConfig ?? input.languageConfig
          );
          const names = buildScopedExpressionIndexNames(input.tableId, languageConfig, scopeFields);
          const planEvidence =
            input.globalInventoryState === 'ready'
              ? await this.validatePlan({
                  physical: input.physical,
                  languageConfig,
                  fields: scopeFields,
                  searchProbe: input.searchProbe,
                  globalGeneratedColumnName: input.globalGeneratedColumnName,
                })
              : {
                  explainStatus: 'skipped' as const,
                  explainReason: 'global_search_vector_not_ready',
                };

          return {
            candidateKey: names.candidateKey,
            tableId: input.tableId,
            baseId: input.baseId,
            indexName: names.indexName,
            indexKind: 'gin_tsvector_expression',
            accessPath: 'scoped_expression_gin',
            languageConfig,
            searchedFieldIds: scopeHeat.searchedFieldIds,
            coveredFields: scopeFields,
            scopeHeat,
            planEvidence,
            nextAction: chooseScopedExpressionNextAction(planEvidence),
          };
        }
      )
    );
    return recommendations.filter(
      (item): item is TableQueryScopedSearchIndexRecommendation => item != null
    );
  }

  private evaluateScopeHeat(
    observations: readonly TableQueryObservationWindow[] | undefined,
    estimatedRows: number
  ): ReturnType<SearchScopeHeatPolicy['evaluate']> | undefined {
    return observations?.length
      ? new SearchScopeHeatPolicy().evaluate({ observations, estimatedRows })
      : undefined;
  }

  private async validatePlan(input: {
    readonly physical: PhysicalTable;
    readonly languageConfig: string;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
    readonly globalGeneratedColumnName?: string;
  }): Promise<TableQuerySearchVectorPlanEvidence> {
    if (!input.fields.length) {
      return {
        explainStatus: 'skipped',
        explainReason: 'no_indexable_search_fields',
      };
    }
    if (!input.searchProbe?.trim()) {
      return {
        explainStatus: 'skipped',
        explainReason: 'search_probe_missing',
      };
    }

    try {
      const sqlDetails = input.globalGeneratedColumnName
        ? buildScopedSearchVectorSqlDetails({
            ...input,
            globalGeneratedColumnName: input.globalGeneratedColumnName,
          })
        : buildSearchVectorExpressionSqlDetails(input);
      const tsqueryHasNodes = await hasTsQueryNodes(
        this.dataDb,
        input.languageConfig,
        input.searchProbe
      );
      if (!tsqueryHasNodes) {
        return { explainStatus: 'skipped', explainReason: 'empty_tsquery' };
      }

      return await this.dataDb.connection().execute(async (db) => {
        const before = input.globalGeneratedColumnName
          ? await explainScopedSearch(db, {
              ...input,
              globalGeneratedColumnName: input.globalGeneratedColumnName,
            })
          : await explainSearchBefore(db, input);
        const hypotheticalIndexStatement = buildHypotheticalSearchVectorIndexStatement(input);
        const hypopgSchema = await readHypopgSchema(db);
        if (!hypopgSchema) {
          return {
            explainStatus: 'validated',
            explainMethod: 'explain',
            explainReason: 'hypopg_extension_unavailable',
            costBefore: before.totalCost,
            planNodeBefore: before.nodeType,
            hypotheticalIndexStatement,
            sqlDetails,
          };
        }

        await resetHypopg(db, hypopgSchema);
        try {
          await sql`
            SELECT * FROM ${sql.raw(quoteIdentifier(hypopgSchema))}.hypopg_create_index(${hypotheticalIndexStatement})
          `.execute(db);
          const after = input.globalGeneratedColumnName
            ? await explainScopedSearch(db, {
                ...input,
                globalGeneratedColumnName: input.globalGeneratedColumnName,
              })
            : await explainSearchAfter(db, input);
          return {
            explainStatus: 'validated',
            explainMethod: 'hypothetical_index',
            explainReason: 'plan_validated',
            costBefore: before.totalCost,
            costAfter: after.totalCost,
            costDeltaPct: explainCostDeltaPct(before.totalCost, after.totalCost),
            planNodeBefore: before.nodeType,
            planNodeAfter: after.nodeType,
            usesCandidateIndex:
              input.globalGeneratedColumnName != null
                ? planReferencesHypotheticalIndex(after.rawPlan)
                : Boolean(after.indexName) || planReferencesHypotheticalIndex(after.rawPlan),
            hypotheticalIndexStatement,
            sqlDetails,
          };
        } catch (hypoError) {
          if (!isHypopgGinUnsupported(hypoError)) {
            throw hypoError;
          }
          // Stock HypoPG only models btree/brin/hash — a hypothetical GIN throws
          // "access method gin is not supported". Don't lose the real before cost we
          // already measured; degrade to explain-only so nextAction stays
          // needs_plan_validation instead of a bare failure.
          return {
            explainStatus: 'validated',
            explainMethod: 'explain',
            explainReason: `hypopg_gin_unsupported: ${
              hypoError instanceof Error ? hypoError.message : String(hypoError)
            }`,
            costBefore: before.totalCost,
            planNodeBefore: before.nodeType,
            hypotheticalIndexStatement,
            sqlDetails,
          };
        } finally {
          await resetHypopg(db, hypopgSchema);
        }
      });
    } catch (error) {
      return {
        explainStatus: 'failed',
        explainReason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class PostgresTableSearchVectorExecutor {
  constructor(
    private readonly metaDb: Kysely<UnknownPostgresDatabase>,
    private readonly dataDb: Kysely<UnknownPostgresDatabase>
  ) {}

  async execute(input: ExecuteTableSearchVectorInput): Promise<ExecuteTableSearchVectorResult> {
    return this.metaDb.connection().execute(async (lockedMetaDb) => {
      await sql`
        SELECT pg_advisory_lock(
          hashtext('teable.table_query_ops.search_vector'),
          hashtext(${input.tableId})
        )
      `.execute(lockedMetaDb);
      try {
        const lockedDataDb = this.dataDb === this.metaDb ? lockedMetaDb : this.dataDb;
        return await new PostgresTableSearchVectorExecutor(
          lockedMetaDb,
          lockedDataDb
        ).executeUnlocked(input);
      } finally {
        await sql`
          SELECT pg_advisory_unlock(
            hashtext('teable.table_query_ops.search_vector'),
            hashtext(${input.tableId})
          )
        `.execute(lockedMetaDb);
      }
    });
  }

  private async executeUnlocked(
    input: ExecuteTableSearchVectorInput
  ): Promise<ExecuteTableSearchVectorResult> {
    const tableMeta = await this.requireTableMeta(input.tableId);
    const physical = splitPhysicalName(tableMeta.db_table_name, tableMeta.base_id);
    const columnName = input.payload.generatedColumnName;
    const indexName = input.payload.indexName;
    // Only ADD/DROP objects this advisor owns, so a hand-built payload can never
    // target a real user column (`rebuild` would otherwise DROP it) or index.
    assertManagedSearchVectorNames(columnName, indexName);

    const rowEstimate = await readRowEstimate(this.dataDb, physical);

    const fields = input.payload.fields.filter((field) => field.fieldDbName);
    if (!fields.length) {
      throw new Error('Search vector task payload must include at least one field');
    }
    const languageConfig = normalizeLanguageConfig(input.payload.languageConfig);
    const validationMode = input.payload.validationMode ?? 'plan';
    const searchProbe = input.payload.searchProbe;
    if (validationMode === 'real_ddl' && !searchProbe?.trim()) {
      throw new Error('Real-DDL search vector validation requires a searchProbe');
    }
    const validationFields = fields.map((field) => ({
      fieldId: field.fieldId,
      fieldDbName: field.fieldDbName,
      fieldType: field.fieldType ?? 'unknown',
      included: true,
    }));
    const realDdlBeforePlan =
      validationMode === 'real_ddl'
        ? await readRealDdlSearchVectorBeforePlan(this.dataDb, {
            physical,
            languageConfig,
            fields: validationFields,
            searchProbe,
          })
        : undefined;
    const expression = buildSearchVectorExpression(
      languageConfig,
      fields.map((field) => field.fieldDbName)
    );
    const tableSql = makePhysicalTableSql(physical.schema, physical.tableName);

    const currentConfig = await this.currentConfig(input.tableId);
    this.assertDefinitionChangeAllowed(currentConfig, input);
    const inventoryBefore = await inspectSearchVectorInventory(
      this.dataDb,
      physical,
      { generatedColumnName: columnName, indexName },
      validationFields
    );
    const alreadyReady =
      currentConfig?.candidate_key === input.payload.candidateKey &&
      inventoryBefore.state === 'ready' &&
      !input.payload.rebuild;

    this.assertTableRewriteAllowed(rowEstimate, alreadyReady, input);

    if (input.payload.rebuild && currentConfig) {
      await this.markConfigRebuildPending(input.tableId, currentConfig.candidate_key);
    }

    const changedManagedObjects = input.payload.rebuild || !alreadyReady;
    try {
      const { inventory, planEvidence } = await this.createAndValidateManagedObjects({
        physical,
        tableSql,
        currentConfig,
        columnName,
        indexName,
        expression,
        rebuild: input.payload.rebuild ?? false,
        alreadyReady,
        validationMode,
        languageConfig,
        realDdlBeforePlan,
        searchProbe,
        validationFields,
      });

      await this.upsertConfig({
        tableId: input.tableId,
        baseId: tableMeta.base_id,
        spaceId: tableMeta.space_id,
        candidateKey: input.payload.candidateKey,
        languageConfig,
        generatedColumnName: columnName,
        indexName,
        fieldIds: fields.map((field) => field.fieldId),
        fieldDbNames: fields.map((field) => field.fieldDbName),
        searchScope: input.payload.searchScope ?? 'all_fields',
        inventory,
      });

      return {
        action: input.payload.rebuild ? 'rebuilt' : alreadyReady ? 'verified' : 'created',
        createdOrVerified: true,
        candidateKey: input.payload.candidateKey,
        generatedColumnName: columnName,
        indexName,
        languageConfig,
        fieldIds: fields.map((field) => field.fieldId),
        fieldDbNames: fields.map((field) => field.fieldDbName),
        estimatedRows: rowEstimate.rows,
        inventory,
        ...(planEvidence ? { planEvidence } : {}),
      };
    } catch (error) {
      return this.rethrowAfterManagedObjectCleanup(
        {
          changedManagedObjects,
          physical,
          tableSql,
          columnName,
          indexName,
        },
        error
      );
    }
  }

  private async requireTableMeta(tableId: string): Promise<TableMetaRow> {
    const tableMeta = await this.findTableMeta(tableId);
    if (!tableMeta) {
      throw new Error('Table meta not found for search vector remediation task');
    }
    return tableMeta;
  }

  private assertDefinitionChangeAllowed(
    currentConfig: SearchVectorConfigRow | undefined,
    input: ExecuteTableSearchVectorInput
  ): void {
    if (
      currentConfig &&
      currentConfig.candidate_key !== input.payload.candidateKey &&
      !input.payload.rebuild
    ) {
      throw new Error('Search vector definition changed; rerun with mode=rebuild');
    }
  }

  private assertTableRewriteAllowed(
    rowEstimate: RowEstimate,
    alreadyReady: boolean,
    input: ExecuteTableSearchVectorInput
  ): void {
    const requiresPermission =
      !alreadyReady &&
      (!rowEstimate.known || rowEstimate.rows >= LARGE_TABLE_REWRITE_ESTIMATED_ROWS);
    if (!requiresPermission || input.payload.allowLargeTableRewrite) return;

    throw new Error(
      rowEstimate.known
        ? `Search vector generated column may rewrite a large table (${rowEstimate.rows} estimated rows); rerun with allowLargeTableRewrite=true`
        : 'Search vector generated column requires a full table rewrite but the table size is unknown (never analyzed); run ANALYZE first or rerun with allowLargeTableRewrite=true'
    );
  }

  private async markConfigRebuildPending(tableId: string, candidateKey: string): Promise<void> {
    await sql`
      UPDATE table_query_search_vector_config
      SET status = 'rebuild_pending',
          last_inspection = ${JSON.stringify({
            state: 'rebuild_pending',
            staleReasons: ['manual_rebuild'],
          })}::jsonb,
          last_modified_time = now()
      WHERE table_id = ${tableId}
        AND candidate_key = ${candidateKey}
    `.execute(this.metaDb);
  }

  private async createAndValidateManagedObjects(input: {
    readonly physical: PhysicalTable;
    readonly tableSql: string;
    readonly currentConfig: SearchVectorConfigRow | undefined;
    readonly columnName: string;
    readonly indexName: string;
    readonly expression: string;
    readonly rebuild: boolean;
    readonly alreadyReady: boolean;
    readonly validationMode: 'plan' | 'real_ddl';
    readonly languageConfig: string;
    readonly realDdlBeforePlan: ExplainPlan | undefined;
    readonly searchProbe: string | undefined;
    readonly validationFields: readonly IncludedSearchVectorField[];
  }): Promise<{
    readonly inventory: TableQuerySearchVectorInventory;
    readonly planEvidence: TableQuerySearchVectorPlanEvidence | undefined;
  }> {
    if (input.rebuild) {
      await this.dropManagedObjects(
        input.physical,
        input.tableSql,
        input.currentConfig,
        input.columnName,
        input.indexName
      );
    }

    if (!input.alreadyReady) {
      await this.createManagedObjects(
        input.tableSql,
        input.columnName,
        input.indexName,
        input.expression
      );
    }

    const inventory = await inspectSearchVectorInventory(
      this.dataDb,
      input.physical,
      {
        generatedColumnName: input.columnName,
        indexName: input.indexName,
      },
      input.validationFields
    );
    this.assertReadyInventory(inventory);

    const planEvidence =
      input.validationMode === 'real_ddl'
        ? await validateRealDdlSearchVectorPlan(this.dataDb, {
            physical: input.physical,
            languageConfig: input.languageConfig,
            beforePlan: input.realDdlBeforePlan,
            searchProbe: input.searchProbe,
            fields: input.validationFields,
            generatedColumnName: input.columnName,
            indexName: input.indexName,
          })
        : undefined;
    if (input.validationMode === 'real_ddl') {
      assertRealDdlPlanEvidenceReady(planEvidence, input.indexName);
    }
    return { inventory, planEvidence };
  }

  private async rethrowAfterManagedObjectCleanup(
    input: {
      readonly changedManagedObjects: boolean;
      readonly physical: PhysicalTable;
      readonly tableSql: string;
      readonly columnName: string;
      readonly indexName: string;
    },
    error: unknown
  ): Promise<never> {
    if (!input.changedManagedObjects) throw error;
    try {
      await this.dropManagedObjects(
        input.physical,
        input.tableSql,
        undefined,
        input.columnName,
        input.indexName
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Search vector validation failed and managed-object cleanup also failed'
      );
    }
    throw error;
  }
  private async dropManagedObjects(
    physical: PhysicalTable,
    tableSql: string,
    currentConfig: SearchVectorConfigRow | undefined,
    columnName: string,
    indexName: string
  ): Promise<void> {
    if (currentConfig) {
      assertManagedSearchVectorNames(currentConfig.generated_column_name, currentConfig.index_name);
      await this.dropManagedIndex(physical.schema, currentConfig.index_name);
      await this.dropManagedColumn(tableSql, currentConfig.generated_column_name);
    }
    await this.dropManagedIndex(physical.schema, indexName);
    await this.dropManagedColumn(tableSql, columnName);
  }

  private async dropManagedIndex(schema: string, indexName: string): Promise<void> {
    await sql
      .raw(`DROP INDEX IF EXISTS ${quoteIdentifier(schema)}.${quoteIdentifier(indexName)}`)
      .execute(this.dataDb);
  }

  private async dropManagedColumn(tableSql: string, columnName: string): Promise<void> {
    await sql
      .raw(`ALTER TABLE ${tableSql} DROP COLUMN IF EXISTS ${quoteIdentifier(columnName)}`)
      .execute(this.dataDb);
  }

  private async createManagedObjects(
    tableSql: string,
    columnName: string,
    indexName: string,
    expression: string
  ): Promise<void> {
    await sql
      .raw(
        `ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(
          columnName
        )} tsvector GENERATED ALWAYS AS (${expression}) STORED`
      )
      .execute(this.dataDb);
    await sql
      .raw(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${tableSql} USING GIN (${quoteIdentifier(
          columnName
        )})`
      )
      .execute(this.dataDb);
  }

  private assertReadyInventory(inventory: TableQuerySearchVectorInventory): void {
    if (inventory.state !== 'ready') {
      throw new Error(
        `Search vector remediation did not produce a ready inventory state (${inventory.state}); rerun with rebuild=true if the existing generated column or index is stale`
      );
    }
  }

  private async findTableMeta(tableId: string): Promise<TableMetaRow | undefined> {
    const result = await sql<TableMetaRow>`
      SELECT tm.base_id, b.space_id, tm.db_table_name
      FROM table_meta tm
      LEFT JOIN base b ON b.id = tm.base_id
      WHERE tm.id = ${tableId}
      LIMIT 1
    `.execute(this.metaDb);
    return result.rows[0];
  }

  async currentConfig(tableId: string): Promise<SearchVectorConfigRow | undefined> {
    const result = await sql<SearchVectorConfigRow>`
      SELECT candidate_key, generated_column_name, index_name, language_config, field_ids, search_scope
      FROM table_query_search_vector_config
      WHERE table_id = ${tableId}
        AND status IN ('ready', 'stale', 'rebuild_pending')
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
      LIMIT 1
    `.execute(this.metaDb);
    return result.rows[0];
  }

  private async upsertConfig(input: {
    readonly tableId: string;
    readonly baseId: string;
    readonly spaceId: string | null;
    readonly candidateKey: string;
    readonly languageConfig: string;
    readonly generatedColumnName: string;
    readonly indexName: string;
    readonly fieldIds: readonly string[];
    readonly fieldDbNames: readonly string[];
    readonly searchScope: 'all_fields' | 'selected_fields';
    readonly inventory: TableQuerySearchVectorInventory;
  }): Promise<void> {
    const id = `tqsv_${stableHash(`${input.tableId}:${input.candidateKey}`).slice(0, 20)}`;
    await sql`
      UPDATE table_query_search_vector_config
      SET status = 'stale',
          last_modified_time = now()
      WHERE table_id = ${input.tableId}
        AND candidate_key <> ${input.candidateKey}
        AND status IN ('ready', 'rebuild_pending')
    `.execute(this.metaDb);
    await sql`
      INSERT INTO table_query_search_vector_config (
        id,
        space_id,
        base_id,
        table_id,
        candidate_key,
        language_config,
        generated_column_name,
        index_name,
        field_ids,
        field_db_names,
        search_scope,
        status,
        last_inspection,
        last_modified_time
      )
      VALUES (
        ${id},
        ${input.spaceId},
        ${input.baseId},
        ${input.tableId},
        ${input.candidateKey},
        ${input.languageConfig},
        ${input.generatedColumnName},
        ${input.indexName},
        ${JSON.stringify(input.fieldIds)}::jsonb,
        ${JSON.stringify(input.fieldDbNames)}::jsonb,
        ${input.searchScope},
        ${input.inventory.state},
        ${JSON.stringify(input.inventory)}::jsonb,
        now()
      )
      ON CONFLICT (table_id, candidate_key)
      DO UPDATE SET
        space_id = EXCLUDED.space_id,
        language_config = EXCLUDED.language_config,
        generated_column_name = EXCLUDED.generated_column_name,
        index_name = EXCLUDED.index_name,
        field_ids = EXCLUDED.field_ids,
        field_db_names = EXCLUDED.field_db_names,
        search_scope = EXCLUDED.search_scope,
        status = EXCLUDED.status,
        last_inspection = EXCLUDED.last_inspection,
        last_modified_time = now()
    `.execute(this.metaDb);
  }
}

export class PostgresTableSearchVectorReconciler implements TableSearchVectorReconciler {
  constructor(
    private readonly metaDb: Kysely<UnknownPostgresDatabase>,
    private readonly dataDb: Kysely<UnknownPostgresDatabase>
  ) {}

  async reconcile(context: IExecutionContext, input: ReconcileTableSearchVectorInput) {
    try {
      const advisor = new PostgresTableSearchVectorAdvisor(this.dataDb);
      const analysis = await advisor.analyze(context, {
        table: input.table,
        fieldIds: input.fieldIds,
        languageConfig: input.languageConfig,
        searchProbe: input.searchProbe,
        maxRecommendations: 1,
      });
      const recommendation = analysis.recommendations[0];
      if (!recommendation) {
        return err(
          domainError.validation({ message: 'Table has no fields eligible for full-text search' })
        );
      }

      const candidate = {
        candidateKey: recommendation.candidateKey,
        generatedColumnName: recommendation.generatedColumnName,
        indexName: recommendation.indexName,
        fields: recommendation.coveredFields.map((field) => ({
          fieldId: field.fieldId,
          fieldDbName: field.fieldDbName ?? '',
        })),
      };
      const validationMode = input.validationMode ?? 'real_ddl';
      if (validationMode === 'real_ddl') {
        assertSearchVectorExecutionCandidate(analysis, candidate);
      } else {
        assertReadySearchVectorExecutionRecommendation(analysis, candidate);
      }

      const executor = new PostgresTableSearchVectorExecutor(this.metaDb, this.dataDb);
      const execution = await executor.execute({
        tableId: input.table.id().toString(),
        payload: {
          candidateKey: recommendation.candidateKey,
          languageConfig: recommendation.languageConfig,
          searchProbe: input.searchProbe,
          validationMode,
          generatedColumnName: recommendation.generatedColumnName,
          indexName: recommendation.indexName,
          fields: recommendation.coveredFields.map((field) => ({
            fieldId: field.fieldId,
            fieldDbName: field.fieldDbName ?? '',
            fieldType: field.fieldType,
          })),
          searchScope: recommendation.searchScope,
          allowLargeTableRewrite: input.allowLargeTableRewrite,
          rebuild: input.mode === 'rebuild',
        },
      });

      return ok<ReconcileTableSearchVectorResult>({
        action: execution.action,
        tableId: input.table.id().toString(),
        definitionKey: recommendation.candidateKey,
        generatedColumnName: execution.generatedColumnName,
        indexName: execution.indexName,
        languageConfig: execution.languageConfig,
        fieldIds: execution.fieldIds,
        status: 'ready',
        ...(execution.planEvidence ? { planEvidence: execution.planEvidence } : {}),
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: error instanceof Error ? error.message : 'Failed to reconcile search vector',
        })
      );
    }
  }

  async maintainAfterSchemaChange(context: IExecutionContext, table: Table) {
    try {
      const executor = new PostgresTableSearchVectorExecutor(this.metaDb, this.dataDb);
      const current = await executor.currentConfig(table.id().toString());
      if (!current) return ok(undefined);

      const selectedFieldIds =
        current.search_scope === 'selected_fields'
          ? parseStringArray(current.field_ids)
          : undefined;
      const advisor = new PostgresTableSearchVectorAdvisor(this.dataDb);
      const analysis = await advisor.analyze(context, {
        table,
        fieldIds: selectedFieldIds,
        languageConfig: current.language_config,
        maxRecommendations: 1,
      });
      const recommendation = analysis.recommendations[0];
      if (!recommendation) {
        await this.markConfigStale(table.id().toString(), 'no_eligible_fields_after_schema_change');
        return ok(undefined);
      }

      const rebuild =
        recommendation.candidateKey !== current.candidate_key ||
        recommendation.inventory.state !== 'ready';
      const execution = await executor.execute({
        tableId: table.id().toString(),
        payload: {
          candidateKey: recommendation.candidateKey,
          languageConfig: recommendation.languageConfig,
          validationMode: 'plan',
          generatedColumnName: recommendation.generatedColumnName,
          indexName: recommendation.indexName,
          fields: recommendation.coveredFields.map((field) => ({
            fieldId: field.fieldId,
            fieldDbName: field.fieldDbName ?? '',
            fieldType: field.fieldType,
          })),
          searchScope: recommendation.searchScope,
          allowLargeTableRewrite: true,
          rebuild,
        },
      });

      return ok<ReconcileTableSearchVectorResult>({
        action: execution.action,
        tableId: table.id().toString(),
        definitionKey: recommendation.candidateKey,
        generatedColumnName: execution.generatedColumnName,
        indexName: execution.indexName,
        languageConfig: execution.languageConfig,
        fieldIds: execution.fieldIds,
        status: 'ready',
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message:
            error instanceof Error
              ? error.message
              : 'Failed to maintain search vector after schema change',
        })
      );
    }
  }

  private async markConfigStale(tableId: string, reason: string): Promise<void> {
    await sql`
      UPDATE table_query_search_vector_config
      SET status = 'stale',
          last_inspection = ${JSON.stringify({ state: 'stale', staleReasons: [reason] })}::jsonb,
          last_modified_time = now()
      WHERE table_id = ${tableId}
        AND status = 'ready'
    `.execute(this.metaDb);
  }
}

const parseStringArray = (value: unknown): readonly string[] | undefined => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return undefined;
  return parsed.filter((item): item is string => typeof item === 'string');
};

export type SearchVectorCoverageAggregate = {
  readonly searchProbeLengthBucket: 'none' | 'short' | 'medium' | 'long';
  readonly scannedFieldCount: number;
  readonly coveredFieldCount: number;
  readonly skippedFieldCount: number;
  readonly coverageReport: {
    readonly scannedFieldCount: number;
    readonly coveredFieldCount: number;
    readonly skippedFieldCount: number;
    readonly skippedReasons: Readonly<Record<string, number>>;
  };
};

/**
 * Roll up per-table analysis into the scope-level coverage summary. Shared by the
 * EE backend service and the devtools layer so the counters/skipped-reason merge
 * live in one place instead of being re-implemented (and drifting) in both.
 * Recommendations stay caller-owned because each surface maps them differently.
 */
export const mergeSearchVectorCoverage = (
  results: readonly AnalyzeTableSearchVectorResult[]
): SearchVectorCoverageAggregate => {
  const skippedReasons: Record<string, number> = {};
  let scannedFieldCount = 0;
  let coveredFieldCount = 0;
  let skippedFieldCount = 0;
  let searchProbeLengthBucket: SearchVectorCoverageAggregate['searchProbeLengthBucket'] = 'none';
  for (const result of results) {
    searchProbeLengthBucket = result.searchProbeLengthBucket;
    scannedFieldCount += result.coverageReport.scannedFieldCount;
    coveredFieldCount += result.coverageReport.coveredFieldCount;
    skippedFieldCount += result.coverageReport.skippedFieldCount;
    for (const [reason, count] of Object.entries(result.coverageReport.skippedReasons)) {
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + count;
    }
  }
  return {
    searchProbeLengthBucket,
    scannedFieldCount,
    coveredFieldCount,
    skippedFieldCount,
    coverageReport: {
      scannedFieldCount,
      coveredFieldCount,
      skippedFieldCount,
      skippedReasons,
    },
  };
};

export const assertReadySearchVectorExecutionRecommendation = (
  result: AnalyzeTableSearchVectorResult,
  input: SearchVectorExecutionCandidateInput
): TableQuerySearchVectorRecommendation => {
  const recommendation = assertSearchVectorExecutionCandidate(result, input);
  if (recommendation.nextAction !== 'ready_for_confirmation') {
    throw new Error(
      `Search vector candidate is not plan-validated for execution (${recommendation.nextAction}: ${recommendation.planEvidence.explainReason ?? 'no plan evidence reason'})`
    );
  }
  return recommendation;
};

export const assertSearchVectorExecutionCandidate = (
  result: AnalyzeTableSearchVectorResult,
  input: SearchVectorExecutionCandidateInput
): TableQuerySearchVectorRecommendation => {
  const recommendation = result.recommendations.find(
    (item) => item.candidateKey === input.candidateKey
  );
  if (!recommendation) {
    throw new Error(
      `Search vector candidate ${input.candidateKey} was not returned by the current advisor analysis`
    );
  }
  if (
    recommendation.generatedColumnName !== input.generatedColumnName ||
    recommendation.indexName !== input.indexName
  ) {
    throw new Error('Search vector candidate names do not match the current advisor output');
  }
  if (
    !sameSortedValues(
      recommendation.coveredFields.map((field) => field.fieldId),
      input.fields.map((field) => field.fieldId)
    )
  ) {
    throw new Error('Search vector candidate field ids do not match the current advisor output');
  }
  if (
    !sameSortedValues(
      recommendation.coveredFields
        .map((field) => field.fieldDbName)
        .filter((fieldDbName): fieldDbName is string => Boolean(fieldDbName)),
      input.fields.map((field) => field.fieldDbName)
    )
  ) {
    throw new Error(
      'Search vector candidate field db names do not match the current advisor output'
    );
  }
  return recommendation;
};

const buildCoverage = (fields: readonly TableQuerySearchVectorFieldSummary[]) => {
  const skippedReasons: Record<string, number> = {};
  for (const field of fields) {
    if (!field.skippedReason) continue;
    skippedReasons[field.skippedReason] = (skippedReasons[field.skippedReason] ?? 0) + 1;
  }
  return {
    scannedFieldCount: fields.length,
    coveredFieldCount: fields.filter((field) => field.included).length,
    skippedFieldCount: fields.filter((field) => !field.included).length,
    skippedReasons,
  };
};

const normalizeLanguageConfig = (value: string | undefined): string => {
  const trimmed = value?.trim() || DEFAULT_LANGUAGE_CONFIG;
  if (!/^[\w.]+$/.test(trimmed)) return DEFAULT_LANGUAGE_CONFIG;
  return trimmed;
};

const lengthBucket = (value: string | undefined): 'none' | 'short' | 'medium' | 'long' => {
  const length = value?.trim().length ?? 0;
  if (length === 0) return 'none';
  if (length < 3) return 'short';
  if (length < 30) return 'medium';
  return 'long';
};

const buildSearchVectorNames = (
  tableId: string,
  languageConfig: string,
  fields: readonly { readonly fieldId: string; readonly fieldDbName?: string }[]
) => {
  const hash = stableHash(
    `${tableId}:${languageConfig}:${fields
      .map((field) => `${field.fieldId}=${field.fieldDbName ?? ''}`)
      .join(',')}`
  );
  return {
    candidateKey: `search_vector:${tableId}:${hash}`,
    generatedColumnName: `${GENERATED_COLUMN_PREFIX}${hash}`.slice(0, 63),
    indexName: `${INDEX_NAME_PREFIX}${tableId}_${hash}`.slice(0, 63),
  };
};

const buildScopedExpressionIndexNames = (
  tableId: string,
  languageConfig: string,
  fields: readonly { readonly fieldId: string; readonly fieldDbName?: string }[]
) => {
  const hash = stableHash(
    `${tableId}:${languageConfig}:${fields
      .map((field) => `${field.fieldId}=${field.fieldDbName ?? ''}`)
      .sort()
      .join(',')}`
  );
  return {
    candidateKey: `scoped_search_expression:${tableId}:${hash}`,
    indexName: `${SCOPED_EXPRESSION_INDEX_PREFIX}${tableId}_${hash}`.slice(0, 63),
  };
};

const buildSearchVectorExpression = (
  languageConfig: string,
  fieldDbNames: readonly string[]
): string => {
  const document = fieldDbNames
    .map((fieldDbName) => `coalesce(${quoteIdentifier(fieldDbName)}::text, '')`)
    .join(` || ' ' || `);
  return `to_tsvector(${quoteLiteral(languageConfig)}::regconfig, ${document || quoteLiteral('')})`;
};

const buildSearchVectorExpressionWithAlias = (
  languageConfig: string,
  fields: readonly IncludedSearchVectorField[],
  alias: string
): string => {
  const document = fields
    .map(
      (field) =>
        `coalesce(${quoteIdentifier(alias)}.${quoteIdentifier(field.fieldDbName)}::text, '')`
    )
    .join(` || ' ' || `);
  return `to_tsvector(${quoteLiteral(languageConfig)}::regconfig, ${document || quoteLiteral('')})`;
};

const analyzeSearchSemantics = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
    readonly includeResultSamples: boolean;
    readonly sampleResultLimit: number;
  }
): Promise<TableQuerySearchSemanticsReport | undefined> => {
  const searchProbe = input.searchProbe?.trim();
  if (!input.fields.length || !searchProbe) return undefined;

  const sampleLimit = Math.max(0, Math.min(input.sampleResultLimit, SEARCH_SEMANTICS_SAMPLE_LIMIT));
  const baseline = await analyzeIlikeSemantics(db, {
    ...input,
    searchProbe,
    sampleResultLimit: sampleLimit,
  });
  const comparisons = addSearchSemanticsBaselineDeltas([
    baseline,
    await analyzeTrigramSemantics(db, {
      ...input,
      searchProbe,
      sampleResultLimit: sampleLimit,
      baseline,
    }),
    await analyzeTsvectorSemantics(db, {
      ...input,
      searchProbe,
      sampleResultLimit: sampleLimit,
      strategy: 'tsvector_simple',
      label: 'tsvector(simple)',
      languageConfig: 'simple',
      tokenizer: 'PostgreSQL simple',
    }),
    await analyzeTsvectorSemantics(db, {
      ...input,
      searchProbe,
      sampleResultLimit: sampleLimit,
      strategy: 'tsvector_english',
      label: 'tsvector(english)',
      languageConfig: 'english',
      tokenizer: 'PostgreSQL english',
    }),
    await analyzeTsvectorSemantics(db, {
      ...input,
      searchProbe,
      sampleResultLimit: sampleLimit,
      strategy: 'tsvector_pg_jieba',
      label: 'tsvector(pg_jieba jiebacfg)',
      languageConfig: 'jiebacfg',
      tokenizer: 'pg_jieba jiebacfg',
    }),
  ]);

  return {
    searchProbeLengthBucket: lengthBucket(searchProbe),
    comparedStrategies: comparisons.map((comparison) => comparison.strategy),
    baselineStrategy: 'ilike',
    comparisons,
    llmEvaluationInput: {
      status: 'needs_llm_review',
      redaction: 'ephemeral_operator_probe_not_persisted',
      searchProbe,
      instruction:
        'Compare whether each search strategy returns business-reasonable results for the operator-provided probe. Prefer exact substring/trigram when substring semantics are required; prefer tsvector when tokenized matches are acceptable and materially cheaper.',
      criteria: [
        'Does tokenization preserve the important business words or identifiers in the probe?',
        'Do match counts diverge from ILIKE in an expected way, or does the strategy lose important rows?',
        'Do sample results look relevant to the search probe?',
        'Is the cost improvement large enough to justify changing search semantics?',
      ],
      strategies: comparisons.map((comparison) => ({
        strategy: comparison.strategy,
        label: comparison.label,
        tokenPreview: comparison.tokenPreview,
        matchCount: comparison.matchCount,
        cost: comparison.cost,
        sampleResults: comparison.sampleResults,
      })),
    },
  };
};

const analyzeIlikeSemantics = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe: string;
    readonly includeResultSamples: boolean;
    readonly sampleResultLimit: number;
  }
): Promise<TableQuerySearchSemanticsComparison> => {
  try {
    const plan = await explainSearchBefore(db, input);
    const matchCount = await countIlikeMatches(db, input);
    const sampleResults = input.includeResultSamples ? await sampleIlikeMatches(db, input) : [];
    return {
      strategy: 'ilike',
      label: 'ILIKE substring',
      semantics: 'substring',
      available: true,
      indexSupport: 'none',
      tokenPreview: buildLiteralTokenPreview(input.searchProbe),
      tokenCount: 1,
      explainStatus: 'validated',
      cost: plan.totalCost,
      planNode: plan.nodeType,
      usesIndex: Boolean(plan.indexName),
      matchCount,
      sampleResults,
      reasonablenessAssessment: buildLlmAssessment(['baseline_requires_llm_review']),
    };
  } catch (error) {
    return failedSemanticsComparison('ilike', 'ILIKE substring', 'substring', error, {
      indexSupport: 'none',
      tokenPreview: buildLiteralTokenPreview(input.searchProbe),
    });
  }
};

const analyzeTrigramSemantics = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe: string;
    readonly includeResultSamples: boolean;
    readonly sampleResultLimit: number;
    readonly baseline: TableQuerySearchSemanticsComparison;
  }
): Promise<TableQuerySearchSemanticsComparison> => {
  const extension = await readExtensionAvailability(db, 'pg_trgm');
  return {
    strategy: 'trigram',
    label: 'pg_trgm substring',
    semantics: 'trigram_substring',
    available: extension.installed,
    availabilityReason: extension.installed
      ? undefined
      : extension.available
        ? 'pg_trgm_extension_not_installed'
        : 'pg_trgm_extension_unavailable',
    indexSupport: extension.installed ? 'existing_or_manual_trigram' : 'extension_required',
    tokenPreview: buildTrigramTokenPreview(input.searchProbe),
    tokenCount: Math.max(0, input.searchProbe.length - 2),
    explainStatus: input.baseline.explainStatus,
    explainReason: extension.installed ? 'same_substring_semantics_as_ilike' : undefined,
    cost: input.baseline.cost,
    planNode: input.baseline.planNode,
    usesIndex: input.baseline.usesIndex,
    matchCount: input.baseline.matchCount,
    sampleResults: input.baseline.sampleResults,
    reasonablenessAssessment: buildLlmAssessment([
      'same_result_semantics_as_ilike',
      extension.installed ? 'extension_installed' : 'extension_not_installed',
    ]),
  };
};

const analyzeTsvectorSemantics = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe: string;
    readonly includeResultSamples: boolean;
    readonly sampleResultLimit: number;
    readonly strategy: Extract<
      TableQuerySearchSemanticsStrategy,
      'tsvector_simple' | 'tsvector_english' | 'tsvector_pg_jieba'
    >;
    readonly label: string;
    readonly languageConfig: string;
    readonly tokenizer: string;
  }
): Promise<TableQuerySearchSemanticsComparison> => {
  const configAvailable = await readRegConfigAvailability(db, input.languageConfig);
  if (!configAvailable) {
    return {
      strategy: input.strategy,
      label: input.label,
      semantics: 'full_text',
      available: false,
      availabilityReason:
        input.strategy === 'tsvector_pg_jieba'
          ? 'pg_jieba_regconfig_unavailable'
          : 'regconfig_unavailable',
      tokenizer: input.tokenizer,
      languageConfig: input.languageConfig,
      indexSupport:
        input.strategy === 'tsvector_pg_jieba' ? 'extension_required' : 'generated_tsvector_gin',
      tokenPreview: [],
      explainStatus: 'skipped',
      explainReason: 'regconfig_unavailable',
      sampleResults: [],
      reasonablenessAssessment: buildLlmAssessment(['strategy_unavailable']),
    };
  }

  try {
    const tokenPreview = await readSearchTokenPreview(db, input.languageConfig, input.searchProbe);
    const tsqueryHasNodes = await hasTsQueryNodes(db, input.languageConfig, input.searchProbe);
    if (!tsqueryHasNodes) {
      return {
        strategy: input.strategy,
        label: input.label,
        semantics: 'full_text',
        available: true,
        tokenizer: input.tokenizer,
        languageConfig: input.languageConfig,
        indexSupport: 'generated_tsvector_gin',
        tokenPreview,
        tokenCount: tokenPreview.length,
        explainStatus: 'skipped',
        explainReason: 'empty_tsquery',
        matchCount: 0,
        sampleResults: [],
        reasonablenessAssessment: buildLlmAssessment(['empty_tsquery']),
      };
    }
    const plan = await explainSearchAfter(db, input);
    const matchCount = await countTsvectorMatches(db, input);
    const sampleResults = input.includeResultSamples ? await sampleTsvectorMatches(db, input) : [];
    return {
      strategy: input.strategy,
      label: input.label,
      semantics: 'full_text',
      available: true,
      tokenizer: input.tokenizer,
      languageConfig: input.languageConfig,
      indexSupport: 'generated_tsvector_gin',
      tokenPreview,
      tokenCount: tokenPreview.length,
      explainStatus: 'validated',
      cost: plan.totalCost,
      planNode: plan.nodeType,
      usesIndex: Boolean(plan.indexName),
      matchCount,
      sampleResults,
      reasonablenessAssessment: buildLlmAssessment(['fts_semantics_requires_llm_review']),
    };
  } catch (error) {
    return failedSemanticsComparison(input.strategy, input.label, 'full_text', error, {
      tokenizer: input.tokenizer,
      languageConfig: input.languageConfig,
      indexSupport: 'generated_tsvector_gin',
    });
  }
};

export const addSearchSemanticsBaselineDeltas = (
  comparisons: readonly TableQuerySearchSemanticsComparison[]
): readonly TableQuerySearchSemanticsComparison[] => {
  const baseline = comparisons.find((comparison) => comparison.strategy === 'ilike');
  if (!baseline) return comparisons;
  const baselineIds = new Set(
    baseline.sampleResults
      .map((sample) => sample.recordId)
      .filter((recordId): recordId is string => Boolean(recordId))
  );
  return comparisons.map((comparison) => {
    const matchCountDeltaFromIlike =
      typeof baseline.matchCount === 'number' && typeof comparison.matchCount === 'number'
        ? comparison.matchCount - baseline.matchCount
        : undefined;
    const matchCountDeltaPctFromIlike =
      typeof matchCountDeltaFromIlike === 'number' &&
      typeof baseline.matchCount === 'number' &&
      baseline.matchCount > 0
        ? (matchCountDeltaFromIlike / baseline.matchCount) * 100
        : undefined;
    const sampleOverlapWithIlike =
      baselineIds.size > 0
        ? comparison.sampleResults.filter(
            (sample) => sample.recordId && baselineIds.has(sample.recordId)
          ).length
        : undefined;
    return {
      ...comparison,
      ...(typeof matchCountDeltaFromIlike === 'number' ? { matchCountDeltaFromIlike } : {}),
      ...(typeof matchCountDeltaPctFromIlike === 'number' ? { matchCountDeltaPctFromIlike } : {}),
      ...(typeof sampleOverlapWithIlike === 'number' ? { sampleOverlapWithIlike } : {}),
      reasonablenessAssessment: {
        ...comparison.reasonablenessAssessment,
        reasonCodes: [
          ...comparison.reasonablenessAssessment.reasonCodes,
          ...semanticDeltaReasonCodes(comparison, matchCountDeltaPctFromIlike),
        ],
      },
    };
  });
};

const semanticDeltaReasonCodes = (
  comparison: TableQuerySearchSemanticsComparison,
  matchCountDeltaPctFromIlike: number | undefined
): readonly string[] => {
  if (comparison.strategy === 'ilike' || comparison.strategy === 'trigram') return [];
  if (typeof matchCountDeltaPctFromIlike !== 'number') return ['match_count_delta_unknown'];
  if (Math.abs(matchCountDeltaPctFromIlike) >= 50) return ['large_match_count_delta'];
  if (Math.abs(matchCountDeltaPctFromIlike) >= 10) return ['moderate_match_count_delta'];
  return ['match_count_close_to_ilike'];
};

const failedSemanticsComparison = (
  strategy: TableQuerySearchSemanticsStrategy,
  label: string,
  semantics: TableQuerySearchSemanticsComparison['semantics'],
  error: unknown,
  extra: {
    readonly tokenizer?: string;
    readonly languageConfig?: string;
    readonly indexSupport: TableQuerySearchSemanticsComparison['indexSupport'];
    readonly tokenPreview?: readonly TableQuerySearchSemanticsToken[];
  }
): TableQuerySearchSemanticsComparison => ({
  strategy,
  label,
  semantics,
  available: false,
  availabilityReason: error instanceof Error ? error.message : String(error),
  tokenizer: extra.tokenizer,
  languageConfig: extra.languageConfig,
  indexSupport: extra.indexSupport,
  tokenPreview: extra.tokenPreview ?? [],
  explainStatus: 'failed',
  explainReason: error instanceof Error ? error.message : String(error),
  sampleResults: [],
  reasonablenessAssessment: buildLlmAssessment(['strategy_failed']),
});

const buildLlmAssessment = (
  reasonCodes: readonly string[]
): TableQuerySearchSemanticsAssessment => ({
  status: 'needs_llm_review',
  reasonCodes,
  instruction:
    'Use the operator-provided search probe, tokenizer output, match counts, plan costs, and sample results to judge whether this strategy preserves acceptable search semantics.',
});

const buildLiteralTokenPreview = (
  searchProbe: string
): readonly TableQuerySearchSemanticsToken[] =>
  searchProbe
    ? [
        {
          token: truncatePreview(searchProbe).preview,
          alias: 'literal',
          lexemes: [truncatePreview(searchProbe).preview],
        },
      ]
    : [];

const buildTrigramTokenPreview = (
  searchProbe: string
): readonly TableQuerySearchSemanticsToken[] => {
  const compact = searchProbe.replace(/\s+/g, ' ').trim();
  if (compact.length < 3) return buildLiteralTokenPreview(compact);
  const tokens: TableQuerySearchSemanticsToken[] = [];
  for (let index = 0; index <= compact.length - 3; index += 1) {
    tokens.push({
      token: compact.slice(index, index + 3),
      alias: 'trigram',
      lexemes: [compact.slice(index, index + 3)],
    });
    if (tokens.length >= SEARCH_SEMANTICS_TOKEN_LIMIT) break;
  }
  return tokens;
};

const readSearchTokenPreview = async (
  db: Kysely<UnknownPostgresDatabase>,
  languageConfig: string,
  searchProbe: string
): Promise<readonly TableQuerySearchSemanticsToken[]> => {
  const result = await sql<{
    alias: string | null;
    token: string | null;
    lexemes: string[] | null;
  }>`
    SELECT alias::text AS alias, token::text AS token, lexemes::text[] AS lexemes
    FROM ts_debug(${sql.raw(`${quoteLiteral(languageConfig)}::regconfig`)}, ${searchProbe})
    WHERE token IS NOT NULL
    LIMIT ${SEARCH_SEMANTICS_TOKEN_LIMIT}
  `.execute(db);
  return result.rows.map((row) => ({
    token: row.token ?? '',
    alias: row.alias ?? undefined,
    lexemes: Array.isArray(row.lexemes) ? row.lexemes.filter(Boolean) : [],
  }));
};

const readRegConfigAvailability = async (
  db: Kysely<UnknownPostgresDatabase>,
  languageConfig: string
): Promise<boolean> => {
  const parts = languageConfig.split('.');
  const schemaName = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;
  const configName = parts[parts.length - 1] ?? languageConfig;
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_ts_config c
      JOIN pg_namespace n ON n.oid = c.cfgnamespace
      WHERE c.cfgname = ${configName}
        AND (${schemaName ?? null}::text IS NULL OR n.nspname = ${schemaName ?? null})
    ) AS "exists"
  `.execute(db);
  return Boolean(result.rows[0]?.exists);
};

const readExtensionAvailability = async (
  db: Kysely<UnknownPostgresDatabase>,
  extensionName: string
): Promise<{ readonly installed: boolean; readonly available: boolean }> => {
  const result = await sql<{ installed: boolean; available: boolean }>`
    SELECT
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = ${extensionName}) AS installed,
      EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = ${extensionName}) AS available
  `.execute(db);
  return {
    installed: Boolean(result.rows[0]?.installed),
    available: Boolean(result.rows[0]?.available),
  };
};

const countIlikeMatches = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe: string;
  }
): Promise<number> => {
  const where = buildIlikeWhere(input.fields, input.searchProbe);
  const result = await sql<{ match_count: string | number | bigint }>`
    SELECT count(*)::text AS match_count
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${where}
  `.execute(db);
  return Number(result.rows[0]?.match_count ?? 0);
};

const countTsvectorMatches = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe: string;
    readonly languageConfig: string;
  }
): Promise<number> => {
  const where = buildTsvectorWhere(input.fields, input.languageConfig, input.searchProbe);
  const result = await sql<{ match_count: string | number | bigint }>`
    SELECT count(*)::text AS match_count
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${where}
  `.execute(db);
  return Number(result.rows[0]?.match_count ?? 0);
};

const sampleIlikeMatches = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe: string;
    readonly sampleResultLimit: number;
  }
): Promise<readonly TableQuerySearchSemanticsSampleResult[]> =>
  sampleSearchMatches(db, input, buildIlikeWhere(input.fields, input.searchProbe));

const sampleTsvectorMatches = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe: string;
    readonly languageConfig: string;
    readonly sampleResultLimit: number;
  }
): Promise<readonly TableQuerySearchSemanticsSampleResult[]> =>
  sampleSearchMatches(
    db,
    input,
    buildTsvectorWhere(input.fields, input.languageConfig, input.searchProbe)
  );

const sampleSearchMatches = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly sampleResultLimit: number;
  },
  where: ReturnType<typeof sql>
): Promise<readonly TableQuerySearchSemanticsSampleResult[]> => {
  if (input.sampleResultLimit <= 0) return [];
  const previewFields = input.fields.slice(0, SEARCH_SEMANTICS_FIELD_PREVIEW_LIMIT);
  const selectList = [
    `${quoteIdentifier('t')}.${quoteIdentifier('__id')}::text AS ${quoteIdentifier('__id')}`,
    ...previewFields.map(
      (field) =>
        `${quoteIdentifier('t')}.${quoteIdentifier(field.fieldDbName)}::text AS ${quoteIdentifier(
          field.fieldDbName
        )}`
    ),
  ].join(', ');
  const result = await sql<Record<string, unknown>>`
    SELECT ${sql.raw(selectList)}
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${where}
    LIMIT ${input.sampleResultLimit}
  `.execute(db);
  return result.rows.map((row) => ({
    recordId: typeof row.__id === 'string' ? row.__id : undefined,
    fieldPreviews: previewFields.flatMap((field) => {
      const value = row[field.fieldDbName];
      if (value === null || value === undefined) return [];
      const preview = truncatePreview(String(value));
      if (!preview.preview) return [];
      return [
        {
          fieldId: field.fieldId,
          fieldDbName: field.fieldDbName,
          preview: preview.preview,
          previewLength: preview.originalLength,
          truncated: preview.truncated,
        },
      ];
    }),
  }));
};

const buildIlikeWhere = (
  fields: readonly IncludedSearchVectorField[],
  searchProbe: string
): ReturnType<typeof sql> => {
  const pattern = `%${escapeLikeWildcards(searchProbe)}%`;
  const conditions = fields.map(
    (field) =>
      sql`(${sql.raw(`${quoteIdentifier('t')}.${quoteIdentifier(field.fieldDbName)}`)})::text ILIKE ${pattern} ESCAPE '\\'`
  );
  return conditions.reduce((acc, condition) => sql`${acc} OR ${condition}`, sql`false`);
};

const buildTsvectorWhere = (
  fields: readonly IncludedSearchVectorField[],
  languageConfig: string,
  searchProbe: string
): ReturnType<typeof sql> =>
  sql`${sql.raw(
    buildSearchVectorExpressionWithAlias(languageConfig, fields, 't')
  )} @@ websearch_to_tsquery(${sql.raw(`${quoteLiteral(languageConfig)}::regconfig`)}, ${searchProbe})`;

const truncatePreview = (
  value: string
): {
  readonly preview: string;
  readonly originalLength: number;
  readonly truncated: boolean;
} => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= SEARCH_SEMANTICS_PREVIEW_LENGTH) {
    return {
      preview: normalized,
      originalLength: normalized.length,
      truncated: false,
    };
  }
  return {
    preview: normalized.slice(0, SEARCH_SEMANTICS_PREVIEW_LENGTH),
    originalLength: normalized.length,
    truncated: true,
  };
};

const inspectSearchVectorInventory = async (
  db: Kysely<UnknownPostgresDatabase>,
  physical: PhysicalTable,
  names: {
    readonly generatedColumnName: string;
    readonly indexName: string;
  },
  fields: readonly { readonly fieldDbName?: string }[]
): Promise<TableQuerySearchVectorInventory> => {
  const columnRows = await sql<{
    column_name: string;
    generation_expression: string | null;
  }>`
    SELECT a.attname AS column_name, pg_get_expr(ad.adbin, ad.adrelid) AS generation_expression
    FROM pg_attribute a
    JOIN pg_class t ON t.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = ${physical.schema}
      AND t.relname = ${physical.tableName}
      AND a.attname = ${names.generatedColumnName}
      AND NOT a.attisdropped
    LIMIT 1
  `.execute(db);
  const indexRows = await sql<{ index_name: string; valid: boolean }>`
    SELECT c.relname AS index_name, i.indisvalid AS valid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = ${physical.schema}
      AND t.relname = ${physical.tableName}
      AND c.relname = ${names.indexName}
    LIMIT 1
  `.execute(db);

  const column = columnRows.rows[0];
  const index = indexRows.rows[0];
  const staleReasons = collectSearchVectorStaleReasons(column, index, fields);
  const state = resolveSearchVectorInventoryState(column, index, staleReasons);
  return {
    state,
    existingGeneratedColumn: column?.column_name,
    existingIndexName: index?.index_name,
    existingIndexValid: index?.valid,
    staleReasons,
  };
};

const collectSearchVectorStaleReasons = (
  column: { readonly generation_expression: string | null } | undefined,
  index: { readonly valid: boolean } | undefined,
  fields: readonly { readonly fieldDbName?: string }[]
): string[] => {
  const staleReasons: string[] = [];
  if (column?.generation_expression) {
    for (const field of fields) {
      if (!field.fieldDbName) continue;
      // pg_get_expr may deparse lowercase identifiers without quotes, but quoted
      // identifiers are still needed for mixed-case or special-character db names.
      // Match an identifier token so `fld_a` is not treated as present in `fld_addr`.
      if (!containsIdentifierToken(column.generation_expression, field.fieldDbName)) {
        staleReasons.push(`missing_field:${field.fieldDbName}`);
      }
    }
  }
  if (index && !index.valid) staleReasons.push('invalid_index');
  return staleReasons;
};

const containsIdentifierToken = (expression: string, identifier: string): boolean => {
  if (expression.includes(quoteIdentifier(identifier))) return true;
  const escapedIdentifier = escapeRegExp(identifier);
  return new RegExp(`(^|[^A-Za-z0-9_])${escapedIdentifier}([^A-Za-z0-9_]|$)`).test(expression);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveSearchVectorInventoryState = (
  column: unknown,
  index: { readonly valid: boolean } | undefined,
  staleReasons: readonly string[]
): TableQuerySearchVectorInventory['state'] => {
  if (staleReasons.length > 0) return index?.valid === false ? 'invalid' : 'stale';
  if (column && index?.valid) return 'ready';
  return 'missing';
};

type RowEstimate = {
  // Best-effort row count; 0 when unknown. Read `known` before trusting it.
  readonly rows: number;
  // false when the table was never analyzed (reltuples < 0 in PG >= 14), so the
  // large-table-rewrite guard must treat the size as potentially huge.
  readonly known: boolean;
};

const readRowEstimate = async (
  db: Kysely<UnknownPostgresDatabase>,
  physical: PhysicalTable
): Promise<RowEstimate> => {
  const result = await sql<{ reltuples: number | string | null }>`
    SELECT c.reltuples AS reltuples
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${physical.schema}
      AND c.relname = ${physical.tableName}
    LIMIT 1
  `.execute(db);
  const raw = Number(result.rows[0]?.reltuples ?? -1);
  if (!Number.isFinite(raw) || raw < 0) return { rows: 0, known: false };
  return { rows: raw, known: true };
};

const assertManagedSearchVectorNames = (columnName: string, indexName: string): void => {
  if (!columnName.startsWith(GENERATED_COLUMN_PREFIX)) {
    throw new Error(
      `Refusing to manage generated column "${columnName}": search vector columns must start with "${GENERATED_COLUMN_PREFIX}"`
    );
  }
  if (!indexName.startsWith(INDEX_NAME_PREFIX)) {
    throw new Error(
      `Refusing to manage index "${indexName}": search vector indexes must start with "${INDEX_NAME_PREFIX}"`
    );
  }
};

const isHypopgGinUnsupported = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /gin/i.test(message) && /not supported/i.test(message);
};

const readTableSizeBytes = async (
  db: Kysely<UnknownPostgresDatabase>,
  physical: PhysicalTable
): Promise<number | undefined> => {
  const result = await sql<{ size_bytes: number | string | null }>`
    SELECT pg_total_relation_size(to_regclass(${makePhysicalTableSql(physical.schema, physical.tableName)})) AS size_bytes
  `.execute(db);
  const value = Number(result.rows[0]?.size_bytes);
  return Number.isFinite(value) ? value : undefined;
};

const hasTsQueryNodes = async (
  db: Kysely<UnknownPostgresDatabase>,
  languageConfig: string,
  searchProbe: string
): Promise<boolean> => {
  const result = await sql<{ node_count: number | string }>`
    SELECT numnode(websearch_to_tsquery(${languageConfig}::regconfig, ${searchProbe})) AS node_count
  `.execute(db);
  return Number(result.rows[0]?.node_count ?? 0) > 0;
};

const readRealDdlSearchVectorBeforePlan = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly languageConfig: string;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
  }
): Promise<ExplainPlan> => {
  if (!input.fields.length) {
    throw new Error('Real-DDL search vector validation has no indexable search fields');
  }
  if (!input.searchProbe?.trim()) {
    throw new Error('Real-DDL search vector validation requires a searchProbe');
  }
  const tsqueryHasNodes = await hasTsQueryNodes(db, input.languageConfig, input.searchProbe);
  if (!tsqueryHasNodes) {
    throw new Error('Real-DDL search vector validation produced an empty tsquery');
  }
  return explainSearchBefore(db, input);
};

const validateRealDdlSearchVectorPlan = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly languageConfig: string;
    readonly beforePlan?: ExplainPlan;
    readonly searchProbe?: string;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly generatedColumnName: string;
    readonly indexName: string;
  }
): Promise<TableQuerySearchVectorPlanEvidence> => {
  try {
    if (!input.beforePlan) {
      return { explainStatus: 'skipped', explainReason: 'before_plan_missing' };
    }
    const after = await explainGeneratedSearchVectorColumn(db, input);
    return {
      explainStatus: 'validated',
      explainMethod: 'real_index',
      explainReason: 'real_ddl_plan_validated',
      costBefore: input.beforePlan.totalCost,
      costAfter: after.totalCost,
      costDeltaPct: explainCostDeltaPct(input.beforePlan.totalCost, after.totalCost),
      planNodeBefore: input.beforePlan.nodeType,
      planNodeAfter: after.nodeType,
      usesCandidateIndex: after.indexName === input.indexName,
      sqlDetails: buildSearchVectorGeneratedColumnSqlDetails(input),
    };
  } catch (error) {
    return {
      explainStatus: 'failed',
      explainReason: error instanceof Error ? error.message : String(error),
    };
  }
};

const assertRealDdlPlanEvidenceReady = (
  evidence: TableQuerySearchVectorPlanEvidence | undefined,
  indexName: string
): void => {
  if (!evidence) {
    throw new Error('Real-DDL search vector validation did not return plan evidence');
  }
  if (evidence.explainStatus !== 'validated') {
    throw new Error(
      `Real-DDL search vector validation did not produce a validated plan (${evidence.explainReason ?? evidence.explainStatus})`
    );
  }
  if (evidence.explainMethod !== 'real_index') {
    throw new Error(
      `Real-DDL search vector validation used unexpected method ${evidence.explainMethod ?? 'unknown'}`
    );
  }
  if (!evidence.usesCandidateIndex) {
    throw new Error(`Real-DDL search vector validation did not use index ${indexName}`);
  }
  if (
    typeof evidence.costDeltaPct !== 'number' ||
    !Number.isFinite(evidence.costDeltaPct) ||
    evidence.costDeltaPct >= 0
  ) {
    throw new Error(
      `Real-DDL search vector validation did not improve plan cost (${evidence.costBefore ?? 'unknown'} -> ${evidence.costAfter ?? 'unknown'})`
    );
  }
};

const explainSearchBefore = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
  }
): Promise<ExplainPlan> => {
  const pattern = `%${escapeLikeWildcards(input.searchProbe ?? '')}%`;
  const conditions = input.fields.map(
    (field) =>
      sql`(${sql.raw(`${quoteIdentifier('t')}.${quoteIdentifier(field.fieldDbName)}`)})::text ILIKE ${pattern} ESCAPE '\\'`
  );
  const where = conditions.reduce((acc, condition) => sql`${acc} OR ${condition}`, sql`false`);
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON)
    SELECT 1
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${where}
    LIMIT 100
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const buildSearchVectorExpressionSqlDetails = (input: {
  readonly physical: PhysicalTable;
  readonly languageConfig: string;
  readonly fields: readonly IncludedSearchVectorField[];
  readonly searchProbe?: string;
}): TableQuerySearchVectorSqlDetails => ({
  beforeSql: buildBeforeSearchSql(input),
  afterSql: buildExpressionSearchSql(input),
  searchProbeLengthBucket: lengthBucket(input.searchProbe),
  placeholders: {
    likePattern: ':search_probe_like_pattern',
    tsquery: ':search_probe',
  },
  redaction: 'search_probe_parameterized',
});

const buildScopedSearchVectorSqlDetails = (input: {
  readonly physical: PhysicalTable;
  readonly languageConfig: string;
  readonly fields: readonly IncludedSearchVectorField[];
  readonly searchProbe?: string;
  readonly globalGeneratedColumnName: string;
}): TableQuerySearchVectorSqlDetails => {
  const scopedSql = buildScopedSearchSql(input);
  return {
    beforeSql: scopedSql,
    afterSql: scopedSql,
    searchProbeLengthBucket: lengthBucket(input.searchProbe),
    placeholders: {
      likePattern: ':search_probe_like_pattern',
      tsquery: ':search_probe',
    },
    redaction: 'search_probe_parameterized',
  };
};

const buildSearchVectorGeneratedColumnSqlDetails = (input: {
  readonly physical: PhysicalTable;
  readonly languageConfig: string;
  readonly fields: readonly IncludedSearchVectorField[];
  readonly searchProbe?: string;
  readonly generatedColumnName: string;
}): TableQuerySearchVectorSqlDetails => ({
  beforeSql: buildBeforeSearchSql(input),
  afterSql: buildGeneratedColumnSearchSql(input),
  searchProbeLengthBucket: lengthBucket(input.searchProbe),
  placeholders: {
    likePattern: ':search_probe_like_pattern',
    tsquery: ':search_probe',
  },
  redaction: 'search_probe_parameterized',
});

const buildBeforeSearchSql = (input: {
  readonly physical: PhysicalTable;
  readonly fields: readonly IncludedSearchVectorField[];
}): string => {
  const conditions = input.fields
    .map(
      (field) =>
        `(${quoteIdentifier('t')}.${quoteIdentifier(field.fieldDbName)})::text ILIKE :search_probe_like_pattern ESCAPE '\\\\'`
    )
    .join(' OR ');
  return [
    'EXPLAIN (FORMAT JSON)',
    'SELECT 1',
    `FROM ${makePhysicalTableSql(input.physical.schema, input.physical.tableName)} AS ${quoteIdentifier(
      't'
    )}`,
    `WHERE ${conditions || 'false'}`,
    'LIMIT 100',
  ].join('\n');
};

const buildExpressionSearchSql = (input: {
  readonly physical: PhysicalTable;
  readonly languageConfig: string;
  readonly fields: readonly IncludedSearchVectorField[];
}): string =>
  buildAfterSearchSql({
    physical: input.physical,
    vectorExpression: buildSearchVectorExpressionWithAlias(input.languageConfig, input.fields, 't'),
    languageConfig: input.languageConfig,
  });

const buildGeneratedColumnSearchSql = (input: {
  readonly physical: PhysicalTable;
  readonly languageConfig: string;
  readonly generatedColumnName: string;
}): string =>
  buildAfterSearchSql({
    physical: input.physical,
    vectorExpression: `${quoteIdentifier('t')}.${quoteIdentifier(input.generatedColumnName)}`,
    languageConfig: input.languageConfig,
  });

const buildScopedSearchSql = (input: {
  readonly physical: PhysicalTable;
  readonly languageConfig: string;
  readonly fields: readonly IncludedSearchVectorField[];
  readonly globalGeneratedColumnName: string;
}): string => {
  const tsquery = `websearch_to_tsquery(${quoteLiteral(
    input.languageConfig
  )}::regconfig, :search_probe)`;
  return [
    'EXPLAIN (FORMAT JSON)',
    'SELECT 1',
    `FROM ${makePhysicalTableSql(input.physical.schema, input.physical.tableName)} AS ${quoteIdentifier(
      't'
    )}`,
    `WHERE ${quoteIdentifier('t')}.${quoteIdentifier(input.globalGeneratedColumnName)} @@ ${tsquery}`,
    `  AND ${buildSearchVectorExpressionWithAlias(
      input.languageConfig,
      input.fields,
      't'
    )} @@ ${tsquery}`,
    'LIMIT 100',
  ].join('\n');
};

const buildAfterSearchSql = (input: {
  readonly physical: PhysicalTable;
  readonly vectorExpression: string;
  readonly languageConfig: string;
}): string =>
  [
    'EXPLAIN (FORMAT JSON)',
    'SELECT 1',
    `FROM ${makePhysicalTableSql(input.physical.schema, input.physical.tableName)} AS ${quoteIdentifier(
      't'
    )}`,
    `WHERE ${input.vectorExpression} @@ websearch_to_tsquery(${quoteLiteral(
      input.languageConfig
    )}::regconfig, :search_probe)`,
    'LIMIT 100',
  ].join('\n');

const explainGeneratedSearchVectorColumn = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly languageConfig: string;
    readonly searchProbe?: string;
    readonly generatedColumnName: string;
  }
): Promise<ExplainPlan> => {
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON)
    SELECT 1
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${sql.raw(`${quoteIdentifier('t')}.${quoteIdentifier(input.generatedColumnName)}`)} @@ websearch_to_tsquery(${input.languageConfig}::regconfig, ${input.searchProbe ?? ''})
    LIMIT 100
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const explainSearchAfter = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly languageConfig: string;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
  }
): Promise<ExplainPlan> => {
  const expression = buildSearchVectorExpressionWithAlias(input.languageConfig, input.fields, 't');
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON)
    SELECT 1
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${sql.raw(expression)} @@ websearch_to_tsquery(${input.languageConfig}::regconfig, ${input.searchProbe ?? ''})
    LIMIT 100
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const explainScopedSearch = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly languageConfig: string;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
    readonly globalGeneratedColumnName: string;
  }
): Promise<ExplainPlan> => {
  const expression = buildSearchVectorExpressionWithAlias(input.languageConfig, input.fields, 't');
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON)
    SELECT 1
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${sql.raw(`${quoteIdentifier('t')}.${quoteIdentifier(input.globalGeneratedColumnName)}`)} @@ websearch_to_tsquery(${input.languageConfig}::regconfig, ${input.searchProbe ?? ''})
      AND ${sql.raw(expression)} @@ websearch_to_tsquery(${input.languageConfig}::regconfig, ${input.searchProbe ?? ''})
    LIMIT 100
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const buildHypotheticalSearchVectorIndexStatement = (input: {
  readonly physical: PhysicalTable;
  readonly languageConfig: string;
  readonly fields: readonly IncludedSearchVectorField[];
}): string => {
  const expression = buildSearchVectorExpression(
    input.languageConfig,
    input.fields.map((field) => field.fieldDbName)
  );
  return `CREATE INDEX ON ${makePhysicalTableSql(input.physical.schema, input.physical.tableName)} USING gin ((${expression}))`;
};

const readHypopgSchema = async (
  db: Kysely<UnknownPostgresDatabase>
): Promise<string | undefined> => {
  const result = await sql<{ schema_name: string }>`
    SELECT n.nspname AS schema_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'hypopg_create_index'
    LIMIT 1
  `.execute(db);
  return result.rows[0]?.schema_name;
};

const resetHypopg = async (db: Kysely<UnknownPostgresDatabase>, schema: string): Promise<void> => {
  await sql`SELECT ${sql.raw(quoteIdentifier(schema))}.hypopg_reset()`.execute(db);
};

const parseExplainPlan = (value: unknown): ExplainPlan => {
  const root = Array.isArray(value) ? value[0] : value;
  const plan = root && typeof root === 'object' ? (root as { Plan?: unknown }).Plan : undefined;
  if (!plan || typeof plan !== 'object') {
    return { rawPlan: value };
  }
  const typed = plan as Record<string, unknown>;
  return {
    startupCost: toNumber(typed['Startup Cost']),
    totalCost: toNumber(typed['Total Cost']),
    nodeType: typeof typed['Node Type'] === 'string' ? typed['Node Type'] : undefined,
    indexName: findFirstIndexName(plan),
    rawPlan: value,
  };
};

const findFirstIndexName = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstIndexName(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['Index Name'] === 'string') return record['Index Name'];
  for (const child of Object.values(record)) {
    const found = findFirstIndexName(child);
    if (found) return found;
  }
  return undefined;
};

const planReferencesHypotheticalIndex = (value: unknown): boolean => {
  if (typeof value === 'string') return value.includes('<') && value.includes('>');
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(planReferencesHypotheticalIndex);
  return Object.values(value as Record<string, unknown>).some(planReferencesHypotheticalIndex);
};

const explainCostDeltaPct = (
  before: number | undefined,
  after: number | undefined
): number | undefined => {
  if (typeof before !== 'number' || typeof after !== 'number' || before <= 0) return undefined;
  return ((after - before) / before) * 100;
};

const chooseNextAction = (input: {
  readonly inventory: TableQuerySearchVectorInventory;
  readonly planEvidence: TableQuerySearchVectorPlanEvidence;
  readonly coveredFieldCount: number;
}): TableQuerySearchVectorNextAction => {
  if (input.coveredFieldCount === 0) return 'manual_investigation';
  if (input.inventory.state === 'ready') return 'no_index_change';
  const evidence = input.planEvidence;
  if (evidence.explainStatus !== 'validated') return 'needs_plan_validation';
  if (evidence.explainMethod !== 'hypothetical_index') return 'needs_plan_validation';
  if (!evidence.usesCandidateIndex) return 'candidate_not_recommended';
  if (
    typeof evidence.costDeltaPct !== 'number' ||
    evidence.costDeltaPct > -MIN_RECOMMENDED_COST_IMPROVEMENT_PCT
  ) {
    return 'candidate_not_recommended';
  }
  return 'ready_for_confirmation';
};

export const chooseScopedExpressionNextAction = (
  evidence: TableQuerySearchVectorPlanEvidence
): TableQuerySearchVectorNextAction => {
  if (evidence.explainStatus !== 'validated') return 'needs_plan_validation';
  if (evidence.explainMethod !== 'hypothetical_index') return 'needs_plan_validation';
  if (!evidence.usesCandidateIndex) return 'candidate_not_recommended';
  if (
    typeof evidence.costDeltaPct !== 'number' ||
    evidence.costDeltaPct > -MIN_RECOMMENDED_COST_IMPROVEMENT_PCT
  ) {
    return 'candidate_not_recommended';
  }
  return 'ready_for_confirmation';
};

const splitPhysicalName = (
  dbTableName: string,
  defaultSchema: string
): { readonly schema: string; readonly tableName: string } => {
  const dotIndex = dbTableName.indexOf('.');
  if (dotIndex === -1) {
    return { schema: defaultSchema, tableName: dbTableName };
  }
  return {
    schema: dbTableName.slice(0, dotIndex),
    tableName: dbTableName.slice(dotIndex + 1),
  };
};

const toNumber = (value: unknown): number | undefined => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const escapeLikeWildcards = (input: string): string =>
  input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

const stableHash = (input: string): string => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const sameSortedValues = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};
