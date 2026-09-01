import {
  AndSpec,
  CellValueType,
  FieldCondition,
  domainError,
  FieldId,
  FieldType,
  FieldValueTypeVisitor,
  LinkForeignTableReferenceVisitor,
  LinkRelationship,
  type LookupField,
  type DomainError,
  type Field,
  type FieldConditionDTO,
  type IFilterItemDTO,
  type ITableRecordConditionSpecVisitor,
  type ISpecification,
  type LinkField,
  type RollupFunction,
  type Table,
  type TableRecord,
} from '@teable/v2-core';
import {
  extractJsonScalarText,
  formatFieldValueAsStringSql,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import {
  sql,
  type AliasedExpression,
  type AliasedRawBuilder,
  type Expression,
  type Kysely,
  type RawBuilder,
  type SqlBool,
} from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';
import { match } from 'ts-pattern';

import { TableRecordConditionWhereVisitor } from '../../visitors';
import { buildDateLikeOrderExpression } from '../dateLikeOrderBy';
import {
  applyV1NullsOrder,
  isNeverNullSystemOrderColumn,
  uniqueOrderByEntries,
} from '../systemOrderColumns';
import type {
  DynamicDB,
  IQueryBuilderDeps,
  ITableRecordQueryBuilder,
  OrderByColumn,
  QB,
} from '../ITableRecordQueryBuilder';
import type { QueryMode } from '../TableRecordQueryBuilderManager';
import {
  buildUserJsonObjectFromSnapshotExpr,
  type UserSnapshotActorFallback,
} from '../userSnapshotSql';
import {
  ComputedFieldSelectExpressionVisitor,
  type ILateralContext,
  type LateralColumnType,
  type LinkOrderBy,
} from './ComputedFieldSelectExpressionVisitor';

export const COMPUTED_TABLE_ALIAS = 't';
const T = COMPUTED_TABLE_ALIAS; // main table alias
const F = 'f'; // foreign table alias in lateral
const UNIQUE_SCAN_ALIAS = 'fu';
const H = 'h'; // host table alias in set-based aggregate joins
const DEFAULT_CONDITIONAL_ORDER_BY = { column: '__auto_number', direction: 'asc' } as const;

const fieldTracksAll = (field: object): boolean =>
  'isTrackAll' in field && typeof field.isTrackAll === 'function'
    ? field.isTrackAll() === true
    : false;

type FieldSourceField = {
  type: () => FieldType;
  dbFieldName: () => Result<{ value: () => Result<string, DomainError> }, DomainError>;
};

type FieldSourceLayout =
  | { kind: 'column'; column: string }
  | { kind: 'createdBy'; snapshotColumn: string }
  | { kind: 'lastModifiedBy'; snapshotColumn: string; trackAll: boolean };

const resolveFieldSourceLayout = (
  field: FieldSourceField
): Result<FieldSourceLayout, DomainError> => {
  if (field.type().equals(FieldType.autoNumber())) {
    return ok({ kind: 'column', column: '__auto_number' });
  }
  if (field.type().equals(FieldType.createdTime())) {
    return ok({ kind: 'column', column: '__created_time' });
  }
  if (field.type().equals(FieldType.lastModifiedTime()) && fieldTracksAll(field)) {
    return ok({ kind: 'column', column: '__last_modified_time' });
  }
  return field.dbFieldName().andThen((dbFieldName) =>
    dbFieldName.value().map((columnName) => {
      if (field.type().equals(FieldType.createdBy())) {
        return { kind: 'createdBy' as const, snapshotColumn: columnName };
      }
      if (field.type().equals(FieldType.lastModifiedBy())) {
        return {
          kind: 'lastModifiedBy' as const,
          snapshotColumn: columnName,
          trackAll: fieldTracksAll(field),
        };
      }
      return { kind: 'column' as const, column: columnName };
    })
  );
};

const fieldSourcePhysicalColumns = (layout: FieldSourceLayout): string[] => {
  switch (layout.kind) {
    case 'column':
      return [layout.column];
    case 'createdBy':
      return [layout.snapshotColumn, '__created_by'];
    case 'lastModifiedBy':
      return layout.trackAll
        ? [layout.snapshotColumn, '__last_modified_by']
        : [layout.snapshotColumn];
  }
};

type ResolvedConditionalOrderBy = {
  column: string;
  direction: 'asc' | 'desc';
  tieBreaker?: LinkOrderBy;
};

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const CONDITIONAL_QUERY_MAX_LIMIT = parsePositiveInt(process.env.CONDITIONAL_QUERY_MAX_LIMIT, 5000);
const CONDITIONAL_QUERY_DEFAULT_LIMIT = Math.min(
  parsePositiveInt(process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT, CONDITIONAL_QUERY_MAX_LIMIT),
  CONDITIONAL_QUERY_MAX_LIMIT
);
const SIMPLE_CONDITIONAL_ROLLUP_OPERATORS: ReadonlySet<string> = new Set(['is', 'isAnyOf']);
/**
 * Value-less operators acceptable as residual constants on the set-based
 * field-reference paths. They never reference a host field, so a filter like
 * `foreign.key is {host.key} AND foreign.x isNotEmpty` stays hash-joinable
 * instead of falling back to the per-host correlated lateral.
 */
const RESIDUAL_VALUELESS_OPERATORS: ReadonlySet<string> = new Set(['isEmpty', 'isNotEmpty']);
const ORDER_INSENSITIVE_ROLLUP_EXPRESSIONS: ReadonlySet<RollupFunction> = new Set([
  'sum({values})',
  'average({values})',
  'countall({values})',
  'counta({values})',
  'count({values})',
  'max({values})',
  'min({values})',
  'and({values})',
  'or({values})',
  'xor({values})',
]);

type SimpleConditionalRollupFilterItem = {
  fieldId: string;
  operator: 'is' | 'isAnyOf';
  value?: unknown;
  isSymbol?: boolean;
};

type SimpleConditionalRollupFilter = {
  conjunction: 'and';
  filterSet: SimpleConditionalRollupFilterItem[];
};

type ConditionalFieldReferenceGroup = {
  foreignFieldId: string;
  hostFieldId: string;
  /** Field-reference equality item (`foreign.field is {host.field}`). */
  filterItem: IFilterItemDTO;
  /**
   * Additional field-ref equalities and source-only residual filters AND-ed
   * with the primary field-ref equality.
   */
  residualFilterItems: IFilterItemDTO[];
  limit?: number;
  /** Optional foreign-table sort for ranking / order-sensitive aggregates. */
  sort?: { fieldId: string; order: 'asc' | 'desc' };
  /**
   * When true, unlimited paths may skip window ranking.
   * Order-sensitive rollups (array_join, etc.) always rank.
   */
  orderInsensitive: boolean;
};

type ResolvedOrderBy = {
  column: string;
  direction: 'asc' | 'desc';
  expression?: RawBuilder<unknown>;
  userLikeMode?: 'single' | 'multiple';
  userLikeSource?: 'field' | 'system';
};

const isSimpleConditionalRollupScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const resolveUserSnapshotActorFallback = (
  context: unknown,
  current?: UserSnapshotActorFallback
): UserSnapshotActorFallback | undefined => {
  if (!context || typeof context !== 'object') {
    return current;
  }

  const raw = context as {
    actorId?: { toString(): string } | string;
    actorName?: unknown;
    actorEmail?: unknown;
  };
  const actorId =
    typeof raw.actorId === 'string'
      ? raw.actorId
      : typeof raw.actorId?.toString === 'function'
        ? raw.actorId.toString()
        : undefined;

  if (!actorId) {
    return current;
  }

  const actorName = typeof raw.actorName === 'string' ? raw.actorName : current?.actorName;
  const actorEmail = typeof raw.actorEmail === 'string' ? raw.actorEmail : current?.actorEmail;

  return {
    actorId,
    ...(actorName != null ? { actorName } : {}),
    ...(actorEmail != null ? { actorEmail } : {}),
  };
};

const isOrderInsensitiveRollupExpression = (expression: RollupFunction): boolean =>
  ORDER_INSENSITIVE_ROLLUP_EXPRESSIONS.has(expression);

const referencedHostFieldId = (item: IFilterItemDTO): string | null => {
  if (item.isSymbol && typeof item.value === 'string') {
    return item.value;
  }

  if (
    item.value &&
    typeof item.value === 'object' &&
    !Array.isArray(item.value) &&
    'type' in item.value &&
    (item.value as { type?: string }).type === 'field' &&
    'fieldId' in item.value &&
    typeof (item.value as { fieldId?: unknown }).fieldId === 'string'
  ) {
    return (item.value as { fieldId: string }).fieldId;
  }

  return null;
};

/**
 * Resolve a field on a table for computed SQL building, enriching the bare
 * `Field not found` domain error with the field id, table id, and the build
 * scene. The `Field not found:` prefix is load-bearing — the computed task
 * failure classifier keys stale-field-reference detection off that phrase.
 */
const resolveTableField = (
  table: Table,
  fieldId: FieldId,
  scene: string
): Result<Field, DomainError> =>
  table
    .getField((f) => f.id().equals(fieldId))
    .mapErr(() =>
      domainError.notFound({
        code: 'record.computed.field_not_found',
        message: `Field not found: ${fieldId.toString()} on table ${table
          .id()
          .toString()} (${scene})`,
        details: {
          fieldId: fieldId.toString(),
          tableId: table.id().toString(),
          scene,
        },
      })
    );

const filterItems = (filter: FieldConditionDTO['filter']): IFilterItemDTO[] => {
  if (!filter?.filterSet) {
    return [];
  }
  return filter.filterSet.filter(
    (item): item is IFilterItemDTO =>
      Boolean(item) && typeof item === 'object' && !('filterSet' in item)
  );
};

const residualFilterItemFingerprint = (item: IFilterItemDTO): string =>
  JSON.stringify({
    fieldId: item.fieldId,
    operator: item.operator,
    value: item.value,
    isSymbol: item.isSymbol ?? false,
  });

const sameResidualFilterItems = (
  left: ReadonlyArray<IFilterItemDTO>,
  right: ReadonlyArray<IFilterItemDTO>
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  const leftKeys = left.map(residualFilterItemFingerprint).sort();
  const rightKeys = right.map(residualFilterItemFingerprint).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
};

const sameConditionalFieldReferenceGroup = (
  left: ConditionalFieldReferenceGroup,
  right: ConditionalFieldReferenceGroup
): boolean =>
  left.foreignFieldId === right.foreignFieldId &&
  left.hostFieldId === right.hostFieldId &&
  left.limit === right.limit &&
  left.orderInsensitive === right.orderInsensitive &&
  left.sort?.fieldId === right.sort?.fieldId &&
  left.sort?.order === right.sort?.order &&
  sameResidualFilterItems(left.residualFilterItems, right.residualFilterItems);

const isResidualConstantFilterItem = (item: IFilterItemDTO): boolean => {
  if (referencedHostFieldId(item) !== null) {
    return false;
  }
  if (RESIDUAL_VALUELESS_OPERATORS.has(item.operator)) {
    return item.value == null;
  }
  if (!SIMPLE_CONDITIONAL_ROLLUP_OPERATORS.has(item.operator)) {
    return false;
  }
  if (item.operator === 'is') {
    return item.value == null || isSimpleConditionalRollupScalar(item.value);
  }
  if (item.operator === 'isAnyOf') {
    return (
      Array.isArray(item.value) &&
      item.value.every((entry) => isSimpleConditionalRollupScalar(entry))
    );
  }
  return false;
};

/**
 * Split an AND filter into field-reference equality keys plus residual
 * source-only constant predicates. Nested filter sets are rejected.
 *
 * The first field-ref equality is the grouping/sharing key. Additional
 * field-ref equalities are retained as residual items so the set-based
 * WHERE keeps the full composite key. Callers that DISTINCT/GROUP BY a
 * single host-key column must refuse residuals that still reference a
 * host field.
 */
const splitFieldReferenceAndResiduals = (
  filter: FieldConditionDTO['filter']
): {
  fieldRefItem: IFilterItemDTO;
  hostFieldId: string;
  residualFilterItems: IFilterItemDTO[];
} | null => {
  if (!filter || filter.conjunction !== 'and') {
    return null;
  }

  const items = filterItems(filter);
  if (items.length === 0) {
    return null;
  }

  let fieldRefItem: IFilterItemDTO | null = null;
  let hostFieldId: string | null = null;
  const residualFilterItems: IFilterItemDTO[] = [];

  for (const item of items) {
    if (item.operator === 'is') {
      const referenced = referencedHostFieldId(item);
      if (referenced) {
        if (!fieldRefItem) {
          fieldRefItem = item;
          hostFieldId = referenced;
        } else {
          residualFilterItems.push(item);
        }
        continue;
      }
    }

    if (!isResidualConstantFilterItem(item)) {
      return null;
    }
    residualFilterItems.push(item);
  }

  if (!fieldRefItem || !hostFieldId) {
    return null;
  }

  return { fieldRefItem, hostFieldId, residualFilterItems };
};

const groupHasCompositeFieldReferenceKey = (group: ConditionalFieldReferenceGroup): boolean =>
  group.residualFilterItems.some((item) => referencedHostFieldId(item) !== null);

const conditionSortDto = (
  condition: FieldCondition
): { fieldId: string; order: 'asc' | 'desc' } | undefined => {
  if (!condition.hasSort()) {
    return undefined;
  }
  const sort = condition.sort();
  if (!sort) {
    return undefined;
  }
  return {
    fieldId: sort.fieldId().toString(),
    order: sort.order(),
  };
};

/**
 * Join-key group for residual field-ref rollups that still share a correlated lateral
 * when different residual predicates project multiple aggregates from one scan.
 * Rejects explicit limit so order+limit stay on the generic lateral path.
 */
const conditionalRollupFieldReferenceGroup = (
  columnType: LateralColumnType
): ConditionalFieldReferenceGroup | null => {
  if (
    columnType.type !== 'conditionalRollup' ||
    !isOrderInsensitiveRollupExpression(columnType.expression) ||
    columnType.condition.hasSort() ||
    columnType.condition.hasLimit()
  ) {
    return null;
  }

  const split = splitFieldReferenceAndResiduals(columnType.condition.toDto().filter);
  if (!split) {
    return null;
  }

  // Lateral sharing key only needs the field-ref pair; residual FILTER(...) is per column.
  return {
    foreignFieldId: split.fieldRefItem.fieldId,
    hostFieldId: split.hostFieldId,
    filterItem: split.fieldRefItem,
    residualFilterItems: [],
    orderInsensitive: true,
  };
};

/**
 * Field-reference rollup eligible for a set-based host join:
 * - one or more field-ref equalities (+ optional residual constant filters)
 * - order-insensitive aggs (sum/max/...) with optional limit
 * - order-sensitive aggs (array_join/...) with ranking + limit
 */
const conditionalRollupSetBasedFieldReferenceGroup = (
  columnType: LateralColumnType
): ConditionalFieldReferenceGroup | null => {
  if (columnType.type !== 'conditionalRollup' || !columnType.condition.hasFilter()) {
    return null;
  }

  const orderInsensitive = isOrderInsensitiveRollupExpression(columnType.expression);
  // Order-sensitive rollups may carry a condition sort; order-insensitive paths reject it
  // so residual max/sum keep deterministic default ranking only when limited.
  if (!orderInsensitive && columnType.condition.hasSort()) {
    // Still OK — use the condition sort for ranking.
  } else if (orderInsensitive && columnType.condition.hasSort()) {
    return null;
  }

  const split = splitFieldReferenceAndResiduals(columnType.condition.toDto().filter);
  if (!split) {
    return null;
  }

  return {
    foreignFieldId: split.fieldRefItem.fieldId,
    hostFieldId: split.hostFieldId,
    filterItem: split.fieldRefItem,
    residualFilterItems: split.residualFilterItems,
    limit: columnType.condition.limit(),
    sort: conditionSortDto(columnType.condition),
    orderInsensitive,
  };
};

/**
 * Field-reference lookup eligible for set-based host join:
 * one or more field-ref equalities, optional residual constants, optional sort, optional limit.
 */
const conditionalLookupFieldReferenceGroup = (
  columnType: LateralColumnType
): ConditionalFieldReferenceGroup | null => {
  if (columnType.type !== 'conditionalLookup' || !columnType.condition.hasFilter()) {
    return null;
  }

  const split = splitFieldReferenceAndResiduals(columnType.condition.toDto().filter);
  if (!split) {
    return null;
  }

  return {
    foreignFieldId: split.fieldRefItem.fieldId,
    hostFieldId: split.hostFieldId,
    filterItem: split.fieldRefItem,
    residualFilterItems: split.residualFilterItems,
    limit: columnType.condition.limit(),
    sort: conditionSortDto(columnType.condition),
    orderInsensitive: false,
  };
};

const isSourceOnlyConditionalRollup = (
  columnType: LateralColumnType,
  foreignFieldIds: ReadonlySet<string>
): boolean => {
  if (
    columnType.type !== 'conditionalRollup' ||
    !isOrderInsensitiveRollupExpression(columnType.expression) ||
    columnType.condition.hasSort() ||
    columnType.condition.hasLimit()
  ) {
    return false;
  }

  return isSimpleConditionalRollupFilter(columnType.condition.toDto().filter, foreignFieldIds);
};

const isSourceOnlyConditionalRollupGroup = (
  foreignTable: Table,
  columns: Array<{ columnType: LateralColumnType }>
): boolean => {
  const foreignFieldIds = new Set(foreignTable.getFields().map((field) => field.id().toString()));
  return (
    columns.length > 0 &&
    columns.every((column) => isSourceOnlyConditionalRollup(column.columnType, foreignFieldIds))
  );
};

const sharedConditionalFieldReferenceGroup = (
  columns: Array<{ columnType: LateralColumnType }>
): ConditionalFieldReferenceGroup | null => {
  let shared: ConditionalFieldReferenceGroup | null = null;

  for (const column of columns) {
    const group = conditionalRollupFieldReferenceGroup(column.columnType);
    if (!group) {
      return null;
    }

    if (!shared) {
      shared = group;
      continue;
    }

    if (
      shared.foreignFieldId !== group.foreignFieldId ||
      shared.hostFieldId !== group.hostFieldId
    ) {
      return null;
    }
  }

  return shared;
};

const sharedConditionalRollupSetBasedFieldReferenceGroup = (
  columns: Array<{ columnType: LateralColumnType }>
): ConditionalFieldReferenceGroup | null => {
  let shared: ConditionalFieldReferenceGroup | null = null;

  for (const column of columns) {
    const group = conditionalRollupSetBasedFieldReferenceGroup(column.columnType);
    if (!group) {
      return null;
    }

    if (!shared) {
      shared = group;
      continue;
    }

    if (!sameConditionalFieldReferenceGroup(shared, group)) {
      return null;
    }
  }

  return shared;
};

const sharedConditionalLookupFieldReferenceGroup = (
  columns: Array<{ columnType: LateralColumnType }>
): ConditionalFieldReferenceGroup | null => {
  let shared: ConditionalFieldReferenceGroup | null = null;

  for (const column of columns) {
    const group = conditionalLookupFieldReferenceGroup(column.columnType);
    if (!group) {
      return null;
    }

    if (!shared) {
      shared = group;
      continue;
    }

    if (!sameConditionalFieldReferenceGroup(shared, group)) {
      return null;
    }
  }

  return shared;
};

const isSimpleConditionalRollupItem = (
  value: unknown,
  foreignFieldIds: ReadonlySet<string>
): value is SimpleConditionalRollupFilterItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  if ('filterSet' in value) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const fieldId = candidate.fieldId;
  const operator = candidate.operator;

  if (
    typeof fieldId !== 'string' ||
    !foreignFieldIds.has(fieldId) ||
    typeof operator !== 'string' ||
    !SIMPLE_CONDITIONAL_ROLLUP_OPERATORS.has(operator) ||
    candidate.isSymbol === true
  ) {
    return false;
  }

  if (operator === 'is') {
    return isSimpleConditionalRollupScalar(candidate.value);
  }

  return (
    Array.isArray(candidate.value) &&
    candidate.value.length > 0 &&
    candidate.value.every((item) => isSimpleConditionalRollupScalar(item))
  );
};

const isSimpleConditionalRollupFilter = (
  value: unknown,
  foreignFieldIds: ReadonlySet<string>
): value is SimpleConditionalRollupFilter => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.conjunction !== 'and' || !Array.isArray(candidate.filterSet)) {
    return false;
  }

  return (
    candidate.filterSet.length > 0 &&
    candidate.filterSet.every((item) => isSimpleConditionalRollupItem(item, foreignFieldIds))
  );
};

type ResolvedOrderByColumn = Pick<
  ResolvedOrderBy,
  'column' | 'expression' | 'userLikeMode' | 'userLikeSource'
>;

/**
 * Configuration for dirty record filtering.
 * When provided, the query will INNER JOIN with the dirty table early
 * (before lateral joins) to filter records efficiently.
 */
export interface IDirtyFilterConfig {
  /** The table ID to filter by in the dirty table */
  tableId: string;
  /** The name of the dirty table (default: 'tmp_computed_dirty') */
  dirtyTableName?: string;
  /** Column name for table ID in dirty table (default: 'table_id') */
  tableIdColumn?: string;
  /** Column name for record ID in dirty table (default: 'record_id') */
  recordIdColumn?: string;
  /**
   * Optional explicit dirty-record slice for large fan-out steps.
   * When set, further restricts the dirty join to this id subset so each
   * UPDATE…FROM statement stays under statement_timeout.
   */
  recordIds?: ReadonlyArray<string>;
}

/**
 * A live computed field whose persisted config references a deleted field.
 * Surfaced by the builder so callers can log the degradation.
 */
export interface IDanglingComputedFieldReference {
  readonly fieldId: string;
  readonly tableId: string;
  readonly scene: string;
}

export interface IComputedQueryBuilderOptions {
  /** Foreign tables for link/lookup/rollup - can be pre-set (for tests) or loaded via prepare() */
  readonly foreignTables?: ReadonlyMap<string, Table>;
  /** Type validation strategy for PostgreSQL version compatibility */
  readonly typeValidationStrategy: IPgTypeValidationStrategy;
  /** Prefer stored values for non-deterministic formulas like LAST_MODIFIED_TIME(field) */
  readonly preferStoredLastModifiedFormula?: boolean;
  readonly erroredLookupReferenceMode?: 'stored' | 'error';
  readonly forceLookupArrayOutput?: boolean;
  readonly userSnapshotActorFallback?: UserSnapshotActorFallback;
  readonly resolveSystemUserSnapshotsFromUsers?: boolean;
  /** Full-table computed backfills may aggregate all host rows before the outer UPDATE. */
  readonly allowFullTableSetBasedRollups?: boolean;
}

/**
 * Query builder that computes field values using LATERAL joins and SQL expressions.
 * Dynamically resolves link/lookup/rollup fields through database-side computation.
 */
export class ComputedTableRecordQueryBuilder implements ITableRecordQueryBuilder {
  private table: Table | null = null;
  private projection: ReadonlyArray<FieldId> | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private orderByValues: Array<{ column: OrderByColumn; direction: 'asc' | 'desc' }> = [];
  private foreignTables: ReadonlyMap<string, Table>;
  private missingForeignTableIds: ReadonlySet<string> = new Set();
  private whereSpecs: Array<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>> = [];
  private whereExpressions: Array<Expression<SqlBool>> = [];
  private dirtyFilterConfig: IDirtyFilterConfig | null = null;
  private readonly typeValidationStrategy: IPgTypeValidationStrategy;
  private readonly preferStoredLastModifiedFormula: boolean;
  private readonly erroredLookupReferenceMode: 'stored' | 'error';
  private readonly forceLookupArrayOutput: boolean;
  private userSnapshotActorFallback?: UserSnapshotActorFallback;
  private readonly resolveSystemUserSnapshotsFromUsers: boolean;
  private readonly allowFullTableSetBasedRollups: boolean;
  private unchunkedDirtySetHostKeyColumns: ReadonlyArray<string> = [];
  private danglingFieldRefs: IDanglingComputedFieldReference[] = [];

  readonly mode: QueryMode = 'computed';

  constructor(
    private readonly db: Kysely<DynamicDB>,
    options: IComputedQueryBuilderOptions
  ) {
    this.foreignTables = options.foreignTables ?? new Map();
    this.typeValidationStrategy = options.typeValidationStrategy;
    this.preferStoredLastModifiedFormula = options.preferStoredLastModifiedFormula ?? false;
    this.erroredLookupReferenceMode = options.erroredLookupReferenceMode ?? 'stored';
    this.forceLookupArrayOutput = options.forceLookupArrayOutput ?? true;
    this.userSnapshotActorFallback = options.userSnapshotActorFallback;
    this.resolveSystemUserSnapshotsFromUsers = options.resolveSystemUserSnapshotsFromUsers ?? false;
    this.allowFullTableSetBasedRollups = options.allowFullTableSetBasedRollups ?? false;
  }

  from(table: Table): this {
    this.table = table;
    return this;
  }

  select(projection: ReadonlyArray<FieldId>): this {
    this.projection = projection;
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  offset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  // group-identity collation is a stored-mode concern (grouped lists and
  // range reads always run stored); computed reads keep their own collation
  orderBy(
    column: OrderByColumn,
    direction: 'asc' | 'desc',
    _options?: { readonly groupIdentityCollation?: boolean }
  ): this {
    this.orderByValues.push({ column, direction });
    return this;
  }

  where(spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>): this {
    this.whereSpecs.push(spec);
    return this;
  }

  whereExpression(expression: Expression<SqlBool>): this {
    this.whereExpressions.push(expression);
    return this;
  }

  /**
   * Set dirty filter configuration.
   * When set, the query will INNER JOIN with the dirty table immediately after
   * the main table (before any lateral joins), ensuring PostgreSQL can use the
   * small dirty table to drive indexed lookups on the main table.
   *
   * This is critical for UPDATE...FROM performance - without early filtering,
   * PostgreSQL may scan and compute lateral joins for all rows before filtering.
   */
  withDirtyFilter(config: IDirtyFilterConfig): this {
    this.dirtyFilterConfig = config;
    return this;
  }

  canExecuteUnchunkedDirtySet(): boolean {
    return this.unchunkedDirtySetHostKeyColumns.length > 0;
  }

  /**
   * Dangling references degraded to NULL during the last build().
   */
  danglingFieldReferences(): ReadonlyArray<IDanglingComputedFieldReference> {
    return this.danglingFieldRefs;
  }

  /**
   * A computed field whose config references a deleted field must behave
   * exactly like hasError (NULL output) instead of failing the whole task:
   * legacy field-delete paths could leave dependents unmarked, and a hard
   * error here dead-letters the task as non-retryable obsolete_plan.
   */
  private degradeDanglingFieldReference(table: Table, fieldId: FieldId, scene: string): void {
    this.danglingFieldRefs.push({
      fieldId: fieldId.toString(),
      tableId: table.id().toString(),
      scene,
    });
  }

  unchunkedHostKeyColumns(): ReadonlyArray<string> {
    return this.unchunkedDirtySetHostKeyColumns;
  }

  /**
   * Prepare by loading foreign tables needed for link/lookup/rollup fields.
   */
  async prepare(deps: IQueryBuilderDeps): Promise<Result<void, DomainError>> {
    if (!this.table) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    const table = this.table;
    this.userSnapshotActorFallback = resolveUserSnapshotActorFallback(
      deps.context,
      this.userSnapshotActorFallback
    );

    return safeTry<void, DomainError>(
      async function* (this: ComputedTableRecordQueryBuilder) {
        // Collect all foreign table references from link/lookup/rollup fields
        const visitor = new LinkForeignTableReferenceVisitor();
        const refs = yield* visitor.collect(table.getFields());

        if (refs.length === 0) {
          this.foreignTables = new Map();
          this.missingForeignTableIds = new Set();
          return ok(undefined);
        }

        const foreignTables = new Map<string, Table>();

        // Separate self-referential from external references
        const externalTableIds = refs
          .filter((ref) => !ref.foreignTableId.equals(table.id()))
          .map((ref) => ref.foreignTableId);

        // Add self-referential table if present
        const hasSelfRef = refs.some((ref) => ref.foreignTableId.equals(table.id()));
        if (hasSelfRef) {
          foreignTables.set(table.id().toString(), table);
        }

        // Batch load all external foreign tables in one query
        if (externalTableIds.length > 0) {
          // Use withoutBaseId() to support cross-base foreign tables
          const foreignSpec = yield* table.specs().withoutBaseId().byIds(externalTableIds).build();
          const loadedTables = yield* await deps.tableRepository.find(deps.context, foreignSpec, {
            state: 'activeWithPending',
          });

          for (const loadedTable of loadedTables) {
            foreignTables.set(loadedTable.id().toString(), loadedTable);
          }

          // Check if all foreign tables were found
          const missingIds = externalTableIds.filter((id) => !foreignTables.has(id.toString()));
          if (missingIds.length > 0) {
            this.missingForeignTableIds = new Set(missingIds.map((id) => id.toString()));
          } else {
            this.missingForeignTableIds = new Set();
          }
        }

        this.foreignTables = foreignTables;
        return ok(undefined);
      }.bind(this)
    );
  }

  build(): Result<QB, DomainError> {
    if (!this.table) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    const table = this.table;
    const foreignTables = this.foreignTables;
    const projection = this.projection;
    this.unchunkedDirtySetHostKeyColumns = [];
    this.danglingFieldRefs = [];
    const { laterals, conditionalLaterals, ctx: lateralCtx } = this.createLateralContext();

    return safeTry<QB, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const fieldSelectColumns = yield* this.buildSelectColumns(table, projection, lateralCtx);
        const applyLateralJoins = yield* this.buildLateralJoins(table, foreignTables, laterals);
        const applyConditionalJoins = yield* this.buildConditionalJoins(
          foreignTables,
          conditionalLaterals
        );
        if (laterals.size > 0) {
          this.unchunkedDirtySetHostKeyColumns = [];
        }

        // Always include __id column for record identification
        const idColumn = sql`${sql.ref(`${T}.__id`)}`.as('__id');

        // Always include __version column for realtime sync
        const versionColumn = sql`${sql.ref(`${T}.__version`)}`.as('__version');

        const selectColumns = [idColumn, versionColumn, ...fieldSelectColumns];

        // Resolve orderBy columns
        const resolvedOrderBy: ResolvedOrderBy[] = [];
        for (const orderBy of uniqueOrderByEntries(this.orderByValues)) {
          const columnResult = yield* this.resolveOrderByColumn(table, orderBy.column);
          if (columnResult !== null) {
            resolvedOrderBy.push({
              column: columnResult.column,
              direction: orderBy.direction,
              expression: columnResult.expression,
              userLikeMode: columnResult.userLikeMode,
              userLikeSource: columnResult.userLikeSource,
            });
          }
        }

        const whereClauseResult = this.buildWhereCondition();
        if (whereClauseResult.isErr()) {
          return err(whereClauseResult.error);
        }
        const whereClause = whereClauseResult.value;

        // Build dirty filter join function if configured.
        // This MUST be applied BEFORE lateral joins to allow PostgreSQL to use
        // the small dirty table to drive indexed lookups, avoiding full table scans.
        const applyDirtyFilter = this.buildDirtyFilterJoin();

        let query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => selectColumns)
          .$call(applyDirtyFilter) // Apply dirty filter BEFORE lateral joins
          .$call(applyLateralJoins)
          .$call(applyConditionalJoins)
          .$if(whereClause !== null, (qb) =>
            qb.where(whereClause as unknown as Expression<SqlBool>)
          );

        for (const expression of this.whereExpressions) {
          query = query.where(expression);
        }

        for (const orderBy of resolvedOrderBy) {
          if (orderBy.userLikeMode) {
            query = this.applyUserLikeOrderBy(
              query,
              orderBy.column,
              orderBy.direction,
              orderBy.userLikeMode,
              orderBy.userLikeSource ?? 'field'
            );
          } else {
            const columnRef = orderBy.expression ?? sql`${sql.ref(`${T}.${orderBy.column}`)}`;
            if (isNeverNullSystemOrderColumn(orderBy.column)) {
              query = query.orderBy(columnRef, orderBy.direction);
            } else {
              query = query.orderBy(columnRef, applyV1NullsOrder(orderBy.direction));
            }
          }
        }

        query = query
          .$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue!))
          .$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue!));
        return ok(query);
      }.bind(this)
    );
  }

  /**
   * Build the dirty filter join function.
   * When dirtyFilterConfig is set, returns a function that applies an INNER JOIN
   * with the dirty table. This must be called BEFORE lateral joins in the query
   * chain to ensure proper query planning.
   */
  private buildDirtyFilterJoin(): (qb: QB) => QB {
    if (!this.dirtyFilterConfig) {
      return (qb) => qb;
    }

    const {
      tableId,
      dirtyTableName = 'tmp_computed_dirty',
      tableIdColumn = 'table_id',
      recordIdColumn = 'record_id',
    } = this.dirtyFilterConfig;

    const DIRTY_ALIAS = '__dirty';
    const recordIdPredicate = this.buildDirtyRecordIdSlicePredicate(DIRTY_ALIAS, recordIdColumn);

    return (qb) => {
      let next = qb.innerJoin(`${dirtyTableName} as ${DIRTY_ALIAS}`, (join) =>
        join
          .onRef(`${T}.__id`, '=', `${DIRTY_ALIAS}.${recordIdColumn}`)
          .on(`${DIRTY_ALIAS}.${tableIdColumn}`, '=', tableId)
      ) as QB;

      // Slice large dirty sets into smaller UPDATE statements (same TX).
      if (recordIdPredicate) {
        next = next.where(recordIdPredicate) as QB;
      }

      return next;
    };
  }

  private dirtyRecordIdSlice(): ReadonlyArray<string> {
    const recordIds = this.dirtyFilterConfig?.recordIds;
    return recordIds?.length ? [...new Set(recordIds.filter((id) => id.length > 0))] : [];
  }

  private buildDirtyRecordIdSlicePredicate(
    alias: string,
    recordIdColumn: string
  ): Expression<SqlBool> | null {
    const recordIds = this.dirtyRecordIdSlice();
    if (recordIds.length === 0) return null;

    return sql<SqlBool>`${sql.ref(`${alias}.${recordIdColumn}`)} = ANY(${recordIds}::text[])`;
  }

  private buildConditionalHostSource(hostTableName: string) {
    const dirtyConfig = this.dirtyFilterConfig;
    if (!dirtyConfig) return `${hostTableName} as ${H}` as const;

    const {
      dirtyTableName = 'tmp_computed_dirty',
      tableIdColumn = 'table_id',
      recordIdColumn = 'record_id',
    } = dirtyConfig;
    const recordIdPredicate = this.buildDirtyRecordIdSlicePredicate('__cond_dirty', recordIdColumn);

    let query = this.db
      .selectFrom(`${hostTableName} as ${H}`)
      .innerJoin(`${dirtyTableName} as __cond_dirty`, (join) =>
        join
          .onRef(`${H}.__id`, '=', `__cond_dirty.${recordIdColumn}`)
          .on(`__cond_dirty.${tableIdColumn}`, '=', dirtyConfig.tableId)
      )
      .selectAll(H);

    if (recordIdPredicate) {
      query = query.where(recordIdPredicate);
    }

    return query.as(H);
  }

  private buildConditionalHostKeySource(hostTableName: string, hostKeyColumn: string) {
    const dirtyConfig = this.dirtyFilterConfig;
    const hostKeySelection = sql`${sql.ref(`${H}.${hostKeyColumn}`)}`.as(hostKeyColumn);

    if (!dirtyConfig) {
      return this.db
        .selectFrom(`${hostTableName} as ${H}`)
        .select(hostKeySelection)
        .distinct()
        .as(H);
    }

    const {
      dirtyTableName = 'tmp_computed_dirty',
      tableIdColumn = 'table_id',
      recordIdColumn = 'record_id',
    } = dirtyConfig;
    const recordIdPredicate = this.buildDirtyRecordIdSlicePredicate('__cond_dirty', recordIdColumn);

    let query = this.db
      .selectFrom(`${hostTableName} as ${H}`)
      .innerJoin(`${dirtyTableName} as __cond_dirty`, (join) =>
        join
          .onRef(`${H}.__id`, '=', `__cond_dirty.${recordIdColumn}`)
          .on(`__cond_dirty.${tableIdColumn}`, '=', dirtyConfig.tableId)
      )
      .select(hostKeySelection)
      .distinct();

    if (recordIdPredicate) {
      query = query.where(recordIdPredicate);
    }

    return query.as(H);
  }

  private createLateralContext() {
    // Link-based laterals (keyed by linkFieldId + lookup filter)
    const laterals = new Map<
      string,
      {
        linkFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
        condition?: FieldCondition;
      }
    >();

    // Conditional field laterals (keyed by compatible condition/source shape).
    // Fields with the same condition can share one scan and project multiple aggregates.
    const conditionalLaterals = new Map<
      string,
      {
        conditionalFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
      }
    >();

    const hashKey = (value: string): string => {
      if (!value) return '0';
      let hash = 5381;
      for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) + hash + value.charCodeAt(i);
      }
      return Math.abs(hash).toString(36);
    };

    const conditionKey = (columnType: LateralColumnType): string => {
      if (
        (columnType.type !== 'lookup' && columnType.type !== 'rollup') ||
        !columnType.condition ||
        columnType.condition.isEmpty()
      ) {
        return '';
      }
      return JSON.stringify(columnType.condition.toDto());
    };

    const conditionalColumnKey = (
      conditionalFieldId: FieldId,
      foreignTableId: string,
      columnType: LateralColumnType
    ): string => {
      if (columnType.type !== 'conditionalLookup' && columnType.type !== 'conditionalRollup') {
        return conditionalFieldId.toString();
      }

      const condition = columnType.condition;
      const setBasedKey = (group: ConditionalFieldReferenceGroup): string =>
        [
          columnType.type,
          'field-ref-set',
          foreignTableId,
          group.foreignFieldId,
          group.hostFieldId,
          group.limit ?? 'none',
          group.orderInsensitive ? 'orderless' : 'ordered',
          group.sort ? `${group.sort.fieldId}:${group.sort.order}` : 'nosort',
          group.residualFilterItems.map(residualFilterItemFingerprint).sort().join('&') ||
            'noresidual',
        ].join('|');

      const setBasedRollupGroup = conditionalRollupSetBasedFieldReferenceGroup(columnType);
      if (setBasedRollupGroup) {
        return setBasedKey(setBasedRollupGroup);
      }

      const fieldRefGroup = conditionalRollupFieldReferenceGroup(columnType);
      if (fieldRefGroup) {
        return [
          columnType.type,
          'field-ref-group',
          foreignTableId,
          fieldRefGroup.foreignFieldId,
          fieldRefGroup.hostFieldId,
        ].join('|');
      }

      const lookupFieldRefGroup = conditionalLookupFieldReferenceGroup(columnType);
      if (lookupFieldRefGroup) {
        return setBasedKey(lookupFieldRefGroup);
      }

      if (columnType.type === 'conditionalRollup') {
        const foreignTable = this.foreignTables.get(foreignTableId);
        const foreignFieldIds = foreignTable
          ? new Set(foreignTable.getFields().map((field) => field.id().toString()))
          : new Set<string>();
        if (isSourceOnlyConditionalRollup(columnType, foreignFieldIds)) {
          return [columnType.type, 'source-only', foreignTableId].join('|');
        }
      }

      const orderMode =
        columnType.type === 'conditionalRollup' &&
        isOrderInsensitiveRollupExpression(columnType.expression)
          ? 'orderless'
          : 'ordered';
      return [columnType.type, orderMode, foreignTableId, JSON.stringify(condition.toDto())].join(
        '|'
      );
    };

    const ctx: ILateralContext = {
      addColumn(linkFieldId, foreignTableId, outputAlias, columnType) {
        const conditionKeyValue = conditionKey(columnType);
        const key = `${linkFieldId.toString()}|${foreignTableId}|${conditionKeyValue}`;
        if (!laterals.has(key)) {
          laterals.set(key, {
            linkFieldId,
            alias: `lat_${linkFieldId.toString()}_${hashKey(conditionKeyValue)}`,
            foreignTableId,
            columns: [],
            condition:
              (columnType.type === 'lookup' || columnType.type === 'rollup') &&
              (columnType.condition?.hasFilter() ||
                columnType.condition?.hasSort() ||
                columnType.condition?.hasLimit())
                ? columnType.condition
                : undefined,
          });
        }
        const lateral = laterals.get(key)!;
        // Prevent duplicate columns with the same outputAlias
        // This can happen when a formula references a lookup field that is also being computed
        const existingColumn = lateral.columns.find((col) => col.outputAlias === outputAlias);
        if (!existingColumn) {
          lateral.columns.push({ outputAlias, columnType });
        }
        return lateral.alias;
      },
      addConditionalColumn(conditionalFieldId, foreignTableId, outputAlias, columnType) {
        const key = conditionalColumnKey(conditionalFieldId, foreignTableId, columnType);
        if (!conditionalLaterals.has(key)) {
          conditionalLaterals.set(key, {
            conditionalFieldId,
            alias: `cond_${conditionalFieldId.toString()}`,
            foreignTableId,
            columns: [],
          });
        }
        const lateral = conditionalLaterals.get(key)!;
        const existingColumn = lateral.columns.find((col) => col.outputAlias === outputAlias);
        if (!existingColumn) {
          lateral.columns.push({ outputAlias, columnType });
        }
        return lateral.alias;
      },
    };

    return { laterals, conditionalLaterals, ctx };
  }

  private buildSelectColumns(
    table: Table,
    projection: ReadonlyArray<FieldId> | null,
    lateralCtx: ILateralContext
  ): Result<AliasedRawBuilder<unknown, string>[], DomainError> {
    return safeTry(
      function* (this: ComputedTableRecordQueryBuilder) {
        const visitor = new ComputedFieldSelectExpressionVisitor(
          table,
          T,
          lateralCtx,
          this.typeValidationStrategy,
          {
            preferStoredLastModifiedFormula: this.preferStoredLastModifiedFormula,
            missingForeignTableIds: this.missingForeignTableIds,
            erroredLookupReferenceMode: this.erroredLookupReferenceMode,
            forceLookupArrayOutput: this.forceLookupArrayOutput,
            userSnapshotActorFallback: this.userSnapshotActorFallback,
            resolveSystemUserSnapshotsFromUsers: this.resolveSystemUserSnapshotsFromUsers,
          }
        );
        const columns: AliasedRawBuilder<unknown, string>[] = [];
        const selectedFields = table
          .getFields()
          .filter(
            (field) =>
              !field.hasError().isError() &&
              (!projection || projection.some((p) => p.equals(field.id())))
          );
        const lastFieldIdByColumn = new Map<string, string>();

        for (const field of selectedFields) {
          const dbFieldName = field.dbFieldName().andThen((name) => name.value());
          if (dbFieldName.isOk()) {
            lastFieldIdByColumn.set(dbFieldName.value, field.id().toString());
          }
        }

        const selectedFieldById = new Map(
          selectedFields.map((field) => [field.id().toString(), field] as const)
        );
        const orderedFields = projection
          ? projection.flatMap((fieldId) => {
              const field = selectedFieldById.get(fieldId.toString());
              return field ? [field] : [];
            })
          : selectedFields;

        for (const field of orderedFields) {
          const dbFieldName = field.dbFieldName().andThen((name) => name.value());
          if (
            dbFieldName.isOk() &&
            lastFieldIdByColumn.get(dbFieldName.value) !== field.id().toString()
          ) {
            continue;
          }
          columns.push(yield* field.accept(visitor));
        }

        return ok(columns);
      }.bind(this)
    );
  }

  private buildLateralJoins(
    table: Table,
    foreignTables: ReadonlyMap<string, Table>,
    laterals: Map<
      string,
      {
        linkFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
        condition?: FieldCondition;
      }
    >
  ): Result<(qb: QB) => QB, DomainError> {
    if (laterals.size === 0) {
      return ok((qb) => qb);
    }

    return safeTry<(qb: QB) => QB, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const subqueries: Array<{
          query: AliasedExpression<Record<string, unknown>, string>;
          joinMode: 'lateral' | 'hostLeft';
        }> = [];

        for (const [, lateral] of laterals) {
          const foreignTable = foreignTables.get(lateral.foreignTableId);
          if (!foreignTable) {
            return err(
              domainError.notFound({
                message: `Foreign table not found: ${lateral.foreignTableId}`,
              })
            );
          }

          const linkField = yield* table
            .getField((f): f is LinkField => f.id().equals(lateral.linkFieldId))
            .mapErr(() =>
              domainError.notFound({ message: `Link field not found: ${lateral.linkFieldId}` })
            );

          const foreignDbTableName = yield* foreignTable.dbTableName();
          const foreignTableName = yield* foreignDbTableName.value();

          if (this.isSetBasedLinkRollupGroup(table, foreignTable, linkField, lateral.columns)) {
            subqueries.push({
              query: yield* this.buildSetBasedLinkRollupAggregate(
                table,
                foreignTable,
                foreignTableName,
                linkField,
                lateral.alias,
                lateral.columns
              ),
              joinMode: 'hostLeft',
            });
            continue;
          }

          // Optional condition sort/limit (plain lookup/rollup options). The
          // schema accepted them but the pipeline ignored them (T6520): the
          // sort overrides the link-order aggregation ranking and the limit
          // restricts the correlated row source per host record.
          const resolvedConditionSort = lateral.condition?.hasSort()
            ? yield* this.resolveConditionalSort(foreignTable, lateral.condition)
            : null;
          const conditionLimit = lateral.condition?.hasLimit()
            ? lateral.condition.limit()
            : undefined;
          const linkOrderBy = lateral.columns.reduce<LinkOrderBy | undefined>(
            (current, column) =>
              current ?? ('orderBy' in column.columnType ? column.columnType.orderBy : undefined),
            undefined
          );
          const conditionSort = resolvedConditionSort
            ? { ...resolvedConditionSort, tieBreaker: linkOrderBy }
            : null;

          const filterWhere = yield* this.buildFilterConditionWhere(
            foreignTable,
            lateral.condition
          );
          const uniqueScanFilterWhere = yield* this.buildFilterConditionWhere(
            foreignTable,
            lateral.condition,
            T,
            UNIQUE_SCAN_ALIAS
          );
          const uniqueScanOnly = lateral.columns.every((col) =>
            this.isForeignRowUniqueScanColumn(col.columnType, foreignTable)
          );

          const selectExprs: AliasedRawBuilder<unknown, string>[] = [];
          for (const col of lateral.columns) {
            selectExprs.push(
              yield* this.buildLateralSelectExpr(foreignTable, col.columnType, col.outputAlias, {
                orderByOverride: conditionSort ?? undefined,
                linkField,
                foreignTableName,
                uniqueScanFilterWhere: uniqueScanFilterWhere ?? undefined,
                uniqueScanLimit: conditionLimit,
              })
            );
          }
          const joinCondition = yield* this.getJoinCondition(linkField, foreignTableName);

          let baseQuery;
          if (uniqueScanOnly) {
            baseQuery = this.db.selectNoFrom(selectExprs);
          } else if (conditionSort || conditionLimit !== undefined) {
            let rowsQuery = this.db
              .selectFrom(`${foreignTableName} as ${F}`)
              .selectAll(F)
              .where(joinCondition);
            if (filterWhere !== null) {
              rowsQuery = rowsQuery.where(sql<SqlBool>`(${filterWhere})`);
            }
            const rowsOrderBy = conditionSort
              ? buildResolvedConditionalOrderByExpr(conditionSort)
              : conditionLimit !== undefined
                ? buildLinkOrderByExpr(linkOrderBy) ?? sql.ref(`${F}.__auto_number`)
                : null;
            if (rowsOrderBy) {
              rowsQuery = rowsQuery.orderBy(rowsOrderBy);
            }
            if (conditionLimit !== undefined) {
              rowsQuery = rowsQuery.limit(conditionLimit);
            }
            baseQuery = this.db.selectFrom(rowsQuery.as(F)).select(selectExprs);
          } else {
            baseQuery = this.db
              .selectFrom(`${foreignTableName} as ${F}`)
              .select(selectExprs)
              .where(joinCondition);

            if (filterWhere !== null) {
              baseQuery = baseQuery.where(sql<SqlBool>`(${filterWhere})`);
            }
          }

          subqueries.push({ query: baseQuery.as(lateral.alias), joinMode: 'lateral' });
        }

        return ok((qb: QB) =>
          subqueries.reduce(
            (q, subquery) =>
              subquery.joinMode === 'lateral'
                ? (q.innerJoinLateral(subquery.query, (j) => j.onTrue()) as QB)
                : (q.leftJoin(subquery.query, (j) =>
                    j.onRef(`${subquery.query.alias}.__host_id`, '=', `${T}.__id`)
                  ) as QB),
            qb
          )
        );
      }.bind(this)
    );
  }

  /**
   * Bulk computed backfills can share one grouped relationship scan when neither row
   * order nor a per-field filter/limit affects their result. Ordinary reads keep the
   * indexed per-host lateral because their outer filter/limit is not available here.
   */
  private isSetBasedLinkRollupGroup(
    table: Table,
    foreignTable: Table,
    linkField: LinkField,
    columns: Array<{ outputAlias: string; columnType: LateralColumnType }>
  ): boolean {
    if (
      (!this.dirtyFilterConfig && !this.allowFullTableSetBasedRollups) ||
      table.id().equals(foreignTable.id()) ||
      columns.length === 0
    ) {
      return false;
    }

    const relationship = linkField.relationship();
    if (
      relationship.equals(LinkRelationship.manyMany()) ||
      (relationship.equals(LinkRelationship.oneMany()) && linkField.isOneWay())
    ) {
      const junctionTable = linkField.fkHostTableNameString();
      const selfKey = linkField.selfKeyNameString();
      const foreignKey = linkField.foreignKeyNameString();
      if (junctionTable.isErr() || selfKey.isErr() || foreignKey.isErr()) {
        return false;
      }
    } else if (relationship.equals(LinkRelationship.oneMany())) {
      const foreignHostKey = linkField.selfKeyNameString();
      if (foreignHostKey.isErr() || foreignHostKey.value === '__id') {
        return false;
      }
    } else {
      return false;
    }

    return columns.every(({ columnType }) => {
      if (
        columnType.type !== 'rollup' ||
        !isOrderInsensitiveRollupExpression(columnType.expression)
      ) {
        return false;
      }

      const condition = columnType.condition;
      return (
        !condition || (!condition.hasFilter() && !condition.hasSort() && !condition.hasLimit())
      );
    });
  }

  /**
   * Drive the aggregate from the relevant host set so hosts without links still
   * produce a grouped row and retain the existing COUNT/SUM/null empty semantics.
   */
  private buildSetBasedLinkRollupAggregate(
    hostTable: Table,
    foreignTable: Table,
    foreignTableName: string,
    linkField: LinkField,
    alias: string,
    columns: Array<{ outputAlias: string; columnType: LateralColumnType }>
  ): Result<AliasedExpression<Record<string, unknown>, string>, DomainError> {
    return safeTry<AliasedExpression<Record<string, unknown>, string>, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const hostDbTableName = yield* hostTable.dbTableName();
        const hostTableName = yield* hostDbTableName.value();
        const hostSource = this.buildConditionalHostSource(hostTableName);
        const hostId = `${H}.__id`;
        const selectExprs: AliasedRawBuilder<unknown, string>[] = [];

        for (const col of columns) {
          if (col.columnType.type !== 'rollup') {
            return err(
              domainError.invariant({
                message: 'Set-based link rollup aggregate received a non-rollup column',
              })
            );
          }
          selectExprs.push(
            (yield* this.buildRollupAggregateExpr(
              foreignTable,
              col.columnType.foreignFieldId,
              col.columnType.expression,
              { tableAlias: F }
            )).as(col.outputAlias)
          );
        }

        const relationship = linkField.relationship();
        if (
          relationship.equals(LinkRelationship.manyMany()) ||
          (relationship.equals(LinkRelationship.oneMany()) && linkField.isOneWay())
        ) {
          const junctionTableName = yield* linkField.fkHostTableNameString();
          const selfKey = yield* linkField.selfKeyNameString();
          const foreignKey = yield* linkField.foreignKeyNameString();

          return ok(
            this.db
              .selectFrom(hostSource)
              .leftJoin(`${junctionTableName} as j`, (join) =>
                join.onRef(`j.${selfKey}`, '=', hostId)
              )
              .leftJoin(`${foreignTableName} as ${F}`, (join) =>
                join.onRef(`${F}.__id`, '=', `j.${foreignKey}`)
              )
              .select([sql`${sql.ref(hostId)}`.as('__host_id'), ...selectExprs])
              .groupBy(sql.ref(hostId))
              .as(alias)
          );
        }

        const foreignHostKey = yield* linkField.selfKeyNameString();
        return ok(
          this.db
            .selectFrom(hostSource)
            .leftJoin(`${foreignTableName} as ${F}`, (join) =>
              join.onRef(`${F}.${foreignHostKey}`, '=', hostId)
            )
            .select([sql`${sql.ref(hostId)}`.as('__host_id'), ...selectExprs])
            .groupBy(sql.ref(hostId))
            .as(alias)
        );
      }.bind(this)
    );
  }

  /**
   * Build lateral joins for conditional fields (conditionalRollup, conditionalLookup).
   *
   * Unlike link-based lateral joins that use FK relationships, conditional joins
   * use a condition filter to select which foreign records to aggregate.
   *
   * The generated SQL structure for each conditional field:
   * - conditionalRollup: set-based host join for field-reference equality (+ residual
   *   constants, optional limit / order-sensitive ranking); uncorrelated join for
   *   simple source-only filters; otherwise LATERAL aggregation
   * - conditionalLookup: set-based host aggregate for field-reference equality
   *   (+ residual constants, optional sort/limit); otherwise LATERAL jsonb_agg
   */
  /**
   * A field-reference group can only drive the set-based fast paths when every
   * pair resolves: each filter fieldId on the foreign table and each referenced
   * value fieldId on the host table. Persisted conditions can violate this
   * (e.g. both sides naming a host-table field); those must fall back to the
   * generic lateral path instead of failing SQL generation.
   */
  private canResolveFieldReferenceGroup(
    foreignTable: Table,
    group: ConditionalFieldReferenceGroup
  ): boolean {
    const hostTable = this.table;
    if (!hostTable) return false;

    const pairs: Array<{ hostFieldId: string; foreignFieldId: string }> = [
      { hostFieldId: group.hostFieldId, foreignFieldId: group.foreignFieldId },
    ];
    for (const item of group.residualFilterItems) {
      const residualHostFieldId = referencedHostFieldId(item);
      if (residualHostFieldId) {
        pairs.push({ hostFieldId: residualHostFieldId, foreignFieldId: item.fieldId });
      }
    }

    return pairs.every((pair) => {
      const hostFieldId = FieldId.create(pair.hostFieldId);
      const foreignFieldId = FieldId.create(pair.foreignFieldId);
      if (hostFieldId.isErr() || foreignFieldId.isErr()) return false;

      return (
        hostTable.getField((field) => field.id().equals(hostFieldId.value)).isOk() &&
        foreignTable.getField((field) => field.id().equals(foreignFieldId.value)).isOk()
      );
    });
  }

  private resolveScalarConditionalHostKeyColumn(
    foreignTable: Table,
    group: ConditionalFieldReferenceGroup
  ): Result<string | null, DomainError> {
    const hostTable = this.table;
    if (!hostTable) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    return safeTry<string | null, DomainError>(function* () {
      // Composite field-ref keys cannot DISTINCT/GROUP BY a single text column.
      // Keep the host-id join so extra equalities stay in the WHERE clause.
      if (groupHasCompositeFieldReferenceKey(group)) {
        return ok(null);
      }

      // Self-table field-ref filters are swapped by FieldCondition.toRecordConditionSpec:
      // `NameMirror is {Name}` becomes F.Name = H.NameMirror. The DISTINCT/join
      // host-key column must follow that swapped host side, or the predicate
      // reads H.NameMirror from a projection that only selected Name.
      const isSelfTable = hostTable.id().equals(foreignTable.id());
      const hostFieldId = yield* FieldId.create(
        isSelfTable ? group.foreignFieldId : group.hostFieldId
      );
      const foreignFieldId = yield* FieldId.create(
        isSelfTable ? group.hostFieldId : group.foreignFieldId
      );
      const hostField = yield* resolveTableField(
        hostTable,
        hostFieldId,
        'resolving conditional field-reference host key'
      );
      const foreignField = yield* resolveTableField(
        foreignTable,
        foreignFieldId,
        'resolving conditional field-reference foreign key'
      );

      // Text equality is stable under DISTINCT/GROUP BY and covers the high-fanout
      // conditional-group path. Multi-value/user/link semantics keep the host-id path.
      if (
        !hostField.type().equals(FieldType.singleLineText()) ||
        !foreignField.type().equals(FieldType.singleLineText())
      ) {
        return ok(null);
      }

      const dbFieldName = yield* hostField.dbFieldName();
      return ok(yield* dbFieldName.value());
    });
  }

  private nullSafeTextKeyEquality(left: string, right: string): Expression<SqlBool> {
    return sql<SqlBool>`(${sql.ref(left)} is null) = (${sql.ref(right)} is null) and coalesce(${sql.ref(left)}, ''::text) = coalesce(${sql.ref(right)}, ''::text)`;
  }

  private buildConditionalJoins(
    foreignTables: ReadonlyMap<string, Table>,
    conditionalLaterals: Map<
      string,
      {
        conditionalFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
      }
    >
  ): Result<(qb: QB) => QB, DomainError> {
    if (conditionalLaterals.size === 0) {
      return ok((qb) => qb);
    }

    return safeTry<(qb: QB) => QB, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const subqueries: Array<{
          query: AliasedExpression<Record<string, unknown>, string>;
          joinMode: 'lateral' | 'inner' | 'hostLeft' | 'hostKey';
          hostKeyColumn?: string;
        }> = [];

        for (const [, lateral] of conditionalLaterals) {
          const foreignTable = foreignTables.get(lateral.foreignTableId);
          if (!foreignTable) {
            return err(
              domainError.notFound({
                message: `Foreign table not found for conditional field: ${lateral.foreignTableId}`,
              })
            );
          }

          const foreignDbTableName = yield* foreignTable.dbTableName();
          const foreignTableName = yield* foreignDbTableName.value();

          const firstColumnType = lateral.columns[0]?.columnType;
          // Degenerate field-reference filters (e.g. both sides naming a
          // host-table field) cannot drive the set-based fast paths. Fall back
          // to the generic lateral path, which treats unresolvable condition
          // fields as a skipped filter instead of failing the whole run.
          const resolvableGroup = (
            group: ConditionalFieldReferenceGroup | null
          ): ConditionalFieldReferenceGroup | null =>
            group && this.canResolveFieldReferenceGroup(foreignTable, group) ? group : null;
          const sharedRollupSetBasedGroup = resolvableGroup(
            sharedConditionalRollupSetBasedFieldReferenceGroup(lateral.columns)
          );
          if (sharedRollupSetBasedGroup) {
            const hostKeyColumn = yield* this.resolveScalarConditionalHostKeyColumn(
              foreignTable,
              sharedRollupSetBasedGroup
            );
            const query = yield* this.buildConditionalRollupFieldReferenceAggregate(
              foreignTable,
              foreignTableName,
              sharedRollupSetBasedGroup,
              lateral.alias,
              lateral.columns,
              hostKeyColumn ?? undefined
            );
            subqueries.push({
              query,
              joinMode: hostKeyColumn ? 'hostKey' : 'hostLeft',
              ...(hostKeyColumn ? { hostKeyColumn } : {}),
            });
            continue;
          }

          const sharedLookupFieldRefGroup = resolvableGroup(
            sharedConditionalLookupFieldReferenceGroup(lateral.columns)
          );
          if (sharedLookupFieldRefGroup) {
            const hostKeyColumn = yield* this.resolveScalarConditionalHostKeyColumn(
              foreignTable,
              sharedLookupFieldRefGroup
            );
            const query = yield* this.buildConditionalLookupFieldReferenceAggregate(
              foreignTable,
              foreignTableName,
              sharedLookupFieldRefGroup,
              lateral.alias,
              lateral.columns,
              hostKeyColumn ?? undefined
            );
            subqueries.push({
              query,
              joinMode: hostKeyColumn ? 'hostKey' : 'hostLeft',
              ...(hostKeyColumn ? { hostKeyColumn } : {}),
            });
            continue;
          }

          const sharedFieldRefGroup = resolvableGroup(
            sharedConditionalFieldReferenceGroup(lateral.columns)
          );
          const condition = match(firstColumnType)
            .with({ type: 'conditionalLookup' }, (c) => c.condition)
            .with({ type: 'conditionalRollup' }, (c) => c.condition)
            // Plain lookup/rollup conditions carry optional sort/limit too —
            // without this they were accepted by the schema but never applied.
            .with({ type: 'lookup' }, (c) => c.condition)
            .with({ type: 'rollup' }, (c) => c.condition)
            .otherwise(() => undefined);

          const sourceOnlyRollupGroup = isSourceOnlyConditionalRollupGroup(
            foreignTable,
            lateral.columns
          );

          // Build WHERE clause from condition filter
          const whereClause = sourceOnlyRollupGroup
            ? null
            : sharedFieldRefGroup
              ? yield* this.buildFieldReferenceConditionWhere(foreignTable, sharedFieldRefGroup)
              : yield* this.buildConditionWhere(foreignTable, firstColumnType);

          const sortClause = condition
            ? yield* this.resolveConditionalSort(foreignTable, condition)
            : null;
          const linkOrderBy = lateral.columns.reduce<LinkOrderBy | undefined>(
            (current, column) =>
              current ?? ('orderBy' in column.columnType ? column.columnType.orderBy : undefined),
            undefined
          );
          const resolvedSortClause = sortClause ? { ...sortClause, tieBreaker: linkOrderBy } : null;
          const configuredLimit = condition?.limit();
          const isConditionalDerived =
            firstColumnType?.type === 'conditionalLookup' ||
            firstColumnType?.type === 'conditionalRollup';
          const canUseUnboundedOrderlessRollup =
            firstColumnType?.type === 'conditionalRollup' &&
            isOrderInsensitiveRollupExpression(firstColumnType.expression) &&
            !condition?.hasSort() &&
            !condition?.hasLimit();
          const limitValue = canUseUnboundedOrderlessRollup
            ? undefined
            : isConditionalDerived
              ? configuredLimit ?? CONDITIONAL_QUERY_DEFAULT_LIMIT
              : configuredLimit;
          const useUncorrelatedRollupFastPath =
            this.shouldUseConditionalRollupFastPath(foreignTable, firstColumnType) &&
            !sharedFieldRefGroup;
          const defaultOrderBy =
            isConditionalDerived && !canUseUnboundedOrderlessRollup
              ? DEFAULT_CONDITIONAL_ORDER_BY
              : undefined;
          const orderByForSelect = resolvedSortClause ?? defaultOrderBy;
          const orderByForLimit =
            resolvedSortClause ??
            (limitValue !== undefined
              ? isConditionalDerived
                ? DEFAULT_CONDITIONAL_ORDER_BY
                : linkOrderBy ?? DEFAULT_CONDITIONAL_ORDER_BY
              : null);
          const needsSubquery = Boolean(orderByForLimit || limitValue);
          const sourceAlias = needsSubquery ? `${lateral.alias}_src` : F;

          const selectExprs: AliasedRawBuilder<unknown, string>[] = [];
          for (const col of lateral.columns) {
            const filterWhere =
              (sharedFieldRefGroup || sourceOnlyRollupGroup) &&
              col.columnType.type === 'conditionalRollup'
                ? yield* this.buildConditionWhere(foreignTable, col.columnType)
                : undefined;
            selectExprs.push(
              yield* this.buildConditionalSelectExpr(
                foreignTable,
                col.columnType,
                col.outputAlias,
                {
                  tableAlias: sourceAlias,
                  orderBy: orderByForSelect ?? undefined,
                  filterWhere: filterWhere ?? undefined,
                }
              )
            );
          }

          const query = needsSubquery
            ? (() => {
                let baseQuery = this.db.selectFrom(`${foreignTableName} as ${F}`).selectAll();
                if (whereClause !== null) {
                  baseQuery = baseQuery.where(whereClause);
                }
                if (orderByForLimit !== null) {
                  const orderByExpr =
                    'source' in orderByForLimit
                      ? buildLinkOrderByExpr(orderByForLimit)
                      : buildResolvedConditionalOrderByExpr(orderByForLimit);
                  if (orderByExpr) baseQuery = baseQuery.orderBy(orderByExpr);
                }
                if (limitValue !== undefined) {
                  baseQuery = baseQuery.limit(limitValue);
                }

                return this.db
                  .selectFrom(baseQuery.as(sourceAlias))
                  .select(selectExprs)
                  .as(lateral.alias);
              })()
            : (() => {
                let baseQuery = this.db
                  .selectFrom(`${foreignTableName} as ${F}`)
                  .select(selectExprs);
                if (whereClause !== null) {
                  baseQuery = baseQuery.where(whereClause);
                }
                return baseQuery.as(lateral.alias);
              })();

          subqueries.push({
            query,
            joinMode: useUncorrelatedRollupFastPath ? 'inner' : 'lateral',
          });
        }

        this.unchunkedDirtySetHostKeyColumns =
          subqueries.length > 0 && subqueries.every((subquery) => subquery.joinMode === 'hostKey')
            ? [
                ...new Set(
                  subqueries.flatMap((subquery) =>
                    subquery.hostKeyColumn ? [subquery.hostKeyColumn] : []
                  )
                ),
              ]
            : [];

        return ok(
          (qb: QB) =>
            subqueries.reduce((q, subquery) => {
              if (subquery.joinMode === 'lateral') {
                return q.innerJoinLateral(subquery.query, (j) => j.onTrue()) as QB;
              }
              if (subquery.joinMode === 'hostLeft') {
                return q.leftJoin(subquery.query, (j) =>
                  j.onRef(`${subquery.query.alias}.__host_id`, '=', `${T}.__id`)
                ) as QB;
              }
              if (subquery.joinMode === 'hostKey' && subquery.hostKeyColumn) {
                return q.leftJoin(subquery.query, (j) =>
                  j.on(
                    this.nullSafeTextKeyEquality(
                      `${subquery.query.alias}.__host_key`,
                      `${T}.${subquery.hostKeyColumn}`
                    )
                  )
                ) as QB;
              }
              return q.innerJoin(subquery.query, (j) => j.onTrue()) as QB;
            }, qb) as QB
        );
      }.bind(this)
    );
  }

  private shouldUseConditionalRollupFastPath(
    foreignTable: Table,
    columnType: LateralColumnType | undefined
  ): boolean {
    if (!columnType || columnType.type !== 'conditionalRollup') {
      return false;
    }

    const condition = columnType.condition;
    if (!condition.hasFilter() || condition.hasSort() || condition.hasLimit()) {
      return false;
    }

    const foreignFieldIds = new Set(foreignTable.getFields().map((field) => field.id().toString()));
    if (
      condition.referencedFieldIds().some((fieldId) => !foreignFieldIds.has(fieldId.toString()))
    ) {
      return false;
    }

    return isSimpleConditionalRollupFilter(condition.toDto().filter, foreignFieldIds);
  }

  /**
   * Build WHERE clause from FieldCondition for conditional field subqueries.
   *
   * Uses the visitor pattern to translate conditions to SQL.
   * This is the canonical way to handle conditions - all operator logic
   * is centralized in TableRecordConditionWhereVisitor.
   *
   * @returns null if no filter conditions, or a SQL expression for WHERE clause
   */
  private buildConditionWhere(
    foreignTable: Table,
    columnType: LateralColumnType | undefined
  ): Result<Expression<SqlBool> | null, DomainError> {
    if (!columnType) {
      return ok(null);
    }

    // Extract condition from column type
    const condition = match(columnType)
      .with({ type: 'conditionalLookup' }, (c) => c.condition)
      .with({ type: 'conditionalRollup' }, (c) => c.condition)
      .otherwise(() => undefined);

    return this.buildFilterConditionWhere(foreignTable, condition);
  }

  private buildFieldReferenceConditionWhere(
    foreignTable: Table,
    group: ConditionalFieldReferenceGroup,
    hostTableAlias = T
  ): Result<Expression<SqlBool> | null, DomainError> {
    return FieldCondition.create({
      filter: {
        conjunction: 'and',
        filterSet: [group.filterItem, ...group.residualFilterItems],
      },
    }).andThen((condition) =>
      this.buildFilterConditionWhere(foreignTable, condition, hostTableAlias)
    );
  }

  private resolveSetBasedOrderBy(
    foreignTable: Table,
    group: ConditionalFieldReferenceGroup
  ): Result<{ column: string; direction: 'asc' | 'desc' }, DomainError> {
    if (!group.sort) {
      return ok(DEFAULT_CONDITIONAL_ORDER_BY);
    }

    const parsedSortFieldId = FieldId.create(group.sort.fieldId);
    if (
      parsedSortFieldId.isOk() &&
      foreignTable.getField((f) => f.id().equals(parsedSortFieldId.value)).isErr()
    ) {
      this.degradeDanglingFieldReference(
        foreignTable,
        parsedSortFieldId.value,
        'conditional field-reference sort field'
      );
      return ok(DEFAULT_CONDITIONAL_ORDER_BY);
    }

    return safeTry<{ column: string; direction: 'asc' | 'desc' }, DomainError>(function* () {
      const sortFieldId = FieldId.create(group.sort!.fieldId);
      if (sortFieldId.isErr()) {
        return err(sortFieldId.error);
      }
      const field = yield* resolveTableField(
        foreignTable,
        sortFieldId.value,
        'resolving conditional field-reference sort field'
      );
      const dbFieldName = yield* field.dbFieldName();
      const column = yield* dbFieldName.value();
      return ok({ column, direction: group.sort!.order });
    });
  }

  /**
   * Physical columns the ranked foreign subquery must project for
   * `getFieldSourceExpr` / rollup `COUNT(__id)` / order tie-breakers.
   */
  private collectFieldSourceColumns(field: Field): Result<string[], DomainError> {
    return resolveFieldSourceLayout(field).map(fieldSourcePhysicalColumns);
  }

  private collectConditionalForeignProjectionColumns(
    foreignTable: Table,
    columns: Array<{ columnType: LateralColumnType }>,
    orderByColumn: string
  ): Result<string[], DomainError> {
    return safeTry<string[], DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const names = new Set<string>(['__id', '__auto_number', orderByColumn]);
        for (const col of columns) {
          if (
            col.columnType.type !== 'conditionalLookup' &&
            col.columnType.type !== 'conditionalRollup'
          ) {
            continue;
          }
          const { foreignFieldId } = col.columnType;
          const fieldResult = foreignTable.getField((f) => f.id().equals(foreignFieldId));
          if (fieldResult.isErr()) {
            continue;
          }
          const sourceColumns = yield* this.collectFieldSourceColumns(fieldResult.value);
          for (const name of sourceColumns) {
            names.add(name);
          }
        }
        return ok([...names]);
      }.bind(this)
    );
  }

  private buildConditionalLookupFieldReferenceAggregate(
    foreignTable: Table,
    foreignTableName: string,
    group: ConditionalFieldReferenceGroup,
    alias: string,
    columns: Array<{ outputAlias: string; columnType: LateralColumnType }>,
    hostKeyColumn?: string
  ): Result<AliasedExpression<Record<string, unknown>, string>, DomainError> {
    const hostTable = this.table;
    if (!hostTable) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    return safeTry<AliasedExpression<Record<string, unknown>, string>, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const hostDbTableName = yield* hostTable.dbTableName();
        const hostTableName = yield* hostDbTableName.value();
        const whereClause = yield* this.buildFieldReferenceConditionWhere(foreignTable, group, H);
        if (whereClause === null) {
          return err(
            domainError.invariant({
              message: 'Conditional lookup field-reference fast path requires a filter',
            })
          );
        }

        const rankedAlias = `${alias}_src`;
        const limitValue = group.limit ?? CONDITIONAL_QUERY_DEFAULT_LIMIT;
        const orderBy = yield* this.resolveSetBasedOrderBy(foreignTable, group);
        const foreignProjectionColumns = yield* this.collectConditionalForeignProjectionColumns(
          foreignTable,
          columns,
          orderBy.column
        );
        const hostSource = hostKeyColumn
          ? this.buildConditionalHostKeySource(hostTableName, hostKeyColumn)
          : this.buildConditionalHostSource(hostTableName);
        const hostIdentity = hostKeyColumn ? `${H}.${hostKeyColumn}` : `${H}.__id`;
        const hostIdentityAlias = hostKeyColumn ? '__host_key' : '__host_id';
        const rankedColumns = [
          sql`${sql.ref(hostIdentity)}`.as(hostIdentityAlias),
          sql`row_number() over (partition by ${sql.ref(hostIdentity)} order by ${sql.ref(`${F}.${orderBy.column}`)} ${sql.raw(orderBy.direction)})`.as(
            '__rn'
          ),
          ...foreignProjectionColumns.map((column) => sql.ref(`${F}.${column}`).as(column)),
        ];
        const rankedQuery = this.db
          .selectFrom(hostSource)
          .innerJoin(`${foreignTableName} as ${F}`, (join) => join.on(whereClause))
          .select(rankedColumns);

        const selectExprs: AliasedRawBuilder<unknown, string>[] = [];
        for (const col of columns) {
          selectExprs.push(
            yield* this.buildConditionalSelectExpr(foreignTable, col.columnType, col.outputAlias, {
              tableAlias: rankedAlias,
              orderBy,
            })
          );
        }

        return ok(
          this.db
            .selectFrom(rankedQuery.as(rankedAlias))
            .select([
              sql`${sql.ref(`${rankedAlias}.${hostIdentityAlias}`)}`.as(hostIdentityAlias),
              ...selectExprs,
            ])
            .where(sql<SqlBool>`${sql.ref(`${rankedAlias}.__rn`)} <= ${limitValue}`)
            .groupBy(sql.ref(`${rankedAlias}.${hostIdentityAlias}`))
            .as(alias)
        );
      }.bind(this)
    );
  }

  /**
   * Set-based materialization for field-reference conditional rollups
   * (optional residual constants, optional limit, order-sensitive or not).
   *
   * Host drives a single join against the foreign table (plus window ranking when a
   * limit is set or the expression is order-sensitive), instead of a correlated LATERAL.
   */
  private buildConditionalRollupFieldReferenceAggregate(
    foreignTable: Table,
    foreignTableName: string,
    group: ConditionalFieldReferenceGroup,
    alias: string,
    columns: Array<{ outputAlias: string; columnType: LateralColumnType }>,
    hostKeyColumn?: string
  ): Result<AliasedExpression<Record<string, unknown>, string>, DomainError> {
    const hostTable = this.table;
    if (!hostTable) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    return safeTry<AliasedExpression<Record<string, unknown>, string>, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const hostDbTableName = yield* hostTable.dbTableName();
        const hostTableName = yield* hostDbTableName.value();
        const whereClause = yield* this.buildFieldReferenceConditionWhere(foreignTable, group, H);
        if (whereClause === null) {
          return err(
            domainError.invariant({
              message: 'Conditional rollup field-reference set-based path requires a filter',
            })
          );
        }

        const buildHostSource = () =>
          hostKeyColumn
            ? this.buildConditionalHostKeySource(hostTableName, hostKeyColumn)
            : this.buildConditionalHostSource(hostTableName);
        const hostIdentity = hostKeyColumn ? `${H}.${hostKeyColumn}` : `${H}.__id`;
        const hostIdentityAlias = hostKeyColumn ? '__host_key' : '__host_id';
        const orderBy = yield* this.resolveSetBasedOrderBy(foreignTable, group);

        // Rank whenever limit is set, or the expression is order-sensitive (array_join…).
        const needsRanking = !group.orderInsensitive || group.limit !== undefined;
        const limitValue = needsRanking
          ? group.limit ?? CONDITIONAL_QUERY_DEFAULT_LIMIT
          : undefined;

        if (needsRanking && limitValue !== undefined) {
          const foreignProjectionColumns = yield* this.collectConditionalForeignProjectionColumns(
            foreignTable,
            columns,
            orderBy.column
          );
          const rankedAlias = `${alias}_src`;
          const rankedQuery = this.db
            .selectFrom(buildHostSource())
            .innerJoin(`${foreignTableName} as ${F}`, (join) => join.on(whereClause))
            .select([
              sql`${sql.ref(hostIdentity)}`.as(hostIdentityAlias),
              sql`row_number() over (partition by ${sql.ref(hostIdentity)} order by ${sql.ref(`${F}.${orderBy.column}`)} ${sql.raw(orderBy.direction)})`.as(
                '__rn'
              ),
              ...foreignProjectionColumns.map((column) => sql.ref(`${F}.${column}`).as(column)),
            ]);

          const selectExprs: AliasedRawBuilder<unknown, string>[] = [];
          for (const col of columns) {
            selectExprs.push(
              yield* this.buildConditionalSelectExpr(
                foreignTable,
                col.columnType,
                col.outputAlias,
                {
                  tableAlias: rankedAlias,
                  orderBy,
                }
              )
            );
          }

          // Drive from host so hosts with zero matches still emit a row (COUNT/SUM → 0).
          return ok(
            this.db
              .selectFrom(buildHostSource())
              .leftJoin(rankedQuery.as(rankedAlias), (join) =>
                join
                  .on(
                    this.nullSafeTextKeyEquality(
                      hostIdentity,
                      `${rankedAlias}.${hostIdentityAlias}`
                    )
                  )
                  .on(sql<SqlBool>`${sql.ref(`${rankedAlias}.__rn`)} <= ${limitValue}`)
              )
              .select([sql`${sql.ref(hostIdentity)}`.as(hostIdentityAlias), ...selectExprs])
              .groupBy(sql.ref(hostIdentity))
              .as(alias)
          );
        }

        const selectExprs: AliasedRawBuilder<unknown, string>[] = [];
        for (const col of columns) {
          selectExprs.push(
            yield* this.buildConditionalSelectExpr(foreignTable, col.columnType, col.outputAlias, {
              tableAlias: F,
            })
          );
        }

        return ok(
          this.db
            .selectFrom(buildHostSource())
            .leftJoin(`${foreignTableName} as ${F}`, (join) => join.on(whereClause))
            .select([sql`${sql.ref(hostIdentity)}`.as(hostIdentityAlias), ...selectExprs])
            .groupBy(sql.ref(hostIdentity))
            .as(alias)
        );
      }.bind(this)
    );
  }

  private buildFilterConditionWhere(
    foreignTable: Table,
    condition?: FieldCondition,
    hostTableAlias = T,
    foreignTableAlias = F
  ): Result<Expression<SqlBool> | null, DomainError> {
    if (!condition || !condition.hasFilter()) {
      return ok(null);
    }

    const hostTable = this.table ?? undefined;
    return safeTry<Expression<SqlBool> | null, DomainError>(function* () {
      // For conditional lookups, pass the host table to resolve field references (isSymbol)
      const conditionSpecResult = yield* ok(
        condition.toRecordConditionSpec(foreignTable, hostTable)
      );
      if (conditionSpecResult.isErr()) {
        // Condition references a field that no longer exists (e.g., deleted field) -
        // return null to skip filtering (field should be in error state)
        return ok(null);
      }
      const spec = conditionSpecResult.value;
      if (!spec) {
        return ok(null);
      }

      // Pass hostTableAlias so field references are resolved from the host table.
      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: foreignTableAlias,
        hostTableAlias,
      });
      const acceptResult = spec.accept(visitor);
      if (acceptResult.isErr()) {
        return err(acceptResult.error);
      }
      const whereResult = visitor.where();
      if (whereResult.isErr()) {
        return err(whereResult.error);
      }
      return ok(whereResult.value as unknown as Expression<SqlBool>);
    });
  }

  private resolveConditionalSort(
    foreignTable: Table,
    condition: FieldCondition
  ): Result<{ column: string; direction: 'asc' | 'desc' } | null, DomainError> {
    if (!condition.hasSort()) {
      return ok(null);
    }

    const sort = condition.sort();
    if (!sort) return ok(null);

    if (foreignTable.getField((f) => f.id().equals(sort.fieldId())).isErr()) {
      this.degradeDanglingFieldReference(foreignTable, sort.fieldId(), 'conditional sort field');
      return ok(null);
    }

    return safeTry<{ column: string; direction: 'asc' | 'desc' } | null, DomainError>(function* () {
      const field = yield* resolveTableField(
        foreignTable,
        sort.fieldId(),
        'resolving conditional sort field'
      );
      const dbFieldName = yield* field.dbFieldName();
      const column = yield* dbFieldName.value();
      return ok({ column, direction: sort.order() });
    });
  }

  private buildWhereCondition(): Result<Expression<SqlBool> | null, DomainError> {
    if (this.whereSpecs.length === 0) {
      return ok(null);
    }

    let combinedSpec = this.whereSpecs[0];
    for (let i = 1; i < this.whereSpecs.length; i += 1) {
      combinedSpec = new AndSpec(combinedSpec, this.whereSpecs[i]);
    }

    const visitor = new TableRecordConditionWhereVisitor({ tableAlias: T });
    const acceptResult = combinedSpec.accept(visitor);
    if (acceptResult.isErr()) {
      return err(acceptResult.error);
    }
    const whereResult = visitor.where();
    if (whereResult.isErr()) {
      return err(whereResult.error);
    }
    return ok(whereResult.value as unknown as Expression<SqlBool>);
  }

  /**
   * Build SELECT expression for conditional field columns.
   */
  private buildConditionalSelectExpr(
    foreignTable: Table,
    columnType: LateralColumnType,
    outputAlias: string,
    options?: {
      tableAlias?: string;
      orderBy?: { column: string; direction: 'asc' | 'desc' };
      filterWhere?: Expression<SqlBool>;
    }
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    const tableAlias = options?.tableAlias ?? F;
    return (
      match(columnType)
        .with({ type: 'conditionalLookup' }, ({ foreignFieldId, isMultiValue }) => {
          // For conditional lookup, aggregate all matching values as a JSONB array.
          // Default to __auto_number ordering to preserve insertion order deterministically.
          const orderBy = options?.orderBy ?? DEFAULT_CONDITIONAL_ORDER_BY;
          return this.buildLookupAggExpr(foreignTable, foreignFieldId, outputAlias, {
            tableAlias,
            orderBy,
            isMultiValue,
          });
        })
        .with({ type: 'conditionalRollup' }, ({ foreignFieldId, expression }) => {
          // For conditional rollup, apply the aggregate function.
          // Default to __auto_number to keep result ordering deterministic for order-sensitive rolls.
          const orderBy = options?.orderBy ?? DEFAULT_CONDITIONAL_ORDER_BY;
          return this.buildRollupAggregateExpr(foreignTable, foreignFieldId, expression, {
            tableAlias,
            orderBy,
            filterWhere: options?.filterWhere,
          }).map((expr: RawBuilder<unknown>) => expr.as(outputAlias));
        })
        // Other types should not appear in conditional laterals
        .with({ type: 'link' }, () =>
          err(domainError.invariant({ message: 'link type should not be in conditional laterals' }))
        )
        .with({ type: 'lookup' }, () =>
          err(
            domainError.invariant({ message: 'lookup type should not be in conditional laterals' })
          )
        )
        .with({ type: 'rollup' }, () =>
          err(
            domainError.invariant({ message: 'rollup type should not be in conditional laterals' })
          )
        )
        .exhaustive()
    );
  }

  private buildLateralSelectExpr(
    foreignTable: Table,
    columnType: LateralColumnType,
    outputAlias: string,
    options?: {
      orderByOverride?: ResolvedConditionalOrderBy;
      linkField?: LinkField;
      foreignTableName?: string;
      uniqueScanFilterWhere?: Expression<SqlBool>;
      uniqueScanLimit?: number;
    }
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return (
      match(columnType)
        .with({ type: 'link' }, ({ lookupFieldId, isMultiValue, orderBy }) =>
          resolveTableField(
            foreignTable,
            lookupFieldId,
            'resolving link title lookup field'
          ).andThen((lookupField) => {
            // Keep v1-compatible link title behavior: when the configured lookup field
            // becomes a checkbox via type conversion, fall back to foreign primary field.
            const titleField = lookupField.type().equals(FieldType.checkbox())
              ? (() => {
                  const primaryFieldResult = foreignTable.getField((f) =>
                    f.id().equals(foreignTable.primaryFieldId())
                  );
                  return primaryFieldResult.isOk() ? primaryFieldResult.value : lookupField;
                })()
              : lookupField;

            return titleField
              .dbFieldName()
              .andThen((dbFieldName) => dbFieldName.value())
              .map((columnName) => {
                const columnRef = sql.ref(`${F}.${columnName}`);
                const qualifiedRef = this.buildQualifiedRef(F, columnName);
                const isMultiValueResult = titleField
                  .isMultipleCellValue()
                  .map((multiplicity) => multiplicity.isMultiple());
                const isMultiValueField = isMultiValueResult.isOk() && isMultiValueResult.value;
                const formattedSql = !isMultiValueField
                  ? formatFieldValueAsStringSql(titleField, qualifiedRef, undefined, undefined, {
                      normalizeJsonScalar:
                        titleField.type().equals(FieldType.formula()) ||
                        titleField.type().equals(FieldType.conditionalRollup()),
                    })
                  : undefined;

                // For JSON-stored fields (User, Attachment, etc.), extract the 'title' property
                // Check if field is stored as JSON by checking dbFieldType
                const isJsonbStorage = titleField
                  .dbFieldType()
                  .map((t) => t.isJson())
                  .unwrapOr(false);

                let titleTextRef: RawBuilder<unknown>;
                if (isMultiValueField) {
                  // For multi-value fields (e.g., formula returning array like ['A'] or ['B', 'C']),
                  // convert JSONB array to comma-separated string
                  // This matches v1's formatStringArray behavior
                  const columnJson = sql`to_jsonb(${columnRef})`;
                  const normalizedColumnJson = sql`(CASE
                      WHEN ${columnRef} IS NULL THEN '[]'::jsonb
                      WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
                      WHEN jsonb_typeof(${columnJson}) = 'null' THEN '[]'::jsonb
                      ELSE jsonb_build_array(${columnJson})
                    END)`;
                  const formattedElemSql = formatFieldValueAsStringSql(
                    titleField,
                    `elem #>> '{}'`,
                    undefined,
                    undefined,
                    { normalizeJsonScalar: false }
                  );
                  titleTextRef = sql`(
                      SELECT string_agg(
                        CASE
                          WHEN jsonb_typeof(elem) = 'object' THEN COALESCE(elem->>'title', elem->>'name', elem #>> '{}')
                          ELSE ${formattedElemSql ? sql.raw(formattedElemSql) : sql`elem #>> '{}'`}
                        END,
                        ', '
                        ORDER BY ord
                      )
                      FROM jsonb_array_elements(${normalizedColumnJson}) WITH ORDINALITY AS t(elem, ord)
                    )`;
                } else if (formattedSql) {
                  // Use formatted SQL if available (for Number/DateTime formatting)
                  titleTextRef = sql.raw(formattedSql);
                } else if (isJsonbStorage) {
                  // For JSON-stored fields, extract a display-friendly scalar
                  titleTextRef = sql.raw(extractJsonScalarText(qualifiedRef));
                } else {
                  // Default: cast to text
                  titleTextRef = sql`(${columnRef})::text`;
                }
                // Build JSON object: {id: ..., title: ...}
                const jsonObj = sql`jsonb_strip_nulls(jsonb_build_object('id', ${sql.ref(`${F}.__id`)}, 'title', ${titleTextRef}))`;

                // CRITICAL FIX: If multi-value and orderBy is undefined, provide default ordering
                // This ensures OneMany foreign-based links get proper __id ordering
                const effectiveOrderBy =
                  isMultiValue && !orderBy
                    ? ({ source: 'foreign' as const, column: undefined } as LinkOrderBy)
                    : orderBy;
                const orderByExpr = buildLinkOrderByExpr(effectiveOrderBy);

                if (isMultiValue) {
                  // Multi-value: aggregate as JSON array
                  // Use jsonb_agg to get JSONB type which is more efficient for storage and indexing
                  return orderByExpr
                    ? sql`jsonb_agg(${jsonObj} ORDER BY ${orderByExpr})`.as(outputAlias)
                    : sql`jsonb_agg(${jsonObj})`.as(outputAlias);
                } else {
                  // Single value: return single object (use first match)
                  // Must use jsonb_agg (not json_agg) because only JSONB supports subscript [0] access
                  return orderByExpr
                    ? sql`(jsonb_agg(${jsonObj} ORDER BY ${orderByExpr}))[0]`.as(outputAlias)
                    : sql`(jsonb_agg(${jsonObj}))[0]`.as(outputAlias);
                }
              });
          })
        )
        .with({ type: 'lookup' }, ({ foreignFieldId, orderBy, isMultiValue }) =>
          this.buildLookupAggExpr(foreignTable, foreignFieldId, outputAlias, {
            orderBy: options?.orderByOverride ?? orderBy,
            isMultiValue,
          })
        )
        .with({ type: 'rollup' }, ({ foreignFieldId, expression, orderBy }) =>
          this.buildRollupAggregateExpr(foreignTable, foreignFieldId, expression, {
            orderBy: options?.orderByOverride ?? orderBy,
            uniqueScan:
              expression === 'array_unique({values})' &&
              options?.linkField &&
              options.foreignTableName
                ? {
                    linkField: options.linkField,
                    foreignTableName: options.foreignTableName,
                    filterWhere: options.uniqueScanFilterWhere,
                    limit: options.uniqueScanLimit,
                  }
                : undefined,
          }).map((expr: RawBuilder<unknown>) => expr.as(outputAlias))
        )
        // Conditional types are handled in buildConditionalJoins, not here
        .with({ type: 'conditionalLookup' }, () =>
          err(
            domainError.invariant({
              message: 'conditionalLookup should be handled in buildConditionalJoins',
            })
          )
        )
        .with({ type: 'conditionalRollup' }, () =>
          err(
            domainError.invariant({
              message: 'conditionalRollup should be handled in buildConditionalJoins',
            })
          )
        )
        .exhaustive()
    );
  }

  private buildQualifiedRef(tableAlias: string, columnName: string): string {
    const escapeIdentifier = (value: string): string => value.replace(/"/g, '""');
    return `"${escapeIdentifier(tableAlias)}"."${escapeIdentifier(columnName)}"`;
  }

  private getFieldSourceExpr(
    field: FieldSourceField,
    tableAlias: string
  ): Result<{ expr: RawBuilder<unknown>; isJsonbStorage?: boolean }, DomainError> {
    return resolveFieldSourceLayout(field).map((layout) => {
      switch (layout.kind) {
        case 'column':
          return { expr: sql.ref(`${tableAlias}.${layout.column}`) };
        case 'createdBy': {
          const snapshotRef = sql.ref(`${tableAlias}.${layout.snapshotColumn}`);
          return {
            expr: buildUserJsonObjectFromSnapshotExpr(
              snapshotRef,
              sql.ref(`${tableAlias}.__created_by`),
              this.userSnapshotActorFallback
            ),
            isJsonbStorage: true,
          };
        }
        case 'lastModifiedBy': {
          const snapshotRef = sql.ref(`${tableAlias}.${layout.snapshotColumn}`);
          const fallbackRef = layout.trackAll
            ? sql.ref(`${tableAlias}.__last_modified_by`)
            : undefined;
          return {
            expr: buildUserJsonObjectFromSnapshotExpr(
              snapshotRef,
              fallbackRef,
              this.userSnapshotActorFallback
            ),
            isJsonbStorage: true,
          };
        }
      }
    });
  }

  private getForeignColRef(
    foreignTable: Table,
    foreignFieldId: FieldId,
    tableAlias: string = F
  ): Result<RawBuilder<unknown>, DomainError> {
    return resolveTableField(
      foreignTable,
      foreignFieldId,
      'resolving foreign column reference'
    ).andThen((field) =>
      this.getFieldSourceExpr(field, tableAlias).map(({ expr }) => sql`${expr}`)
    );
  }

  private buildPerRowNestedJsonTextExpr(colRef: RawBuilder<unknown>): RawBuilder<unknown> {
    const colJson = sql`to_jsonb(${colRef})`;
    const normalized = sql`(CASE
      WHEN ${colRef} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(${colJson}) = 'array' THEN ${colJson}
      WHEN jsonb_typeof(${colJson}) = 'null' THEN '[]'::jsonb
      ELSE jsonb_build_array(${colJson})
    END)`;
    return sql`(
      SELECT string_agg(
        ${sql.raw(extractJsonScalarText('leaf'))},
        ', '
        ORDER BY outer_ord, inner_ord
      )
      FROM jsonb_array_elements(${normalized}) WITH ORDINALITY AS outer_elem(elem, outer_ord)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(outer_elem.elem) = 'array' THEN outer_elem.elem
          ELSE jsonb_build_array(outer_elem.elem)
        END
      ) WITH ORDINALITY AS inner_elem(leaf, inner_ord)
    )`;
  }

  /**
   * Deduplicate a pre-ordered jsonb array while keeping first-occurrence order.
   * `json_agg(DISTINCT x)` / `SELECT DISTINCT val ORDER BY val` sort by value and
   * cannot preserve link/source order.
   */
  private buildDistinctNestedJsonTextArrayExpr(
    baseAggregate: RawBuilder<unknown>
  ): RawBuilder<unknown> {
    return sql`(
      SELECT jsonb_agg(to_jsonb(v.val) ORDER BY v.outer_ord, v.inner_ord)
      FROM (
        SELECT DISTINCT ON (flattened.val) flattened.val, flattened.outer_ord, flattened.inner_ord
        FROM (
          SELECT ${sql.raw(extractJsonScalarText('leaf'))} AS val,
                 row_elem.outer_ord,
                 leaf_elem.inner_ord
          FROM jsonb_array_elements(COALESCE(${baseAggregate}, '[]'::jsonb))
            WITH ORDINALITY AS row_elem(elem, outer_ord)
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(row_elem.elem) = 'array' THEN row_elem.elem
              ELSE jsonb_build_array(row_elem.elem)
            END
          ) WITH ORDINALITY AS leaf_elem(leaf, inner_ord)
        ) AS flattened
        WHERE val IS NOT NULL AND val <> ''
        ORDER BY flattened.val, flattened.outer_ord, flattened.inner_ord
      ) AS v
    )`;
  }

  /**
   * Deduplicate a pre-ordered jsonb array while keeping first-occurrence order.
   * Fallback when a correlated foreign-row scan is unavailable.
   */
  private buildFirstOccurrenceUniqueJsonbArrayExpr(
    orderedJsonbAgg: RawBuilder<unknown>
  ): RawBuilder<unknown> {
    return sql`(
      SELECT jsonb_agg(g.val ORDER BY g.pos)
      FROM (
        SELECT src.val, MIN(src.pos) AS pos
        FROM jsonb_array_elements(COALESCE(${orderedJsonbAgg}, '[]'::jsonb))
          WITH ORDINALITY AS src(val, pos)
        WHERE src.val IS NOT NULL AND src.val <> 'null'::jsonb
        GROUP BY src.val
      ) AS g
    )`;
  }

  private isForeignRowUniqueScanColumn(
    columnType: LateralColumnType,
    foreignTable: Table
  ): boolean {
    if (columnType.type !== 'rollup' || columnType.expression !== 'array_unique({values})') {
      return false;
    }
    const fieldResult = foreignTable.getField((f) => f.id().equals(columnType.foreignFieldId));
    if (fieldResult.isErr()) {
      return false;
    }
    const field = fieldResult.value;
    if (field.type().equals(FieldType.link())) {
      return false;
    }
    const valueType = field.accept(new FieldValueTypeVisitor());
    return valueType.isOk() && !valueType.value.isMultipleCellValue.isMultiple();
  }

  /**
   * Ordered unique over foreign rows without nesting jsonb_agg inside a
   * scalar subquery. Nested aggregates can drop ORDER BY, so DISTINCT ON
   * (val) then follows value order (Done before Todo) while STRING_AGG
   * on the same lateral still follows link order.
   */
  private buildFirstOccurrenceUniqueScanExpr(params: {
    colRef: RawBuilder<unknown>;
    uniqueOrderExpr: RawBuilder<unknown>;
    foreignTableName: string;
    joinCondition: Expression<SqlBool>;
    filterWhere?: Expression<SqlBool>;
    limit?: number;
  }): RawBuilder<unknown> {
    let rankedRows = this.db
      .selectFrom(`${params.foreignTableName} as ${UNIQUE_SCAN_ALIAS}`)
      .select([
        params.colRef.as('val'),
        sql<number>`row_number() over (order by ${params.uniqueOrderExpr})`.as('pos'),
      ])
      .where(params.joinCondition);
    if (params.filterWhere) {
      rankedRows = rankedRows.where(sql<SqlBool>`(${params.filterWhere})`);
    }
    const limitedRows =
      params.limit === undefined
        ? rankedRows
        : this.db
            .selectFrom(rankedRows.as('limited'))
            .selectAll()
            .where(sql<SqlBool>`${sql.ref('limited.pos')} <= ${params.limit}`);

    const firstOccurrence = this.db
      .selectFrom(limitedRows.as('x'))
      .select([sql.ref('x.val').as('val'), sql`min(${sql.ref('x.pos')})`.as('pos')])
      .where(sql<SqlBool>`${sql.ref('x.val')} is not null`)
      .groupBy(sql.ref('x.val'));

    return sql`(${this.db
      .selectFrom(firstOccurrence.as('q'))
      .select(
        sql`jsonb_agg(to_jsonb(${sql.ref('q.val')}) order by ${sql.ref('q.pos')})`.as('vals')
      )})`;
  }

  private canUseSingleLevelLookupFlatten(foreignField: {
    type: () => FieldType;
  }): foreignField is LookupField {
    if (!foreignField.type().equals(FieldType.lookup())) {
      return false;
    }

    const condition = (foreignField as LookupField).lookupOptions().condition();
    return !condition?.hasFilter();
  }

  /**
   * Lookup fields already persist one flat JSON array per foreign row.
   * When another lookup reads those stored values we only need to flatten the
   * aggregate by one array layer while preserving row order and inner element order.
   */
  private buildSingleLevelLookupFlattenExpr(
    baseAggregate: RawBuilder<unknown>
  ): RawBuilder<unknown> {
    return sql`(
      SELECT jsonb_agg(inner_elem.leaf ORDER BY outer_elem.outer_ord, inner_elem.inner_ord)
      FROM jsonb_array_elements(COALESCE(${baseAggregate}, '[]'::jsonb))
        WITH ORDINALITY AS outer_elem(elem, outer_ord)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(outer_elem.elem) = 'array' THEN outer_elem.elem
          WHEN jsonb_typeof(outer_elem.elem) = 'null' THEN '[]'::jsonb
          ELSE jsonb_build_array(outer_elem.elem)
        END
      ) WITH ORDINALITY AS inner_elem(leaf, inner_ord)
      WHERE jsonb_typeof(inner_elem.leaf) <> 'null'
    )`;
  }

  /**
   * Build lookup aggregation expression.
   *
   * For lookup fields that reference already-JSONB columns (like other lookup fields),
   * we need to handle nested arrays to avoid double-encoding.
   *
   * V1 approach (flattenLookupCteValue):
   * - For JSONB: Cast to jsonb (not to_jsonb) and flatten nested arrays
   * - Uses WITH RECURSIVE to unwrap all nested array levels
   *
   * Example: if B.ValueFromA = [10] and we link to one B record:
   * - With to_jsonb: jsonb_agg(to_jsonb([10])) = ["[10]"] (WRONG - string)
   * - With ::jsonb: jsonb_agg([10]::jsonb) = [[10]] (nested array)
   * - With flatten: [10] (correct - flattened)
   */
  private buildLookupAggExpr(
    foreignTable: Table,
    foreignFieldId: FieldId,
    outputAlias: string,
    options?: {
      tableAlias?: string;
      orderBy?: LinkOrderBy | ResolvedConditionalOrderBy;
      isMultiValue?: boolean;
    }
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    const tableAlias = options?.tableAlias ?? F;
    const orderBy = options?.orderBy;
    const isMultiValue = options?.isMultiValue ?? true;
    if (foreignTable.getField((f) => f.id().equals(foreignFieldId)).isErr()) {
      this.degradeDanglingFieldReference(
        foreignTable,
        foreignFieldId,
        'lookup aggregation source field'
      );
      return ok(sql`NULL::jsonb`.as(outputAlias));
    }
    return resolveTableField(
      foreignTable,
      foreignFieldId,
      'resolving lookup aggregation source field'
    ).andThen((foreignField) =>
      this.getFieldSourceExpr(foreignField, tableAlias).andThen(
        ({ expr: colRef, isJsonbStorage: sourceIsJsonb }) => {
          // Build orderBy expression - handle both LinkOrderBy and simple format
          const orderByExpr = orderBy
            ? 'source' in orderBy
              ? buildLinkOrderByExpr(orderBy)
              : buildResolvedConditionalOrderByExpr(orderBy, tableAlias)
            : null;
          // Include leading space in orderByRef so no trailing space when empty
          const orderByRef = orderByExpr ? sql` order by ${orderByExpr}` : sql``;

          // Check if the foreign field actually stores data as JSONB by checking dbFieldType
          // Don't assume lookup/link fields are always JSONB - they might be TEXT if looking up text values
          const isJsonbStorage =
            sourceIsJsonb ??
            foreignField
              .dbFieldType()
              .map((t) => t.isJson())
              .unwrapOr(false);

          if (isJsonbStorage) {
            const aggExpr = sql`jsonb_agg(${colRef}::jsonb${orderByRef}) FILTER (WHERE ${colRef} IS NOT NULL)`;
            const flattenedExpr = this.canUseSingleLevelLookupFlatten(foreignField)
              ? this.buildSingleLevelLookupFlattenExpr(aggExpr)
              : // For general JSONB columns we still need the recursive flattening path
                // to preserve v1-compatible behavior for deeper nesting.
                sql`(
                    WITH RECURSIVE __flat(e) AS (
                      SELECT ${aggExpr}
                      UNION ALL
                      SELECT jsonb_array_elements(
                        CASE
                          WHEN jsonb_typeof(__flat.e) = 'array' THEN __flat.e
                          ELSE '[]'::jsonb
                        END
                      )
                      FROM __flat
                    )
                    SELECT jsonb_agg(e) FILTER (WHERE jsonb_typeof(e) <> 'array') FROM __flat
                  )`;

            return ok(
              isMultiValue
                ? sql`${flattenedExpr}`.as(outputAlias)
                : sql`${flattenedExpr} -> 0`.as(outputAlias)
            );
          }

          const fieldValueTypeResult = foreignField.accept(new FieldValueTypeVisitor());
          const isDateTimeLookupTarget =
            fieldValueTypeResult.isOk() &&
            fieldValueTypeResult.value.cellValueType.equals(CellValueType.dateTime());

          const lookupValueExpr =
            isMultiValue && isDateTimeLookupTarget
              ? sql`to_jsonb(to_char(${colRef} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`
              : sql`to_jsonb(${colRef})`;
          const aggExpr = sql`jsonb_agg(${lookupValueExpr}${orderByRef}) FILTER (WHERE ${colRef} IS NOT NULL)`;
          return ok(isMultiValue ? aggExpr.as(outputAlias) : sql`${aggExpr} -> 0`.as(outputAlias));
        }
      )
    );
  }

  private buildRollupAggregateExpr(
    foreignTable: Table,
    foreignFieldId: FieldId,
    expression: RollupFunction,
    options?: {
      tableAlias?: string;
      orderBy?: LinkOrderBy | ResolvedConditionalOrderBy;
      filterWhere?: Expression<SqlBool>;
      uniqueScan?: {
        linkField: LinkField;
        foreignTableName: string;
        filterWhere?: Expression<SqlBool>;
        limit?: number;
      };
    }
  ): Result<RawBuilder<unknown>, DomainError> {
    if (foreignTable.getField((f) => f.id().equals(foreignFieldId)).isErr()) {
      this.degradeDanglingFieldReference(
        foreignTable,
        foreignFieldId,
        'rollup aggregation source field'
      );
      return ok(sql`NULL`);
    }
    const tableAlias = options?.tableAlias ?? F;
    const orderByExpr = options?.orderBy
      ? 'source' in options.orderBy
        ? buildLinkOrderByExpr(options.orderBy)
        : buildResolvedConditionalOrderByExpr(options.orderBy, tableAlias)
      : null;
    const orderBySql = orderByExpr ? sql` ORDER BY ${orderByExpr}` : sql``;
    const filterAgg = (agg: RawBuilder<unknown>): RawBuilder<unknown> =>
      options?.filterWhere ? sql`${agg} FILTER (WHERE ${options.filterWhere})` : agg;

    return safeTry<RawBuilder<unknown>, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const foreignField = yield* resolveTableField(
          foreignTable,
          foreignFieldId,
          'resolving rollup aggregation source field'
        );
        const colRef = yield* this.getForeignColRef(foreignTable, foreignFieldId, tableAlias);
        const valueType = yield* foreignField.accept(new FieldValueTypeVisitor());
        const isNumericTarget = valueType.cellValueType.equals(CellValueType.number());
        const isMultipleValue = valueType.isMultipleCellValue.isMultiple();
        const rowPresenceExpr = sql.ref(`${tableAlias}.__id`);

        switch (expression) {
          case 'sum({values})': {
            if (isNumericTarget) {
              if (isMultipleValue) {
                const numericExpr = this.buildJsonNumericSumExpression(colRef);
                return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`SUM(${numericExpr})`)}, 0)`));
              }
              return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`SUM(${colRef})`)}, 0)`));
            }
            return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`SUM(0)`)}, 0)`));
          }
          case 'average({values})': {
            if (isNumericTarget) {
              if (isMultipleValue) {
                const sumExpr = this.buildJsonNumericSumExpression(colRef);
                const countExpr = this.buildJsonNumericCountExpression(colRef);
                const sumAgg = sql`COALESCE(${filterAgg(sql`SUM(${sumExpr})`)}, 0)`;
                const countAgg = sql`COALESCE(${filterAgg(sql`SUM(${countExpr})`)}, 0)`;
                return ok(
                  this.castAgg(
                    sql`CASE WHEN ${countAgg} = 0 THEN 0 ELSE ${sumAgg} / ${countAgg} END`
                  )
                );
              }
              return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`AVG(${colRef})`)}, 0)`));
            }
            return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`AVG(0)`)}, 0)`));
          }
          case 'countall({values})': {
            if (foreignField.type().equals(FieldType.multipleSelect())) {
              return ok(
                this.castAgg(
                  sql`COALESCE(${filterAgg(sql`SUM(CASE WHEN ${colRef} IS NOT NULL THEN jsonb_array_length(${colRef}::jsonb) ELSE 0 END)`)}, 0)`
                )
              );
            }
            return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`COUNT(${rowPresenceExpr})`)}, 0)`));
          }
          case 'counta({values})':
            return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`COUNT(${colRef})`)}, 0)`));
          case 'count({values})':
            // Numeric sources keep duplicate numbers. Scalar non-numeric sources
            // count unique non-empty values so COUNT is not identical to COUNTA.
            if (!isNumericTarget && !isMultipleValue) {
              return ok(
                this.castAgg(sql`COALESCE(${filterAgg(sql`COUNT(DISTINCT ${colRef})`)}, 0)`)
              );
            }
            return ok(this.castAgg(sql`COALESCE(${filterAgg(sql`COUNT(${colRef})`)}, 0)`));
          case 'max({values})': {
            const aggregate = filterAgg(sql`MAX(${colRef})`);
            return ok(
              valueType.cellValueType.equals(CellValueType.dateTime())
                ? aggregate
                : this.castAgg(aggregate)
            );
          }
          case 'min({values})': {
            const aggregate = filterAgg(sql`MIN(${colRef})`);
            return ok(
              valueType.cellValueType.equals(CellValueType.dateTime())
                ? aggregate
                : this.castAgg(aggregate)
            );
          }
          case 'and({values})':
            return ok(filterAgg(sql`BOOL_AND(${colRef}::boolean)`));
          case 'or({values})':
            return ok(filterAgg(sql`BOOL_OR(${colRef}::boolean)`));
          case 'xor({values})':
            return ok(
              sql`(${filterAgg(sql`COUNT(CASE WHEN ${colRef}::boolean THEN 1 END)`)} % 2 = 1)`
            );
          case 'array_join({values})':
          case 'concatenate({values})': {
            if (foreignField.type().equals(FieldType.link())) {
              const rowTextExpr = this.buildPerRowNestedJsonTextExpr(colRef);
              return ok(sql`STRING_AGG(${rowTextExpr}, ', '${orderBySql})`);
            }
            const columnName = yield* foreignField
              .dbFieldName()
              .andThen((dbFieldName) => dbFieldName.value());
            const qualifiedRef = this.buildQualifiedRef(tableAlias, columnName);
            const shouldUseFormatted =
              foreignField.type().equals(FieldType.formula()) ||
              foreignField.type().equals(FieldType.conditionalRollup());
            const formattedSql = shouldUseFormatted
              ? formatFieldValueAsStringSql(foreignField, qualifiedRef, undefined, undefined, {
                  normalizeJsonScalar:
                    foreignField.type().equals(FieldType.formula()) ||
                    foreignField.type().equals(FieldType.conditionalRollup()),
                })
              : undefined;
            return ok(
              sql`STRING_AGG(${formattedSql ? sql.raw(formattedSql) : sql`${colRef}::text`}, ', '${orderBySql})`
            );
          }
          case 'array_unique({values})': {
            const uniqueOrderExpr = orderByExpr ?? sql.ref(`${tableAlias}.__auto_number`);
            if (foreignField.type().equals(FieldType.link())) {
              const baseAggregate = sql`jsonb_agg(to_jsonb(${colRef}) ORDER BY ${uniqueOrderExpr}) FILTER (WHERE ${colRef} IS NOT NULL)`;
              return ok(this.buildDistinctNestedJsonTextArrayExpr(baseAggregate));
            }
            if (isMultipleValue) {
              const baseAggregate = sql`jsonb_agg(${colRef} ORDER BY ${uniqueOrderExpr}) FILTER (WHERE ${colRef} IS NOT NULL)`;
              return ok(this.buildDistinctNestedJsonTextArrayExpr(baseAggregate));
            }
            if (options?.uniqueScan && !options.filterWhere) {
              const scanJoin = yield* this.getJoinCondition(
                options.uniqueScan.linkField,
                options.uniqueScan.foreignTableName,
                UNIQUE_SCAN_ALIAS
              );
              const scanColRef = yield* this.getForeignColRef(
                foreignTable,
                foreignFieldId,
                UNIQUE_SCAN_ALIAS
              );
              const scanOrderExpr = options.orderBy
                ? 'source' in options.orderBy
                  ? buildLinkOrderByExpr(options.orderBy, UNIQUE_SCAN_ALIAS)
                  : buildResolvedConditionalOrderByExpr(options.orderBy, UNIQUE_SCAN_ALIAS)
                : sql.ref(`${UNIQUE_SCAN_ALIAS}.__auto_number`);
              return ok(
                this.buildFirstOccurrenceUniqueScanExpr({
                  colRef: scanColRef,
                  uniqueOrderExpr: scanOrderExpr ?? sql.ref(`${UNIQUE_SCAN_ALIAS}.__auto_number`),
                  foreignTableName: options.uniqueScan.foreignTableName,
                  joinCondition: scanJoin,
                  filterWhere: options.uniqueScan.filterWhere,
                  limit: options.uniqueScan.limit,
                })
              );
            }
            return ok(
              this.buildFirstOccurrenceUniqueJsonbArrayExpr(
                sql`jsonb_agg(to_jsonb(${colRef}) ORDER BY ${uniqueOrderExpr}) FILTER (WHERE ${colRef} IS NOT NULL)`
              )
            );
          }
          case 'array_compact({values})': {
            const baseAggregate = orderByExpr
              ? sql`jsonb_agg(${colRef} ORDER BY ${orderByExpr}) FILTER (WHERE (${colRef}) IS NOT NULL AND (${colRef})::text <> '')`
              : sql`jsonb_agg(${colRef}) FILTER (WHERE (${colRef}) IS NOT NULL AND (${colRef})::text <> '')`;
            if (isMultipleValue) {
              return ok(sql`(
              WITH RECURSIVE flattened(val) AS (
                SELECT COALESCE(${baseAggregate}, '[]'::jsonb)
                UNION ALL
                SELECT elem
                FROM flattened
                CROSS JOIN LATERAL jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(flattened.val) = 'array' THEN flattened.val
                    ELSE '[]'::jsonb
                  END
                ) AS elem
              )
              SELECT jsonb_agg(val) FILTER (
                WHERE jsonb_typeof(val) <> 'array'
                  AND jsonb_typeof(val) <> 'null'
                  AND val <> '""'::jsonb
              ) FROM flattened
            )`);
            }
            return ok(baseAggregate);
          }
          default:
            return ok(sql`ARRAY_AGG(${colRef})`);
        }
      }.bind(this)
    );
  }

  private sanitizeNumericTextExpression(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    const normalized = sql`NULLIF(REGEXP_REPLACE(BTRIM((${expr})::text), '[,\\s]', '', 'g'), '')`;
    const isValidNumeric = sql.raw(
      this.typeValidationStrategy.isValidForType('(__num_prefix)::text', 'numeric')
    );

    return sql`(
      WITH __num_src AS (
        SELECT ${normalized} AS normalized
      ),
      __num_ext AS (
        SELECT
          normalized,
          SUBSTRING(normalized FROM '^([+-]?[0-9]+[.]?[0-9]*|[+-]?[0-9]*[.][0-9]+)') AS __num_prefix,
          normalized ~ '^([+-]?[0-9]+[.]?[0-9]*|[+-]?[0-9]*[.][0-9]+)[eE][+-]?[0-9]+' AS has_exponent
        FROM __num_src
      )
      SELECT CASE
        WHEN normalized IS NULL THEN NULL
        WHEN __num_prefix IS NOT NULL AND NOT has_exponent AND ${isValidNumeric} THEN (__num_prefix)::double precision
        ELSE NULL
      END
      FROM __num_ext
    )`;
  }

  private buildJsonNumericSumExpression(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    const scalarValue = this.sanitizeNumericTextExpression(expr);
    const safeArrayExpr = sql`(CASE
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN ${expr}::jsonb
      ELSE '[]'::jsonb
    END)`;
    const arraySum = sql`(
      SELECT SUM(${this.sanitizeNumericTextExpression(sql`elem.value`)})
      FROM jsonb_array_elements_text(${safeArrayExpr}) AS elem(value)
    )`;
    return sql`(CASE
      WHEN ${expr} IS NULL THEN 0
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN COALESCE(${arraySum}, 0)
      ELSE COALESCE(${scalarValue}, 0)
    END)`;
  }

  private buildJsonNumericCountExpression(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    const scalarValue = this.sanitizeNumericTextExpression(expr);
    const scalarCount = sql`(CASE WHEN ${scalarValue} IS NULL THEN 0 ELSE 1 END)`;
    const safeArrayExpr = sql`(CASE
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN ${expr}::jsonb
      ELSE '[]'::jsonb
    END)`;
    const elementCount = sql`(
      SELECT SUM(CASE WHEN ${this.sanitizeNumericTextExpression(sql`elem.value`)} IS NULL THEN 0 ELSE 1 END)
      FROM jsonb_array_elements_text(${safeArrayExpr}) AS elem(value)
    )`;
    return sql`(CASE
      WHEN ${expr} IS NULL THEN 0
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN COALESCE(${elementCount}, 0)
      ELSE ${scalarCount}
    END)`;
  }

  private castAgg(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    return sql`CAST(${expr} AS DOUBLE PRECISION)`;
  }

  /**
   * Build join condition based on relationship type.
   *
   * FK config meanings from LinkFieldConfig.buildDbConfig:
   * - manyOne/oneOne: selfKeyName='__id', foreignKeyName='__fk_{fieldId}' (FK in current table)
   *   → join: f.__id = t.{foreignKeyName}
   * - oneMany: selfKeyName='__fk_{symmetricFieldId}', foreignKeyName='__id' (FK in foreign table)
   *   → join: f.{selfKeyName} = t.__id
   * - manyMany: both keys point to junction table columns
   *   → join via junction table
   */
  private getJoinCondition(
    linkField: LinkField,
    _foreignTableName: string,
    foreignAlias: string = F
  ): Result<Expression<SqlBool>, DomainError> {
    const relationship = linkField.relationship();
    const isOneWay = linkField.isOneWay();
    const selfKeyNameResult = linkField.selfKeyName().value();
    const foreignKeyNameResult = linkField.foreignKeyName().value();

    // manyOne/oneOne: current table has FK pointing to foreign table's __id
    // selfKeyName='__id', foreignKeyName='__fk_{fieldId}'
    // join: f.__id = t.{foreignKeyName}
    if (
      relationship.equals(LinkRelationship.manyOne()) ||
      relationship.equals(LinkRelationship.oneOne())
    ) {
      if (foreignKeyNameResult.isOk() && foreignKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${foreignAlias}.__id`)} = ${sql.ref(`${T}.${foreignKeyNameResult.value}`)}`
        );
      }
      // Fallback for symmetric oneOne where foreign table holds FK
      if (selfKeyNameResult.isOk() && selfKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${foreignAlias}.${selfKeyNameResult.value}`)} = ${sql.ref(`${T}.__id`)}`
        );
      }
    }

    // oneMany: foreign table has FK pointing to this table's __id
    // selfKeyName='__fk_{symmetricFieldId}', foreignKeyName='__id'
    // join: f.{selfKeyName} = t.__id
    if (relationship.equals(LinkRelationship.oneMany()) && !isOneWay) {
      if (selfKeyNameResult.isOk() && selfKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${foreignAlias}.${selfKeyNameResult.value}`)} = ${sql.ref(`${T}.__id`)}`
        );
      }
      // Fallback
      if (foreignKeyNameResult.isOk() && foreignKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${foreignAlias}.__id`)} = ${sql.ref(`${T}.${foreignKeyNameResult.value}`)}`
        );
      }
    }

    // manyMany: use junction table
    // SELECT ... FROM foreign_table f
    // WHERE f.__id IN (SELECT j.foreignKeyName FROM junction_table j WHERE j.selfKeyName = t.__id)
    if (
      relationship.equals(LinkRelationship.manyMany()) ||
      (relationship.equals(LinkRelationship.oneMany()) && isOneWay)
    ) {
      const fkHostTableNameResult = linkField.fkHostTableName().value();
      if (fkHostTableNameResult.isOk() && selfKeyNameResult.isOk() && foreignKeyNameResult.isOk()) {
        const junctionTable = fkHostTableNameResult.value;
        const selfKey = selfKeyNameResult.value;
        const foreignKey = foreignKeyNameResult.value;

        // f.__id IN (SELECT j.foreignKey FROM junction j WHERE j.selfKey = t.__id)
        return ok(
          sql<SqlBool>`${sql.ref(`${foreignAlias}.__id`)} IN (SELECT ${sql.ref(`j.${foreignKey}`)} FROM ${sql.table(junctionTable)} AS j WHERE ${sql.ref(`j.${selfKey}`)} = ${sql.ref(`${T}.__id`)})`
        );
      }
    }

    return err(
      domainError.validation({
        message: `Cannot build join condition for link field: missing FK configuration`,
      })
    );
  }

  /**
   * Resolve orderBy column to actual database column name.
   * If FieldId, look up the field's dbFieldName.
   * If system column string, use as-is.
   */
  private resolveOrderByColumn(
    table: Table,
    orderByColumn: OrderByColumn
  ): Result<ResolvedOrderByColumn | null, DomainError> {
    // If it's a FieldId, resolve to dbFieldName
    if (orderByColumn instanceof FieldId) {
      return resolveTableField(table, orderByColumn as FieldId, 'resolving order-by field').andThen(
        (field) => {
          const fieldType = field.type();
          const isUserLike =
            fieldType.equals(FieldType.user()) ||
            fieldType.equals(FieldType.link()) ||
            fieldType.equals(FieldType.createdBy()) ||
            fieldType.equals(FieldType.lastModifiedBy());
          const resolveDateLikeOrderBy = (column: string) => {
            const expression = buildDateLikeOrderExpression(field, T, column);
            return ok(expression ? { column, expression } : { column });
          };

          if (fieldType.equals(FieldType.createdTime())) {
            return resolveDateLikeOrderBy('__created_time');
          }
          const isTrackAll =
            'isTrackAll' in field && typeof field.isTrackAll === 'function'
              ? field.isTrackAll() === true
              : true;
          if (fieldType.equals(FieldType.lastModifiedTime())) {
            if (isTrackAll) {
              return resolveDateLikeOrderBy('__last_modified_time');
            }
            return field
              .dbFieldName()
              .andThen((dbFieldName) => dbFieldName.value())
              .andThen((column) => resolveDateLikeOrderBy(column));
          }
          if (fieldType.equals(FieldType.createdBy())) {
            return ok({
              column: '__created_by',
              userLikeMode: 'single',
              userLikeSource: 'system',
            });
          }
          if (fieldType.equals(FieldType.lastModifiedBy()) && isTrackAll) {
            return ok({
              column: '__last_modified_by',
              userLikeMode: 'single',
              userLikeSource: 'system',
            });
          }
          if (fieldType.equals(FieldType.autoNumber())) return ok({ column: '__auto_number' });
          const multiplicityResult = isUserLike ? field.isMultipleCellValue() : undefined;
          if (multiplicityResult?.isErr()) {
            return err(multiplicityResult.error);
          }
          const multiplicity = multiplicityResult?.isOk() ? multiplicityResult.value : undefined;
          return field.dbFieldName().andThen((dbFieldName) =>
            dbFieldName.value().map((column) => ({
              column,
              expression: buildDateLikeOrderExpression(field, T, column) ?? undefined,
              ...(isUserLike
                ? {
                    userLikeMode: (multiplicity?.isMultiple() ? 'multiple' : 'single') as Exclude<
                      ResolvedOrderBy['userLikeMode'],
                      undefined
                    >,
                    userLikeSource: 'field' as const,
                  }
                : {}),
            }))
          );
        }
      );
    }

    // System column - use as-is
    return ok({ column: orderByColumn });
  }

  private applyUserLikeOrderBy(
    query: QB,
    column: string,
    direction: 'asc' | 'desc',
    mode: 'single' | 'multiple',
    source: 'field' | 'system'
  ): QB {
    const columnRef = sql.ref(`${T}.${column}`);
    const columnJson = source === 'field' ? sql`${columnRef}::jsonb` : sql`to_jsonb(${columnRef})`;
    const arrayLikeColumnJson =
      source === 'field'
        ? sql`CASE
            WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
            WHEN jsonb_typeof(${columnJson}) = 'object' THEN jsonb_build_array(${columnJson})
            ELSE '[]'::jsonb
          END`
        : sql`CASE
            WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
            ELSE '[]'::jsonb
          END`;
    const titleExpr =
      mode === 'multiple'
        ? sql`jsonb_path_query_array(${arrayLikeColumnJson}, '$[*].title')::text`
        : source === 'field'
          ? sql`${columnJson} ->> 'title'`
          : sql`coalesce(${columnJson} ->> 'title', ${columnJson} ->> 'name', ${columnJson} #>> '{}')`;

    return query.orderBy(titleExpr, applyV1NullsOrder(direction));
  }
}

const buildResolvedConditionalOrderByExpr = (
  orderBy: ResolvedConditionalOrderBy,
  tableAlias = F
): RawBuilder<unknown> => {
  if (
    orderBy.column === '__auto_number' &&
    (!orderBy.tieBreaker || orderBy.tieBreaker.source === 'foreign')
  ) {
    return sql`${sql.ref(`${tableAlias}.${orderBy.column}`)} ${sql.raw(orderBy.direction)}`;
  }
  const tieBreaker = buildStableTieBreakerExpr(orderBy.tieBreaker, tableAlias);
  return sql`${sql.ref(`${tableAlias}.${orderBy.column}`)} ${sql.raw(
    orderBy.direction
  )}, ${tieBreaker} asc`;
};

const buildStableTieBreakerExpr = (orderBy?: LinkOrderBy, tableAlias = F): RawBuilder<unknown> => {
  if (!orderBy || orderBy.source === 'foreign') {
    return sql.ref(`${tableAlias}.__auto_number`);
  }

  return sql`(SELECT ${sql.ref(`j.__id`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${tableAlias}.__id`)})`;
};

const buildLinkOrderByExpr = (
  orderBy?: LinkOrderBy,
  tableAlias = F
): RawBuilder<unknown> | null => {
  if (!orderBy) return null;

  if (orderBy.source === 'foreign') {
    // If explicit order column exists, use it with __auto_number as tie-breaker
    if (orderBy.column) {
      return sql`${sql.ref(`${tableAlias}.${orderBy.column}`)}, ${sql.ref(`${tableAlias}.__auto_number`)}`;
    }
    // No explicit order column - use __auto_number to maintain insertion/creation order
    // Foreign tables (regular data tables) have __auto_number column that reflects creation order
    // This is critical for tests that expect stable ordering based on record creation time
    return sql`${sql.ref(`${tableAlias}.__auto_number`)}`;
  }

  // Junction-based ordering (ManyMany, OneMany one-way)
  if (orderBy.column) {
    // Explicit order column exists - use it with junction __id as tie-breaker
    // This ensures stable ordering when multiple records have the same order value
    return sql`(SELECT ${sql.ref(`j.${orderBy.column}`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${tableAlias}.__id`)}), (SELECT ${sql.ref(`j.__id`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${tableAlias}.__id`)})`;
  }

  // No explicit order column - use junction table's __id to maintain insertion order
  // Junction tables only have __id (serial), not __auto_number
  // This is critical for tests that expect stable ordering based on link creation order
  return sql`(SELECT ${sql.ref(`j.__id`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${tableAlias}.__id`)})`;
};
