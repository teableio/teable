import { BaseId, domainError, FieldId, TableId, type DomainError } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';

export type FieldDependencyEdge = {
  fromFieldId: FieldId;
  toFieldId: FieldId;
  fromTableId: TableId;
  toTableId: TableId;
  source: 'reference' | 'legacy';
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

export type FieldMeta = {
  id: FieldId;
  tableId: TableId;
  type: string;
  isComputed: boolean;
  options: LinkOptionsMeta | null;
  lookupOptions: LookupOptionsMeta | null;
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

        const legacyEdges: FieldDependencyEdge[] = [];
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

            legacyEdges.push({
              fromFieldId: linkFieldId,
              toFieldId: field.id,
              fromTableId: field.tableId,
              toTableId: field.tableId,
              source: 'legacy',
            });
            legacyEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              source: 'legacy',
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
            legacyEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              source: 'legacy',
            });
          }
        }

        const edges = mergeEdges(referenceEdges, legacyEdges);
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
        const lookupOptions =
          row.type === 'lookup' || row.type === 'rollup'
            ? parseLookupOptions(row.lookup_options)
            : ok<LookupOptionsMeta | null>(null);
        if (lookupOptions.isErr()) return err(lookupOptions.error);

        fields.push({
          id: fieldId.value,
          tableId: tableId.value,
          type: row.type,
          isComputed: Boolean(row.is_computed),
          options: options.value,
          lookupOptions: lookupOptions.value,
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

        edges.push({
          fromFieldId: fromFieldId.value,
          toFieldId: toFieldId.value,
          fromTableId: fromTableId.value,
          toTableId: toTableId.value,
          source: 'reference',
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
  legacyEdges: ReadonlyArray<FieldDependencyEdge>
): ReadonlyArray<FieldDependencyEdge> => {
  const map = new Map<string, FieldDependencyEdge>();
  const add = (edge: FieldDependencyEdge) => {
    const key = `${edge.fromFieldId.toString()}|${edge.toFieldId.toString()}`;
    if (!map.has(key)) {
      map.set(key, edge);
    }
  };
  referenceEdges.forEach(add);
  legacyEdges.forEach(add);
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
