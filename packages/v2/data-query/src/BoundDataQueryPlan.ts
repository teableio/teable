import {
  ConditionalLookupField,
  LookupField,
  type DomainError,
  type Field,
  type ITableReadModel,
} from '@teable/v2-core';
import { ok, safeTry, type Result } from 'neverthrow';

import { freezeQueryValue, queryError } from './DataQueryDefinition';
import type {
  DataQueryAggregate,
  DataQueryBucket,
  DataQueryDefinitionInput,
  DataQueryFieldDependency,
  DataQueryFieldUsage,
  DataQueryFilter,
  DataQueryParameterDefinition,
  DataQueryRelation,
  DataQueryRelationAggregate,
  DataQuerySort,
  DataQuerySortNulls,
  DataQuerySortOrder,
  DataQuerySortTarget,
  DataQuerySystemField,
} from './types';

export type BoundDataQueryPlanPhysical = {
  readonly schema: string | null;
  readonly tableName: string;
};

export type BoundDataQueryPlanField = {
  readonly fieldId: string;
  readonly column: string | null;
  readonly fieldType: string;
  readonly cellValueType: string;
  readonly isMultipleCellValue: boolean;
  readonly isComputed: boolean;
  readonly isLookupOrConditional: boolean;
  /** Filled by the authorization layer in C2/S2; S1 does not evaluate masks. */
  readonly masked?: boolean;
};

export type BoundDataQueryPlanLink =
  | { readonly kind: 'root-fk'; readonly column: string }
  | { readonly kind: 'target-fk'; readonly column: string }
  | { readonly kind: 'target-fk-many'; readonly column: string }
  | {
      readonly kind: 'junction';
      readonly schema: string | null;
      readonly tableName: string;
      readonly selfKeyName: string;
      readonly foreignKeyName: string;
    };

export type BoundDataQueryPlanSource = {
  readonly alias: string;
  readonly tableId: string;
  readonly physical: BoundDataQueryPlanPhysical;
  readonly cardinality: 'one' | 'many';
  readonly parentAlias?: string;
  readonly linkFieldId?: string;
  readonly link?: BoundDataQueryPlanLink;
  readonly fields: ReadonlyArray<BoundDataQueryPlanField>;
};

export type BoundDataQueryPlanProjection =
  | {
      readonly kind: 'field';
      readonly source: string;
      readonly fieldId: string;
      readonly column: string | null;
      readonly alias: string;
      readonly bucket?: DataQueryBucket;
      readonly arrayDistinct?: boolean;
    }
  | {
      readonly kind: 'system';
      readonly source: string;
      readonly system: DataQuerySystemField;
      readonly column: string;
      readonly alias: string;
    }
  | {
      readonly kind: 'aggregate';
      readonly source: string;
      readonly alias: string;
      readonly statisticFunc: DataQueryRelationAggregate['statisticFunc'];
      readonly fieldId?: string;
      readonly column: string | null;
    };

export type BoundDataQueryPlanAggregate =
  | {
      readonly source: 'root';
      readonly alias: string;
      readonly statisticFunc: DataQueryAggregate['statisticFunc'];
      readonly fieldId: string;
      readonly column: string | null;
    }
  | {
      readonly source: string;
      readonly alias: string;
      readonly statisticFunc: DataQueryRelationAggregate['statisticFunc'];
      readonly fieldId?: string;
      readonly column: string | null;
    };

export type BoundDataQueryPlanGroup = {
  readonly source: string;
  readonly fieldId: string;
  readonly column: string | null;
  readonly alias: string;
  readonly bucket?: DataQueryBucket;
};

export type BoundDataQueryPlanSortTarget = {
  readonly source: string;
  readonly fieldId?: string;
  readonly system?: DataQuerySystemField;
  readonly column: string | null;
};

export type BoundDataQueryPlanSort =
  | {
      readonly kind: 'target';
      readonly source: string;
      readonly fieldId?: string;
      readonly system?: DataQuerySystemField;
      readonly column: string | null;
      readonly order: DataQuerySortOrder;
      readonly nulls?: DataQuerySortNulls;
    }
  | {
      readonly kind: 'alias';
      readonly alias: string;
      readonly order: DataQuerySortOrder;
      readonly nulls?: DataQuerySortNulls;
    }
  | {
      readonly kind: 'parameter';
      readonly field: string;
      readonly order: DataQuerySortOrder | { readonly parameter: string };
      readonly allowed: ReadonlyArray<BoundDataQueryPlanSortTarget>;
      readonly optional: boolean;
      readonly nulls?: DataQuerySortNulls;
    };

export type BoundDataQueryPlanParameter = {
  readonly name: string;
  readonly type: DataQueryParameterDefinition['type'];
  readonly nullable: boolean;
  readonly hasDefault: boolean;
};

export type BoundDataQueryPlanUsage = {
  readonly source: string;
  readonly fieldId: string;
  readonly usages: ReadonlyArray<DataQueryFieldUsage>;
};

export type BoundDataQueryPlan = {
  readonly definitionVersion: 1 | 2;
  readonly kind: 'records' | 'aggregate';
  readonly tableId: string;
  readonly root: BoundDataQueryPlanSource;
  readonly sources: ReadonlyArray<BoundDataQueryPlanSource>;
  readonly projections: ReadonlyArray<BoundDataQueryPlanProjection>;
  readonly aggregates: ReadonlyArray<BoundDataQueryPlanAggregate>;
  readonly groupBy: ReadonlyArray<BoundDataQueryPlanGroup>;
  readonly sort: ReadonlyArray<BoundDataQueryPlanSort>;
  readonly page?: {
    readonly limit: number | { readonly parameter: string };
    readonly offset?: number | { readonly parameter: string };
    readonly includeTotal: boolean;
  };
  readonly parameters: ReadonlyArray<BoundDataQueryPlanParameter>;
  readonly filter?: DataQueryFilter;
  readonly relationFilters: ReadonlyArray<{
    readonly source: string;
    readonly filter: DataQueryFilter;
  }>;
  readonly usage: ReadonlyArray<BoundDataQueryPlanUsage>;
};

export type BoundDataQueryPlanRelationInput = {
  readonly alias: string;
  readonly table: ITableReadModel;
  readonly linkFieldId: string;
  readonly parentAlias: string;
  readonly cardinality: 'one' | 'many';
  readonly linkStorage: BoundDataQueryPlanLink;
  readonly dependencies: ReadonlyArray<DataQueryFieldDependency>;
  readonly usage: ReadonlyMap<string, ReadonlyArray<DataQueryFieldUsage>>;
};

export type BuildBoundDataQueryPlanInput = {
  readonly definition: DataQueryDefinitionInput;
  readonly rootTable: ITableReadModel;
  readonly rootDependencies: ReadonlyArray<DataQueryFieldDependency>;
  readonly rootUsage: ReadonlyMap<string, ReadonlyArray<DataQueryFieldUsage>>;
  readonly relations?: ReadonlyArray<BoundDataQueryPlanRelationInput>;
};

const systemColumns: Readonly<Record<DataQuerySystemField, string>> = {
  id: '__id',
  createdTime: '__created_time',
  lastModifiedTime: '__last_modified_time',
  autoNumber: '__auto_number',
  version: '__version',
};

const physicalTable = (table: ITableReadModel): Result<BoundDataQueryPlanPhysical, DomainError> =>
  table
    .dbTableName()
    .andThen((name) => name.split({ defaultSchema: 'public' }))
    .map((name) => ({ schema: name.schema ?? null, tableName: name.tableName }))
    .mapErr(() => queryError('table_physical', 'A query table has no physical name'));

const fieldColumn = (field: Field): string | null => {
  const name = field.dbFieldName().andThen((value) => value.value());
  return name.isOk() ? name.value : null;
};

const planFields = (
  table: ITableReadModel,
  dependencies: ReadonlyArray<DataQueryFieldDependency>
): Result<ReadonlyArray<BoundDataQueryPlanField>, DomainError> =>
  safeTry(function* () {
    const fields: BoundDataQueryPlanField[] = [];
    for (const dependency of dependencies) {
      const field = yield* table
        .getField((candidate) => candidate.id().toString() === dependency.fieldId)
        .mapErr(() =>
          queryError('field_missing', 'A required query field is missing', {
            fieldId: dependency.fieldId,
          })
        );
      fields.push({
        fieldId: dependency.fieldId,
        column: fieldColumn(field),
        fieldType: dependency.fieldType,
        cellValueType: dependency.cellValueType,
        isMultipleCellValue: dependency.isMultipleCellValue,
        isComputed: field.computed().toBoolean(),
        isLookupOrConditional:
          field instanceof LookupField || field instanceof ConditionalLookupField,
      });
    }
    return ok(fields);
  });

const sourceFrom = (
  alias: string,
  table: ITableReadModel,
  dependencies: ReadonlyArray<DataQueryFieldDependency>,
  options: {
    cardinality: 'one' | 'many';
    parentAlias?: string;
    linkFieldId?: string;
    link?: BoundDataQueryPlanLink;
  }
): Result<BoundDataQueryPlanSource, DomainError> =>
  safeTry(function* () {
    const physical = yield* physicalTable(table);
    const fields = yield* planFields(table, dependencies);
    return ok({
      alias,
      tableId: table.id().toString(),
      physical,
      cardinality: options.cardinality,
      ...(options.parentAlias ? { parentAlias: options.parentAlias } : {}),
      ...(options.linkFieldId ? { linkFieldId: options.linkFieldId } : {}),
      ...(options.link ? { link: options.link } : {}),
      fields,
    });
  });

const columnOf = (source: BoundDataQueryPlanSource, fieldId: string): string | null =>
  source.fields.find((field) => field.fieldId === fieldId)?.column ?? null;

const sourceAlias = (source: string | undefined): string => source ?? 'root';

const columnFor = (
  sources: ReadonlyMap<string, BoundDataQueryPlanSource>,
  source: string,
  fieldId: string
): string | null => {
  const planSource = sources.get(source);
  return planSource ? columnOf(planSource, fieldId) : null;
};

const planSortTarget = (
  target: DataQuerySortTarget,
  sources: ReadonlyMap<string, BoundDataQueryPlanSource>
): BoundDataQueryPlanSortTarget => {
  const source = sourceAlias('source' in target ? target.source : undefined);
  const planSource = sources.get(source);
  if ('system' in target) {
    return { source, system: target.system, column: systemColumns[target.system] };
  }
  return {
    source,
    fieldId: target.fieldId,
    column: planSource ? columnOf(planSource, target.fieldId) : null,
  };
};

const planSort = (
  sort: DataQuerySort,
  sources: ReadonlyMap<string, BoundDataQueryPlanSource>
): BoundDataQueryPlanSort => {
  if ('alias' in sort) {
    return {
      kind: 'alias',
      alias: sort.alias,
      order: sort.order,
      ...(sort.nulls ? { nulls: sort.nulls } : {}),
    };
  }
  if ('field' in sort) {
    return {
      kind: 'parameter',
      field: sort.field.name,
      order: typeof sort.order === 'string' ? sort.order : { parameter: sort.order.name },
      allowed: sort.allowed.map((target) => planSortTarget(target, sources)),
      optional: sort.optional === true,
      ...(sort.nulls ? { nulls: sort.nulls } : {}),
    };
  }
  const source = sourceAlias('source' in sort ? sort.source : undefined);
  if ('system' in sort) {
    return {
      kind: 'target',
      source,
      system: sort.system,
      column: systemColumns[sort.system],
      order: sort.order,
      ...(sort.nulls ? { nulls: sort.nulls } : {}),
    };
  }
  return {
    kind: 'target',
    source,
    fieldId: sort.fieldId,
    column: columnFor(sources, source, sort.fieldId),
    order: sort.order,
    ...(sort.nulls ? { nulls: sort.nulls } : {}),
  };
};

const planAggregate = (
  aggregate: DataQueryRelationAggregate | DataQueryAggregate,
  sources: ReadonlyMap<string, BoundDataQueryPlanSource>
): BoundDataQueryPlanAggregate => {
  if ('source' in aggregate) {
    return {
      source: aggregate.source,
      alias: aggregate.alias,
      statisticFunc: aggregate.statisticFunc,
      ...(aggregate.fieldId ? { fieldId: aggregate.fieldId } : {}),
      column: columnFor(sources, aggregate.source, aggregate.fieldId ?? ''),
    };
  }
  return {
    source: 'root',
    alias: aggregate.alias,
    statisticFunc: aggregate.statisticFunc,
    fieldId: aggregate.fieldId,
    column: columnFor(sources, 'root', aggregate.fieldId),
  };
};

const relationFilters = (
  relations: Readonly<Record<string, DataQueryRelation>> | undefined
): ReadonlyArray<{ source: string; filter: DataQueryFilter }> =>
  Object.entries(relations ?? {}).flatMap(([source, relation]) =>
    relation.filter ? [{ source, filter: relation.filter }] : []
  );

// One linear assembly from already-validated binding inputs; splitting it would
// hide the order in which sources, projections and usage are joined.
export const buildBoundDataQueryPlan = (
  input: BuildBoundDataQueryPlanInput
): Result<BoundDataQueryPlan, DomainError> =>
  // eslint-disable-next-line sonarjs/cognitive-complexity
  safeTry(function* () {
    const { definition } = input;
    const root = yield* sourceFrom('root', input.rootTable, input.rootDependencies, {
      cardinality: 'one',
    });
    const relationSources: BoundDataQueryPlanSource[] = [];
    for (const relation of input.relations ?? []) {
      relationSources.push(
        yield* sourceFrom(relation.alias, relation.table, relation.dependencies, {
          cardinality: relation.cardinality,
          parentAlias: relation.parentAlias,
          linkFieldId: relation.linkFieldId,
          link: relation.linkStorage,
        })
      );
    }
    const sources = new Map<string, BoundDataQueryPlanSource>([['root', root]]);
    for (const source of relationSources) sources.set(source.alias, source);

    const projections: BoundDataQueryPlanProjection[] = [];
    const aggregates: BoundDataQueryPlanAggregate[] = [];
    if (definition.kind === 'records') {
      for (const projection of definition.select) {
        const source = sourceAlias('source' in projection ? projection.source : undefined);
        if ('statisticFunc' in projection) {
          projections.push({
            kind: 'aggregate',
            source,
            alias: projection.alias,
            statisticFunc: projection.statisticFunc,
            ...(projection.fieldId ? { fieldId: projection.fieldId } : {}),
            column: projection.fieldId ? columnFor(sources, source, projection.fieldId) : null,
          });
          continue;
        }
        if ('system' in projection) {
          projections.push({
            kind: 'system',
            source,
            system: projection.system,
            column: systemColumns[projection.system],
            alias: projection.alias,
          });
          continue;
        }
        projections.push({
          kind: 'field',
          source,
          fieldId: projection.fieldId,
          column: columnFor(sources, source, projection.fieldId),
          alias: projection.alias,
          ...('bucket' in projection && projection.bucket ? { bucket: projection.bucket } : {}),
          ...(projection.arrayDistinct ? { arrayDistinct: true } : {}),
        });
      }
    } else {
      for (const aggregate of definition.aggregates) {
        aggregates.push(planAggregate(aggregate, sources));
      }
    }

    const groupBy: BoundDataQueryPlanGroup[] = [];
    if (definition.kind === 'aggregate') {
      for (const group of definition.groupBy ?? []) {
        const source = sourceAlias('source' in group ? group.source : undefined);
        groupBy.push({
          source,
          fieldId: group.fieldId,
          column: columnFor(sources, source, group.fieldId),
          alias: group.alias,
          ...('bucket' in group && group.bucket ? { bucket: group.bucket } : {}),
        });
      }
    }

    const usage: BoundDataQueryPlanUsage[] = [];
    for (const [fieldId, fieldUsages] of input.rootUsage) {
      usage.push({ source: 'root', fieldId, usages: fieldUsages });
    }
    for (const relation of input.relations ?? []) {
      for (const [fieldId, fieldUsages] of relation.usage) {
        usage.push({ source: relation.alias, fieldId, usages: fieldUsages });
      }
    }

    const plan: BoundDataQueryPlan = {
      definitionVersion: definition.version,
      kind: definition.kind,
      tableId: definition.tableId,
      root,
      sources: relationSources,
      projections,
      aggregates,
      groupBy,
      sort: (definition.sort ?? []).map((sort) => planSort(sort, sources)),
      ...(definition.page
        ? {
            page: {
              limit:
                typeof definition.page.limit === 'number'
                  ? definition.page.limit
                  : { parameter: definition.page.limit.name },
              ...(definition.page.offset !== undefined
                ? {
                    offset:
                      typeof definition.page.offset === 'number'
                        ? definition.page.offset
                        : { parameter: definition.page.offset.name },
                  }
                : {}),
              includeTotal: definition.page.includeTotal === true,
            },
          }
        : {}),
      parameters: Object.entries(definition.parameters ?? {}).map(([name, parameter]) => ({
        name,
        type: parameter.type,
        nullable: parameter.nullable === true,
        hasDefault: parameter.default !== undefined,
      })),
      ...(definition.filter ? { filter: definition.filter } : {}),
      relationFilters: relationFilters(definition.version === 2 ? definition.relations : undefined),
      usage,
    };
    freezeQueryValue(plan);
    return ok(Object.freeze(plan));
  });
