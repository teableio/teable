// oxlint-disable sonarjs/cognitive-complexity -- projection, storage and hop branches each encode a contract
import {
  buildRecordConditionSpec,
  buildRecordConditionValue,
  DbTableName,
  FieldValueTypeVisitor,
  getValidRecordAggregationFunctions,
  isRecordFilterDateValue,
  isRecordFilterFieldReferenceValue,
  RecordConditionDateValue,
  recordFilterSchema,
  resolveFieldConditionSpecInput,
  ConditionalLookupField,
  type DomainError,
  type Field,
  type ITableReadModel,
  type LinkField,
  LookupField,
  type RecordFilter,
  type RecordFilterNode,
  type RecordFilterOperator,
  type RecordFilterValue,
  RollupField,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

import type { DataQueryDefinition } from './DataQueryDefinition';
import {
  freezeQueryValue,
  mapQueryFilter,
  queryError,
  representativeParameterValue,
  resolveDataQueryFilter,
} from './DataQueryDefinition';
import type {
  DataQueryAggregate,
  DataQueryBucket,
  DataQueryDefinitionInput,
  DataQueryFieldDependency,
  DataQueryFieldUsage,
  DataQueryFilter,
  DataQueryOutput,
  DataQueryRelationAggregate,
} from './types';

const describeField = (
  table: ITableReadModel,
  field: Field,
  usages: ReadonlyArray<DataQueryFieldUsage>
): Result<DataQueryFieldDependency, DomainError> =>
  safeTry(function* () {
    if (field.hasError().toBoolean())
      return err(queryError('field_error', 'A required field has an unresolved schema error'));
    if (field instanceof LookupField || field instanceof RollupField) {
      const link = yield* table
        .getField((candidate) => candidate.id().equals(field.linkFieldId()))
        .mapErr(() =>
          queryError('field_semantics', 'A required lookup relationship is unavailable')
        );
      if (
        link.type().toString() !== 'link' ||
        link.hasError().toBoolean() ||
        !(link as LinkField).foreignTableId().equals(field.foreignTableId())
      ) {
        return err(queryError('field_semantics', 'A required lookup relationship is unavailable'));
      }
    }
    // Foreign inner fields are already hydrated in their own host table by the
    // domain. Inspect their errors, never resolve their link IDs in this table.
    let inner = field;
    while (inner instanceof LookupField || inner instanceof ConditionalLookupField) {
      inner = yield* inner
        .innerField()
        .mapErr(() =>
          queryError('field_semantics', 'Cannot resolve a required field semantic contract')
        );
      if (inner.hasError().toBoolean()) {
        return err(
          queryError('field_error', 'A required foreign field has an unresolved schema error')
        );
      }
    }
    const valueType = yield* field
      .accept(new FieldValueTypeVisitor())
      .mapErr(() => queryError('field_type', 'Cannot resolve a required field value type'));
    return ok({
      fieldId: field.id().toString(),
      usages: [...usages],
      fieldType: field.type().toString(),
      cellValueType: valueType.cellValueType.toString(),
      isMultipleCellValue: valueType.isMultipleCellValue.toBoolean(),
    });
  });

const validateLiteralFilterValue = (
  value: RecordFilterValue,
  operator: RecordFilterOperator,
  cellType: string
): Result<void, DomainError> => {
  if (isRecordFilterDateValue(value)) {
    if (value.mode === 'dateRange' && operator === 'isNot') {
      return err(
        queryError('filter_operator', 'Negate an is or isWithIn predicate to exclude a date range')
      );
    }
    return cellType === 'dateTime' && RecordConditionDateValue.create(value).isOk()
      ? ok(undefined)
      : err(queryError('filter_value_type', 'Filter date value is incompatible with its field'));
  }
  const values = Array.isArray(value) ? value : [value];
  if (
    values.some(
      (item) => typeof item !== cellType || (typeof item === 'number' && !Number.isFinite(item))
    )
  ) {
    return err(queryError('filter_value_type', 'Filter literal has an incompatible value type'));
  }
  return ok(undefined);
};

/**
 * Locate the first filter leaf the record-condition builder rejects for its field/operator pair.
 * Acceptance is delegated to core's normalizer, so checkbox null folding and stale user-operator
 * adaptation apply exactly as they do during condition spec creation.
 * Returns undefined when every leaf is locatable, so a residual rejection (value shape,
 * cross-table reference, …) still falls back to the generic incompatibility error.
 */
const locateFilterLeafError = (
  table: ITableReadModel,
  node: RecordFilterNode
): DomainError | undefined => {
  if ('items' in node) {
    for (const child of node.items) {
      const located = locateFilterLeafError(table, child);
      if (located) return located;
    }
    return undefined;
  }
  if ('not' in node) return locateFilterLeafError(table, node.not);

  const fieldResult = table.getField((candidate) => candidate.id().toString() === node.fieldId);
  if (fieldResult.isErr()) return queryError('field_missing', 'A required filter field is missing');
  const field = fieldResult.value;
  const valueType = field.accept(new FieldValueTypeVisitor());
  if (valueType.isErr()) return queryError('field_type', 'Cannot resolve filter field type');

  // A leaf whose value cannot be built is rejected for its value, not its operator; keep
  // scanning so a sibling with an actually unsupported operator is still reported.
  const conditionValue = buildRecordConditionValue(table, node.value);
  if (conditionValue.isErr()) return undefined;

  const resolution = resolveFieldConditionSpecInput(field, {
    operator: node.operator,
    value: conditionValue.value,
  });
  if (resolution.isErr() || resolution.value.accepted) return undefined;

  const fieldType = field.type().toString();
  const { operator, supportedOperators } = resolution.value;
  return queryError(
    'filter_operator_unsupported',
    `Filter operator "${operator}" is not supported for field ${node.fieldId} (${fieldType}); supported operators: ${supportedOperators.join(', ')}`,
    { fieldId: node.fieldId, fieldType, operator, supportedOperators }
  );
};

/** Strict, non-sanitizing validation, shared by preparation and the executor's actual bound values. */
export const validateDataQueryFilter = (
  table: ITableReadModel,
  filter: RecordFilter | undefined
): Result<void, DomainError> => {
  if (filter === undefined) return ok(undefined);
  if (filter === null || !recordFilterSchema.safeParse(filter).success)
    return err(queryError('invalid_filter', 'Invalid query filter'));
  const spec = buildRecordConditionSpec(table, filter);
  if (spec.isErr()) {
    const located = locateFilterLeafError(table, filter);
    if (located) return err(located);
    return err(
      queryError('filter_incompatible', 'Query filter is incompatible with the current schema')
    );
  }
  const validateNode = (node: RecordFilterNode): Result<void, DomainError> =>
    safeTry(function* () {
      if ('items' in node) {
        for (const child of node.items) yield* validateNode(child);
        return ok(undefined);
      }
      if ('not' in node) return validateNode(node.not);
      const field = yield* table
        .getField((candidate) => candidate.id().toString() === node.fieldId)
        .mapErr(() => queryError('field_missing', 'A required filter field is missing'));
      const type = yield* field
        .accept(new FieldValueTypeVisitor())
        .mapErr(() => queryError('field_type', 'Cannot resolve filter field type'));
      if (node.value === null) return ok(undefined); // Core spec already enforces unary/checkbox null semantics.
      if (isRecordFilterFieldReferenceValue(node.value)) {
        const referenceId = node.value.fieldId;
        const reference = yield* table
          .getField((candidate) => candidate.id().toString() === referenceId)
          .mapErr(() => queryError('field_missing', 'A referenced filter field is missing'));
        const referenceType = yield* reference
          .accept(new FieldValueTypeVisitor())
          .mapErr(() => queryError('field_type', 'Cannot resolve referenced filter field type'));
        if (
          !type.cellValueType.equals(referenceType.cellValueType) ||
          !type.isMultipleCellValue.equals(referenceType.isMultipleCellValue)
        )
          return err(
            queryError('filter_value_type', 'Filter field reference has an incompatible value type')
          );
        return ok(undefined);
      }
      return validateLiteralFilterValue(node.value, node.operator, type.cellValueType.toString());
    });
  return validateNode(filter);
};

type AddFieldUsage = (fieldId: string, usage: DataQueryFieldUsage) => void;

const collectFilterUsages = (node: RecordFilterNode, add: AddFieldUsage): void => {
  if ('items' in node) {
    node.items.forEach((child) => collectFilterUsages(child, add));
    return;
  }
  if ('not' in node) {
    collectFilterUsages(node.not, add);
    return;
  }
  add(node.fieldId, 'filter');
  if (isRecordFilterFieldReferenceValue(node.value)) add(node.value.fieldId, 'reference');
};

const queryFieldUsages = (
  snapshot: DataQueryDefinitionInput
): Map<string, DataQueryFieldUsage[]> => {
  const usages = new Map<string, DataQueryFieldUsage[]>();
  const add: AddFieldUsage = (fieldId, usage) => {
    const fieldUsages = usages.get(fieldId) ?? [];
    if (!fieldUsages.includes(usage)) fieldUsages.push(usage);
    usages.set(fieldId, fieldUsages);
  };
  if (snapshot.kind === 'records') {
    snapshot.select.forEach((projection) => {
      if ('statisticFunc' in projection) {
        if (projection.fieldId !== undefined) add(projection.fieldId, 'aggregate');
        return;
      }
      if ('fieldId' in projection) add(projection.fieldId, 'projection');
    });
  } else {
    for (const group of snapshot.groupBy ?? []) add(group.fieldId, 'group');
    for (const aggregate of snapshot.aggregates) add(aggregate.fieldId, 'aggregate');
  }
  snapshot.sort?.forEach((sort) => {
    if ('fieldId' in sort && !('source' in sort)) add(sort.fieldId, 'sort');
    // Every allow-listed target must exist and be readable, even when the runtime
    // parameter selects only one of them: the choice is not a permission boundary.
    if ('field' in sort) {
      for (const target of sort.allowed) {
        if ('fieldId' in target && !('source' in target)) add(target.fieldId, 'sort');
      }
    }
  });
  if (snapshot.filter) {
    collectFilterUsages(
      mapQueryFilter(snapshot.filter, (reference) =>
        representativeParameterValue(snapshot.parameters![reference.name])
      ),
      add
    );
  }
  return usages;
};

type ParameterValueMaps = {
  readonly representative: ReadonlyMap<string, RecordFilterValue>;
  readonly defaults: ReadonlyMap<string, RecordFilterValue>;
};

const parameterValueMaps = (
  parameters: DataQueryDefinitionInput['parameters']
): ParameterValueMaps => {
  const representative = new Map<string, RecordFilterValue>();
  const defaults = new Map<string, RecordFilterValue>();
  for (const [name, parameter] of Object.entries(parameters ?? {})) {
    const sample = representativeParameterValue(parameter);
    representative.set(name, sample);
    defaults.set(name, Object.hasOwn(parameter, 'default') ? parameter.default! : sample);
  }
  return { representative, defaults };
};

const validateFilterAgainstTable = (
  filter: DataQueryFilter | undefined,
  table: ITableReadModel,
  values: ParameterValueMaps
): Result<void, DomainError> =>
  safeTry(function* () {
    if (!filter) return ok(undefined);
    const representativeFilter = yield* resolveDataQueryFilter(filter, values.representative);
    const defaultFilter = yield* resolveDataQueryFilter(filter, values.defaults);
    yield* validateDataQueryFilter(table, representativeFilter);
    yield* validateDataQueryFilter(table, defaultFilter);
    return ok(undefined);
  });

const validateDefinitionFilters = (
  snapshot: DataQueryDefinitionInput,
  table: ITableReadModel
): Result<void, DomainError> =>
  validateFilterAgainstTable(snapshot.filter, table, parameterValueMaps(snapshot.parameters));

const aggregateOutput = (
  aggregate: DataQueryAggregate,
  field: Field
): Result<DataQueryOutput, DomainError> => {
  return getValidRecordAggregationFunctions(field)
    .mapErr(() => queryError('aggregate_type', 'Cannot resolve aggregate field type'))
    .andThen((valid) => {
      if (!valid.has(aggregate.statisticFunc)) {
        return err(
          queryError(
            'aggregate_incompatible',
            'Aggregation function is incompatible with its field'
          )
        );
      }
      const dateOutput =
        aggregate.statisticFunc === 'earliestDate' || aggregate.statisticFunc === 'latestDate';
      const nullableFunctions: Partial<Record<DataQueryAggregate['statisticFunc'], true>> = {
        min: true,
        max: true,
        sum: true,
        average: true,
        checked: true,
        unChecked: true,
        percentChecked: true,
        percentUnChecked: true,
        totalAttachmentSize: true,
        earliestDate: true,
        latestDate: true,
        dateRangeOfDays: true,
        dateRangeOfMonths: true,
      };
      return ok<DataQueryOutput, DomainError>({
        alias: aggregate.alias,
        wireType: dateOutput ? 'string' : 'numberOrString',
        cellValueType: dateOutput ? 'dateTime' : 'number',
        isMultipleCellValue: false,
        nullable: nullableFunctions[aggregate.statisticFunc] === true,
      });
    });
};

// Semantic string fields such as users/links/attachments actually store JSON objects.
// Computed and lookup storage can also carry composite values; do not promise a scalar.
const storedFieldWireTypes: Readonly<Partial<Record<string, DataQueryOutput['wireType']>>> = {
  singleLineText: 'string',
  longText: 'string',
  singleSelect: 'string',
  multipleSelect: 'string',
  date: 'string',
  createdTime: 'string',
  lastModifiedTime: 'string',
  number: 'numberOrString',
  rating: 'numberOrString',
  autoNumber: 'numberOrString',
  checkbox: 'boolean',
};

const bucketOutputType = (alias: string, bucket: DataQueryBucket): DataQueryOutput =>
  bucket.kind === 'dateTrunc'
    ? {
        alias,
        wireType: 'string',
        cellValueType: 'string',
        isMultipleCellValue: false,
        nullable: true,
      }
    : {
        alias,
        wireType: 'string',
        cellValueType: 'string',
        isMultipleCellValue: false,
        nullable: bucket.nullLabel === undefined,
      };

const validateBucketField = (
  bucket: DataQueryBucket,
  dependency: DataQueryFieldDependency,
  details: Readonly<Record<string, unknown>>
): Result<void, DomainError> => {
  const expected = bucket.kind === 'numericRange' ? 'number' : 'dateTime';
  return !dependency.isMultipleCellValue && dependency.cellValueType === expected
    ? ok(undefined)
    : err(
        queryError(
          'bucket_field',
          `A ${bucket.kind} bucket requires a single-value ${expected} field`,
          details
        )
      );
};

// oxlint-disable-next-line sonarjs/cognitive-complexity -- output types enumerate every projection shape
// eslint-disable-next-line sonarjs/cognitive-complexity -- output types enumerate every projection shape
const describeOutputs = (
  snapshot: DataQueryDefinitionInput,
  fields: ReadonlyMap<string, Field>,
  dependencies: ReadonlyMap<string, DataQueryFieldDependency>
): Result<DataQueryOutput[], DomainError> =>
  safeTry(function* () {
    const outputs: DataQueryOutput[] = [];
    const projectionOutput = (
      fieldId: string,
      alias: string,
      bucket?: DataQueryBucket
    ): Result<DataQueryOutput, DomainError> => {
      const dependency = dependencies.get(fieldId)!;
      if (bucket === undefined) {
        return ok({
          alias,
          wireType: storedFieldWireTypes[dependency.fieldType] ?? 'unknown',
          cellValueType: dependency.cellValueType,
          isMultipleCellValue: dependency.isMultipleCellValue,
          nullable: true,
        });
      }
      const validated = validateBucketField(bucket, dependency, { fieldId });
      return validated.map(() => bucketOutputType(alias, bucket));
    };
    if (snapshot.kind === 'records') {
      for (const projection of snapshot.select) {
        // A relation aggregate always implies a version 2 relation query and is
        // bound by DataQueryRelationBinding, never by this single-table path.
        if ('statisticFunc' in projection) {
          return err(
            queryError('join_version', 'Relation aggregates require a version 2 relation binding')
          );
        }
        if ('fieldId' in projection) {
          outputs.push(
            yield* projectionOutput(
              projection.fieldId,
              projection.alias,
              'bucket' in projection ? projection.bucket : undefined
            )
          );
        } else {
          const cellValueTypes = {
            id: 'string',
            createdTime: 'dateTime',
            lastModifiedTime: 'dateTime',
            autoNumber: 'number',
            version: 'number',
          };
          outputs.push({
            alias: projection.alias,
            wireType:
              projection.system === 'autoNumber' || projection.system === 'version'
                ? 'numberOrString'
                : 'string',
            cellValueType: cellValueTypes[projection.system],
            isMultipleCellValue: false,
            nullable: projection.system === 'lastModifiedTime',
          });
        }
      }
      return ok(outputs);
    }
    for (const group of snapshot.groupBy ?? []) {
      outputs.push(
        yield* projectionOutput(
          group.fieldId,
          group.alias,
          'bucket' in group ? group.bucket : undefined
        )
      );
    }
    for (const aggregate of snapshot.aggregates)
      outputs.push(yield* aggregateOutput(aggregate, fields.get(aggregate.fieldId)!));
    return ok(outputs);
  });

export type DataQueryBindingPrepareOptions = {
  /**
   * Defer a located unsupported-operator rejection until the caller has authorized the table.
   * A denied caller must not learn a field's type or operator matrix.
   */
  readonly deferOperatorRejection?: boolean;
};

export type DataQueryRelationCardinality = 'one' | 'many';

export type DataQueryRelationLinkStorage =
  | { readonly kind: 'root-fk'; readonly column: string }
  | { readonly kind: 'target-fk'; readonly column: string }
  /** A two-way one-many link keeps its foreign key on the target table. */
  | { readonly kind: 'target-fk-many'; readonly column: string }
  /** A many-many or one-way one-many link stores its edges in a junction table. */
  | {
      readonly kind: 'junction';
      readonly schema: string | null;
      readonly tableName: string;
      readonly selfKeyName: string;
      readonly foreignKeyName: string;
    };

export type DataQueryRelationSourceBinding = {
  readonly alias: string;
  readonly table: ITableReadModel;
  readonly linkFieldId: string;
  /** Source whose row key this hop joins against: `root` or an earlier alias. */
  readonly parentAlias: string;
  readonly cardinality: DataQueryRelationCardinality;
  readonly linkStorage: DataQueryRelationLinkStorage;
  readonly dependencies: ReadonlyArray<DataQueryFieldDependency>;
};

const projectionSource = (projection: object): string | undefined =>
  'source' in projection && typeof projection.source === 'string' ? projection.source : undefined;

const isRootProjection = (projection: object): boolean => {
  const source = projectionSource(projection);
  return source === undefined || source === 'root';
};

type PhysicalName = { schema: string | null; tableName: string };

const samePhysical = (left: PhysicalName, right: PhysicalName): boolean =>
  left.schema === right.schema && left.tableName === right.tableName;

/**
 * Derive the physical relation from persisted Link metadata. The caller supplies
 * only field/table IDs; FK host, key names and junction placement always come
 * from the domain object, never from the query definition.
 */

// oxlint-disable-next-line sonarjs/cognitive-complexity -- one branch per Link storage contract
// eslint-disable-next-line sonarjs/cognitive-complexity -- one branch per Link storage contract
const deriveRelationStorage = (params: {
  alias: string;
  relationship: string;
  isOneWay: boolean;
  fkHost: PhysicalName;
  selfKeyName: string;
  foreignKeyName: string;
  parentPhysical: PhysicalName;
  targetPhysical: PhysicalName;
}): Result<
  { cardinality: DataQueryRelationCardinality; storage: DataQueryRelationLinkStorage },
  DomainError
> => {
  const {
    alias,
    relationship,
    isOneWay,
    fkHost,
    selfKeyName,
    foreignKeyName,
    parentPhysical,
    targetPhysical,
  } = params;
  const hosted = samePhysical(fkHost, parentPhysical);
  const inverse = samePhysical(fkHost, targetPhysical);
  const junction = !hosted && !inverse;
  // Keep the historical terminal code: a link whose metadata contradicts the
  // declared relationship is a relationship error, not an input-shape error.
  const fail = (message: string) =>
    err(queryError('join_relationship', message, { source: alias }));
  if (relationship === 'manyOne') {
    if (!hosted || selfKeyName !== '__id' || foreignKeyName === '__id') {
      return fail('A many-one link must keep its foreign key on the parent table');
    }
    return ok({ cardinality: 'one', storage: { kind: 'root-fk', column: foreignKeyName } });
  }
  if (relationship === 'oneOne') {
    if (hosted && selfKeyName === '__id' && foreignKeyName !== '__id') {
      return ok({ cardinality: 'one', storage: { kind: 'root-fk', column: foreignKeyName } });
    }
    if (inverse && foreignKeyName === '__id' && selfKeyName !== '__id') {
      return ok({ cardinality: 'one', storage: { kind: 'target-fk', column: selfKeyName } });
    }
    return fail('A one-one link must keep its foreign key on one of the two record tables');
  }
  if (relationship === 'oneMany') {
    if (!isOneWay && inverse && foreignKeyName === '__id' && selfKeyName !== '__id') {
      return ok({
        cardinality: 'many',
        storage: { kind: 'target-fk-many', column: selfKeyName },
      });
    }
    if (isOneWay && junction && selfKeyName !== '__id' && foreignKeyName !== '__id') {
      return ok({
        cardinality: 'many',
        storage: {
          kind: 'junction',
          schema: fkHost.schema,
          tableName: fkHost.tableName,
          selfKeyName,
          foreignKeyName,
        },
      });
    }
    return fail(
      isOneWay
        ? 'A one-way one-many link must keep its edges in a junction table'
        : 'A two-way one-many link must keep its foreign key on the target table'
    );
  }
  if (relationship === 'manyMany') {
    if (junction && selfKeyName !== '__id' && foreignKeyName !== '__id') {
      return ok({
        cardinality: 'many',
        storage: {
          kind: 'junction',
          schema: fkHost.schema,
          tableName: fkHost.tableName,
          selfKeyName,
          foreignKeyName,
        },
      });
    }
    return fail('A many-many link must keep its edges in a junction table');
  }
  return err(queryError('join_relationship', 'Unsupported link relationship', { source: alias }));
};

const relationAggregateOutput = (
  aggregate: DataQueryRelationAggregate,
  dependency: DataQueryFieldDependency | undefined,
  source: string
): Result<DataQueryOutput, DomainError> => {
  const base = { alias: aggregate.alias, isMultipleCellValue: false } as const;
  if (aggregate.statisticFunc === 'count') {
    return ok({
      ...base,
      wireType: 'numberOrString',
      cellValueType: 'number',
      nullable: false,
    });
  }
  if (!dependency) {
    return err(
      queryError('field_missing', 'A required related field is missing', {
        source,
        fieldId: aggregate.fieldId,
      })
    );
  }
  if (dependency.isMultipleCellValue) {
    return err(
      queryError('relation_aggregate_type', 'A relation aggregate requires a single-value field', {
        source,
        fieldId: dependency.fieldId,
      })
    );
  }
  if (aggregate.statisticFunc === 'unique') {
    return ok({
      ...base,
      wireType: 'numberOrString',
      cellValueType: 'number',
      nullable: false,
    });
  }
  if (aggregate.statisticFunc === 'sum' || aggregate.statisticFunc === 'average') {
    if (dependency.cellValueType !== 'number') {
      return err(
        queryError('relation_aggregate_type', 'sum and average require a number field', {
          source,
          fieldId: dependency.fieldId,
        })
      );
    }
    return ok({
      ...base,
      wireType: 'numberOrString',
      cellValueType: 'number',
      nullable: true,
    });
  }
  const date = dependency.cellValueType === 'dateTime';
  if (!date && dependency.cellValueType !== 'number') {
    return err(
      queryError('relation_aggregate_type', 'min and max require a number or date field', {
        source,
        fieldId: dependency.fieldId,
      })
    );
  }
  return ok(
    date
      ? { ...base, wireType: 'string', cellValueType: 'dateTime', nullable: true }
      : { ...base, wireType: 'numberOrString', cellValueType: 'number', nullable: true }
  );
};

const buildSourceDependencies = (
  table: ITableReadModel,
  usages: ReadonlyMap<string, DataQueryFieldUsage[]>,
  source?: string
): Result<
  {
    dependencies: DataQueryFieldDependency[];
    map: Map<string, DataQueryFieldDependency>;
  },
  DomainError
> =>
  safeTry(function* () {
    const dependencies: DataQueryFieldDependency[] = [];
    const map = new Map<string, DataQueryFieldDependency>();
    for (const [fieldId, fieldUsages] of usages) {
      const field = yield* table
        .getField((candidate) => candidate.id().toString() === fieldId)
        .mapErr(() =>
          queryError('field_missing', 'A required related field is missing', {
            ...(source ? { source } : {}),
            fieldId,
          })
        );
      const dependency = yield* describeField(table, field, fieldUsages);
      map.set(fieldId, dependency);
      dependencies.push(dependency);
    }
    return ok({ dependencies, map });
  });

/**
 * A version-2 records binding keeps each source's dependencies separate so the
 * host authorizes every joined table with that table's own scope. Relations may
 * be to-one joins or to-many aggregate sources, may chain through `via`, and a
 * source may declare a target filter, so each source's dependencies include the
 * fields that filter, sort or aggregate reads, plus the link edge its child hops use.
 */
export class DataQueryRelationBinding {
  private constructor(
    readonly definition: DataQueryDefinition,
    readonly rootTable: ITableReadModel,
    readonly rootDependencies: ReadonlyArray<DataQueryFieldDependency>,
    readonly sources: ReadonlyArray<DataQueryRelationSourceBinding>,
    readonly outputs: ReadonlyArray<DataQueryOutput>,
    readonly deferredFilterError?: DomainError
  ) {
    freezeQueryValue(rootDependencies);
    freezeQueryValue(sources);
    freezeQueryValue(outputs);
    Object.freeze(this);
  }

  static prepare(
    definition: DataQueryDefinition,
    rootTable: ITableReadModel,
    targetTables: ReadonlyMap<string, ITableReadModel>,
    options: DataQueryBindingPrepareOptions = {}
  ): Result<DataQueryRelationBinding, DomainError> {
    // The generator is a single linear validation sequence: early returns explain each
    // rejected boundary, and splitting it would scatter one contract across helpers.
    // eslint-disable-next-line sonarjs/cognitive-complexity
    return safeTry(function* () {
      const snapshot = definition.snapshot();
      if (snapshot.version !== 2) {
        return err(queryError('join_version', 'Relation binding requires definition version 2'));
      }
      if (snapshot.tableId !== rootTable.id().toString())
        return err(queryError('table_mismatch', 'Query table does not match the loaded table'));
      const filterValidation = validateDefinitionFilters(snapshot, rootTable);
      const deferredFilterError =
        options.deferOperatorRejection &&
        filterValidation.isErr() &&
        filterValidation.error.code === 'data_query.filter_operator_unsupported'
          ? filterValidation.error
          : undefined;
      if (filterValidation.isErr() && !deferredFilterError) return err(filterValidation.error);

      const parameterValues = parameterValueMaps(snapshot.parameters);

      const rootUsages = new Map<string, DataQueryFieldUsage[]>();
      const targetUsages = new Map<string, Map<string, DataQueryFieldUsage[]>>();
      const usageMap = (source: string): Map<string, DataQueryFieldUsage[]> => {
        if (source === 'root') return rootUsages;
        const existing = targetUsages.get(source) ?? new Map<string, DataQueryFieldUsage[]>();
        targetUsages.set(source, existing);
        return existing;
      };
      const addUsage = (source: string, fieldId: string, usage: DataQueryFieldUsage) => {
        const usages = usageMap(source);
        const fieldUsages = usages.get(fieldId) ?? [];
        if (!fieldUsages.includes(usage)) fieldUsages.push(usage);
        usages.set(fieldId, fieldUsages);
      };
      if (snapshot.kind === 'records') {
        for (const projection of snapshot.select) {
          if ('statisticFunc' in projection) {
            if (projection.fieldId !== undefined) {
              addUsage(projection.source, projection.fieldId, 'aggregate');
            }
            continue;
          }
          const source = projectionSource(projection) ?? 'root';
          if ('fieldId' in projection) addUsage(source, projection.fieldId, 'projection');
        }
      } else {
        for (const group of snapshot.groupBy ?? []) {
          addUsage(projectionSource(group) ?? 'root', group.fieldId, 'group');
        }
        for (const aggregate of snapshot.aggregates) {
          addUsage('root', aggregate.fieldId, 'aggregate');
        }
      }
      for (const [alias, relation] of Object.entries(snapshot.relations ?? {})) {
        // Create the map before any child hop can attach its link-edge dependency.
        usageMap(alias);
        if (!relation.filter) continue;
        collectFilterUsages(
          mapQueryFilter(relation.filter, (reference) =>
            representativeParameterValue(snapshot.parameters![reference.name])
          ),
          (fieldId, usage) => addUsage(alias, fieldId, usage)
        );
      }
      for (const sort of snapshot.sort ?? []) {
        if ('source' in sort) {
          if ('fieldId' in sort) addUsage(sort.source, sort.fieldId, 'sort');
          continue;
        }
        if ('fieldId' in sort) {
          addUsage('root', sort.fieldId, 'sort');
          continue;
        }
        if ('field' in sort) {
          for (const target of sort.allowed) {
            if ('fieldId' in target) {
              addUsage('source' in target ? target.source : 'root', target.fieldId, 'sort');
            }
          }
        }
      }

      type ResolvedRelation = {
        alias: string;
        table: ITableReadModel;
        linkFieldId: string;
        parentAlias: string;
        cardinality: DataQueryRelationCardinality;
        linkStorage: DataQueryRelationLinkStorage;
      };
      const resolved = new Map<string, ResolvedRelation>();
      for (const [alias, relation] of Object.entries(snapshot.relations ?? {})) {
        const target = targetTables.get(alias);
        if (!target) {
          return err(
            queryError('join_table_missing', 'A related table could not be loaded', {
              source: alias,
            })
          );
        }
        if (target.id().toString() !== relation.tableId) {
          return err(
            queryError('table_mismatch', 'Related table does not match its declaration', {
              source: alias,
            })
          );
        }
        if (target.baseId().toString() !== rootTable.baseId().toString()) {
          return err(
            queryError('join_cross_base', 'Related table belongs to another base', {
              source: alias,
            })
          );
        }
        const parentAlias = relation.via ?? 'root';
        const parent = parentAlias === 'root' ? rootTable : resolved.get(parentAlias)?.table;
        if (!parent) {
          return err(
            queryError('join_via', 'A relation `via` names an unknown earlier relation', {
              source: alias,
            })
          );
        }
        if (parentAlias !== 'root' && resolved.get(parentAlias)!.cardinality !== 'one') {
          return err(
            queryError('join_via', 'A relation may only hop through a to-one relation', {
              source: alias,
            })
          );
        }
        const link = yield* parent
          .getField((candidate) => candidate.id().toString() === relation.linkFieldId)
          .mapErr(() =>
            queryError('join_link_missing', 'A relation link field is missing', { source: alias })
          );
        if (link.type().toString() !== 'link' || link.hasError().toBoolean()) {
          return err(
            queryError('join_link_type', 'A relation field is not a usable link', {
              source: alias,
            })
          );
        }
        const linkField = link as LinkField;
        if (!linkField.foreignTableId().equals(target.id())) {
          return err(
            queryError('join_link_target', 'A relation link points at another table', {
              source: alias,
            })
          );
        }
        const fkHost = yield* linkField
          .fkHostTableNameString()
          .andThen((raw) => DbTableName.rehydrate(raw))
          .andThen((name) => name.split({ defaultSchema: 'public' }))
          .mapErr(() =>
            queryError('join_link_metadata', 'A relation foreign key host is unavailable', {
              source: alias,
            })
          );
        const selfKeyName = yield* linkField.selfKeyNameString().mapErr(() =>
          queryError('join_link_metadata', 'A relation self key is unavailable', {
            source: alias,
          })
        );
        const foreignKeyName = yield* linkField.foreignKeyNameString().mapErr(() =>
          queryError('join_link_metadata', 'A relation foreign key is unavailable', {
            source: alias,
          })
        );
        const parentPhysical = yield* parent
          .dbTableName()
          .andThen((name) => name.split({ defaultSchema: 'public' }))
          .mapErr(() =>
            queryError('join_link_metadata', 'The parent table physical name is unavailable')
          );
        const targetPhysical = yield* target
          .dbTableName()
          .andThen((name) => name.split({ defaultSchema: 'public' }))
          .mapErr(() =>
            queryError('join_link_metadata', 'The target table physical name is unavailable')
          );
        const derived = yield* deriveRelationStorage({
          alias,
          relationship: linkField.relationship().toString(),
          isOneWay: linkField.isOneWay(),
          fkHost,
          selfKeyName,
          foreignKeyName,
          parentPhysical,
          targetPhysical,
        });
        yield* validateFilterAgainstTable(relation.filter, target, parameterValues);
        // The link edge itself is a dependency of the table that hosts it.
        addUsage(parentAlias, linkField.id().toString(), 'relation');
        resolved.set(alias, {
          alias,
          table: target,
          linkFieldId: relation.linkFieldId,
          parentAlias,
          cardinality: derived.cardinality,
          linkStorage: derived.storage,
        });
      }

      // Count has no field dependency, so aggregates are checked by declared source.
      for (const projection of snapshot.kind === 'records' ? snapshot.select : []) {
        if (!('statisticFunc' in projection)) continue;
        const info = resolved.get(projection.source);
        if (info !== undefined && info.cardinality !== 'many') {
          return err(
            queryError(
              'join_aggregate_cardinality',
              'Relation aggregates require a to-many relation',
              { source: projection.source }
            )
          );
        }
      }
      if (snapshot.kind === 'aggregate') {
        // Grouped reports join to-one hops only; a to-many member set has no
        // single grouping value per root, so it belongs in a records aggregate.
        for (const [alias, info] of resolved) {
          if (info.cardinality !== 'one') {
            return err(
              queryError(
                'join_aggregate_cardinality',
                'Aggregate queries support to-one relations only',
                { source: alias }
              )
            );
          }
        }
      } else {
        // A to-many source has no single row per root, so it may only feed aggregates.
        for (const [alias, info] of resolved) {
          const many = info.cardinality === 'many';
          for (const [fieldId, usages] of targetUsages.get(alias) ?? []) {
            if (many && usages.includes('projection')) {
              return err(
                queryError(
                  'join_projection_multi',
                  'A to-many relation supports aggregate projections only',
                  { source: alias, fieldId }
                )
              );
            }
            if (many && usages.includes('sort')) {
              return err(
                queryError(
                  'join_sort_multi',
                  'A to-many relation cannot be sorted directly; sort by an aggregate alias',
                  { source: alias, fieldId }
                )
              );
            }
            if (!many && usages.includes('aggregate')) {
              return err(
                queryError(
                  'join_aggregate_cardinality',
                  'Relation aggregates require a to-many relation',
                  { source: alias, fieldId }
                )
              );
            }
          }
          if (!many) continue;
          for (const projection of snapshot.select) {
            if (projectionSource(projection) === alias && !('statisticFunc' in projection)) {
              return err(
                queryError(
                  'join_projection_multi',
                  'A to-many relation supports aggregate projections only',
                  { source: alias }
                )
              );
            }
          }
          for (const sort of snapshot.sort ?? []) {
            if ('source' in sort && sort.source === alias) {
              return err(
                queryError(
                  'join_sort_multi',
                  'A to-many relation cannot be sorted directly; sort by an aggregate alias',
                  { source: alias }
                )
              );
            }
          }
        }
      }

      const root = yield* buildSourceDependencies(rootTable, rootUsages);
      const targetDependencyMaps = new Map<string, Map<string, DataQueryFieldDependency>>();
      const sources: DataQueryRelationSourceBinding[] = [];
      for (const info of resolved.values()) {
        const built = yield* buildSourceDependencies(
          info.table,
          targetUsages.get(info.alias) ?? new Map(),
          info.alias
        );
        targetDependencyMaps.set(info.alias, built.map);
        sources.push({
          alias: info.alias,
          table: info.table,
          linkFieldId: info.linkFieldId,
          parentAlias: info.parentAlias,
          cardinality: info.cardinality,
          linkStorage: info.linkStorage,
          dependencies: built.dependencies,
        });
      }

      const outputs: DataQueryOutput[] = [];
      if (snapshot.kind === 'records') {
        for (const projection of snapshot.select) {
          if ('statisticFunc' in projection) {
            const info = resolved.get(projection.source);
            if (!info) {
              return err(
                queryError('join_source_unknown', 'A projection references an undeclared source', {
                  source: projection.source,
                })
              );
            }
            const dependency =
              projection.fieldId === undefined
                ? undefined
                : targetDependencyMaps.get(projection.source)?.get(projection.fieldId);
            if (projection.fieldId !== undefined && !dependency) {
              return err(
                queryError('field_missing', 'A required related field is missing', {
                  source: projection.source,
                  fieldId: projection.fieldId,
                })
              );
            }
            outputs.push(yield* relationAggregateOutput(projection, dependency, projection.source));
            continue;
          }
          if ('system' in projection) {
            const cellValueTypes = {
              id: 'string',
              createdTime: 'dateTime',
              lastModifiedTime: 'dateTime',
              autoNumber: 'number',
              version: 'number',
            };
            outputs.push({
              alias: projection.alias,
              wireType:
                projection.system === 'autoNumber' || projection.system === 'version'
                  ? 'numberOrString'
                  : 'string',
              cellValueType: cellValueTypes[projection.system],
              isMultipleCellValue: false,
              // A LEFT JOIN can miss for any target row, so target system columns are
              // always nullable; the root keeps its stored-column invariants.
              nullable: !isRootProjection(projection) || projection.system === 'lastModifiedTime',
            });
            continue;
          }
          const rawSource = projectionSource(projection);
          const source = rawSource === 'root' ? undefined : rawSource;
          const dependency = source
            ? targetDependencyMaps.get(source)?.get(projection.fieldId)
            : root.map.get(projection.fieldId);
          if (!dependency) {
            return err(
              queryError('field_missing', 'A selected field is not part of the query binding', {
                ...(source ? { source } : {}),
              })
            );
          }
          if (projection.arrayDistinct === true && dependency.isMultipleCellValue !== true) {
            return err(
              queryError(
                'array_distinct_incompatible',
                'Array-distinct projection requires a multiple-value field'
              )
            );
          }
          const bucket = 'bucket' in projection ? projection.bucket : undefined;
          if (bucket !== undefined) {
            yield* validateBucketField(bucket, dependency, {
              ...(source ? { source } : {}),
              fieldId: projection.fieldId,
            });
            outputs.push(bucketOutputType(projection.alias, bucket));
            continue;
          }
          outputs.push({
            alias: projection.alias,
            wireType: storedFieldWireTypes[dependency.fieldType] ?? 'unknown',
            cellValueType: dependency.cellValueType,
            isMultipleCellValue: dependency.isMultipleCellValue,
            nullable: true,
          });
        }
      } else {
        for (const group of snapshot.groupBy ?? []) {
          const rawSource = projectionSource(group);
          const source = rawSource === 'root' ? undefined : rawSource;
          const dependency = source
            ? targetDependencyMaps.get(source)?.get(group.fieldId)
            : root.map.get(group.fieldId);
          if (!dependency) {
            return err(
              queryError('field_missing', 'A grouping field is not part of the query binding', {
                ...(source ? { source } : {}),
                fieldId: group.fieldId,
              })
            );
          }
          const bucket = 'bucket' in group ? group.bucket : undefined;
          if (bucket !== undefined) {
            yield* validateBucketField(bucket, dependency, {
              ...(source ? { source } : {}),
              fieldId: group.fieldId,
            });
            outputs.push(bucketOutputType(group.alias, bucket));
            continue;
          }
          outputs.push({
            alias: group.alias,
            wireType: storedFieldWireTypes[dependency.fieldType] ?? 'unknown',
            cellValueType: dependency.cellValueType,
            isMultipleCellValue: dependency.isMultipleCellValue,
            nullable: true,
          });
        }
        for (const aggregate of snapshot.aggregates) {
          const field = yield* rootTable
            .getField((candidate) => candidate.id().toString() === aggregate.fieldId)
            .mapErr(() => queryError('field_missing', 'A required query field is missing'));
          outputs.push(yield* aggregateOutput(aggregate, field));
        }
      }

      return ok(
        new DataQueryRelationBinding(
          definition,
          rootTable,
          root.dependencies,
          sources,
          outputs,
          deferredFilterError
        )
      );
    });
  }
}

export class DataQueryBinding {
  private constructor(
    readonly definition: DataQueryDefinition,
    readonly dependencies: ReadonlyArray<DataQueryFieldDependency>,
    readonly outputs: ReadonlyArray<DataQueryOutput>,
    /** Present only when preparation deferred an operator rejection past authorization. */
    readonly deferredFilterError?: DomainError
  ) {
    freezeQueryValue(dependencies);
    freezeQueryValue(outputs);
    Object.freeze(this);
  }

  static prepare(
    definition: DataQueryDefinition,
    table: ITableReadModel,
    options: DataQueryBindingPrepareOptions = {}
  ): Result<DataQueryBinding, DomainError> {
    return safeTry(function* () {
      const snapshot = definition.snapshot();
      if (snapshot.tableId !== table.id().toString())
        return err(queryError('table_mismatch', 'Query table does not match the loaded table'));
      const filterValidation = validateDefinitionFilters(snapshot, table);
      const deferredFilterError =
        options.deferOperatorRejection &&
        filterValidation.isErr() &&
        filterValidation.error.code === 'data_query.filter_operator_unsupported'
          ? filterValidation.error
          : undefined;
      if (filterValidation.isErr() && !deferredFilterError) return err(filterValidation.error);
      const dependencies: DataQueryFieldDependency[] = [];
      const fields = new Map<string, Field>();
      const descriptions = new Map<string, DataQueryFieldDependency>();
      for (const [id, fieldUsages] of queryFieldUsages(snapshot)) {
        const field = yield* table
          .getField((candidate) => candidate.id().toString() === id)
          .mapErr(() => queryError('field_missing', 'A required query field is missing'));
        const dependency = yield* describeField(table, field, fieldUsages);
        fields.set(id, field);
        descriptions.set(id, dependency);
        dependencies.push(dependency);
      }
      if (snapshot.kind === 'records') {
        for (const projection of snapshot.select) {
          if (
            'fieldId' in projection &&
            'arrayDistinct' in projection &&
            projection.arrayDistinct === true &&
            descriptions.get(projection.fieldId)?.isMultipleCellValue !== true
          ) {
            return err(
              queryError(
                'array_distinct_incompatible',
                'Array-distinct projection requires a multiple-value field'
              )
            );
          }
        }
      }
      const outputs = yield* describeOutputs(snapshot, fields, descriptions);
      return ok(new DataQueryBinding(definition, dependencies, outputs, deferredFilterError));
    });
  }
}
