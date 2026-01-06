import { BaseId, domainError, FieldId, TableId, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';

/**
 * Edge kind for field dependencies.
 *
 * - `same_record`: Dependency within the same record (no link traversal needed)
 * - `cross_record`: Dependency across records via link (includes same-table self-referencing)
 */
export type FieldDependencyEdgeKind = 'same_record' | 'cross_record';

/**
 * Semantic hint for debugging and logging (does not affect propagation logic).
 */
export type FieldDependencyEdgeSemantic =
  | 'formula_ref'
  | 'lookup_source'
  | 'lookup_link'
  | 'link_title'
  | 'rollup_source'
  | 'conditional_rollup_source'
  | 'conditional_lookup_source';

export type FieldDependencyEdge = {
  fromFieldId: FieldId;
  toFieldId: FieldId;
  fromTableId: TableId;
  toTableId: TableId;
  kind: FieldDependencyEdgeKind;
  /** For cross_record edges: which link field to use for dirty propagation */
  linkFieldId?: FieldId;
  /** Semantic hint for debugging (does not affect propagation) */
  semantic?: FieldDependencyEdgeSemantic;
};

export type LookupOptionsMeta = {
  linkFieldId: string;
  foreignTableId: string;
  lookupFieldId: string;
};

export type LinkOptionsMeta = {
  foreignTableId: string;
  lookupFieldId: string;
  symmetricFieldId?: string;
};

/**
 * Metadata for conditional field options (conditionalRollup / conditionalLookup).
 * Unlike regular lookup/rollup, these don't have a linkFieldId.
 */
export type ConditionalFieldOptionsMeta = {
  foreignTableId: string;
  lookupFieldId: string;
  // condition is stored but not needed for dependency graph
};

export type FieldMeta = {
  id: FieldId;
  tableId: TableId;
  type: string;
  isComputed: boolean;
  options: LinkOptionsMeta | null;
  lookupOptions: LookupOptionsMeta | null;
  /** For conditionalRollup/conditionalLookup fields */
  conditionalOptions: ConditionalFieldOptionsMeta | null;
};

export type FieldDependencyGraphData = {
  fieldsById: Map<string, FieldMeta>;
  edges: ReadonlyArray<FieldDependencyEdge>;
};

/**
 * Load field dependency metadata from Postgres (reference + field config).
 *
 * This graph is adapter-side only and does NOT touch core domain wiring.
 *
 * Example
 * ```typescript
 * const graph = new FieldDependencyGraph(db);
 * const data = await graph.load(baseId);
 * // data.edges includes formula/lookup/rollup/link dependencies
 * ```
 */
@injectable()
export class FieldDependencyGraph {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async load(baseId: BaseId): Promise<Result<FieldDependencyGraphData, DomainError>> {
    return safeTry<FieldDependencyGraphData, DomainError>(
      async function* (this: FieldDependencyGraph) {
        const fields = yield* await this.loadFields(baseId);
        const referenceEdges = yield* await this.loadReferenceEdges(baseId);

        const fieldsById = new Map(fields.map((field) => [field.id.toString(), field]));

        const derivedEdges: FieldDependencyEdge[] = [];
        for (const field of fields) {
          const type = field.type;
          if (type === 'lookup' || type === 'rollup') {
            const lookupOptions = field.lookupOptions;
            if (!lookupOptions) {
              return err(
                domainError.validation({
                  message: `Missing lookupOptions for ${type} field ${field.id.toString()}`,
                })
              );
            }
            const linkFieldId = yield* FieldId.create(lookupOptions.linkFieldId);
            const lookupFieldId = yield* FieldId.create(lookupOptions.lookupFieldId);
            const foreignTableId = yield* TableId.create(lookupOptions.foreignTableId);

            // Lookup/Rollup depends on its link field (same record)
            derivedEdges.push({
              fromFieldId: linkFieldId,
              toFieldId: field.id,
              fromTableId: field.tableId,
              toTableId: field.tableId,
              kind: 'same_record',
              semantic: 'lookup_link',
            });

            // Lookup/Rollup depends on source field in foreign table (cross record)
            // Note: This is cross_record even if foreignTableId === field.tableId (self-ref link)
            derivedEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              kind: 'cross_record',
              linkFieldId,
              semantic: type === 'rollup' ? 'rollup_source' : 'lookup_source',
            });
          }

          if (type === 'link') {
            const options = field.options;
            if (!options) {
              return err(
                domainError.validation({
                  message: `Missing options for link field ${field.id.toString()}`,
                })
              );
            }
            const lookupFieldId = yield* FieldId.create(options.lookupFieldId);
            const foreignTableId = yield* TableId.create(options.foreignTableId);

            // Link's stored title depends on the lookup field in foreign table (cross record)
            derivedEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              kind: 'cross_record',
              linkFieldId: field.id, // The link field itself is used for traversal
              semantic: 'link_title',
            });
          }

          // Handle conditional rollup and conditional lookup fields
          if (type === 'conditionalRollup' || type === 'conditionalLookup') {
            const conditionalOptions = field.conditionalOptions;
            if (!conditionalOptions) {
              return err(
                domainError.validation({
                  message: `Missing conditionalOptions for ${type} field ${field.id.toString()}`,
                })
              );
            }
            const lookupFieldId = yield* FieldId.create(conditionalOptions.lookupFieldId);
            const foreignTableId = yield* TableId.create(conditionalOptions.foreignTableId);

            // Conditional rollup/lookup depends on source field in foreign table (cross record)
            // Note: Unlike regular lookup/rollup, there's no linkFieldId for traversal.
            // The condition-based relationship must be handled differently during update propagation.
            derivedEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              kind: 'cross_record',
              // No linkFieldId - conditional fields use conditions instead of link traversal
              semantic:
                type === 'conditionalRollup'
                  ? 'conditional_rollup_source'
                  : 'conditional_lookup_source',
            });
          }
        }

        const edges = mergeEdges(referenceEdges, derivedEdges);
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
          'f.meta as meta',
        ])
        .where('t.base_id', '=', baseId.toString())
        .where('f.deleted_time', 'is', null)
        .where('t.deleted_time', 'is', null)
        .execute();

      const fields: FieldMeta[] = [];
      for (const row of rows) {
        const fieldId = FieldId.create(row.id);
        if (fieldId.isErr()) return err(fieldId.error);
        const tableId = TableId.create(row.table_id);
        if (tableId.isErr()) return err(tableId.error);
        const options =
          row.type === 'link' ? parseLinkOptions(row.options) : ok<LinkOptionsMeta | null>(null);
        if (options.isErr()) return err(options.error);

        // Lookup fields are stored with `is_lookup=true` and type set to inner field type (v1 format)
        // Rollup fields have type='rollup'
        const isLookupField = Boolean(row.is_lookup);
        const isRollupField = row.type === 'rollup';
        const lookupOptions =
          isLookupField || isRollupField
            ? parseLookupOptions(row.lookup_options)
            : ok<LookupOptionsMeta | null>(null);
        if (lookupOptions.isErr()) return err(lookupOptions.error);

        // Conditional fields (conditionalRollup/conditionalLookup) store their config differently
        const isConditionalField =
          row.type === 'conditionalRollup' || row.type === 'conditionalLookup';
        const conditionalOptions = isConditionalField
          ? parseConditionalFieldOptions(row.options)
          : ok<ConditionalFieldOptionsMeta | null>(null);
        if (conditionalOptions.isErr()) return err(conditionalOptions.error);

        // Normalize the type for graph processing:
        // - lookup fields: use 'lookup' as type (regardless of inner field type)
        // - other fields: use stored type
        const normalizedType = isLookupField ? 'lookup' : row.type;

        fields.push({
          id: fieldId.value,
          tableId: tableId.value,
          type: normalizedType,
          isComputed: Boolean(row.is_computed),
          options: options.value,
          lookupOptions: lookupOptions.value,
          conditionalOptions: conditionalOptions.value,
        });
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
        const fromFieldId = FieldId.create(row.from_field_id);
        if (fromFieldId.isErr()) return err(fromFieldId.error);
        const toFieldId = FieldId.create(row.to_field_id);
        if (toFieldId.isErr()) return err(toFieldId.error);
        const fromTableId = TableId.create(row.from_table_id);
        if (fromTableId.isErr()) return err(fromTableId.error);
        const toTableId = TableId.create(row.to_table_id);
        if (toTableId.isErr()) return err(toTableId.error);

        const toFieldType = row.to_field_type;
        const isSameTable = fromTableId.value.equals(toTableId.value);

        // For lookup/rollup/link/conditional fields, their dependencies are handled in derivedEdges.
        // Skip them here to avoid duplicates, especially for self-referencing links
        // where fromTableId === toTableId but it's still cross_record.
        if (
          isSameTable &&
          (toFieldType === 'lookup' ||
            toFieldType === 'rollup' ||
            toFieldType === 'link' ||
            toFieldType === 'conditionalRollup' ||
            toFieldType === 'conditionalLookup')
        ) {
          // These cross-record dependencies (even for self-referencing links)
          // are correctly created in derivedEdges with linkFieldId or conditional options
          continue;
        }

        // Reference edges from the reference table:
        // - If different tables, it's cross_record (formula depends on lookup/link value)
        // - If same table, it's same_record (formula directly references same-table field)
        edges.push({
          fromFieldId: fromFieldId.value,
          toFieldId: toFieldId.value,
          fromTableId: fromTableId.value,
          toTableId: toTableId.value,
          kind: isSameTable ? 'same_record' : 'cross_record',
          semantic: 'formula_ref',
        });
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

const mergeEdges = (
  referenceEdges: ReadonlyArray<FieldDependencyEdge>,
  derivedEdges: ReadonlyArray<FieldDependencyEdge>
): ReadonlyArray<FieldDependencyEdge> => {
  const map = new Map<string, FieldDependencyEdge>();
  const add = (edge: FieldDependencyEdge) => {
    // Key includes kind and linkFieldId to distinguish different propagation paths
    const linkKey = edge.linkFieldId?.toString() ?? '';
    const key = `${edge.fromFieldId.toString()}|${edge.toFieldId.toString()}|${edge.kind}|${linkKey}`;
    if (!map.has(key)) {
      map.set(key, edge);
    }
  };
  // Process derived edges FIRST so they take priority over reference edges.
  // Derived edges have more specific semantics (e.g., lookup_link vs formula_ref).
  derivedEdges.forEach(add);
  referenceEdges.forEach(add);
  return [...map.values()];
};

const parseLinkOptions = (raw: string | null): Result<LinkOptionsMeta | null, DomainError> => {
  if (!raw) return ok(null);
  const parsed = parseJson(raw, 'field.options');
  if (parsed.isErr()) return err(parsed.error);
  const value = parsed.value as Record<string, unknown>;
  const foreignTableId = readString(value, 'foreignTableId');
  if (foreignTableId.isErr()) return err(foreignTableId.error);
  const lookupFieldId = readString(value, 'lookupFieldId');
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);
  const symmetricFieldId = readOptionalString(value, 'symmetricFieldId');
  if (symmetricFieldId.isErr()) return err(symmetricFieldId.error);

  return ok({
    foreignTableId: foreignTableId.value,
    lookupFieldId: lookupFieldId.value,
    ...(symmetricFieldId.value ? { symmetricFieldId: symmetricFieldId.value } : {}),
  });
};

const parseLookupOptions = (raw: string | null): Result<LookupOptionsMeta | null, DomainError> => {
  if (!raw) return ok(null);
  const parsed = parseJson(raw, 'field.lookup_options');
  if (parsed.isErr()) return err(parsed.error);
  const value = parsed.value as Record<string, unknown>;
  const linkFieldId = readString(value, 'linkFieldId');
  if (linkFieldId.isErr()) return err(linkFieldId.error);
  const foreignTableId = readString(value, 'foreignTableId');
  if (foreignTableId.isErr()) return err(foreignTableId.error);
  const lookupFieldId = readString(value, 'lookupFieldId');
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);

  return ok({
    linkFieldId: linkFieldId.value,
    foreignTableId: foreignTableId.value,
    lookupFieldId: lookupFieldId.value,
  });
};

/**
 * Parse conditional field options (for conditionalRollup/conditionalLookup).
 * v1 format: foreignTableId, lookupFieldId, filter, sort, limit are stored directly in options.
 */
const parseConditionalFieldOptions = (
  raw: string | null
): Result<ConditionalFieldOptionsMeta | null, DomainError> => {
  if (!raw) return ok(null);
  const parsed = parseJson(raw, 'field.options (conditional)');
  if (parsed.isErr()) return err(parsed.error);
  const value = parsed.value as Record<string, unknown>;

  // v1 format: foreignTableId and lookupFieldId are directly in options
  const foreignTableId = readOptionalString(value, 'foreignTableId');
  if (foreignTableId.isErr()) return err(foreignTableId.error);
  const lookupFieldId = readOptionalString(value, 'lookupFieldId');
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);

  // If both are missing, return null (field might be incomplete)
  if (!foreignTableId.value || !lookupFieldId.value) {
    return ok(null);
  }

  return ok({
    foreignTableId: foreignTableId.value,
    lookupFieldId: lookupFieldId.value,
  });
};

const parseJson = (raw: string, label: string): Result<unknown, DomainError> => {
  try {
    return ok(JSON.parse(raw));
  } catch {
    return err(domainError.validation({ message: `Invalid JSON for ${label}` }));
  }
};

const readString = (value: Record<string, unknown>, key: string): Result<string, DomainError> => {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return err(domainError.validation({ message: `Missing string "${key}" in config` }));
  }
  return ok(candidate);
};

const readOptionalString = (
  value: Record<string, unknown>,
  key: string
): Result<string | undefined, DomainError> => {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) return ok(undefined);
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return err(domainError.validation({ message: `Invalid string "${key}" in config` }));
  }
  return ok(candidate);
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
