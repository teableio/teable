import { resolvePostgresDbOrTx } from '@teable/v2-adapter-db-postgres-shared';
import {
  createTeableSpanAttributes,
  domainError,
  FieldId,
  TableId,
  TeableSpanAttributes,
  v2CoreTokens,
} from '@teable/v2-core';
import type { BaseId, IExecutionContext, DomainError, ILogger } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import {
  describeError,
  parseConditionalFieldOptions,
  parseLinkOptions,
  parseLookupOptions,
  type FieldDependencyEdgeKind,
  type FieldDependencyEdgeSemantic,
  type ParsedConditionalOptions as ConditionalFieldOptionsMeta,
  type ParsedLinkOptions as LinkOptionsMeta,
  type ParsedLookupOptions as LookupOptionsMeta,
} from '@teable/v2-field-dependency-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import { isComputedFieldType } from './ComputedUpdatePlanner';

export type TableProvisionStateForDependencyGraph = 'ready' | 'pending' | 'deleting';

export type TableProvisionStatesForDependencyGraph = readonly [
  TableProvisionStateForDependencyGraph,
  ...TableProvisionStateForDependencyGraph[],
];

const DEFAULT_TABLE_PROVISION_STATES: TableProvisionStatesForDependencyGraph = ['ready', 'pending'];

const COMPUTED_TARGET_FIELD_TYPES = [
  'formula',
  'link',
  'lookup',
  'rollup',
  'conditionalLookup',
  'conditionalRollup',
] as const;

const SYSTEM_COMPUTED_FIELD_TYPES = [
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'autoNumber',
] as const;

const tableProvisionPredicate = (
  alias: string,
  tableProvisionStates: TableProvisionStatesForDependencyGraph,
  scopedPendingTableIds: ReadonlyArray<TableId> = []
) => {
  const provisionStateRef = sql.ref(`${alias}.provision_state`);
  const stateSql = sql.join(
    tableProvisionStates.map((state) => sql`${state}`),
    sql`, `
  );
  const pendingIds = scopedPendingTableIds.map((tableId) => tableId.toString());
  if (pendingIds.length === 0) {
    return sql<boolean>`${provisionStateRef} IN (${stateSql})`;
  }

  return sql<boolean>`(
    ${provisionStateRef} IN (${stateSql})
    OR (
      ${sql.ref(`${alias}.id`)} IN (${sql.join(
        pendingIds.map((tableId) => sql`${tableId}`),
        sql`, `
      )})
      AND ${provisionStateRef} = 'pending'
    )
  )`;
};

const withGraphTraceSpan = async <T>(
  executionContext: IExecutionContext | undefined,
  operation: string,
  extraAttributes: Record<string, string | number | boolean>,
  work: () => Promise<T>
): Promise<T> => {
  const tracer = executionContext?.tracer;
  const span = tracer?.startSpan(
    `teable.FieldDependencyGraph.${operation}`,
    createTeableSpanAttributes('repository', `FieldDependencyGraph.${operation}`, {
      [TeableSpanAttributes.HANDLER]: 'FieldDependencyGraph',
      ...extraAttributes,
    })
  );

  if (!span || !tracer) {
    return work();
  }

  return tracer.withSpan(span, async () => {
    try {
      return await work();
    } catch (error) {
      span.recordError(describeError(error));
      throw error;
    } finally {
      span.end();
    }
  });
};

// Re-export shared types
export type { FieldDependencyEdgeKind, FieldDependencyEdgeSemantic };

/**
 * Field dependency edge with domain types.
 * Uses FieldId/TableId instead of strings for type safety in the adapter layer.
 */
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

export type { LookupOptionsMeta, LinkOptionsMeta, ConditionalFieldOptionsMeta };

export type LinkRelationship = 'oneMany' | 'manyOne' | 'oneOne' | 'manyMany';

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
 * Cross-base field metadata extracted from reference edges.
 * Used to populate fieldsById for fields that are in a different base
 * but are referenced by fields in the current base.
 */
export type CrossBaseFieldMeta = {
  id: FieldId;
  tableId: TableId;
  type: string;
  baseId: string;
};

export type FieldDependencyGraphLoadOptions = {
  requiredFieldIds?: ReadonlyArray<FieldId>;
  tableProvisionStates?: TableProvisionStatesForDependencyGraph;
  scopedPendingTableIds?: ReadonlyArray<TableId>;
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
    db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly metaDb: Kysely<V1TeableDatabase> = db
  ) {}

  async load(
    baseId: BaseId,
    executionContext?: IExecutionContext,
    options: FieldDependencyGraphLoadOptions = {}
  ): Promise<Result<FieldDependencyGraphData, DomainError>> {
    const db = resolvePostgresDbOrTx(this.metaDb, executionContext, 'meta');
    const seedFieldIds = options.requiredFieldIds ?? [];
    const tableProvisionStates = options.tableProvisionStates ?? DEFAULT_TABLE_PROVISION_STATES;
    const scopedPendingTableIds = options.scopedPendingTableIds ?? [];

    // Use incremental mode when seed field IDs are provided
    if (seedFieldIds.length > 0) {
      return this.loadIncremental(
        db,
        baseId,
        seedFieldIds,
        tableProvisionStates,
        scopedPendingTableIds
      );
    }

    // Full mode: load all computed fields for the entire base
    return this.loadFull(db, baseId, options);
  }

  async hasComputedTargets(
    baseId: BaseId,
    executionContext?: IExecutionContext,
    options: Pick<
      FieldDependencyGraphLoadOptions,
      'tableProvisionStates' | 'scopedPendingTableIds'
    > = {}
  ): Promise<Result<boolean, DomainError>> {
    const db = resolvePostgresDbOrTx(this.metaDb, executionContext, 'meta');
    const tableProvisionStates = options.tableProvisionStates ?? DEFAULT_TABLE_PROVISION_STATES;

    return withGraphTraceSpan(
      executionContext,
      'hasComputedTargets',
      {
        'teable.base_id': baseId.toString(),
      },
      async () => {
        try {
          const row = await db
            .selectFrom('field as f')
            .innerJoin('table_meta as t', 't.id', 'f.table_id')
            .select(sql<number>`1`.as('exists'))
            .where('t.base_id', '=', baseId.toString())
            .where('f.deleted_time', 'is', null)
            .where('t.deleted_time', 'is', null)
            .where(
              tableProvisionPredicate('t', tableProvisionStates, options.scopedPendingTableIds)
            )
            .where((eb) =>
              eb.or([
                eb('f.is_lookup', '=', true),
                eb('f.is_conditional_lookup', '=', true),
                eb('f.type', 'in', [...COMPUTED_TARGET_FIELD_TYPES]),
                sql<boolean>`(
                  f.is_computed = true
                  AND f.type NOT IN (${sql.join(
                    SYSTEM_COMPUTED_FIELD_TYPES.map((type) => sql`${type}`),
                    sql`, `
                  )})
                )`,
              ])
            )
            .limit(1)
            .executeTakeFirst();

          return ok(Boolean(row));
        } catch (error) {
          return err(
            domainError.infrastructure({
              message: `Failed to check computed targets for base ${baseId.toString()}: ${describeError(
                error
              )}`,
            })
          );
        }
      }
    );
  }

  /**
   * Full loading mode - loads all computed fields and references for the entire base.
   * Used when no seed field IDs are provided (e.g., for schema validation).
   */
  private async loadFull(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    baseId: BaseId,
    options: FieldDependencyGraphLoadOptions = {}
  ): Promise<Result<FieldDependencyGraphData, DomainError>> {
    return safeTry<FieldDependencyGraphData, DomainError>(
      async function* (this: FieldDependencyGraph) {
        const tableProvisionStates = options.tableProvisionStates ?? DEFAULT_TABLE_PROVISION_STATES;
        const scopedPendingTableIds = options.scopedPendingTableIds ?? [];
        const fields = yield* await this.loadFields(db, baseId, options);
        const { edges: referenceEdges, crossBaseFields } = yield* await this.loadReferenceEdges(
          db,
          baseId,
          tableProvisionStates,
          scopedPendingTableIds
        );

        const fieldsById = new Map(fields.map((field) => [field.id.toString(), field]));

        // Add cross-base fields to fieldsById so they can be included in computed update steps.
        // These are fields in other bases that are referenced by fields in the current base.
        for (const crossBaseField of crossBaseFields) {
          const fieldKey = crossBaseField.id.toString();
          if (!fieldsById.has(fieldKey)) {
            fieldsById.set(fieldKey, {
              id: crossBaseField.id,
              tableId: crossBaseField.tableId,
              type: crossBaseField.type,
              isComputed: isComputedFieldType(crossBaseField.type),
              options: null,
              lookupOptions: null,
              conditionalOptions: null,
            });
          }
        }

        yield* await this.hydrateFilterFieldMeta(
          db,
          fieldsById,
          fields,
          tableProvisionStates,
          scopedPendingTableIds
        );

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

            // Add dependencies on fields referenced in the lookup/rollup filter.
            // When these fields change, the lookup/rollup needs to be recalculated
            // because the filter result may change.
            if (lookupOptions.filterFieldIds) {
              for (const filterFieldId of lookupOptions.filterFieldIds) {
                const condFieldId = yield* FieldId.create(filterFieldId);
                // Skip if the filter field is already the lookup source field
                if (condFieldId.equals(lookupFieldId)) continue;

                const conditionMeta = fieldsById.get(condFieldId.toString());
                const conditionTableId = conditionMeta?.tableId ?? foreignTableId;
                // Filter fields in the foreign table need cross_record propagation via link traversal.
                // Filter fields in the current table (field.tableId) need same_record propagation.
                // Note: For self-referencing links where foreignTableId equals field.tableId,
                // filter fields are still evaluated on linked records, so they need cross_record.
                const isFilterFieldInCurrentTable =
                  conditionTableId.equals(field.tableId) &&
                  !conditionTableId.equals(foreignTableId);

                derivedEdges.push({
                  fromFieldId: condFieldId,
                  toFieldId: field.id,
                  fromTableId: conditionTableId,
                  toTableId: field.tableId,
                  kind: isFilterFieldInCurrentTable ? 'same_record' : 'cross_record',
                  ...(isFilterFieldInCurrentTable ? {} : { linkFieldId }),
                  semantic: type === 'rollup' ? 'rollup_filter' : 'lookup_filter',
                });
              }
            }
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

            // Add dependencies on fields referenced in the condition filter.
            // When these fields change, the conditional rollup/lookup needs to be recalculated
            // because the filter result may change.
            for (const conditionFieldId of conditionalOptions.conditionFieldIds) {
              const condFieldId = yield* FieldId.create(conditionFieldId);
              // Skip if it's the same as lookupFieldId (already added above)
              if (condFieldId.equals(lookupFieldId)) continue;

              const conditionMeta = fieldsById.get(condFieldId.toString());
              const conditionTableId = conditionMeta?.tableId ?? foreignTableId;
              // Condition fields in the foreign table need cross_record propagation via condition matching.
              // Condition fields in the current table (field.tableId) need same_record propagation.
              // Note: For self-referencing conditionals where foreignTableId equals field.tableId,
              // condition fields are still evaluated on matched records, so they need cross_record.
              const isConditionFieldInCurrentTable =
                conditionTableId.equals(field.tableId) && !conditionTableId.equals(foreignTableId);

              derivedEdges.push({
                fromFieldId: condFieldId,
                toFieldId: field.id,
                fromTableId: conditionTableId,
                toTableId: field.tableId,
                kind: isConditionFieldInCurrentTable ? 'same_record' : 'cross_record',
                // No linkFieldId - conditional fields use conditions instead of link traversal
                semantic:
                  type === 'conditionalRollup'
                    ? 'conditional_rollup_source'
                    : 'conditional_lookup_source',
              });
            }
          }
        }

        const edges = mergeEdges(referenceEdges, derivedEdges);
        return ok({ fieldsById, edges });
      }.bind(this)
    );
  }

  private async hydrateFilterFieldMeta(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    fieldsById: Map<string, FieldMeta>,
    fields: ReadonlyArray<FieldMeta>,
    tableProvisionStates: TableProvisionStatesForDependencyGraph,
    scopedPendingTableIds: ReadonlyArray<TableId> = []
  ): Promise<Result<void, DomainError>> {
    const filterFieldIds = new Set<string>();
    for (const field of fields) {
      field.lookupOptions?.filterFieldIds?.forEach((id) => filterFieldIds.add(id));
      field.conditionalOptions?.conditionFieldIds?.forEach((id) => filterFieldIds.add(id));
    }

    const missingIds = [...filterFieldIds].filter((id) => !fieldsById.has(id));
    if (missingIds.length === 0) {
      return ok(undefined);
    }

    const extraFields = await this.loadFieldsByIds(
      db,
      missingIds,
      tableProvisionStates,
      scopedPendingTableIds
    );
    if (extraFields.isErr()) return err(extraFields.error);

    for (const field of extraFields.value) {
      const key = field.id.toString();
      if (!fieldsById.has(key)) {
        fieldsById.set(key, field);
      }
    }

    return ok(undefined);
  }

  private async loadFields(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    baseId: BaseId,
    options: FieldDependencyGraphLoadOptions
  ): Promise<Result<ReadonlyArray<FieldMeta>, DomainError>> {
    try {
      const tableProvisionStates = options.tableProvisionStates ?? DEFAULT_TABLE_PROVISION_STATES;
      const requiredFieldIds = [
        ...new Set(
          (options.requiredFieldIds ?? [])
            .map((fieldId) => fieldId.toString())
            .filter((fieldId) => fieldId.length > 0)
        ),
      ];

      const computedFieldTypes = [
        'link',
        'rollup',
        'lookup',
        'conditionalRollup',
        'conditionalLookup',
      ];

      const rows = await db
        .selectFrom('field as f')
        .innerJoin('table_meta as t', 't.id', 'f.table_id')
        .leftJoin('table_meta as option_target', (join) =>
          join.onRef(sql`(f.options::json->>'foreignTableId')::text`, '=', 'option_target.id')
        )
        .leftJoin('table_meta as lookup_target', (join) =>
          join.onRef(
            sql`(f.lookup_options::json->>'foreignTableId')::text`,
            '=',
            'lookup_target.id'
          )
        )
        .leftJoin('field as sf', (join) =>
          join.onRef(sql`(f.options::json->>'symmetricFieldId')::text`, '=', 'sf.id')
        )
        .select([
          'f.id as id',
          'f.table_id as table_id',
          'f.type as type',
          'f.is_computed as is_computed',
          'f.is_lookup as is_lookup',
          'f.is_conditional_lookup as is_conditional_lookup',
          'f.options as options',
          'f.lookup_options as lookup_options',
          'f.meta as meta',
          // Check if symmetric field relationship is valid:
          // - symmetric field must exist
          // - symmetric field must not be deleted
          // - symmetric field must be a link type
          // - symmetric field must point back to this field
          sql<boolean>`CASE
            WHEN f.type != 'link' THEN true
            WHEN f.options::json->>'symmetricFieldId' IS NULL THEN true
            WHEN sf.id IS NULL THEN false
            WHEN sf.deleted_time IS NOT NULL THEN false
            WHEN sf.type != 'link' THEN false
            WHEN (sf.options::json->>'symmetricFieldId')::text IS NULL THEN false
            WHEN (sf.options::json->>'symmetricFieldId')::text != f.id THEN false
            ELSE true
          END`.as('symmetric_valid'),
        ])
        .where('t.base_id', '=', baseId.toString())
        .where('f.deleted_time', 'is', null)
        .where('t.deleted_time', 'is', null)
        .where(tableProvisionPredicate('t', tableProvisionStates, options.scopedPendingTableIds))
        .where(
          sql<boolean>`(
            (f.options::json->>'foreignTableId') IS NULL
            OR (
              option_target.deleted_time IS NULL
              AND ${tableProvisionPredicate(
                'option_target',
                tableProvisionStates,
                options.scopedPendingTableIds
              )}
            )
          )`
        )
        .where(
          sql<boolean>`(
            (f.lookup_options::json->>'foreignTableId') IS NULL
            OR (
              lookup_target.deleted_time IS NULL
              AND ${tableProvisionPredicate(
                'lookup_target',
                tableProvisionStates,
                options.scopedPendingTableIds
              )}
            )
          )`
        )
        .where((eb) =>
          eb.or([
            eb('f.is_computed', '=', true),
            eb('f.is_lookup', '=', true),
            eb('f.is_conditional_lookup', '=', true),
            eb('f.type', 'in', computedFieldTypes),
            ...(requiredFieldIds.length > 0 ? [eb('f.id', 'in', requiredFieldIds)] : []),
          ])
        )
        .execute();

      const fields: FieldMeta[] = [];
      for (const row of rows) {
        const fieldId = FieldId.create(row.id);
        if (fieldId.isErr()) return err(fieldId.error);
        const tableId = TableId.create(row.table_id);
        if (tableId.isErr()) return err(tableId.error);

        // Parse link options, clearing invalid symmetric field references
        let options: Result<LinkOptionsMeta | null, DomainError>;
        if (row.type === 'link' && !row.is_lookup && !row.is_conditional_lookup) {
          const parsed = parseLinkOptions(row.options);
          if (parsed.isErr()) return err(parsed.error);

          // If symmetric relationship is broken, treat as one-way link
          if (parsed.value && !row.symmetric_valid) {
            options = ok({ ...parsed.value, symmetricFieldId: undefined });
          } else {
            options = parsed;
          }
        } else {
          options = ok<LinkOptionsMeta | null>(null);
        }
        if (options.isErr()) return err(options.error);

        // Lookup fields are stored with `is_lookup=true` and type set to inner field type (v1 format)
        // Conditional lookup uses `is_conditional_lookup=true` with lookup_options (no linkFieldId)
        // Rollup fields have type='rollup'
        const isLookupField = Boolean(row.is_lookup);
        const isConditionalLookup = Boolean(row.is_conditional_lookup);
        const isRollupField = row.type === 'rollup';
        const lookupOptions =
          (isLookupField && !isConditionalLookup) || isRollupField
            ? parseLookupOptions(row.lookup_options)
            : ok<LookupOptionsMeta | null>(null);
        if (lookupOptions.isErr()) return err(lookupOptions.error);

        // Conditional fields (conditionalRollup/conditionalLookup) store their config differently
        const isConditionalField =
          row.type === 'conditionalRollup' ||
          row.type === 'conditionalLookup' ||
          isConditionalLookup;

        const conditionalOptions = isConditionalField
          ? parseConditionalFieldOptions(isConditionalLookup ? row.lookup_options : row.options)
          : ok<ConditionalFieldOptionsMeta | null>(null);
        if (conditionalOptions.isErr()) return err(conditionalOptions.error);

        // Normalize the type for graph processing:
        // - lookup fields: use 'lookup' as type (regardless of inner field type)
        // - conditional lookup (v1): use 'conditionalLookup' to avoid linkFieldId requirement
        // - formula fields can be stored as their result type with is_computed=true in v1 format
        const normalizedType = isConditionalLookup
          ? 'conditionalLookup'
          : isLookupField
            ? 'lookup'
            : row.is_computed &&
                row.type !== 'link' &&
                row.type !== 'rollup' &&
                row.type !== 'conditionalRollup' &&
                row.type !== 'conditionalLookup'
              ? 'formula'
              : row.type;

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
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    baseId: BaseId,
    tableProvisionStates: TableProvisionStatesForDependencyGraph,
    scopedPendingTableIds: ReadonlyArray<TableId> = []
  ): Promise<
    Result<
      {
        edges: ReadonlyArray<FieldDependencyEdge>;
        crossBaseFields: ReadonlyArray<CrossBaseFieldMeta>;
      },
      DomainError
    >
  > {
    try {
      const selectColumns = [
        'r.from_field_id as from_field_id',
        'r.to_field_id as to_field_id',
        'f_from.table_id as from_table_id',
        'f_to.table_id as to_table_id',
        'f_to.type as to_field_type',
        't_from.base_id as from_base_id',
        't_to.base_id as to_base_id',
      ] as const;

      const fromBaseQuery = db
        .selectFrom('reference as r')
        .innerJoin('field as f_from', 'f_from.id', 'r.from_field_id')
        .innerJoin('field as f_to', 'f_to.id', 'r.to_field_id')
        .innerJoin('table_meta as t_from', 't_from.id', 'f_from.table_id')
        .innerJoin('table_meta as t_to', 't_to.id', 'f_to.table_id')
        .select(selectColumns)
        .where('t_from.base_id', '=', baseId.toString())
        .where('f_from.deleted_time', 'is', null)
        .where('f_to.deleted_time', 'is', null)
        .where('t_from.deleted_time', 'is', null)
        .where('t_to.deleted_time', 'is', null)
        .where(tableProvisionPredicate('t_from', tableProvisionStates, scopedPendingTableIds))
        .where(tableProvisionPredicate('t_to', tableProvisionStates, scopedPendingTableIds));

      const toBaseQuery = db
        .selectFrom('reference as r')
        .innerJoin('field as f_from', 'f_from.id', 'r.from_field_id')
        .innerJoin('field as f_to', 'f_to.id', 'r.to_field_id')
        .innerJoin('table_meta as t_from', 't_from.id', 'f_from.table_id')
        .innerJoin('table_meta as t_to', 't_to.id', 'f_to.table_id')
        .select(selectColumns)
        .where('t_to.base_id', '=', baseId.toString())
        .where('f_from.deleted_time', 'is', null)
        .where('f_to.deleted_time', 'is', null)
        .where('t_from.deleted_time', 'is', null)
        .where('t_to.deleted_time', 'is', null)
        .where(tableProvisionPredicate('t_from', tableProvisionStates, scopedPendingTableIds))
        .where(tableProvisionPredicate('t_to', tableProvisionStates, scopedPendingTableIds));

      const rows = await fromBaseQuery.union(toBaseQuery).execute();

      const edges: FieldDependencyEdge[] = [];
      const crossBaseFieldsMap = new Map<string, CrossBaseFieldMeta>();
      const currentBaseId = baseId.toString();

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

        // Collect cross-base field metadata for fields that are in a different base.
        // This allows the planner to include these fields in computed update steps.
        if (row.to_base_id !== currentBaseId) {
          const toFieldKey = toFieldId.value.toString();
          if (!crossBaseFieldsMap.has(toFieldKey)) {
            crossBaseFieldsMap.set(toFieldKey, {
              id: toFieldId.value,
              tableId: toTableId.value,
              type: toFieldType,
              baseId: row.to_base_id,
            });
          }
        }

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

      return ok({ edges, crossBaseFields: [...crossBaseFieldsMap.values()] });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load reference edges: ${describeError(error)}`,
        })
      );
    }
  }

  /**
   * Incremental loading mode - only loads fields and edges related to the seed fields.
   * Uses recursive CTE to traverse the dependency graph starting from seed fields.
   */
  private async loadIncremental(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    baseId: BaseId,
    seedFieldIds: ReadonlyArray<FieldId>,
    tableProvisionStates: TableProvisionStatesForDependencyGraph,
    scopedPendingTableIds: ReadonlyArray<TableId> = []
  ): Promise<Result<FieldDependencyGraphData, DomainError>> {
    return safeTry<FieldDependencyGraphData, DomainError>(
      async function* (this: FieldDependencyGraph) {
        const seedIds = seedFieldIds.map((id) => id.toString());
        if (seedIds.length === 0) {
          return ok({ fieldsById: new Map<string, FieldMeta>(), edges: [] });
        }

        // Step 1: Find all affected field IDs using iterative traversal
        // (Recursive CTE with multiple UNION branches is complex in Kysely,
        // so we use application-level iteration with batched queries)
        const affectedFieldIds = yield* await this.findAffectedFieldIds(
          db,
          baseId,
          seedIds,
          tableProvisionStates
        );

        // Include seed fields in the result
        for (const seedId of seedIds) {
          affectedFieldIds.add(seedId);
        }

        if (affectedFieldIds.size === 0) {
          return ok({ fieldsById: new Map<string, FieldMeta>(), edges: [] });
        }

        const affectedFieldIdArray = [...affectedFieldIds];

        // Step 2: Load field metadata for affected fields
        const fields = yield* await this.loadFieldsByIds(
          db,
          affectedFieldIdArray,
          tableProvisionStates,
          scopedPendingTableIds
        );

        // Step 3: Load reference edges for affected fields
        const { edges: referenceEdges, crossBaseFields } = yield* await this.loadEdgesByFieldIds(
          db,
          affectedFieldIdArray,
          baseId,
          tableProvisionStates,
          scopedPendingTableIds
        );

        const fieldsById = new Map(fields.map((field) => [field.id.toString(), field]));

        // Add cross-base fields
        for (const crossBaseField of crossBaseFields) {
          const fieldKey = crossBaseField.id.toString();
          if (!fieldsById.has(fieldKey)) {
            fieldsById.set(fieldKey, {
              id: crossBaseField.id,
              tableId: crossBaseField.tableId,
              type: crossBaseField.type,
              isComputed: isComputedFieldType(crossBaseField.type),
              options: null,
              lookupOptions: null,
              conditionalOptions: null,
            });
          }
        }

        yield* await this.hydrateFilterFieldMeta(
          db,
          fieldsById,
          fields,
          tableProvisionStates,
          scopedPendingTableIds
        );

        // Step 4: Build derived edges from field metadata
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

            derivedEdges.push({
              fromFieldId: linkFieldId,
              toFieldId: field.id,
              fromTableId: field.tableId,
              toTableId: field.tableId,
              kind: 'same_record',
              semantic: 'lookup_link',
            });

            derivedEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              kind: 'cross_record',
              linkFieldId,
              semantic: type === 'rollup' ? 'rollup_source' : 'lookup_source',
            });

            // Add dependencies on fields referenced in the lookup/rollup filter.
            // When these fields change, the lookup/rollup needs to be recalculated
            // because the filter result may change.
            if (lookupOptions.filterFieldIds) {
              for (const filterFieldId of lookupOptions.filterFieldIds) {
                const condFieldId = yield* FieldId.create(filterFieldId);
                // Skip if the filter field is already the lookup source field
                if (condFieldId.equals(lookupFieldId)) continue;

                const conditionMeta = fieldsById.get(condFieldId.toString());
                const conditionTableId = conditionMeta?.tableId ?? foreignTableId;
                // Filter fields in the foreign table need cross_record propagation via link traversal.
                // Filter fields in the current table (field.tableId) need same_record propagation.
                // Note: For self-referencing links where foreignTableId equals field.tableId,
                // filter fields are still evaluated on linked records, so they need cross_record.
                const isFilterFieldInCurrentTable =
                  conditionTableId.equals(field.tableId) &&
                  !conditionTableId.equals(foreignTableId);

                derivedEdges.push({
                  fromFieldId: condFieldId,
                  toFieldId: field.id,
                  fromTableId: conditionTableId,
                  toTableId: field.tableId,
                  kind: isFilterFieldInCurrentTable ? 'same_record' : 'cross_record',
                  ...(isFilterFieldInCurrentTable ? {} : { linkFieldId }),
                  semantic: type === 'rollup' ? 'rollup_filter' : 'lookup_filter',
                });
              }
            }
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

            derivedEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              kind: 'cross_record',
              linkFieldId: field.id,
              semantic: 'link_title',
            });
          }

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

            derivedEdges.push({
              fromFieldId: lookupFieldId,
              toFieldId: field.id,
              fromTableId: foreignTableId,
              toTableId: field.tableId,
              kind: 'cross_record',
              semantic:
                type === 'conditionalRollup'
                  ? 'conditional_rollup_source'
                  : 'conditional_lookup_source',
            });

            for (const conditionFieldId of conditionalOptions.conditionFieldIds) {
              const condFieldId = yield* FieldId.create(conditionFieldId);
              if (condFieldId.equals(lookupFieldId)) continue;

              const conditionMeta = fieldsById.get(condFieldId.toString());
              const conditionTableId = conditionMeta?.tableId ?? foreignTableId;
              const isSameTable = conditionTableId.equals(field.tableId);

              derivedEdges.push({
                fromFieldId: condFieldId,
                toFieldId: field.id,
                fromTableId: conditionTableId,
                toTableId: field.tableId,
                kind: isSameTable ? 'same_record' : 'cross_record',
                semantic:
                  type === 'conditionalRollup'
                    ? 'conditional_rollup_source'
                    : 'conditional_lookup_source',
              });
            }
          }
        }

        const edges = mergeEdges(referenceEdges, derivedEdges);
        return ok({ fieldsById, edges });
      }.bind(this)
    );
  }

  /**
   * Find all field IDs that are affected by changes to the seed fields.
   * Uses iterative BFS with batched queries - each iteration queries only the
   * fields that depend on the current batch, avoiding full table scans.
   */
  private async findAffectedFieldIds(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    baseId: BaseId,
    seedIds: string[],
    tableProvisionStates: TableProvisionStatesForDependencyGraph
  ): Promise<Result<Set<string>, DomainError>> {
    const startTime = Date.now();
    let iterationCount = 0;
    const MAX_ITERATIONS = 1000;
    const MAX_VISITED = 50000;

    try {
      const visited = new Set<string>();
      const queue = [...seedIds];

      while (queue.length > 0) {
        iterationCount++;

        // Safety limits to prevent runaway BFS
        if (iterationCount > MAX_ITERATIONS) {
          this.logger.warn('computed:dependency:max_iterations_reached', {
            iterations: iterationCount,
            visited: visited.size,
            queueRemaining: queue.length,
            seedCount: seedIds.length,
            elapsedMs: Date.now() - startTime,
          });
          break;
        }
        if (visited.size > MAX_VISITED) {
          this.logger.warn('computed:dependency:max_visited_reached', {
            iterations: iterationCount,
            visited: visited.size,
            queueRemaining: queue.length,
            seedCount: seedIds.length,
            elapsedMs: Date.now() - startTime,
          });
          break;
        }

        // Process in batches to avoid overly large IN clauses
        const batch = queue.splice(0, 100);
        const batchSet = new Set(batch);

        // Build VALUES clause for the batch
        const batchValues = batch.map((id) => sql`(${id})`);
        const batchValuesClause = sql.join(batchValues, sql`, `);
        const tableProvisionStateSql = sql.join(
          tableProvisionStates.map((state) => sql`${state}`),
          sql`, `
        );
        const referenceQueryLimit = MAX_VISITED + batch.length + 1;

        // Expand healthy reference edges recursively in one query. Keep legacy metadata lookups
        // in separate 100-ID batches below: a large recursive closure can otherwise make the
        // planner abandon expression indexes and scan all link/lookup fields in the database.
        const referenceResult = await sql<{ field_id: string }>`
          WITH RECURSIVE
          batch(id) AS MATERIALIZED (
            VALUES ${batchValuesClause}
          ),
          reference_walk(field_id) AS (
            SELECT id
            FROM batch

            UNION

            SELECT r.to_field_id
            FROM reference_walk affected
            INNER JOIN reference r ON r.from_field_id = affected.field_id
            INNER JOIN field f ON f.id = r.to_field_id
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE f.deleted_time IS NULL
              AND t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})
          )
          SELECT field_id
          FROM reference_walk
          -- Keep one sentinel row beyond the global safety budget. Previously visited rows can
          -- be needed as paths to new descendants, so the limit cannot use only the remaining
          -- budget without risking an incomplete traversal.
          LIMIT ${referenceQueryLimit}
        `.execute(db);

        const referenceClosureIds = [...new Set(referenceResult.rows.map((row) => row.field_id))];
        const referenceClosureSet = new Set(referenceClosureIds);
        const newlyResolvedReferenceIds = referenceClosureIds.filter(
          (fieldId) => !visited.has(fieldId) && !batchSet.has(fieldId)
        );
        const referenceOverflow =
          referenceClosureIds.length >= referenceQueryLimit ||
          newlyResolvedReferenceIds.length > MAX_VISITED - visited.size;

        for (const fieldId of newlyResolvedReferenceIds) {
          visited.add(fieldId);
        }

        // A target discovered by an earlier legacy branch can still be waiting in the queue when
        // another seed reaches it through reference. Its descendants are already expanded by this
        // closure, so remove that stale queue entry instead of querying it again next iteration.
        let retainedQueueLength = 0;
        for (const queuedFieldId of queue) {
          if (!referenceClosureSet.has(queuedFieldId)) {
            queue[retainedQueueLength] = queuedFieldId;
            retainedQueueLength++;
          }
        }
        queue.length = retainedQueueLength;

        if (referenceOverflow || visited.size > MAX_VISITED) {
          this.logger.warn('computed:dependency:max_visited_reached', {
            iterations: iterationCount,
            visited: visited.size,
            queueRemaining: queue.length,
            seedCount: seedIds.length,
            elapsedMs: Date.now() - startTime,
          });
          break;
        }

        // Reference metadata is authoritative for new writes, but old rows may only carry JSON
        // options. Check those fallbacks against every recursively resolved ID in bounded batches.
        for (let offset = 0; offset < referenceClosureIds.length; offset += 100) {
          const fallbackBatch = referenceClosureIds.slice(offset, offset + 100);
          const fallbackBatchValues = fallbackBatch.map((id) => sql`(${id})`);
          const fallbackBatchValuesClause = sql.join(fallbackBatchValues, sql`, `);

          const fallbackResult = await sql<{ field_id: string }>`
            WITH batch(id) AS MATERIALIZED (
              VALUES ${fallbackBatchValuesClause}
            )

            -- 2. Lookup/rollup dependency on linkFieldId - prefer field_lookup_linked_field_id_idx
            SELECT f.id AS field_id
            FROM field f
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE f.deleted_time IS NULL
              AND t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})
              AND (f.type = 'rollup' OR f.is_lookup = true)
              AND f.lookup_linked_field_id = ANY(ARRAY(SELECT id FROM batch))

            UNION ALL

            -- 2b. Fallback for stale rows where JSON has linkFieldId but lookup_linked_field_id is null
            SELECT f.id AS field_id
            FROM batch affected
            CROSS JOIN LATERAL (
              SELECT f.id, f.table_id
              FROM field f
              WHERE f.deleted_time IS NULL
                AND f.lookup_linked_field_id IS NULL
                AND f.lookup_options IS NOT NULL
                AND (f.type = 'rollup' OR f.is_lookup = true)
                AND (f.lookup_options::jsonb)->>'linkFieldId' = affected.id
              -- Prevent pull-up into a global partial-index scan; retain one expression-index
              -- probe per batch ID.
              OFFSET 0
            ) f
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})

            UNION ALL

            -- 3. Lookup/rollup dependency on lookupFieldId - uses field_lookup_options_lookup_field_id_idx
            SELECT f.id AS field_id
            FROM batch affected
            CROSS JOIN LATERAL (
              SELECT f.id, f.table_id
              FROM field f
              WHERE f.deleted_time IS NULL
                AND f.lookup_options IS NOT NULL
                AND (f.type = 'rollup' OR f.is_lookup = true)
                AND (f.lookup_options::jsonb)->>'lookupFieldId' = affected.id
              OFFSET 0
            ) f
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})

            UNION ALL

            -- 4. Link field dependency on lookupFieldId (link_title) - uses field_options_lookup_field_id_idx
            SELECT f.id AS field_id
            FROM field f
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE f.deleted_time IS NULL
              AND t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})
              AND f.type = 'link'
              AND f.options IS NOT NULL
              AND (f.options::jsonb)->>'lookupFieldId' = ANY(ARRAY(SELECT id FROM batch))

            UNION ALL

            -- 5. ConditionalRollup/ConditionalLookup dependency on lookupFieldId
            SELECT f.id AS field_id
            FROM field f
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE f.deleted_time IS NULL
              AND t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})
              AND f.type IN ('conditionalRollup', 'conditionalLookup')
              AND f.options IS NOT NULL
              AND (f.options::jsonb)->>'lookupFieldId' = ANY(ARRAY(SELECT id FROM batch))

            UNION ALL

            -- 6. Conditional lookup (v1) dependency on lookupFieldId
            SELECT f.id AS field_id
            FROM batch affected
            CROSS JOIN LATERAL (
              SELECT f.id, f.table_id
              FROM field f
              WHERE f.deleted_time IS NULL
                AND f.is_conditional_lookup = true
                AND f.lookup_options IS NOT NULL
                AND (f.lookup_options::jsonb)->>'lookupFieldId' = affected.id
              OFFSET 0
            ) f
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})

            UNION ALL

            -- 10. Symmetric link field - when a link field changes, its symmetric field is also affected
            -- The symmetric field can have lookups/rollups that depend on it
            SELECT f.id AS field_id
            FROM field f
            INNER JOIN table_meta t ON t.id = f.table_id
            WHERE f.deleted_time IS NULL
              AND t.deleted_time IS NULL
              AND t.provision_state IN (${tableProvisionStateSql})
              AND f.type = 'link'
              AND f.options IS NOT NULL
              AND (f.options::jsonb)->>'symmetricFieldId' = ANY(ARRAY(SELECT id FROM batch))
          `.execute(db);

          // UNION ALL can return duplicates, and a legacy edge can point back into the already
          // expanded reference closure. The sets preserve the old UNION semantics in memory.
          for (const row of fallbackResult.rows) {
            const fieldId = row.field_id;
            if (!visited.has(fieldId) && !referenceClosureSet.has(fieldId)) {
              visited.add(fieldId);
              queue.push(fieldId);
            }
          }

          if (visited.size > MAX_VISITED) {
            break;
          }
        }

        if (visited.size > MAX_VISITED) {
          continue;
        }

        // Unlike expression-index probes, JSON filter extraction scales with the number of
        // candidate fields in this base, not the closure size. Run it once for the full closure
        // so a large reference graph does not repeatedly parse the same legacy JSON.
        const legacyFilterBatchValues = referenceClosureIds.map((id) => sql`(${id})`);
        const legacyFilterBatchValuesClause = sql.join(legacyFilterBatchValues, sql`, `);
        const legacyFilterResult = await sql<{ field_id: string }>`
          WITH batch(id) AS MATERIALIZED (
            VALUES ${legacyFilterBatchValuesClause}
          )
          SELECT DISTINCT f.id AS field_id
          FROM field f
          INNER JOIN table_meta t ON t.id = f.table_id
          CROSS JOIN LATERAL jsonb_path_query(
            jsonb_build_array(
              CASE
                WHEN f.type IN ('conditionalRollup', 'conditionalLookup')
                  THEN f.options::jsonb
                ELSE NULL
              END,
              CASE
                WHEN f.is_conditional_lookup = true OR f.type = 'rollup' OR f.is_lookup = true
                  THEN f.lookup_options::jsonb
                ELSE NULL
              END
            ),
            '$.**.fieldId'
          ) referenced(value)
          INNER JOIN batch affected ON affected.id = referenced.value #>> '{}'
          WHERE f.deleted_time IS NULL
            AND t.deleted_time IS NULL
            AND t.provision_state IN (${tableProvisionStateSql})
            AND t.base_id = ${baseId.toString()}
            AND (
              (
                f.type IN ('conditionalRollup', 'conditionalLookup')
                AND f.options IS NOT NULL
              )
              OR
              (
                (f.is_conditional_lookup = true OR f.type = 'rollup' OR f.is_lookup = true)
                AND f.lookup_options IS NOT NULL
              )
            )
        `.execute(db);

        for (const row of legacyFilterResult.rows) {
          const fieldId = row.field_id;
          if (!visited.has(fieldId) && !referenceClosureSet.has(fieldId)) {
            visited.add(fieldId);
            queue.push(fieldId);
          }
        }
      }

      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > 100 || visited.size > 100 || iterationCount > 10) {
        this.logger.debug('computed:dependency:findAffectedFieldIds', {
          iterations: iterationCount,
          visited: visited.size,
          seedCount: seedIds.length,
          elapsedMs,
        });
      }

      return ok(visited);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to find affected field IDs: ${describeError(error)}`,
        })
      );
    }
  }

  /**
   * Load field metadata by field IDs.
   */
  private async loadFieldsByIds(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    fieldIds: string[],
    tableProvisionStates: TableProvisionStatesForDependencyGraph,
    scopedPendingTableIds: ReadonlyArray<TableId> = []
  ): Promise<Result<ReadonlyArray<FieldMeta>, DomainError>> {
    if (fieldIds.length === 0) return ok([]);

    try {
      const rows = await db
        .selectFrom('field as f')
        .innerJoin('table_meta as t', 't.id', 'f.table_id')
        .leftJoin('table_meta as option_target', (join) =>
          join.onRef(sql`(f.options::json->>'foreignTableId')::text`, '=', 'option_target.id')
        )
        .leftJoin('table_meta as lookup_target', (join) =>
          join.onRef(
            sql`(f.lookup_options::json->>'foreignTableId')::text`,
            '=',
            'lookup_target.id'
          )
        )
        .leftJoin('field as sf', (join) =>
          join.onRef(sql`(f.options::json->>'symmetricFieldId')::text`, '=', 'sf.id')
        )
        .select([
          'f.id as id',
          'f.table_id as table_id',
          'f.type as type',
          'f.is_computed as is_computed',
          'f.is_lookup as is_lookup',
          'f.is_conditional_lookup as is_conditional_lookup',
          'f.options as options',
          'f.lookup_options as lookup_options',
          // Check if symmetric field relationship is valid
          sql<boolean>`CASE
            WHEN f.type != 'link' THEN true
            WHEN f.options::json->>'symmetricFieldId' IS NULL THEN true
            WHEN sf.id IS NULL THEN false
            WHEN sf.deleted_time IS NOT NULL THEN false
            WHEN sf.type != 'link' THEN false
            WHEN (sf.options::json->>'symmetricFieldId')::text IS NULL THEN false
            WHEN (sf.options::json->>'symmetricFieldId')::text != f.id THEN false
            ELSE true
          END`.as('symmetric_valid'),
        ])
        .where('f.id', 'in', fieldIds)
        .where('f.deleted_time', 'is', null)
        .where('t.deleted_time', 'is', null)
        .where(tableProvisionPredicate('t', tableProvisionStates, scopedPendingTableIds))
        .where(
          sql<boolean>`(
            (f.options::json->>'foreignTableId') IS NULL
            OR (
              option_target.deleted_time IS NULL
              AND ${tableProvisionPredicate(
                'option_target',
                tableProvisionStates,
                scopedPendingTableIds
              )}
            )
          )`
        )
        .where(
          sql<boolean>`(
            (f.lookup_options::json->>'foreignTableId') IS NULL
            OR (
              lookup_target.deleted_time IS NULL
              AND ${tableProvisionPredicate(
                'lookup_target',
                tableProvisionStates,
                scopedPendingTableIds
              )}
            )
          )`
        )
        .execute();

      const fields: FieldMeta[] = [];
      for (const row of rows) {
        const fieldId = FieldId.create(row.id);
        if (fieldId.isErr()) return err(fieldId.error);
        const tableId = TableId.create(row.table_id);
        if (tableId.isErr()) return err(tableId.error);

        // Parse link options, clearing invalid symmetric field references
        let options: Result<LinkOptionsMeta | null, DomainError>;
        if (row.type === 'link' && !row.is_lookup && !row.is_conditional_lookup) {
          const parsed = parseLinkOptions(row.options);
          if (parsed.isErr()) return err(parsed.error);

          // If symmetric relationship is broken, treat as one-way link
          if (parsed.value && !row.symmetric_valid) {
            options = ok({ ...parsed.value, symmetricFieldId: undefined });
          } else {
            options = parsed;
          }
        } else {
          options = ok<LinkOptionsMeta | null>(null);
        }
        if (options.isErr()) return err(options.error);

        const isLookupField = Boolean(row.is_lookup);
        const isConditionalLookup = Boolean(row.is_conditional_lookup);
        const isRollupField = row.type === 'rollup';
        const lookupOptions =
          (isLookupField && !isConditionalLookup) || isRollupField
            ? parseLookupOptions(row.lookup_options)
            : ok<LookupOptionsMeta | null>(null);
        if (lookupOptions.isErr()) return err(lookupOptions.error);

        const isConditionalField =
          row.type === 'conditionalRollup' ||
          row.type === 'conditionalLookup' ||
          isConditionalLookup;

        const conditionalOptions = isConditionalField
          ? parseConditionalFieldOptions(isConditionalLookup ? row.lookup_options : row.options)
          : ok<ConditionalFieldOptionsMeta | null>(null);
        if (conditionalOptions.isErr()) return err(conditionalOptions.error);

        const normalizedType = isConditionalLookup
          ? 'conditionalLookup'
          : isLookupField
            ? 'lookup'
            : row.is_computed &&
                row.type !== 'link' &&
                row.type !== 'rollup' &&
                row.type !== 'conditionalRollup' &&
                row.type !== 'conditionalLookup'
              ? 'formula'
              : row.type;

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
          message: `Failed to load fields by IDs: ${describeError(error)}`,
        })
      );
    }
  }

  /**
   * Load reference edges for specific field IDs.
   */
  private async loadEdgesByFieldIds(
    db: Kysely<V1TeableDatabase> | Transaction<V1TeableDatabase>,
    fieldIds: string[],
    currentBaseId: BaseId,
    tableProvisionStates: TableProvisionStatesForDependencyGraph,
    scopedPendingTableIds: ReadonlyArray<TableId> = []
  ): Promise<
    Result<
      {
        edges: ReadonlyArray<FieldDependencyEdge>;
        crossBaseFields: ReadonlyArray<CrossBaseFieldMeta>;
      },
      DomainError
    >
  > {
    if (fieldIds.length === 0) return ok({ edges: [], crossBaseFields: [] });

    try {
      const selectColumns = [
        'r.from_field_id as from_field_id',
        'r.to_field_id as to_field_id',
        'f_from.table_id as from_table_id',
        'f_to.table_id as to_table_id',
        'f_to.type as to_field_type',
        't_from.base_id as from_base_id',
        't_to.base_id as to_base_id',
      ] as const;

      const fromFieldQuery = db
        .selectFrom('reference as r')
        .innerJoin('field as f_from', 'f_from.id', 'r.from_field_id')
        .innerJoin('field as f_to', 'f_to.id', 'r.to_field_id')
        .innerJoin('table_meta as t_from', 't_from.id', 'f_from.table_id')
        .innerJoin('table_meta as t_to', 't_to.id', 'f_to.table_id')
        .select(selectColumns)
        .where('r.from_field_id', 'in', fieldIds)
        .where('f_from.deleted_time', 'is', null)
        .where('f_to.deleted_time', 'is', null)
        .where('t_from.deleted_time', 'is', null)
        .where('t_to.deleted_time', 'is', null)
        .where(tableProvisionPredicate('t_from', tableProvisionStates, scopedPendingTableIds))
        .where(tableProvisionPredicate('t_to', tableProvisionStates, scopedPendingTableIds));

      const toFieldQuery = db
        .selectFrom('reference as r')
        .innerJoin('field as f_from', 'f_from.id', 'r.from_field_id')
        .innerJoin('field as f_to', 'f_to.id', 'r.to_field_id')
        .innerJoin('table_meta as t_from', 't_from.id', 'f_from.table_id')
        .innerJoin('table_meta as t_to', 't_to.id', 'f_to.table_id')
        .select(selectColumns)
        .where('r.to_field_id', 'in', fieldIds)
        .where('f_from.deleted_time', 'is', null)
        .where('f_to.deleted_time', 'is', null)
        .where('t_from.deleted_time', 'is', null)
        .where('t_to.deleted_time', 'is', null)
        .where(tableProvisionPredicate('t_from', tableProvisionStates, scopedPendingTableIds))
        .where(tableProvisionPredicate('t_to', tableProvisionStates, scopedPendingTableIds));

      const rows = await fromFieldQuery.union(toFieldQuery).execute();

      const edges: FieldDependencyEdge[] = [];
      const crossBaseFieldsMap = new Map<string, CrossBaseFieldMeta>();
      const baseIdStr = currentBaseId.toString();

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

        if (row.to_base_id !== baseIdStr) {
          const toFieldKey = toFieldId.value.toString();
          if (!crossBaseFieldsMap.has(toFieldKey)) {
            crossBaseFieldsMap.set(toFieldKey, {
              id: toFieldId.value,
              tableId: toTableId.value,
              type: toFieldType,
              baseId: row.to_base_id,
            });
          }
        }

        if (
          isSameTable &&
          (toFieldType === 'lookup' ||
            toFieldType === 'rollup' ||
            toFieldType === 'link' ||
            toFieldType === 'conditionalRollup' ||
            toFieldType === 'conditionalLookup')
        ) {
          continue;
        }

        edges.push({
          fromFieldId: fromFieldId.value,
          toFieldId: toFieldId.value,
          fromTableId: fromTableId.value,
          toTableId: toTableId.value,
          kind: isSameTable ? 'same_record' : 'cross_record',
          semantic: 'formula_ref',
        });
      }

      return ok({ edges, crossBaseFields: [...crossBaseFieldsMap.values()] });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to load edges by field IDs: ${describeError(error)}`,
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
