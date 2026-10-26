/* eslint-disable sonarjs/cognitive-complexity -- source validation and catalog/assumption branching are explicit */
import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import {
  domainError,
  FormulaField,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  type Table,
} from '@teable/v2-core';
import {
  FieldDependencyGraph,
  PostgresComplexityStatisticsReader,
  v2RecordRepositoryPostgresTokens,
  type FieldDependencyGraphData,
  type PostgresComplexityStatisticsSnapshot,
} from '@teable/v2-adapter-table-repository-postgres';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import {
  buildComplexityAssessment,
  buildSchemaComplexityProfile,
  simulateSchemaComplexity,
  type ComplexityAssessment,
  type DataStatisticsSnapshot,
  type FormulaProfile,
  type OperationDescriptor,
  type SchemaComplexityAssumptions,
  type SchemaComplexityEdge,
  type SchemaComplexityField,
  type SchemaComplexityProfile,
  type SchemaOperationKind,
} from '@teable/v2-complexity';

import {
  collectSchemaComplexityProfile,
  prepareSchemaComplexityInput,
} from '../profile/collectSchemaComplexityProfile';
import {
  mergeComplexityStatistics,
  type ComplexityConditionalEdge,
} from '../profile/mergeComplexityStatistics';

export type ComplexitySchemaInput = {
  readonly fields: ReadonlyArray<
    Omit<SchemaComplexityField, 'formula'> & { readonly formula?: FormulaProfile | unknown }
  >;
  readonly edges: ReadonlyArray<SchemaComplexityEdge>;
};

export type ComplexityAssessInput = {
  readonly tableId?: string;
  /**
   * Raw schema input may carry a host-shaped formula object (the HTTP contract
   * treats it as opaque). The pure model consumes a precomputed FormulaProfile.
   */
  readonly schema?: ComplexitySchemaInput;
  readonly operation?: OperationDescriptor;
  readonly assumptions?: SchemaComplexityAssumptions;
  /** Read catalog aggregates for tableId. Caller assumptions are merged per key. */
  readonly includeCatalogStats?: boolean;
  readonly completeness?: 'complete' | 'partial' | 'truncated';
  readonly focusTableId?: string;
  readonly maxTraversalDepth?: number;
  /** Host-authorized table ids; omitted means the caller already scoped access. */
  readonly authorizedTableIds?: ReadonlyArray<string>;
};

export type ComplexityAssessResult = {
  readonly profile: SchemaComplexityProfile;
  readonly assessment: ComplexityAssessment;
};

export type ComplexityMatrixOperation =
  | 'update'
  | 'field-delete'
  | 'field-convert'
  | 'create-record'
  | 'delete-record';
export type ComplexityMatrixCellBasis = 'schema-potential-only';
export type ComplexityMatrixBasis = 'schema-potential-only';

export type ComplexityMatrixCell = {
  readonly operation: ComplexityMatrixOperation;
  readonly basis: ComplexityMatrixCellBasis;
  readonly level: ComplexityAssessment['level'];
  readonly score: ComplexityAssessment['score'];
  readonly confidence: ComplexityAssessment['confidence'];
  readonly workload: ComplexityAssessment['workload'];
  readonly structural: number;
  readonly dataWork: number | null;
  readonly risk: number;
  readonly reasonCodes: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

export type ComplexityMatrixRow = {
  readonly scope: 'field' | 'table';
  readonly fieldId: string | null;
  readonly fieldType: string | null;
  readonly tableId: string;
  readonly level: ComplexityAssessment['level'];
  readonly typicalRows: number | null;
  readonly worstRows: number | null;
  readonly mainReason: string | null;
  readonly confidence: ComplexityAssessment['confidence'];
  readonly basis: ComplexityMatrixBasis;
  readonly unknownCellCount: number;
  readonly cells: ReadonlyArray<ComplexityMatrixCell>;
};

export type ComplexityMatrixResult = {
  readonly tableId: string;
  readonly completeness: 'complete' | 'partial' | 'truncated';
  readonly fieldCount: number;
  readonly basis: ComplexityMatrixBasis;
  /** Rows with no unknown-level cell; eligible for score ordering. */
  readonly rows: ReadonlyArray<ComplexityMatrixRow>;
  /** Rows containing an unknown-level cell; never score-ordered. */
  readonly unknownRows: ReadonlyArray<ComplexityMatrixRow>;
  readonly warnings: ReadonlyArray<string>;
};

export type ComplexityMatrixInput = {
  readonly tableId: string;
  readonly fieldIds?: ReadonlyArray<string>;
  readonly operations?: ReadonlyArray<ComplexityMatrixOperation>;
  readonly maxFields?: number;
  readonly assumptions?: SchemaComplexityAssumptions;
  readonly includeCatalogStats?: boolean;
  /** Host-authorized table ids; omitted means the caller already scoped access. */
  readonly authorizedTableIds?: ReadonlyArray<string>;
};

export interface IComplexityService {
  assess(
    context: IExecutionContext,
    input: ComplexityAssessInput
  ): Promise<Result<ComplexityAssessResult, DomainError>>;
  assessMatrix(
    context: IExecutionContext,
    input: ComplexityMatrixInput
  ): Promise<Result<ComplexityMatrixResult, DomainError>>;
}

/** A base wider than this keeps seed-scoped metadata and declares itself partial. */
export const COMPLEXITY_METADATA_MAX_TABLES = 200;
/** Catalog snapshots are reused for a short window to avoid a per-request base scan. */
export const COMPLEXITY_CATALOG_CACHE_TTL_MS = 20_000;
const COMPLEXITY_CATALOG_CACHE_MAX_ENTRIES = 8;
const COMPLEXITY_MATRIX_MAX_FIELDS = 1000;

type CatalogCacheEntry = {
  readonly snapshot: PostgresComplexityStatisticsSnapshot;
  readonly storedAt: number;
};

const catalogCache = new Map<string, CatalogCacheEntry>();

export const clearComplexityStatisticsCache = (): void => {
  catalogCache.clear();
};

const readCatalogCache = (baseId: string): CatalogCacheEntry | undefined => {
  const entry = catalogCache.get(baseId);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > COMPLEXITY_CATALOG_CACHE_TTL_MS) {
    catalogCache.delete(baseId);
    return undefined;
  }
  return entry;
};

const writeCatalogCache = (baseId: string, snapshot: PostgresComplexityStatisticsSnapshot) => {
  catalogCache.delete(baseId);
  catalogCache.set(baseId, { snapshot, storedAt: Date.now() });
  while (catalogCache.size > COMPLEXITY_CATALOG_CACHE_MAX_ENTRIES) {
    const oldest = catalogCache.keys().next().value;
    if (oldest === undefined) break;
    catalogCache.delete(oldest);
  }
};

const validateInput = (input: ComplexityAssessInput): DomainError | null => {
  if ((input.tableId === undefined) === (input.schema === undefined)) {
    return domainError.validation({
      message: 'Provide exactly one of tableId or schema',
    });
  }
  if (input.assumptions !== undefined && input.operation === undefined) {
    return domainError.validation({
      message: 'assumptions require an operation',
    });
  }
  if (input.includeCatalogStats && input.tableId === undefined) {
    return domainError.validation({
      message: 'includeCatalogStats requires tableId',
    });
  }
  return null;
};

const normalizeSchemaFields = (
  fields: ComplexitySchemaInput['fields']
): ReadonlyArray<SchemaComplexityField> =>
  fields.map((field) => ({
    ...field,
    formula: field.formula as FormulaProfile | undefined,
  }));

const mergeWarnings = (
  ...groups: ReadonlyArray<ReadonlyArray<string> | undefined>
): ReadonlyArray<string> => [...new Set(groups.flatMap((group) => group ?? []))].sort();

const MATRIX_LEVEL_SEVERITY: Record<ComplexityAssessment['level'], number> = {
  unknown: 0,
  trivial: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};
const CONFIDENCE_SEVERITY: Record<ComplexityAssessment['confidence'], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Deterministic order for score-eligible matrix rows (unknown rows are kept out
 * by the caller): level severity desc, then worstRows desc, then the highest
 * cell score desc, then a stable scope/field key. The score breaks ties only;
 * it never determines the level.
 */
export const orderMatrixRowsBySeverity = (
  rows: ReadonlyArray<ComplexityMatrixRow>
): ComplexityMatrixRow[] => {
  const numeric = (value: number | null) => value ?? -1;
  const rowScore = (row: ComplexityMatrixRow) =>
    row.cells.length === 0 ? -1 : Math.max(...row.cells.map((cell) => numeric(cell.score)));
  return [...rows].sort((left, right) => {
    const severity =
      MATRIX_LEVEL_SEVERITY[right.level] - MATRIX_LEVEL_SEVERITY[left.level];
    if (severity !== 0) return severity;
    const worst = numeric(right.worstRows) - numeric(left.worstRows);
    if (worst !== 0) return worst;
    const score = rowScore(right) - rowScore(left);
    if (score !== 0) return score;
    return `${left.scope}:${left.fieldId ?? left.tableId}`.localeCompare(
      `${right.scope}:${right.fieldId ?? right.tableId}`
    );
  });
};

const descriptorKind = (
  operation: ComplexityMatrixOperation
): OperationDescriptor['kind'] =>
  operation === 'create-record'
    ? 'create'
    : operation === 'delete-record'
      ? 'delete'
      : operation === 'field-delete' || operation === 'field-convert'
        ? 'field-change'
        : 'update';

const fieldChangeFor = (
  operation: ComplexityMatrixOperation
): 'delete' | 'convert' | null =>
  operation === 'field-delete' ? 'delete' : operation === 'field-convert' ? 'convert' : null;

const summarizeMatrixRow = (
  input: Omit<
    ComplexityMatrixRow,
    'level' | 'typicalRows' | 'worstRows' | 'mainReason' | 'confidence' | 'basis' | 'unknownCellCount'
  >
): ComplexityMatrixRow => {
  const cells = input.cells;
  if (cells.length === 0) {
    return {
      ...input,
      level: 'unknown',
      typicalRows: null,
      worstRows: null,
      mainReason: null,
      confidence: 'low',
      basis: 'schema-potential-only',
      unknownCellCount: 0,
    };
  }
  const knownCells = cells.filter((cell) => cell.level !== 'unknown');
  const unknownCells = cells.filter((cell) => cell.level === 'unknown');
  const worstCell =
    knownCells.length === 0
      ? cells[0]!
      : knownCells.reduce((worst, cell) =>
          MATRIX_LEVEL_SEVERITY[cell.level] > MATRIX_LEVEL_SEVERITY[worst.level] ? cell : worst
        );
  const expected = knownCells
    .map((cell) => cell.workload.rows.expected)
    .filter((value): value is number => value !== null);
  const upper = knownCells
    .map((cell) => cell.workload.rows.upper ?? cell.workload.rows.lower)
    .filter((value): value is number => value !== null);
  const confidence = (knownCells.length > 0 ? knownCells : cells).reduce(
    (lowest, cell) =>
      CONFIDENCE_SEVERITY[cell.confidence] < CONFIDENCE_SEVERITY[lowest]
        ? cell.confidence
        : lowest,
    cells[0]!.confidence
  );
  return {
    ...input,
    level: knownCells.length === 0 ? 'unknown' : worstCell.level,
    unknownCellCount: unknownCells.length,
    typicalRows: expected.length > 0 ? Math.max(...expected) : null,
    worstRows: upper.length > 0 ? Math.max(...upper) : null,
    mainReason: worstCell.reasonCodes[0] ?? null,
    confidence,
    basis: 'schema-potential-only',
  };
};

type TableMetadata = {
  readonly table: Table;
  readonly tables: ReadonlyArray<Table>;
  readonly graph: FieldDependencyGraphData;
  readonly truncated: boolean;
  readonly missingFormulaFieldIds: ReadonlyArray<string>;
  readonly missingTableIds: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
};

const addGapWarnings = (
  warnings: string[],
  prefix: string,
  ids: ReadonlyArray<string>,
  limit = 20
): void => {
  for (const id of ids.slice(0, limit)) warnings.push(`${prefix}:${id}`);
  if (ids.length > limit) warnings.push(`${prefix}:+${ids.length - limit}`);
};



type ConditionalEdgeSource = FieldDependencyGraphData['edges'][number];

/**
 * End-to-end complexity assessment.
 *
 * - tableId: metadata for the dependency closure, then an optional catalog read.
 * - schema: pure model, no database access.
 * - catalog and caller assumptions are merged per key, never all-or-nothing.
 * - no operation means no catalog scan: nothing consumes row statistics.
 *
 * Layering: kept in command-explain because the repository has no v2
 * application/use-case package, and command-explain already owns the
 * Postgres explain stack. Moving it would duplicate DI wiring and introduce a
 * new package for one service. It adds no v2-core host concept: only the table
 * repository, the dependency graph, and read-only catalog aggregates.
 */
@injectable()
export class ComplexityService implements IComplexityService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
    private readonly dependencyGraph: FieldDependencyGraph,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async assess(
    context: IExecutionContext,
    input: ComplexityAssessInput
  ): Promise<Result<ComplexityAssessResult, DomainError>> {
    const validationError = validateInput(input);
    if (validationError) return err(validationError);

    const profileResult =
      input.tableId !== undefined
        ? await this.assessTable(context, input, input.tableId)
        : await this.assessSchema(input);

    if (profileResult.isErr()) return err(profileResult.error);
    return ok({
      profile: profileResult.value,
      assessment: buildComplexityAssessment(profileResult.value),
    });
  }

  async assessMatrix(
    context: IExecutionContext,
    input: ComplexityMatrixInput
  ): Promise<Result<ComplexityMatrixResult, DomainError>> {
    const metadataResult = await this.loadTableMetadata(context, input.tableId, input.authorizedTableIds);
    if (metadataResult.isErr()) return err(metadataResult.error);
    const metadata = metadataResult.value;

    const requestedFields = input.fieldIds?.length
      ? new Set(input.fieldIds)
      : undefined;
    const selected = metadata.table
      .getFields()
      .filter((field) => !requestedFields || requestedFields.has(field.id().toString()));
    const maxFields = Math.max(
      1,
      Math.min(input.maxFields ?? COMPLEXITY_MATRIX_MAX_FIELDS, COMPLEXITY_MATRIX_MAX_FIELDS)
    );
    if (selected.length > maxFields) {
      return err(
        domainError.validation({
          code: 'complexity.matrix.too_many_fields',
          message: `The matrix evaluates at most ${maxFields} fields per request; narrow fieldIds.`,
        })
      );
    }

    const operations: ReadonlyArray<ComplexityMatrixOperation> = input.operations?.length
      ? input.operations
      : ['update', 'field-delete', 'field-convert', 'create-record', 'delete-record'];
    const fieldOperations = operations.filter(
      (operation) => operation === 'update' || operation === 'field-delete' || operation === 'field-convert'
    );
    const tableOperations = operations.filter(
      (operation) => operation === 'create-record' || operation === 'delete-record'
    );

    const statisticsResult = await this.resolveStatistics(context, metadata, {
      includeCatalogStats: input.includeCatalogStats !== false,
      assumptions: input.assumptions,
      operationPresent: true,
      operationKind: 'update',
      warnings: [],
    });
    if (statisticsResult.isErr()) return err(statisticsResult.error);
    const { statistics, warnings: dataWarnings, seedRecordCount } = statisticsResult.value;
    const completeness = this.resolveCompleteness(metadata);
    const preparedSchema = prepareSchemaComplexityInput({
      tables: metadata.tables,
      graph: metadata.graph,
    });

    const evaluateCell = (
      operationKind: ComplexityMatrixOperation,
      changedFieldIds: ReadonlyArray<string>
    ): ComplexityMatrixCell => {
      const profile = collectSchemaComplexityProfile({
        tables: metadata.tables,
        graph: metadata.graph,
        operation: {
          kind: descriptorKind(operationKind),
          tableId: metadata.table.id().toString(),
          changedFieldIds,
          ...(fieldChangeFor(operationKind) ? { fieldChange: fieldChangeFor(operationKind)! } : {}),
        },
        assumptions: statistics ? undefined : input.assumptions,
        statistics,
        seedRecordCount,
        completeness,
        focusTableId: metadata.table.id().toString(),
        preparedSchema,
      });
      const assessment = buildComplexityAssessment(profile);
      return {
        operation: operationKind,
        basis: 'schema-potential-only',
        level: assessment.level,
        score: assessment.score,
        confidence: assessment.confidence,
        workload: assessment.workload,
        structural: assessment.components.structural,
        dataWork: assessment.components.dataWork,
        risk: assessment.components.risk,
        reasonCodes: assessment.reasonCodes,
        warnings: this.reconcileFormulaWarnings(profile.warnings, metadata),
      };
    };

    const rows: ComplexityMatrixRow[] = [];
    const FIELD_CHUNK_SIZE = 200;
    if (fieldOperations.length > 0) {
      for (let start = 0; start < selected.length; start += FIELD_CHUNK_SIZE) {
        for (const field of selected.slice(start, start + FIELD_CHUNK_SIZE)) {
          const fieldId = field.id().toString();
          rows.push(
            summarizeMatrixRow({
              scope: 'field',
              fieldId,
              fieldType: field.type().toString(),
              tableId: metadata.table.id().toString(),
              cells: fieldOperations.map((operationKind) =>
                evaluateCell(operationKind, [fieldId])
              ),
            })
          );
        }
      }
    }
    if (tableOperations.length > 0) {
      rows.push(
        summarizeMatrixRow({
          scope: 'table',
          fieldId: null,
          fieldType: null,
          tableId: metadata.table.id().toString(),
          cells: tableOperations.map((operationKind) => evaluateCell(operationKind, [])),
        })
      );
    }

    const unknownRows = rows.filter((row) => row.unknownCellCount > 0);
    const knownRows = rows.filter((row) => row.unknownCellCount === 0);

    return ok({
      tableId: metadata.table.id().toString(),
      completeness,
      fieldCount: selected.length,
      basis: 'schema-potential-only',
      rows: [...orderMatrixRowsBySeverity(knownRows), ...orderMatrixRowsBySeverity(unknownRows)],
      unknownRows,
      warnings: mergeWarnings(metadata.warnings, dataWarnings, statistics?.warnings),
    });
  }

  private async assessSchema(
    input: ComplexityAssessInput
  ): Promise<Result<SchemaComplexityProfile, DomainError>> {
    const schema = input.schema;
    if (!schema) {
      return err(domainError.validation({ message: 'Provide exactly one of tableId or schema' }));
    }
    const fields = normalizeSchemaFields(schema.fields);

    if (input.operation) {
      return ok(
        simulateSchemaComplexity({
          schema: { fields, edges: schema.edges },
          operation: input.operation,
          assumptions: input.assumptions,
          completeness: input.completeness ?? 'partial',
          ...(input.focusTableId ? { focusTableId: input.focusTableId } : {}),
          ...(input.maxTraversalDepth === undefined
            ? {}
            : { maxTraversalDepth: input.maxTraversalDepth }),
        })
      );
    }

    return ok(
      buildSchemaComplexityProfile({
        fields,
        edges: schema.edges,
        completeness: input.completeness ?? 'partial',
        ...(input.focusTableId ? { focusTableId: input.focusTableId } : {}),
        ...(input.maxTraversalDepth === undefined
          ? {}
          : { maxTraversalDepth: input.maxTraversalDepth }),
      })
    );
  }

  private async assessTable(
    context: IExecutionContext,
    input: ComplexityAssessInput,
    rawTableId: string
  ): Promise<Result<SchemaComplexityProfile, DomainError>> {
    const metadataResult = await this.loadTableMetadata(context, rawTableId, input.authorizedTableIds);
    if (metadataResult.isErr()) return err(metadataResult.error);
    const metadata = metadataResult.value;

    const statisticsResult = await this.resolveStatistics(context, metadata, {
      includeCatalogStats: input.includeCatalogStats === true,
      assumptions: input.assumptions,
      operationPresent: input.operation !== undefined,
      ...(input.operation ? { operationKind: input.operation.kind } : {}),
      warnings: [],
    });
    if (statisticsResult.isErr()) return err(statisticsResult.error);
    const { statistics, warnings: dataWarnings, seedRecordCount } = statisticsResult.value;

    const completeness = this.resolveCompleteness(metadata, input.completeness);
    const profile = collectSchemaComplexityProfile({
      tables: metadata.tables,
      graph: metadata.graph,
      operation: input.operation,
      assumptions: statistics ? undefined : input.assumptions,
      statistics,
      seedRecordCount,
      completeness,
      focusTableId: input.focusTableId ?? metadata.table.id().toString(),
      ...(input.maxTraversalDepth === undefined
        ? {}
        : { maxTraversalDepth: input.maxTraversalDepth }),
    });

    const warnings = mergeWarnings(
      this.reconcileFormulaWarnings(profile.warnings, metadata),
      metadata.warnings,
      dataWarnings
    );
    if (warnings.length === profile.warnings.length) return ok(profile);
    return ok({ ...profile, warnings });
  }

  private async loadTableMetadata(
    context: IExecutionContext,
    rawTableId: string,
    authorizedTableIds?: ReadonlyArray<string>
  ): Promise<Result<TableMetadata, DomainError>> {
    const tableIdResult = TableId.create(rawTableId);
    if (tableIdResult.isErr()) return err(tableIdResult.error);

    const tableResult = await this.tableRepository.findOne(
      context,
      TableByIdSpec.create(tableIdResult.value)
    );
    if (tableResult.isErr()) return err(tableResult.error);
    const table = tableResult.value;
    const baseId = table.baseId();

    const warnings: string[] = [];
    let truncated = false;
    let tables: ReadonlyArray<Table> = [table];

    const countResult = this.tableRepository.count
      ? await this.tableRepository.count(
          context,
          TableByBaseIdSpec.create(baseId),
          { state: 'active' }
        )
      : null;
    const totalTables = countResult?.isOk() ? countResult.value : null;
    if (totalTables !== null && totalTables > COMPLEXITY_METADATA_MAX_TABLES) {
      truncated = true;
      warnings.push(
        `table-metadata-truncated:${totalTables}:${COMPLEXITY_METADATA_MAX_TABLES}`
      );
    } else {
      const tablesResult = await this.tableRepository.find(
        context,
        TableByBaseIdSpec.create(baseId),
        { state: 'active' }
      );
      if (tablesResult.isErr()) return err(tablesResult.error);
      tables = tablesResult.value;
      if (tables.length > COMPLEXITY_METADATA_MAX_TABLES) {
        truncated = true;
        warnings.push(
          `table-metadata-truncated:${tables.length}:${COMPLEXITY_METADATA_MAX_TABLES}`
        );
        tables = [table];
      }
    }

    const graphResult = truncated
      ? await this.dependencyGraph.load(baseId, context, {
          requiredFieldIds: table.getFields().map((field) => field.id()),
          tableProvisionStates: ['ready'],
        })
      : await this.dependencyGraph.load(baseId, context, {
          tableProvisionStates: ['ready'],
        });
    if (graphResult.isErr()) return err(graphResult.error);

    const authorized = authorizedTableIds ? new Set(authorizedTableIds) : null;
    if (authorized) tables = tables.filter((candidate) => authorized.has(candidate.id().toString()));
    const loadedTableIds = new Set(tables.map((candidate) => candidate.id().toString()));
    const formulaFieldIds = new Set<string>();
    for (const loaded of tables) {
      for (const field of loaded.getFields()) {
        if (field instanceof FormulaField) formulaFieldIds.add(field.id().toString());
      }
    }
    const graphFields = [...graphResult.value.fieldsById.values()];
    const unauthorizedCount = authorized
      ? graphFields.filter((field) => !authorized.has(field.tableId.toString())).length
      : 0;
    if (unauthorizedCount > 0) {
      truncated = true;
      warnings.push('authorized-table-scope-excluded');
    }
    const authorizedGraph = {
      fieldsById: new Map(
        [...graphResult.value.fieldsById.entries()].filter(([, field]) =>
          loadedTableIds.has(field.tableId.toString())
        )
      ),
      edges: graphResult.value.edges.filter(
        (edge) =>
          loadedTableIds.has(edge.fromTableId.toString()) &&
          loadedTableIds.has(edge.toTableId.toString())
      ),
    };
    const missingTableIds = [
      ...new Set(
        [...authorizedGraph.fieldsById.values()]
          .map((field) => field.tableId.toString())
          .filter((tableId) => !loadedTableIds.has(tableId))
      ),
    ].sort();
    const missingFormulaFieldIds = graphFields
      .filter(
        (field) =>
          field.type === 'formula' &&
          loadedTableIds.has(field.tableId.toString()) &&
          !formulaFieldIds.has(field.id.toString())
      )
      .map((field) => field.id.toString())
      .sort();
    addGapWarnings(warnings, 'table-metadata-unavailable', missingTableIds);
    addGapWarnings(warnings, 'formula-metadata-unavailable', missingFormulaFieldIds);

    return ok({
      table,
      tables,
      graph: authorizedGraph,
      truncated,
      missingFormulaFieldIds,
      missingTableIds,
      warnings,
    });

  }

  private resolveCompleteness(
    metadata: TableMetadata,
    declared?: 'complete' | 'partial' | 'truncated'
  ): 'complete' | 'partial' | 'truncated' {
    if (declared === 'truncated') return 'truncated';
    const incomplete =
      metadata.truncated ||
      declared === 'partial' ||
      metadata.missingTableIds.length > 0 ||
      metadata.missingFormulaFieldIds.length > 0;
    return incomplete ? 'partial' : 'complete';
  }

  /**
   * A formula field whose Table aggregate was outside the loaded closure is a
   * metadata gap, not a schema defect. Replace the core warning with the
   * explicit gap marker so hosts never read it as "computed without formula".
   */
  private reconcileFormulaWarnings(
    warnings: ReadonlyArray<string>,
    metadata: TableMetadata
  ): ReadonlyArray<string> {
    if (metadata.missingFormulaFieldIds.length === 0) return warnings;
    const missing = new Set(metadata.missingFormulaFieldIds);
    const prefix = 'computed-field-without-formula:';
    return warnings.filter(
      (warning) => !(warning.startsWith(prefix) && missing.has(warning.slice(prefix.length)))
    );
  }

  private conditionalEdges(metadata: TableMetadata): ReadonlyArray<ComplexityConditionalEdge> {
    return metadata.graph.edges
      .filter(
        (edge) =>
          metadata.graph.fieldsById.get(edge.toFieldId.toString())?.conditionalOptions != null
      )
      .map((edge: ConditionalEdgeSource) => ({
        fromFieldId: edge.fromFieldId.toString(),
        toFieldId: edge.toFieldId.toString(),
        fromTableId: edge.fromTableId.toString(),
        toTableId: edge.toTableId.toString(),
        linkFieldId: edge.linkFieldId?.toString() ?? null,
      }));
  }

  /**
   * Tables actually reachable from this assessment: the seed table, every
   * table that owns a field in the dependency graph, and edge endpoints. The
   * catalog reader never scans unrelated tables in the base.
   */
  private closureTables(metadata: TableMetadata): ReadonlyArray<Table> {
    const tableIds = new Set<string>([metadata.table.id().toString()]);
    for (const field of metadata.graph.fieldsById.values()) {
      tableIds.add(field.tableId.toString());
    }
    for (const edge of metadata.graph.edges) {
      tableIds.add(edge.fromTableId.toString());
      tableIds.add(edge.toTableId.toString());
    }
    const tables = metadata.tables.filter((table) => tableIds.has(table.id().toString()));
    return tables.length > 0 ? tables : [metadata.table];
  }

  private async resolveStatistics(
    context: IExecutionContext,
    metadata: TableMetadata,
    input: {
      readonly includeCatalogStats: boolean;
      readonly assumptions?: SchemaComplexityAssumptions;
      readonly operationPresent: boolean;
      readonly operationKind?: SchemaOperationKind;
      readonly warnings: string[];
    }
  ): Promise<
    Result<
      {
        readonly statistics: DataStatisticsSnapshot | null;
        readonly warnings: ReadonlyArray<string>;
        readonly seedRecordCount: number | null;
      },
      DomainError
    >
  > {
    const warnings = [...input.warnings];
    let seedRecordCount = input.assumptions?.seedRecordCount ?? null;
    if (
      seedRecordCount === null &&
      input.operationPresent &&
      input.operationKind !== undefined &&
      input.operationKind !== 'paste'
    ) {
      // Batch-capable operations need an explicit row count; one row is only a
      // stated assumption, never a silent measurement.
      seedRecordCount = 1;
      warnings.push('seed-record-count-defaulted:1');
    }

    if (input.includeCatalogStats && !input.operationPresent) {
      warnings.push('catalog-statistics-skipped:no-operation');
    }

    let catalog: DataStatisticsSnapshot | null = null;
    if (input.includeCatalogStats && input.operationPresent) {
      const baseId = metadata.table.baseId().toString();
      const closure = this.closureTables(metadata);
      if (closure.length < metadata.tables.length) {
        warnings.push(`catalog-statistics-scope:${closure.length}/${metadata.tables.length}`);
      }
      const cacheKey = `${baseId}|${closure
        .map((table) => table.id().toString())
        .sort()
        .join(',')}`;
      const cached = readCatalogCache(cacheKey);
      if (cached) {
        catalog = cached.snapshot;
        warnings.push(
          `catalog-statistics-cache-hit:${Math.max(0, Date.now() - cached.storedAt)}ms`
        );
      } else {
        const reader = new PostgresComplexityStatisticsReader(this.db);
        const catalogResult = await reader.collectMany(context, closure, {
          includeLinkFanout: true,
        });
        if (catalogResult.isErr()) return err(catalogResult.error);
        catalog = catalogResult.value;
        writeCatalogCache(cacheKey, catalogResult.value);
      }
    }

    if (catalog === null) {
      return ok({ statistics: null, warnings, seedRecordCount });
    }
    if (input.assumptions === undefined) {
      return ok({ statistics: catalog, warnings, seedRecordCount });
    }

    const merged = mergeComplexityStatistics({
      catalog,
      assumptions: input.assumptions,
      tables: metadata.tables,
      conditionalEdges: this.conditionalEdges(metadata),
    });
    return ok({
      statistics: merged.statistics,
      warnings: mergeWarnings(warnings, merged.warnings),
      seedRecordCount,
    });
  }
}
