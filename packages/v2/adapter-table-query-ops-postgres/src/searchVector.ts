import {
  LEGACY_MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX,
  LEGACY_MANAGED_SEARCH_INDEX_PREFIX,
  MANAGED_SCOPED_SEARCH_INDEX_PREFIX,
  MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX,
  MANAGED_SEARCH_INDEX_PREFIX,
} from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  type IExecutionContext,
  type SearchFieldTextProjection,
  type Table,
} from '@teable/v2-core';
import {
  buildTableSearchVectorDefinition,
  SearchScopeHeatPolicy,
  type ReconcileTableSearchVectorInput,
  type ReconcileTableSearchVectorResult,
  type SearchScopeHeatEntry,
  type SearchScopeHeatReportSnapshot,
  type TableQueryObservationWindow,
  type TableSearchAccessPathCapability,
  type TableSearchVectorReconciler,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok } from 'neverthrow';

import { getTablePhysicalName, makePhysicalTableSql, quoteIdentifier } from './helpers';
import { readPostgresSearchAccessPathCapabilities } from './searchAccessPathCapability';
import {
  renderSearchTextProjectionSql,
  sanitizeSearchTextProjection,
  searchTextProjectionKey,
} from './searchDocumentProjection';
import type { UnknownPostgresDatabase } from './types';

const DEFAULT_LANGUAGE_CONFIG = 'simple';
const LARGE_TABLE_REWRITE_ESTIMATED_ROWS = 50_000;
const MIN_RECOMMENDED_COST_IMPROVEMENT_PCT = 20;

// All generated columns and indexes this advisor manages carry the shared
// prefixes from @teable/v2-table-query-ops. The executor refuses to ADD/DROP
// anything that does not, so a hand-built or mistyped payload can never
// rewrite/drop a real user column or index.
const GENERATED_COLUMN_PREFIX = MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX;
const INDEX_NAME_PREFIX = MANAGED_SEARCH_INDEX_PREFIX;
const SCOPED_EXPRESSION_INDEX_PREFIX = MANAGED_SCOPED_SEARCH_INDEX_PREFIX;
const LEGACY_GENERATED_COLUMN_PREFIX = LEGACY_MANAGED_SEARCH_DOCUMENT_COLUMN_PREFIX;
const LEGACY_INDEX_NAME_PREFIX = LEGACY_MANAGED_SEARCH_INDEX_PREFIX;
const SEARCH_DOCUMENT_DEFINITION_VERSION = 'v2';
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
  readonly textProjection?: SearchFieldTextProjection;
  readonly skippedReason?: string;
};

export type TableQuerySearchVectorInventory = {
  readonly state: 'ready' | 'missing' | 'stale' | 'invalid' | 'unknown';
  readonly semantics?: 'substring';
  readonly provider?: TableQuerySubstringSearchProvider;
  readonly operatorClass?: TableQuerySubstringSearchOperatorClass;
  readonly existingGeneratedColumn?: string;
  readonly existingIndexName?: string;
  readonly existingIndexValid?: boolean;
  readonly staleReasons: readonly string[];
};

export type TableQuerySubstringSearchProvider = 'pg_bigm' | 'pg_trgm';

export type TableQuerySubstringSearchOperatorClass = 'gin_bigm_ops' | 'gin_trgm_ops';

export type TableQuerySubstringSearchProviderCapability = {
  readonly provider: TableQuerySubstringSearchProvider;
  readonly extensionName: TableQuerySubstringSearchProvider;
  readonly operatorClass: TableQuerySubstringSearchOperatorClass;
  readonly operatorClassSchema?: string;
  readonly extensionInstalled: boolean;
  readonly extensionAvailable: boolean;
  readonly operatorClassInstalled: boolean;
  readonly usable: boolean;
  readonly minimumProbeLength: number;
  readonly reason?:
    | 'extension_not_installed'
    | 'extension_unavailable'
    | 'extension_not_preloaded'
    | 'operator_class_missing';
};

export type TableQuerySubstringSearchCapabilities = {
  readonly selectedProvider: TableQuerySubstringSearchProvider;
  readonly providers: readonly TableQuerySubstringSearchProviderCapability[];
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
  readonly semanticsCompatible?: boolean;
  readonly hypotheticalIndexStatement?: string;
  readonly sqlDetails?: TableQuerySearchVectorSqlDetails;
};

export type TableQuerySearchVectorSqlDetails = {
  readonly beforeSql: string;
  readonly afterSql: string;
  readonly searchProbeLengthBucket: 'none' | 'short' | 'medium' | 'long';
  readonly placeholders: {
    readonly likePattern: string;
    /** @deprecated Substring access paths use likePattern. */
    readonly tsquery: string;
  };
  readonly redaction: 'search_probe_parameterized';
};

export type TableQuerySearchSemanticsStrategy =
  | 'ilike'
  | 'bigram'
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
    | 'generated_text_gin'
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
  readonly generatedTextColumnName: string;
  readonly indexName: string;
  readonly indexKind: 'gin_bigm' | 'gin_trgm';
  readonly accessPath: 'generated_text';
  readonly semantics: 'substring';
  readonly provider: TableQuerySubstringSearchProvider;
  readonly providerCapability: TableQuerySubstringSearchProviderCapability;
  readonly providerCapabilities: readonly TableQuerySubstringSearchProviderCapability[];
  readonly operatorClass: TableQuerySubstringSearchOperatorClass;
  readonly minimumProbeLength: number;
  /** @deprecated Substring search does not use a text-search language configuration. */
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
  readonly indexKind: 'gin_bigm_expression' | 'gin_trgm_expression';
  readonly accessPath: 'scoped_expression_gin';
  readonly semantics: 'substring';
  readonly provider: TableQuerySubstringSearchProvider;
  readonly operatorClass: TableQuerySubstringSearchOperatorClass;
  readonly minimumProbeLength: number;
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
  readonly provider?: TableQuerySubstringSearchProvider;
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
    readonly provider?: TableQuerySubstringSearchProvider;
    readonly operatorClass?: TableQuerySubstringSearchOperatorClass;
    readonly fields: readonly {
      readonly fieldId: string;
      readonly fieldDbName: string;
      readonly fieldType?: string;
      readonly textProjection?: SearchFieldTextProjection;
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
    readonly textProjection?: SearchFieldTextProjection;
  }[];
};

export type DropTableSearchVectorResult = {
  readonly action: 'dropped';
  readonly tableId: string;
  readonly hadManagedObjects: boolean;
  readonly candidateKey?: string;
  readonly generatedColumnName?: string;
  readonly indexName?: string;
};

export type ExecuteTableSearchVectorResult = {
  readonly action: 'created' | 'rebuilt' | 'verified';
  readonly createdOrVerified: boolean;
  readonly candidateKey: string;
  readonly generatedColumnName: string;
  readonly indexName: string;
  readonly semantics: 'substring';
  readonly provider: TableQuerySubstringSearchProvider;
  readonly operatorClass: TableQuerySubstringSearchOperatorClass;
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
  readonly semantics: string;
  readonly access_path: string;
  readonly provider: string;
  readonly operator_class: string | null;
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

const requireProviderCapability = (
  capabilities: TableQuerySubstringSearchCapabilities,
  provider: TableQuerySubstringSearchProvider
): TableQuerySubstringSearchProviderCapability => {
  const capability = capabilities.providers.find((item) => item.provider === provider);
  if (!capability) throw new Error('Substring search provider capability resolution failed');
  return capability;
};

const buildPhysicalNameFailureResult = (input: {
  readonly tableId: string;
  readonly baseId: string;
  readonly languageConfig: string;
  readonly searchProbe?: string;
  readonly fieldSummaries: readonly TableQuerySearchVectorFieldSummary[];
  readonly coveredFields: readonly IncludedSearchVectorField[];
  readonly skippedFields: readonly TableQuerySearchVectorFieldSummary[];
}): AnalyzeTableSearchVectorResult => ({
  tableId: input.tableId,
  baseId: input.baseId,
  languageConfig: input.languageConfig,
  searchProbeLengthBucket: lengthBucket(input.searchProbe),
  scannedFieldCount: input.fieldSummaries.length,
  coveredFieldCount: input.coveredFields.length,
  skippedFieldCount: input.skippedFields.length,
  recommendations: [],
  scopedExpressionRecommendations: [],
  inventory: {
    state: 'unknown',
    staleReasons: ['physical_table_name_failed'],
  },
  coverageReport: buildCoverage(input.fieldSummaries),
});

const buildSearchAccessPathRecommendation = (input: {
  readonly tableId: string;
  readonly baseId: string;
  readonly languageConfig: string;
  readonly requestedFieldIds?: readonly string[];
  readonly coveredFields: readonly IncludedSearchVectorField[];
  readonly skippedFields: readonly TableQuerySearchVectorFieldSummary[];
  readonly providerCapability: TableQuerySubstringSearchProviderCapability;
  readonly providerCapabilities: readonly TableQuerySubstringSearchProviderCapability[];
  readonly names: ReturnType<typeof buildSearchVectorNames>;
  readonly estimatedRows: number;
  readonly tableSizeBytes?: number;
  readonly inventory: TableQuerySearchVectorInventory;
  readonly planEvidence: TableQuerySearchVectorPlanEvidence;
  readonly semanticsReport?: TableQuerySearchSemanticsReport;
  readonly nextAction: TableQuerySearchVectorNextAction;
}): TableQuerySearchVectorRecommendation | undefined => {
  if (!input.coveredFields.length) return undefined;
  return {
    candidateKey: input.names.candidateKey,
    tableId: input.tableId,
    baseId: input.baseId,
    generatedColumnName: input.names.generatedColumnName,
    generatedTextColumnName: input.names.generatedColumnName,
    indexName: input.names.indexName,
    indexKind: input.providerCapability.provider === 'pg_bigm' ? 'gin_bigm' : 'gin_trgm',
    accessPath: 'generated_text',
    semantics: 'substring',
    provider: input.providerCapability.provider,
    providerCapability: input.providerCapability,
    providerCapabilities: input.providerCapabilities,
    operatorClass: input.providerCapability.operatorClass,
    minimumProbeLength: input.providerCapability.minimumProbeLength,
    languageConfig: input.languageConfig,
    searchScope: input.requestedFieldIds?.length ? 'selected_fields' : 'all_fields',
    coveredFields: input.coveredFields,
    skippedFields: input.skippedFields,
    estimatedRows: input.estimatedRows,
    ...(input.tableSizeBytes == null ? {} : { tableSizeBytes: input.tableSizeBytes }),
    inventory: input.inventory,
    planEvidence: input.planEvidence,
    ...(input.semanticsReport ? { semanticsReport: input.semanticsReport } : {}),
    nextAction: input.nextAction,
  };
};

type SearchAccessPathExecutionField = ExecuteTableSearchVectorInput['payload']['fields'][number] & {
  readonly fieldDbName: string;
};

const requireExecutionFields = (
  fields: ExecuteTableSearchVectorInput['payload']['fields']
): readonly SearchAccessPathExecutionField[] => {
  const included = fields
    .filter((field): field is SearchAccessPathExecutionField => Boolean(field.fieldDbName))
    .map((field) => ({
      ...field,
      // Payloads arrive as JSON; never let an unvalidated projection reach DDL.
      textProjection: sanitizeSearchTextProjection(field.textProjection),
    }));
  if (!included.length) {
    throw new Error('Search access-path task payload must include at least one field');
  }
  return included;
};

const requireUsableExecutionProvider = (
  capabilities: TableQuerySubstringSearchCapabilities,
  requestedProvider?: TableQuerySubstringSearchProvider
): TableQuerySubstringSearchProviderCapability => {
  const selectedProvider = requestedProvider ?? capabilities.selectedProvider;
  const capability = requireProviderCapability(capabilities, selectedProvider);
  if (!capability.usable) {
    throw new Error(
      `Substring search provider ${selectedProvider} is not usable (${capability.reason ?? 'capability_missing'})`
    );
  }
  return capability;
};

const assertExecutionOperatorClass = (
  requested: TableQuerySubstringSearchOperatorClass | undefined,
  capability: TableQuerySubstringSearchProviderCapability
): void => {
  if (!requested || requested === capability.operatorClass) return;
  throw new Error(
    `Substring search operator class ${requested} does not match provider ${capability.provider}`
  );
};

const resolveExecutionValidation = (
  input: ExecuteTableSearchVectorInput,
  capability: TableQuerySubstringSearchProviderCapability
): {
  readonly validationMode: 'plan' | 'real_ddl';
  readonly searchProbe?: string;
} => {
  const validationMode = input.payload.validationMode ?? 'plan';
  const searchProbe = input.payload.searchProbe;
  if (validationMode !== 'real_ddl') return { validationMode, searchProbe };
  if (!searchProbe?.trim()) {
    throw new Error('Real-DDL search access-path validation requires a searchProbe');
  }
  if (Array.from(searchProbe.trim()).length < capability.minimumProbeLength) {
    throw new Error(
      `Real-DDL substring validation requires at least ${capability.minimumProbeLength} characters for ${capability.provider}`
    );
  }
  return { validationMode, searchProbe };
};

const assertInventoryCanBeApplied = (
  inventory: TableQuerySearchVectorInventory,
  rebuild: boolean | undefined
): void => {
  if (inventory.state !== 'stale' && inventory.state !== 'invalid') return;
  if (rebuild) return;
  throw new Error(
    `Managed substring search objects are ${inventory.state}; rerun with rebuild=true`
  );
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
    const capabilities = await readSubstringSearchCapabilities(this.dataDb);
    const selectedProvider = input.provider ?? capabilities.selectedProvider;
    const providerCapability = requireProviderCapability(capabilities, selectedProvider);
    const definition = buildTableSearchVectorDefinition(table, {
      fieldIds: input.fieldIds,
      semantics: 'substring',
      provider: selectedProvider,
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
      return buildPhysicalNameFailureResult({
        tableId,
        baseId,
        languageConfig,
        searchProbe: input.searchProbe,
        fieldSummaries,
        coveredFields,
        skippedFields,
      });
    }

    const physical = physicalResult.value;
    const rowEstimate = await readRowEstimate(this.dataDb, physical);
    const estimatedRows = rowEstimate.rows;
    const tableSizeBytes = await readTableSizeBytes(this.dataDb, physical);
    const names = buildSearchVectorNames(tableId, providerCapability, coveredFields);
    const inventory = await inspectSearchVectorInventory(
      this.dataDb,
      physical,
      names,
      coveredFields,
      providerCapability
    );
    const planEvidence = await this.validatePlan({
      physical,
      providerCapability,
      fields: coveredFields,
      searchProbe: input.searchProbe,
    });
    const semanticsReport = await analyzeSearchSemantics(this.dataDb, {
      physical,
      fields: coveredFields,
      providerCapabilities: capabilities.providers,
      searchProbe: input.searchProbe,
      includeResultSamples: input.includeResultSamples ?? true,
      sampleResultLimit: input.sampleResultLimit ?? SEARCH_SEMANTICS_SAMPLE_LIMIT,
    });
    const nextAction = chooseNextAction({
      inventory,
      planEvidence,
      coveredFieldCount: coveredFields.length,
    });

    const recommendation = buildSearchAccessPathRecommendation({
      tableId,
      baseId,
      languageConfig,
      requestedFieldIds: input.fieldIds,
      coveredFields,
      skippedFields,
      providerCapability,
      providerCapabilities: capabilities.providers,
      names,
      estimatedRows,
      tableSizeBytes,
      inventory,
      planEvidence,
      semanticsReport,
      nextAction,
    });

    const scopeHeatReport = this.evaluateScopeHeat(input.observations, estimatedRows);
    if (scopeHeatReport?.isErr()) throw scopeHeatReport.error;
    const scopedExpressionRecommendations = scopeHeatReport?.isOk()
      ? await this.buildScopedExpressionRecommendations({
          scopeHeatEntries: scopeHeatReport.value.hotScopes(),
          coveredFields,
          tableId,
          baseId,
          providerCapability,
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
    readonly providerCapability: TableQuerySubstringSearchProviderCapability;
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

          const names = buildScopedExpressionIndexNames(
            input.tableId,
            input.providerCapability,
            scopeFields
          );
          const planEvidence =
            input.globalInventoryState === 'ready'
              ? await this.validatePlan({
                  physical: input.physical,
                  providerCapability: input.providerCapability,
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
            indexKind:
              input.providerCapability.provider === 'pg_bigm'
                ? 'gin_bigm_expression'
                : 'gin_trgm_expression',
            accessPath: 'scoped_expression_gin',
            semantics: 'substring',
            provider: input.providerCapability.provider,
            operatorClass: input.providerCapability.operatorClass,
            minimumProbeLength: input.providerCapability.minimumProbeLength,
            languageConfig: DEFAULT_LANGUAGE_CONFIG,
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
    readonly providerCapability: TableQuerySubstringSearchProviderCapability;
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
    if (!input.providerCapability.usable) {
      return {
        explainStatus: 'skipped',
        explainReason: `${input.providerCapability.provider}_${
          input.providerCapability.reason ?? 'unusable'
        }`,
      };
    }
    if (!input.searchProbe?.trim()) {
      return {
        explainStatus: 'skipped',
        explainReason: 'search_probe_missing',
      };
    }
    if (Array.from(input.searchProbe.trim()).length < input.providerCapability.minimumProbeLength) {
      return {
        explainStatus: 'skipped',
        explainReason: `${input.providerCapability.provider}_probe_too_short`,
      };
    }

    try {
      const sqlDetails = input.globalGeneratedColumnName
        ? buildScopedSearchVectorSqlDetails({
            ...input,
            globalGeneratedColumnName: input.globalGeneratedColumnName,
          })
        : buildSearchVectorExpressionSqlDetails(input);
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

  /**
   * Table-level kill switch: drop the managed generated column + GIN index and
   * disable every active config row so the runtime falls back to plain ILIKE.
   */
  async drop(
    tableId: string,
    expectedDefinitionKey?: string
  ): Promise<DropTableSearchVectorResult> {
    return this.metaDb.connection().execute(async (lockedMetaDb) => {
      await sql`
        SELECT pg_advisory_lock(
          hashtext('teable.table_query_ops.search_vector'),
          hashtext(${tableId})
        )
      `.execute(lockedMetaDb);
      try {
        const lockedDataDb = this.dataDb === this.metaDb ? lockedMetaDb : this.dataDb;
        return await new PostgresTableSearchVectorExecutor(lockedMetaDb, lockedDataDb).dropUnlocked(
          tableId,
          expectedDefinitionKey
        );
      } finally {
        await sql`
          SELECT pg_advisory_unlock(
            hashtext('teable.table_query_ops.search_vector'),
            hashtext(${tableId})
          )
        `.execute(lockedMetaDb);
      }
    });
  }

  private async dropUnlocked(
    tableId: string,
    expectedDefinitionKey?: string
  ): Promise<DropTableSearchVectorResult> {
    const tableMeta = await this.requireTableMeta(tableId);
    const physical = splitPhysicalName(tableMeta.db_table_name, tableMeta.base_id);
    const tableSql = makePhysicalTableSql(physical.schema, physical.tableName);
    const currentConfig = expectedDefinitionKey
      ? await this.claimedReclaimConfig(tableId, expectedDefinitionKey)
      : await this.currentConfig(tableId);
    if (currentConfig) {
      assertManagedSearchVectorNames(currentConfig.generated_column_name, currentConfig.index_name);
      await this.dropManagedIndex(physical.schema, currentConfig.index_name);
      await this.dropManagedColumn(tableSql, currentConfig.generated_column_name);
    }
    if (expectedDefinitionKey) {
      if (currentConfig) {
        await sql`
          UPDATE table_query_search_vector_config
          SET last_inspection = ${JSON.stringify({
            state: 'disabled',
            staleReasons: ['reclaimed_after_grace'],
          })}::jsonb,
              reclaim_disabled_at = NULL,
              reclaim_drop_after = NULL,
              reclaim_drop_queued_at = NULL,
              reclaim_idx_scan_baseline = NULL,
              reclaim_sampled_at = NULL,
              last_modified_time = now()
          WHERE table_id = ${tableId}
            AND candidate_key = ${expectedDefinitionKey}
            AND status = 'disabled'
        `.execute(this.metaDb);
      }
    } else {
      await sql`
        UPDATE table_query_search_vector_config
        SET status = 'disabled',
            last_inspection = ${JSON.stringify({
              state: 'disabled',
              staleReasons: ['manually_dropped'],
            })}::jsonb,
            last_modified_time = now()
        WHERE table_id = ${tableId}
          AND status IN ('ready', 'stale', 'rebuild_pending')
      `.execute(this.metaDb);
    }

    return {
      action: 'dropped',
      tableId,
      hadManagedObjects: Boolean(currentConfig),
      ...(currentConfig
        ? {
            candidateKey: currentConfig.candidate_key,
            generatedColumnName: currentConfig.generated_column_name,
            indexName: currentConfig.index_name,
          }
        : {}),
    };
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

    const fields = requireExecutionFields(input.payload.fields);
    const languageConfig = normalizeLanguageConfig(input.payload.languageConfig);
    const capabilities = await readSubstringSearchCapabilities(this.dataDb);
    const providerCapability = requireUsableExecutionProvider(capabilities, input.payload.provider);
    assertExecutionOperatorClass(input.payload.operatorClass, providerCapability);
    const executionInput = await withUnattendedProbe(
      this.dataDb,
      physical,
      fields,
      providerCapability,
      input
    );
    const { validationMode, searchProbe } = resolveExecutionValidation(
      executionInput,
      providerCapability
    );
    const validationFields = fields.map((field) => ({
      fieldId: field.fieldId,
      fieldDbName: field.fieldDbName,
      fieldType: field.fieldType ?? 'unknown',
      included: true,
      ...(field.textProjection ? { textProjection: field.textProjection } : {}),
    }));
    const realDdlBeforePlan =
      validationMode === 'real_ddl'
        ? await readRealDdlSearchVectorBeforePlan(this.dataDb, {
            physical,
            fields: validationFields,
            searchProbe,
          })
        : undefined;
    const expression = buildSearchDocumentExpression(fields);
    const tableSql = makePhysicalTableSql(physical.schema, physical.tableName);

    const currentConfig = await this.currentConfig(input.tableId);
    this.assertDefinitionChangeAllowed(currentConfig, input);
    const inventoryBefore = await inspectSearchVectorInventory(
      this.dataDb,
      physical,
      { generatedColumnName: columnName, indexName },
      validationFields,
      providerCapability
    );
    assertInventoryCanBeApplied(inventoryBefore, input.payload.rebuild);
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
        providerCapability,
        realDdlBeforePlan,
        searchProbe,
        validationFields,
      });

      await this.upsertConfig({
        tableId: input.tableId,
        baseId: tableMeta.base_id,
        spaceId: tableMeta.space_id,
        candidateKey: input.payload.candidateKey,
        semantics: 'substring',
        accessPath: 'generated_text',
        provider: providerCapability.provider,
        operatorClass: providerCapability.operatorClass,
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
        semantics: 'substring',
        provider: providerCapability.provider,
        operatorClass: providerCapability.operatorClass,
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
    readonly providerCapability: TableQuerySubstringSearchProviderCapability;
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
        input.expression,
        input.providerCapability
      );
    }

    const inventory = await inspectSearchVectorInventory(
      this.dataDb,
      input.physical,
      {
        generatedColumnName: input.columnName,
        indexName: input.indexName,
      },
      input.validationFields,
      input.providerCapability
    );
    this.assertReadyInventory(inventory);

    const planEvidence =
      input.validationMode === 'real_ddl'
        ? await validateRealDdlSearchVectorPlan(this.dataDb, {
            physical: input.physical,
            providerCapability: input.providerCapability,
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
    expression: string,
    providerCapability: TableQuerySubstringSearchProviderCapability
  ): Promise<void> {
    // pg_bigm has cluster-level deployment requirements. The adapter only uses
    // capabilities that are already installed and never attempts CREATE EXTENSION.
    if (!providerCapability.usable) {
      throw new Error(`Substring search provider ${providerCapability.provider} is not usable`);
    }
    await sql
      .raw(
        `ALTER TABLE ${tableSql} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(
          columnName
        )} text GENERATED ALWAYS AS (${expression}) STORED`
      )
      .execute(this.dataDb);
    await sql
      .raw(
        `COMMENT ON COLUMN ${tableSql}.${quoteIdentifier(columnName)} IS ${quoteLiteral(
          buildSearchDocumentDefinitionMarker(expression, providerCapability)
        )}`
      )
      .execute(this.dataDb);
    const operatorClass = qualifyOperatorClass(providerCapability);
    await sql
      .raw(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${tableSql} USING GIN (${quoteIdentifier(
          columnName
        )} ${operatorClass})`
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
      SELECT candidate_key, semantics, access_path, provider, operator_class,
             generated_column_name, index_name, language_config, field_ids, search_scope
      FROM table_query_search_vector_config
      WHERE table_id = ${tableId}
        AND status IN ('ready', 'stale', 'rebuild_pending')
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
      LIMIT 1
    `.execute(this.metaDb);
    return result.rows[0];
  }

  private async claimedReclaimConfig(
    tableId: string,
    expectedDefinitionKey: string
  ): Promise<SearchVectorConfigRow | undefined> {
    const result = await sql<SearchVectorConfigRow>`
      SELECT candidate_key, semantics, access_path, provider, operator_class,
             generated_column_name, index_name, language_config, field_ids, search_scope
      FROM table_query_search_vector_config
      WHERE table_id = ${tableId}
        AND candidate_key = ${expectedDefinitionKey}
        AND status = 'disabled'
        AND reclaim_drop_after <= now()
        AND reclaim_drop_queued_at IS NOT NULL
      LIMIT 1
    `.execute(this.metaDb);
    return result.rows[0];
  }

  private async upsertConfig(input: {
    readonly tableId: string;
    readonly baseId: string;
    readonly spaceId: string | null;
    readonly candidateKey: string;
    readonly semantics: 'substring';
    readonly accessPath: 'generated_text';
    readonly provider: TableQuerySubstringSearchProvider;
    readonly operatorClass: TableQuerySubstringSearchOperatorClass;
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
        semantics,
        access_path,
        provider,
        operator_class,
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
        ${input.semantics},
        ${input.accessPath},
        ${input.provider},
        ${input.operatorClass},
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
        semantics = EXCLUDED.semantics,
        access_path = EXCLUDED.access_path,
        provider = EXCLUDED.provider,
        operator_class = EXCLUDED.operator_class,
        language_config = EXCLUDED.language_config,
        generated_column_name = EXCLUDED.generated_column_name,
        index_name = EXCLUDED.index_name,
        field_ids = EXCLUDED.field_ids,
        field_db_names = EXCLUDED.field_db_names,
        search_scope = EXCLUDED.search_scope,
        status = EXCLUDED.status,
        last_inspection = EXCLUDED.last_inspection,
        reclaim_disabled_at = NULL,
        reclaim_drop_after = NULL,
        reclaim_drop_queued_at = NULL,
        reclaim_idx_scan_baseline = NULL,
        reclaim_sampled_at = NULL,
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
      if (input.mode === 'drop') {
        const executor = new PostgresTableSearchVectorExecutor(this.metaDb, this.dataDb);
        const dropped = await executor.drop(
          input.table.id().toString(),
          input.expectedDefinitionKey
        );
        return ok<ReconcileTableSearchVectorResult>({
          action: 'dropped',
          tableId: dropped.tableId,
          definitionKey: dropped.candidateKey ?? '',
          generatedColumnName: dropped.generatedColumnName ?? '',
          indexName: dropped.indexName ?? '',
          languageConfig: DEFAULT_LANGUAGE_CONFIG,
          fieldIds: [],
          status: 'disabled',
        });
      }

      const advisor = new PostgresTableSearchVectorAdvisor(this.dataDb);
      const analysis = await advisor.analyze(context, {
        table: input.table,
        fieldIds: input.fieldIds,
        provider:
          input.provider === 'pg_bigm' || input.provider === 'pg_trgm' ? input.provider : undefined,
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
      if (
        input.expectedDefinitionKey &&
        recommendation.candidateKey !== input.expectedDefinitionKey
      ) {
        return err(
          domainError.conflict({
            message: `Search access path changed from ${input.expectedDefinitionKey} to ${recommendation.candidateKey}; analyze and confirm again`,
          })
        );
      }

      const candidate = {
        candidateKey: recommendation.candidateKey,
        generatedColumnName: recommendation.generatedColumnName,
        indexName: recommendation.indexName,
        fields: recommendation.coveredFields.map((field) => ({
          fieldId: field.fieldId,
          fieldDbName: field.fieldDbName ?? '',
          ...(field.textProjection ? { textProjection: field.textProjection } : {}),
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
          provider: recommendation.provider,
          operatorClass: recommendation.operatorClass,
          fields: recommendation.coveredFields.map((field) => ({
            fieldId: field.fieldId,
            fieldDbName: field.fieldDbName ?? '',
            fieldType: field.fieldType,
            ...(field.textProjection ? { textProjection: field.textProjection } : {}),
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
        provider:
          current.provider === 'pg_bigm' || current.provider === 'pg_trgm'
            ? current.provider
            : undefined,
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
          provider: recommendation.provider,
          operatorClass: recommendation.operatorClass,
          fields: recommendation.coveredFields.map((field) => ({
            fieldId: field.fieldId,
            fieldDbName: field.fieldDbName ?? '',
            fieldType: field.fieldType,
            ...(field.textProjection ? { textProjection: field.textProjection } : {}),
          })),
          searchScope: recommendation.searchScope,
          // Schema maintenance must obey the same rewrite guard as an explicit
          // remediation. Large or unknown tables remain pending for Admin approval.
          allowLargeTableRewrite: false,
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
  providerCapability: TableQuerySubstringSearchProviderCapability,
  fields: readonly {
    readonly fieldId: string;
    readonly fieldDbName?: string;
    readonly textProjection?: SearchFieldTextProjection;
  }[]
) => {
  const hash = stableHash(
    `${tableId}:substring:${providerCapability.provider}:${providerCapability.operatorClass}:${fields
      .map(
        (field) =>
          `${field.fieldId}=${field.fieldDbName ?? ''}:${searchTextProjectionKey(field.textProjection)}`
      )
      .join(',')}`
  );
  return {
    candidateKey: `search_document:${tableId}:${providerCapability.provider}:${hash}`,
    generatedColumnName: `${GENERATED_COLUMN_PREFIX}${hash}`.slice(0, 63),
    indexName: `${INDEX_NAME_PREFIX}${tableId}_${hash}`.slice(0, 63),
  };
};

const buildScopedExpressionIndexNames = (
  tableId: string,
  providerCapability: TableQuerySubstringSearchProviderCapability,
  fields: readonly {
    readonly fieldId: string;
    readonly fieldDbName?: string;
    readonly textProjection?: SearchFieldTextProjection;
  }[]
) => {
  const hash = stableHash(
    `${tableId}:substring:${providerCapability.provider}:${providerCapability.operatorClass}:${fields
      .map(
        (field) =>
          `${field.fieldId}=${field.fieldDbName ?? ''}:${searchTextProjectionKey(field.textProjection)}`
      )
      .sort()
      .join(',')}`
  );
  return {
    candidateKey: `scoped_search_expression:${tableId}:${hash}`,
    indexName: `${SCOPED_EXPRESSION_INDEX_PREFIX}${tableId}_${hash}`.slice(0, 63),
  };
};

type SearchDocumentExpressionField = {
  readonly fieldDbName: string;
  readonly textProjection?: SearchFieldTextProjection;
};

/**
 * Unattended real-DDL runs have no admin-typed probe: sample one from the table's
 * own data (guaranteed to match a row), or fall back to plan validation on empty
 * tables where result-compatibility checks are meaningless.
 */
const withUnattendedProbe = async (
  dataDb: Kysely<UnknownPostgresDatabase>,
  physical: { readonly schema: string; readonly tableName: string },
  fields: readonly SearchDocumentExpressionField[],
  capability: TableQuerySubstringSearchProviderCapability,
  input: ExecuteTableSearchVectorInput
): Promise<ExecuteTableSearchVectorInput> => {
  if ((input.payload.validationMode ?? 'plan') !== 'real_ddl') return input;
  if (input.payload.searchProbe?.trim()) return input;
  const sampledProbe = await sampleSearchProbeFromData(
    dataDb,
    physical,
    fields,
    capability.minimumProbeLength
  );
  return sampledProbe
    ? { ...input, payload: { ...input.payload, searchProbe: sampledProbe } }
    : { ...input, payload: { ...input.payload, validationMode: 'plan' } };
};

/**
 * Samples a substring probe from the table's own search document so unattended
 * real-DDL validation always probes something that matches at least one row. The
 * caller trims/normalizes; returns undefined when no row carries enough text.
 */
const sampleSearchProbeFromData = async (
  dataDb: Kysely<UnknownPostgresDatabase>,
  physical: { readonly schema: string; readonly tableName: string },
  fields: readonly SearchDocumentExpressionField[],
  minimumProbeLength: number
): Promise<string | undefined> => {
  const expression = buildSearchDocumentExpression(fields);
  const probeLength = Math.max(minimumProbeLength, 3) + 5;
  const result = await sql<{ probe: string | null }>`
    SELECT substring(btrim(${sql.raw(expression)}) FROM 1 FOR ${probeLength}) AS probe
    FROM ${sql.raw(makePhysicalTableSql(physical.schema, physical.tableName))}
    WHERE char_length(btrim(${sql.raw(expression)})) >= ${minimumProbeLength}
    LIMIT 1
  `.execute(dataDb);
  const probe = result.rows[0]?.probe?.trim();
  return probe && Array.from(probe).length >= minimumProbeLength ? probe : undefined;
};

const buildSearchDocumentExpression = (
  fields: readonly SearchDocumentExpressionField[]
): string => {
  const document = fields
    .map(
      (field) =>
        `coalesce(${renderSearchTextProjectionSql(quoteIdentifier(field.fieldDbName), field.textProjection)}, '')`
    )
    .join(` || E'\\n' || `);
  return `lower(${document || quoteLiteral('')})`;
};

const buildSearchDocumentExpressionWithAlias = (
  fields: readonly IncludedSearchVectorField[],
  alias: string
): string => {
  const document = fields
    .map(
      (field) =>
        `coalesce(${renderSearchTextProjectionSql(
          `${quoteIdentifier(alias)}.${quoteIdentifier(field.fieldDbName)}`,
          field.textProjection
        )}, '')`
    )
    .join(` || E'\\n' || `);
  return `lower(${document || quoteLiteral('')})`;
};

const analyzeSearchSemantics = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly providerCapabilities: readonly TableQuerySubstringSearchProviderCapability[];
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
    ...input.providerCapabilities.map((capability) =>
      analyzeNgramSemantics({ capability, baseline, searchProbe })
    ),
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
        'Confirm that each n-gram access path preserves the ILIKE substring result set and materially reduces plan cost before rollout.',
      criteria: [
        'Do match counts and sampled record ids remain identical to the ILIKE baseline?',
        'Is the probe long enough for the selected n-gram provider?',
        'Does EXPLAIN use the managed GIN index?',
        'Is the measured cost improvement large enough to justify write and storage overhead?',
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

const analyzeNgramSemantics = (input: {
  readonly capability: TableQuerySubstringSearchProviderCapability;
  readonly searchProbe: string;
  readonly baseline: TableQuerySearchSemanticsComparison;
}): TableQuerySearchSemanticsComparison => {
  const strategy = input.capability.provider === 'pg_bigm' ? 'bigram' : 'trigram';
  return {
    strategy,
    label: `${input.capability.provider} substring`,
    semantics: input.capability.provider === 'pg_bigm' ? 'substring' : 'trigram_substring',
    available: input.capability.usable,
    availabilityReason: input.capability.reason,
    indexSupport: input.capability.usable ? 'generated_text_gin' : 'extension_required',
    tokenPreview:
      input.capability.provider === 'pg_bigm'
        ? buildNgramTokenPreview(input.searchProbe, 2)
        : buildNgramTokenPreview(input.searchProbe, 3),
    tokenCount: Math.max(0, input.searchProbe.length - input.capability.minimumProbeLength + 1),
    explainStatus: input.baseline.explainStatus,
    explainReason: input.capability.usable
      ? 'same_substring_semantics_as_ilike'
      : input.capability.reason,
    cost: input.baseline.cost,
    planNode: input.baseline.planNode,
    usesIndex: input.baseline.usesIndex,
    matchCount: input.baseline.matchCount,
    sampleResults: input.baseline.sampleResults,
    reasonablenessAssessment: buildLlmAssessment([
      'same_result_semantics_as_ilike',
      input.capability.usable ? 'provider_usable' : 'provider_not_usable',
    ]),
  };
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
  if (comparison.strategy === 'ilike') return [];
  if (comparison.strategy === 'bigram' || comparison.strategy === 'trigram') {
    if (typeof matchCountDeltaPctFromIlike !== 'number') return ['match_count_delta_unknown'];
    return matchCountDeltaPctFromIlike === 0
      ? ['substring_results_match']
      : ['substring_result_mismatch'];
  }
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

const buildNgramTokenPreview = (
  searchProbe: string,
  ngramLength: 2 | 3
): readonly TableQuerySearchSemanticsToken[] => {
  const compact = searchProbe.replace(/\s+/g, ' ').trim();
  if (compact.length < ngramLength) return buildLiteralTokenPreview(compact);
  const tokens: TableQuerySearchSemanticsToken[] = [];
  for (let index = 0; index <= compact.length - ngramLength; index += 1) {
    tokens.push({
      token: compact.slice(index, index + ngramLength),
      alias: ngramLength === 2 ? 'bigram' : 'trigram',
      lexemes: [compact.slice(index, index + ngramLength)],
    });
    if (tokens.length >= SEARCH_SEMANTICS_TOKEN_LIMIT) break;
  }
  return tokens;
};

const toSubstringProviderCapability = (
  capability: TableSearchAccessPathCapability
): TableQuerySubstringSearchProviderCapability => {
  const reason =
    capability.state === 'ready'
      ? undefined
      : capability.state === 'requires_database_extension'
        ? ('extension_not_installed' as const)
        : capability.state === 'requires_cluster_restart'
          ? ('extension_not_preloaded' as const)
          : capability.available
            ? ('operator_class_missing' as const)
            : ('extension_unavailable' as const);
  return {
    provider: capability.provider,
    extensionName: capability.extensionName,
    operatorClass: capability.operatorClass,
    ...(capability.operatorClassSchema
      ? { operatorClassSchema: capability.operatorClassSchema }
      : {}),
    extensionInstalled: capability.installed,
    extensionAvailable: capability.available,
    operatorClassInstalled: capability.operatorClassInstalled,
    usable: capability.state === 'ready',
    minimumProbeLength: capability.minimumProbeLength,
    ...(reason ? { reason } : {}),
  };
};

export const readSubstringSearchCapabilities = async (
  db: Kysely<UnknownPostgresDatabase>
): Promise<TableQuerySubstringSearchCapabilities> => {
  const providers = (await readPostgresSearchAccessPathCapabilities(db)).map(
    toSubstringProviderCapability
  );
  // Merely being listed in pg_available_extensions is not enough for pg_bigm:
  // it can require cluster-level preload/deployment. Never install it here.
  return {
    selectedProvider: selectSubstringSearchProvider(providers),
    providers,
  };
};

export const selectSubstringSearchProvider = (
  capabilities: readonly TableQuerySubstringSearchProviderCapability[]
): TableQuerySubstringSearchProvider =>
  capabilities.find((capability) => capability.provider === 'pg_bigm' && capability.usable)
    ? 'pg_bigm'
    : 'pg_trgm';

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

// The exact per-field predicate over the same canonical projections the
// generated document is built from. Using one projection on both sides is what
// keeps the document prefilter a superset of this baseline.
const buildFieldProjectionSql = (field: IncludedSearchVectorField, alias: string): string =>
  renderSearchTextProjectionSql(
    `${quoteIdentifier(alias)}.${quoteIdentifier(field.fieldDbName)}`,
    field.textProjection
  );

const buildIlikeWhere = (
  fields: readonly IncludedSearchVectorField[],
  searchProbe: string
): ReturnType<typeof sql> => {
  const pattern = `%${escapeLikeWildcards(searchProbe)}%`;
  const conditions = fields.map(
    (field) => sql`${sql.raw(buildFieldProjectionSql(field, 't'))} ILIKE ${pattern} ESCAPE '\\'`
  );
  return conditions.reduce((acc, condition) => sql`${acc} OR ${condition}`, sql`false`);
};

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
  fields: readonly {
    readonly fieldDbName?: string;
    readonly textProjection?: SearchFieldTextProjection;
  }[],
  providerCapability: TableQuerySubstringSearchProviderCapability
): Promise<TableQuerySearchVectorInventory> => {
  const columnRows = await sql<{
    column_name: string;
    generation_expression: string | null;
    data_type: string;
    generated_kind: string;
    definition_marker: string | null;
  }>`
    SELECT
      a.attname AS column_name,
      pg_get_expr(ad.adbin, ad.adrelid) AS generation_expression,
      format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attgenerated AS generated_kind,
      col_description(a.attrelid, a.attnum) AS definition_marker
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
  const indexRows = await sql<{
    index_name: string;
    valid: boolean;
    access_method: string;
    indexed_column: string | null;
    operator_class: string | null;
    operator_class_schema: string | null;
  }>`
    SELECT
      c.relname AS index_name,
      i.indisvalid AS valid,
      am.amname AS access_method,
      indexed_attribute.attname AS indexed_column,
      opc.opcname AS operator_class,
      opn.nspname AS operator_class_schema
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_am am ON am.oid = c.relam
    LEFT JOIN pg_attribute indexed_attribute
      ON indexed_attribute.attrelid = i.indrelid
      AND indexed_attribute.attnum = i.indkey[0]
    LEFT JOIN pg_opclass opc ON opc.oid = i.indclass[0]
    LEFT JOIN pg_namespace opn ON opn.oid = opc.opcnamespace
    WHERE n.nspname = ${physical.schema}
      AND t.relname = ${physical.tableName}
      AND c.relname = ${names.indexName}
    LIMIT 1
  `.execute(db);

  const column = columnRows.rows[0];
  const index = indexRows.rows[0];
  const expectedExpression = buildSearchDocumentExpression(
    fields.filter((field): field is SearchDocumentExpressionField => Boolean(field.fieldDbName))
  );
  const staleReasons = collectSearchVectorStaleReasons(
    column,
    index,
    fields,
    names,
    expectedExpression,
    providerCapability
  );
  const state = resolveSearchVectorInventoryState(column, index, staleReasons);
  return {
    state,
    semantics: 'substring',
    provider: providerCapability.provider,
    operatorClass: providerCapability.operatorClass,
    existingGeneratedColumn: column?.column_name,
    existingIndexName: index?.index_name,
    existingIndexValid: index?.valid,
    staleReasons,
  };
};

type SearchDocumentCatalogColumn = {
  readonly generation_expression: string | null;
  readonly data_type: string;
  readonly generated_kind: string;
  readonly definition_marker: string | null;
};

type SearchDocumentCatalogIndex = {
  readonly valid: boolean;
  readonly access_method: string;
  readonly indexed_column: string | null;
  readonly operator_class: string | null;
  readonly operator_class_schema: string | null;
};

const collectSearchDocumentColumnStaleReasons = (
  column: SearchDocumentCatalogColumn | undefined,
  fields: readonly { readonly fieldDbName?: string }[],
  expectedExpression: string,
  providerCapability: TableQuerySubstringSearchProviderCapability
): string[] => {
  const staleReasons: string[] = [];
  if (column && column.data_type !== 'text') staleReasons.push('generated_column_type_mismatch');
  if (column && column.generated_kind !== 's') staleReasons.push('generated_column_not_stored');
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
    const expectedMarker = buildSearchDocumentDefinitionMarker(
      expectedExpression,
      providerCapability
    );
    if (column.definition_marker !== expectedMarker) {
      staleReasons.push('generated_expression_mismatch');
    }
  }
  return staleReasons;
};

const collectSearchDocumentIndexStaleReasons = (
  index: SearchDocumentCatalogIndex | undefined,
  generatedColumnName: string,
  providerCapability: TableQuerySubstringSearchProviderCapability
): string[] => {
  const staleReasons: string[] = [];
  if (index && index.access_method !== 'gin') staleReasons.push('index_access_method_mismatch');
  if (index && index.indexed_column !== generatedColumnName) {
    staleReasons.push('index_column_mismatch');
  }
  if (index && index.operator_class !== providerCapability.operatorClass) {
    staleReasons.push('index_operator_class_mismatch');
  }
  if (
    index &&
    providerCapability.operatorClassSchema &&
    index.operator_class_schema !== providerCapability.operatorClassSchema
  ) {
    staleReasons.push('index_operator_class_schema_mismatch');
  }
  if (index && !index.valid) staleReasons.push('invalid_index');
  return staleReasons;
};

const collectSearchVectorStaleReasons = (
  column: SearchDocumentCatalogColumn | undefined,
  index: SearchDocumentCatalogIndex | undefined,
  fields: readonly { readonly fieldDbName?: string }[],
  names: { readonly generatedColumnName: string; readonly indexName: string },
  expectedExpression: string,
  providerCapability: TableQuerySubstringSearchProviderCapability
): string[] => [
  ...collectSearchDocumentColumnStaleReasons(
    column,
    fields,
    expectedExpression,
    providerCapability
  ),
  ...collectSearchDocumentIndexStaleReasons(index, names.generatedColumnName, providerCapability),
];

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
  if (
    !columnName.startsWith(GENERATED_COLUMN_PREFIX) &&
    !columnName.startsWith(LEGACY_GENERATED_COLUMN_PREFIX)
  ) {
    throw new Error(
      `Refusing to manage generated column "${columnName}": search vector columns must start with "${GENERATED_COLUMN_PREFIX}"`
    );
  }
  if (!indexName.startsWith(INDEX_NAME_PREFIX) && !indexName.startsWith(LEGACY_INDEX_NAME_PREFIX)) {
    throw new Error(
      `Refusing to manage index "${indexName}": search vector indexes must start with "${INDEX_NAME_PREFIX}"`
    );
  }
};

const buildSearchDocumentDefinitionMarker = (
  expression: string,
  providerCapability: TableQuerySubstringSearchProviderCapability
): string =>
  `teable.table-query-ops.search-document:${SEARCH_DOCUMENT_DEFINITION_VERSION}:${stableHash(
    `${expression}:${providerCapability.provider}:${providerCapability.operatorClass}:${
      providerCapability.operatorClassSchema ?? ''
    }`
  )}`;

const qualifyOperatorClass = (
  providerCapability: TableQuerySubstringSearchProviderCapability
): string =>
  providerCapability.operatorClassSchema
    ? `${quoteIdentifier(providerCapability.operatorClassSchema)}.${quoteIdentifier(
        providerCapability.operatorClass
      )}`
    : quoteIdentifier(providerCapability.operatorClass);

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

const readRealDdlSearchVectorBeforePlan = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
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
  return explainSearchBefore(db, input);
};

const validateRealDdlSearchVectorPlan = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly providerCapability: TableQuerySubstringSearchProviderCapability;
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
    const semanticsCompatible = await validateSubstringResultCompatibility(db, input);
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
      semanticsCompatible,
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
  if (evidence.semanticsCompatible !== true) {
    throw new Error('Real-DDL substring search validation did not preserve ILIKE results');
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
  const where = buildIlikeWhere(input.fields, input.searchProbe ?? '');
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
  readonly providerCapability: TableQuerySubstringSearchProviderCapability;
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
  readonly providerCapability: TableQuerySubstringSearchProviderCapability;
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
  readonly providerCapability: TableQuerySubstringSearchProviderCapability;
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
        `${buildFieldProjectionSql(field, 't')} ILIKE :search_probe_like_pattern ESCAPE '\\\\'`
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
  readonly fields: readonly IncludedSearchVectorField[];
}): string =>
  buildSubstringSearchSql(input, buildSearchDocumentExpressionWithAlias(input.fields, 't'));

const buildGeneratedColumnSearchSql = (input: {
  readonly physical: PhysicalTable;
  readonly fields: readonly IncludedSearchVectorField[];
  readonly generatedColumnName: string;
}): string =>
  buildSubstringSearchSql(
    input,
    `${quoteIdentifier('t')}.${quoteIdentifier(input.generatedColumnName)}`
  );

const buildScopedSearchSql = (input: {
  readonly physical: PhysicalTable;
  readonly fields: readonly IncludedSearchVectorField[];
  readonly globalGeneratedColumnName: string;
}): string => {
  const exactConditions = buildBeforeSearchConditionsSql(input.fields);
  return [
    'EXPLAIN (FORMAT JSON)',
    'SELECT 1',
    `FROM ${makePhysicalTableSql(input.physical.schema, input.physical.tableName)} AS ${quoteIdentifier(
      't'
    )}`,
    `WHERE ${quoteIdentifier('t')}.${quoteIdentifier(
      input.globalGeneratedColumnName
    )} LIKE lower(:search_probe_like_pattern) ESCAPE '\\\\'`,
    `  AND ${buildSearchDocumentExpressionWithAlias(
      input.fields,
      't'
    )} LIKE lower(:search_probe_like_pattern) ESCAPE '\\\\'`,
    `  AND (${exactConditions})`,
    'LIMIT 100',
  ].join('\n');
};

const buildSubstringSearchSql = (
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
  },
  documentExpression: string
): string => {
  const exactConditions = buildBeforeSearchConditionsSql(input.fields);
  return [
    'EXPLAIN (FORMAT JSON)',
    'SELECT 1',
    `FROM ${makePhysicalTableSql(input.physical.schema, input.physical.tableName)} AS ${quoteIdentifier(
      't'
    )}`,
    `WHERE ${documentExpression} LIKE lower(:search_probe_like_pattern) ESCAPE '\\\\'`,
    `  AND (${exactConditions})`,
    'LIMIT 100',
  ].join('\n');
};

const buildBeforeSearchConditionsSql = (fields: readonly IncludedSearchVectorField[]): string =>
  fields
    .map(
      (field) =>
        `${buildFieldProjectionSql(field, 't')} ILIKE :search_probe_like_pattern ESCAPE '\\\\'`
    )
    .join(' OR ') || 'false';

const buildOptimizedSubstringWhere = (input: {
  readonly fields: readonly IncludedSearchVectorField[];
  readonly searchProbe?: string;
  readonly documentExpression: string;
}): ReturnType<typeof sql> => {
  const pattern = `%${escapeLikeWildcards(input.searchProbe ?? '')}%`;
  const exactWhere = buildIlikeWhere(input.fields, input.searchProbe ?? '');
  return sql`${sql.raw(input.documentExpression)} LIKE lower(${pattern}) ESCAPE '\\' AND (${exactWhere})`;
};

const explainGeneratedSearchVectorColumn = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
    readonly generatedColumnName: string;
  }
): Promise<ExplainPlan> => {
  const where = buildOptimizedSubstringWhere({
    fields: input.fields,
    searchProbe: input.searchProbe,
    documentExpression: `${quoteIdentifier('t')}.${quoteIdentifier(input.generatedColumnName)}`,
  });
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON)
    SELECT 1
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${where}
    LIMIT 100
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const explainSearchAfter = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
  }
): Promise<ExplainPlan> => {
  const where = buildOptimizedSubstringWhere({
    fields: input.fields,
    searchProbe: input.searchProbe,
    documentExpression: buildSearchDocumentExpressionWithAlias(input.fields, 't'),
  });
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON)
    SELECT 1
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${where}
    LIMIT 100
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const explainScopedSearch = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
    readonly globalGeneratedColumnName: string;
  }
): Promise<ExplainPlan> => {
  const pattern = `%${escapeLikeWildcards(input.searchProbe ?? '')}%`;
  const exactWhere = buildIlikeWhere(input.fields, input.searchProbe ?? '');
  const scopedExpression = buildSearchDocumentExpressionWithAlias(input.fields, 't');
  const rows = await sql<ExplainRow>`
    EXPLAIN (FORMAT JSON)
    SELECT 1
    FROM ${sql.raw(makePhysicalTableSql(input.physical.schema, input.physical.tableName))} AS ${sql.raw(quoteIdentifier('t'))}
    WHERE ${sql.raw(`${quoteIdentifier('t')}.${quoteIdentifier(input.globalGeneratedColumnName)}`)} LIKE lower(${pattern}) ESCAPE '\\'
      AND ${sql.raw(scopedExpression)} LIKE lower(${pattern}) ESCAPE '\\'
      AND (${exactWhere})
    LIMIT 100
  `.execute(db);
  return parseExplainPlan(rows.rows[0]?.['QUERY PLAN']);
};

const validateSubstringResultCompatibility = async (
  db: Kysely<UnknownPostgresDatabase>,
  input: {
    readonly physical: PhysicalTable;
    readonly fields: readonly IncludedSearchVectorField[];
    readonly searchProbe?: string;
    readonly generatedColumnName: string;
  }
): Promise<boolean> => {
  const baseline = buildIlikeWhere(input.fields, input.searchProbe ?? '');
  const optimized = buildOptimizedSubstringWhere({
    fields: input.fields,
    searchProbe: input.searchProbe,
    documentExpression: `${quoteIdentifier('t')}.${quoteIdentifier(input.generatedColumnName)}`,
  });
  const tableSql = makePhysicalTableSql(input.physical.schema, input.physical.tableName);
  const result = await sql<{ compatible: boolean }>`
    SELECT NOT EXISTS (
      (SELECT ctid FROM ${sql.raw(tableSql)} AS ${sql.raw(quoteIdentifier('t'))} WHERE ${baseline}
       EXCEPT
       SELECT ctid FROM ${sql.raw(tableSql)} AS ${sql.raw(quoteIdentifier('t'))} WHERE ${optimized})
      UNION ALL
      (SELECT ctid FROM ${sql.raw(tableSql)} AS ${sql.raw(quoteIdentifier('t'))} WHERE ${optimized}
       EXCEPT
       SELECT ctid FROM ${sql.raw(tableSql)} AS ${sql.raw(quoteIdentifier('t'))} WHERE ${baseline})
    ) AS compatible
  `.execute(db);
  return Boolean(result.rows[0]?.compatible);
};

const buildHypotheticalSearchVectorIndexStatement = (input: {
  readonly physical: PhysicalTable;
  readonly providerCapability: TableQuerySubstringSearchProviderCapability;
  readonly fields: readonly IncludedSearchVectorField[];
}): string => {
  const expression = buildSearchDocumentExpression(input.fields);
  return `CREATE INDEX ON ${makePhysicalTableSql(
    input.physical.schema,
    input.physical.tableName
  )} USING gin ((${expression}) ${qualifyOperatorClass(input.providerCapability)})`;
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
