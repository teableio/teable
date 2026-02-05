import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { domainError, FieldId, TableId, type BaseId, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import {
  describeError,
  parseConditionalFieldOptions,
  parseLinkOptions,
  parseLookupOptions,
  type FieldDependencyEdgeKind,
  type ParsedConditionalOptions as ConditionalFieldOptionsMeta,
  type ParsedLinkOptions as LinkOptionsMeta,
  type ParsedLookupOptions as LookupOptionsMeta,
} from '@teable/v2-field-dependency-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type {
  DebugFieldRelationGraphData,
  DebugFieldRelationGraphFieldMeta,
  IDebugFieldRelationGraph,
} from '../../ports/FieldRelationGraph';
import type { DebugFieldRelationEdge, DebugFieldRelationEdgeSemantic } from '../../types';

export type { FieldDependencyEdgeKind };

type FieldDependencyEdge = {
  fromFieldId: FieldId;
  toFieldId: FieldId;
  fromTableId: TableId;
  toTableId: TableId;
  kind: FieldDependencyEdgeKind;
  linkFieldId?: FieldId;
  semantic?: DebugFieldRelationEdgeSemantic;
};

type FieldMeta = {
  id: FieldId;
  tableId: TableId;
  type: string;
  isComputed: boolean;
  isLookup: boolean;
  options: LinkOptionsMeta | null;
  lookupOptions: LookupOptionsMeta | null;
  conditionalOptions: ConditionalFieldOptionsMeta | null;
};

type FieldRow = {
  id: string;
  table_id: string;
  type: string;
  is_computed: boolean | null;
  is_lookup: boolean | null;
  options: string | null;
  lookup_options: string | null;
};

type ReferenceRow = {
  from_field_id: string;
  to_field_id: string;
  from_table_id: string;
  to_table_id: string;
  to_field_type: string;
};

@injectable()
export class PostgresFieldRelationGraph implements IDebugFieldRelationGraph {
  constructor(
    @inject(v2PostgresDbTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async load(baseId: BaseId): Promise<Result<DebugFieldRelationGraphData, DomainError>> {
    return safeTry<DebugFieldRelationGraphData, DomainError>(
      async function* (this: PostgresFieldRelationGraph) {
        const fields = yield* await this.loadFields(baseId);
        const referenceEdges = yield* await this.loadReferenceEdges(baseId);
        const fieldsById = buildFieldMetaMap(fields);
        const derivedEdges = yield* buildDerivedEdges(fields);
        const edges = mergeEdges(referenceEdges, derivedEdges).map(toDebugEdge);

        return ok({ fieldsById, edges });
      }.bind(this)
    );
  }

  private async loadFields(baseId: BaseId): Promise<Result<ReadonlyArray<FieldMeta>, DomainError>> {
    try {
      const rows = await this.db
        .selectFrom('field as f')
        .innerJoin('table_meta as t', 't.id', 'f.table_id')
        .select([
          'f.id as id',
          'f.table_id as table_id',
          'f.type as type',
          'f.is_computed as is_computed',
          'f.is_lookup as is_lookup',
          'f.options as options',
          'f.lookup_options as lookup_options',
        ])
        .where('t.base_id', '=', baseId.toString())
        .where('f.deleted_time', 'is', null)
        .where('t.deleted_time', 'is', null)
        .execute();

      const fields: FieldMeta[] = [];
      for (const row of rows) {
        const field = parseFieldRow(row);
        if (field.isErr()) return err(field.error);
        fields.push(field.value);
      }

      return ok(fields);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load fields: ${describeError(error)}`,
        })
      );
    }
  }

  private async loadReferenceEdges(
    baseId: BaseId
  ): Promise<Result<ReadonlyArray<FieldDependencyEdge>, DomainError>> {
    try {
      const rows = await this.db
        .selectFrom('reference as r')
        .innerJoin('field as f_from', 'f_from.id', 'r.from_field_id')
        .innerJoin('field as f_to', 'f_to.id', 'r.to_field_id')
        .innerJoin('table_meta as t_from', 't_from.id', 'f_from.table_id')
        .innerJoin('table_meta as t_to', 't_to.id', 'f_to.table_id')
        .select([
          'r.from_field_id as from_field_id',
          'r.to_field_id as to_field_id',
          'f_from.table_id as from_table_id',
          'f_to.table_id as to_table_id',
          'f_to.type as to_field_type',
          't_from.base_id as from_base_id',
          't_to.base_id as to_base_id',
        ])
        .where((eb) =>
          eb.or([
            eb('t_from.base_id', '=', baseId.toString()),
            eb('t_to.base_id', '=', baseId.toString()),
          ])
        )
        .where('f_from.deleted_time', 'is', null)
        .where('f_to.deleted_time', 'is', null)
        .where('t_from.deleted_time', 'is', null)
        .where('t_to.deleted_time', 'is', null)
        .execute();

      const edges: FieldDependencyEdge[] = [];
      for (const row of rows) {
        const edge = parseReferenceRow(row);
        if (edge.isErr()) return err(edge.error);
        if (edge.value) edges.push(edge.value);
      }

      return ok(edges);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load reference edges: ${describeError(error)}`,
        })
      );
    }
  }
}

const buildFieldMetaMap = (
  fields: ReadonlyArray<FieldMeta>
): Map<string, DebugFieldRelationGraphFieldMeta> => {
  const map = new Map<string, DebugFieldRelationGraphFieldMeta>();
  for (const field of fields) {
    map.set(field.id.toString(), {
      id: field.id.toString(),
      tableId: field.tableId.toString(),
      type: field.type,
      isComputed: field.isComputed,
      isLookup: field.isLookup,
    });
  }
  return map;
};

const buildDerivedEdges = (
  fields: ReadonlyArray<FieldMeta>
): Result<ReadonlyArray<FieldDependencyEdge>, DomainError> => {
  const edges: FieldDependencyEdge[] = [];
  for (const field of fields) {
    const fieldEdges = buildEdgesForField(field);
    if (fieldEdges.isErr()) return err(fieldEdges.error);
    edges.push(...fieldEdges.value);
  }
  return ok(edges);
};

const buildEdgesForField = (
  field: FieldMeta
): Result<ReadonlyArray<FieldDependencyEdge>, DomainError> => {
  if (field.type === 'lookup' || field.type === 'rollup') {
    return buildLookupEdges(field);
  }
  if (field.type === 'link') {
    return buildLinkEdges(field);
  }
  if (field.type === 'conditionalRollup' || field.type === 'conditionalLookup') {
    return buildConditionalEdges(field);
  }
  return ok([]);
};

const buildLookupEdges = (
  field: FieldMeta
): Result<ReadonlyArray<FieldDependencyEdge>, DomainError> => {
  const lookupOptions = field.lookupOptions;
  if (!lookupOptions) {
    return err(
      domainError.validation({
        message: `Missing lookupOptions for ${field.type} field ${field.id.toString()}`,
      })
    );
  }
  const linkFieldId = FieldId.create(lookupOptions.linkFieldId);
  if (linkFieldId.isErr()) return err(linkFieldId.error);
  const lookupFieldId = FieldId.create(lookupOptions.lookupFieldId);
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);
  const foreignTableId = TableId.create(lookupOptions.foreignTableId);
  if (foreignTableId.isErr()) return err(foreignTableId.error);

  return ok([
    {
      fromFieldId: linkFieldId.value,
      toFieldId: field.id,
      fromTableId: field.tableId,
      toTableId: field.tableId,
      kind: 'same_record',
      semantic: 'lookup_link',
    },
    {
      fromFieldId: lookupFieldId.value,
      toFieldId: field.id,
      fromTableId: foreignTableId.value,
      toTableId: field.tableId,
      kind: 'cross_record',
      linkFieldId: linkFieldId.value,
      semantic: field.type === 'rollup' ? 'rollup_source' : 'lookup_source',
    },
  ]);
};

const buildLinkEdges = (
  field: FieldMeta
): Result<ReadonlyArray<FieldDependencyEdge>, DomainError> => {
  const options = field.options;
  if (!options) {
    return err(
      domainError.validation({
        message: `Missing options for link field ${field.id.toString()}`,
      })
    );
  }
  const lookupFieldId = FieldId.create(options.lookupFieldId);
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);
  const foreignTableId = TableId.create(options.foreignTableId);
  if (foreignTableId.isErr()) return err(foreignTableId.error);

  return ok([
    {
      fromFieldId: lookupFieldId.value,
      toFieldId: field.id,
      fromTableId: foreignTableId.value,
      toTableId: field.tableId,
      kind: 'cross_record',
      linkFieldId: field.id,
      semantic: 'link_title',
    },
  ]);
};

const buildConditionalEdges = (
  field: FieldMeta
): Result<ReadonlyArray<FieldDependencyEdge>, DomainError> => {
  const conditionalOptions = field.conditionalOptions;
  if (!conditionalOptions) {
    return err(
      domainError.validation({
        message: `Missing conditionalOptions for ${field.type} field ${field.id.toString()}`,
      })
    );
  }
  const lookupFieldId = FieldId.create(conditionalOptions.lookupFieldId);
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);
  const foreignTableId = TableId.create(conditionalOptions.foreignTableId);
  if (foreignTableId.isErr()) return err(foreignTableId.error);

  return ok([
    {
      fromFieldId: lookupFieldId.value,
      toFieldId: field.id,
      fromTableId: foreignTableId.value,
      toTableId: field.tableId,
      kind: 'cross_record',
      semantic:
        field.type === 'conditionalRollup'
          ? 'conditional_rollup_source'
          : 'conditional_lookup_source',
    },
  ]);
};

const parseFieldRow = (row: FieldRow): Result<FieldMeta, DomainError> => {
  const fieldId = FieldId.create(row.id);
  if (fieldId.isErr()) return err(fieldId.error);
  const tableId = TableId.create(row.table_id);
  if (tableId.isErr()) return err(tableId.error);

  const options =
    row.type === 'link' ? parseLinkOptions(row.options) : ok<LinkOptionsMeta | null>(null);
  if (options.isErr()) return err(options.error);

  const isLookupField = Boolean(row.is_lookup);
  const isRollupField = row.type === 'rollup';
  const lookupOptions =
    isLookupField || isRollupField
      ? parseLookupOptions(row.lookup_options)
      : ok<LookupOptionsMeta | null>(null);
  if (lookupOptions.isErr()) return err(lookupOptions.error);

  const isConditionalField = row.type === 'conditionalRollup' || row.type === 'conditionalLookup';
  const conditionalOptions = isConditionalField
    ? parseConditionalFieldOptions(row.options)
    : ok<ConditionalFieldOptionsMeta | null>(null);
  if (conditionalOptions.isErr()) return err(conditionalOptions.error);

  const normalizedType = isLookupField ? 'lookup' : row.type;

  return ok({
    id: fieldId.value,
    tableId: tableId.value,
    type: normalizedType,
    isComputed: Boolean(row.is_computed),
    isLookup: Boolean(row.is_lookup),
    options: options.value,
    lookupOptions: lookupOptions.value,
    conditionalOptions: conditionalOptions.value,
  });
};

const parseReferenceRow = (row: ReferenceRow): Result<FieldDependencyEdge | null, DomainError> => {
  const fromFieldId = FieldId.create(row.from_field_id);
  if (fromFieldId.isErr()) return err(fromFieldId.error);
  const toFieldId = FieldId.create(row.to_field_id);
  if (toFieldId.isErr()) return err(toFieldId.error);
  const fromTableId = TableId.create(row.from_table_id);
  if (fromTableId.isErr()) return err(fromTableId.error);
  const toTableId = TableId.create(row.to_table_id);
  if (toTableId.isErr()) return err(toTableId.error);

  const isSameTable = fromTableId.value.equals(toTableId.value);
  if (shouldSkipReferenceEdge(isSameTable, row.to_field_type)) {
    return ok(null);
  }

  return ok({
    fromFieldId: fromFieldId.value,
    toFieldId: toFieldId.value,
    fromTableId: fromTableId.value,
    toTableId: toTableId.value,
    kind: isSameTable ? 'same_record' : 'cross_record',
    semantic: 'formula_ref',
  });
};

const shouldSkipReferenceEdge = (isSameTable: boolean, toFieldType: string): boolean => {
  if (!isSameTable) return false;
  return (
    toFieldType === 'lookup' ||
    toFieldType === 'rollup' ||
    toFieldType === 'link' ||
    toFieldType === 'conditionalRollup' ||
    toFieldType === 'conditionalLookup'
  );
};

const toDebugEdge = (edge: FieldDependencyEdge): DebugFieldRelationEdge => ({
  fromFieldId: edge.fromFieldId.toString(),
  toFieldId: edge.toFieldId.toString(),
  fromTableId: edge.fromTableId.toString(),
  toTableId: edge.toTableId.toString(),
  kind: edge.kind,
  semantic: edge.semantic,
  linkFieldId: edge.linkFieldId?.toString(),
});

const mergeEdges = (
  referenceEdges: ReadonlyArray<FieldDependencyEdge>,
  derivedEdges: ReadonlyArray<FieldDependencyEdge>
): ReadonlyArray<FieldDependencyEdge> => {
  const map = new Map<string, FieldDependencyEdge>();
  const add = (edge: FieldDependencyEdge) => {
    const linkKey = edge.linkFieldId?.toString() ?? '';
    const key = `${edge.fromFieldId.toString()}|${edge.toFieldId.toString()}|${edge.kind}|${linkKey}`;
    if (!map.has(key)) {
      map.set(key, edge);
    }
  };
  derivedEdges.forEach(add);
  referenceEdges.forEach(add);
  return [...map.values()];
};
