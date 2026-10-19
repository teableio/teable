import {
  buildRecordConditionSpec,
  FieldValueTypeVisitor,
  getValidRecordAggregationFunctions,
  isRecordFilterDateValue,
  isRecordFilterFieldReferenceValue,
  RecordConditionDateValue,
  recordFilterSchema,
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
} from './DataQueryDefinition';
import type {
  DataQueryAggregate,
  DataQueryDefinitionInput,
  DataQueryFieldDependency,
  DataQueryFieldUsage,
  DataQueryOutput,
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

/** Strict, non-sanitizing validation, shared by preparation and the executor's actual bound values. */
export const validateDataQueryFilter = (
  table: ITableReadModel,
  filter: RecordFilter | undefined
): Result<void, DomainError> => {
  if (filter === undefined) return ok(undefined);
  if (filter === null || !recordFilterSchema.safeParse(filter).success)
    return err(queryError('invalid_filter', 'Invalid query filter'));
  const spec = buildRecordConditionSpec(table, filter);
  if (spec.isErr())
    return err(
      queryError('filter_incompatible', 'Query filter is incompatible with the current schema')
    );
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
      if ('fieldId' in projection) add(projection.fieldId, 'projection');
    });
  } else {
    for (const group of snapshot.groupBy ?? []) add(group.fieldId, 'group');
    for (const aggregate of snapshot.aggregates) add(aggregate.fieldId, 'aggregate');
  }
  snapshot.sort?.forEach((sort) => {
    if ('fieldId' in sort) add(sort.fieldId, 'sort');
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

const validateDefinitionFilters = (
  snapshot: DataQueryDefinitionInput,
  table: ITableReadModel
): Result<void, DomainError> => {
  if (!snapshot.filter) return ok(undefined);
  const representative = mapQueryFilter(snapshot.filter, (reference) =>
    representativeParameterValue(snapshot.parameters![reference.name])
  );
  const defaults = mapQueryFilter(snapshot.filter, (reference) => {
    const parameter = snapshot.parameters![reference.name];
    return Object.hasOwn(parameter, 'default')
      ? parameter.default!
      : representativeParameterValue(parameter);
  });
  return validateDataQueryFilter(table, representative).andThen(() =>
    validateDataQueryFilter(table, defaults)
  );
};

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

const describeOutputs = (
  snapshot: DataQueryDefinitionInput,
  fields: ReadonlyMap<string, Field>,
  dependencies: ReadonlyMap<string, DataQueryFieldDependency>
): Result<DataQueryOutput[], DomainError> =>
  safeTry(function* () {
    const outputs: DataQueryOutput[] = [];
    const projectionOutput = (fieldId: string, alias: string): DataQueryOutput => {
      const dependency = dependencies.get(fieldId)!;
      return {
        alias,
        wireType: storedFieldWireTypes[dependency.fieldType] ?? 'unknown',
        cellValueType: dependency.cellValueType,
        isMultipleCellValue: dependency.isMultipleCellValue,
        nullable: true,
      };
    };
    if (snapshot.kind === 'records') {
      for (const projection of snapshot.select) {
        if ('fieldId' in projection) {
          outputs.push(projectionOutput(projection.fieldId, projection.alias));
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
    for (const group of snapshot.groupBy ?? [])
      outputs.push(projectionOutput(group.fieldId, group.alias));
    for (const aggregate of snapshot.aggregates)
      outputs.push(yield* aggregateOutput(aggregate, fields.get(aggregate.fieldId)!));
    return ok(outputs);
  });

export class DataQueryBinding {
  private constructor(
    readonly definition: DataQueryDefinition,
    readonly dependencies: ReadonlyArray<DataQueryFieldDependency>,
    readonly outputs: ReadonlyArray<DataQueryOutput>
  ) {
    freezeQueryValue(dependencies);
    freezeQueryValue(outputs);
    Object.freeze(this);
  }

  static prepare(
    definition: DataQueryDefinition,
    table: ITableReadModel
  ): Result<DataQueryBinding, DomainError> {
    return safeTry(function* () {
      const snapshot = definition.snapshot();
      if (snapshot.tableId !== table.id().toString())
        return err(queryError('table_mismatch', 'Query table does not match the loaded table'));
      yield* validateDefinitionFilters(snapshot, table);
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
      const outputs = yield* describeOutputs(snapshot, fields, descriptions);
      return ok(new DataQueryBinding(definition, dependencies, outputs));
    });
  }
}
