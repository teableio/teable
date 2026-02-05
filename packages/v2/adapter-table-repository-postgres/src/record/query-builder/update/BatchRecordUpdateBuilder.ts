import { FieldId, FieldType, ok } from '@teable/v2-core';
import type { DomainError, ICellValueSpec, RecordId, Table } from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { UpdateImpactHint } from '../../computed';
import { isPersistedAsGeneratedColumn } from '../../computed/isPersistedAsGeneratedColumn';
import { createEmptyCollectedLinkChanges, type CollectedLinkChanges } from '../../visitors';
import { CellValueMutateVisitor } from '../../visitors/CellValueMutateVisitor';
import type { CompiledSqlStatement, LinkedRecordLockInfo } from '../insert';
import type { DynamicDB } from '../ITableRecordQueryBuilder';

import type { RecordUpdateBuilderContext, RecordUpdateSeedGroup } from './RecordUpdateBuilder';

/**
 * Input for a single record update in a batch.
 */
export interface BatchRecordUpdateInput {
  recordId: RecordId;
  mutateSpec: ICellValueSpec;
}

/**
 * Aggregated impact for batch updates.
 */
export interface BatchRecordUpdateImpact {
  impactHint: UpdateImpactHint;
  extraSeedRecords: ReadonlyArray<RecordUpdateSeedGroup>;
  linkChanges: CollectedLinkChanges;
  valueFieldIds: ReadonlyArray<FieldId>;
  linkedRecordLocks: LinkedRecordLockInfo[];
}

/**
 * Result of building batch update data (raw form for batching).
 */
export interface BatchRecordUpdateDataResult {
  /**
   * Raw update values grouped by column for batch UPDATE generation.
   * Map<columnName, Array<{ recordId, value }>>
   *
   * This structure is transposed from per-record to per-column to facilitate
   * the unnest(ARRAY[...]) pattern in PostgreSQL.
   */
  columnUpdateData: Map<string, Array<{ recordId: string; value: unknown }>>;

  /**
   * Additional SQL statements (junction table operations, FK updates).
   * These are compiled immediately as they're not easily batchable.
   */
  additionalStatements: CompiledSqlStatement[];

  /**
   * Deduplicated and sorted linked record locks.
   */
  linkedRecordLocks: LinkedRecordLockInfo[];

  /**
   * Aggregated impact across all records.
   */
  impact: BatchRecordUpdateImpact;

  /**
   * System columns that always update (for batch query generation).
   */
  systemColumns: {
    lastModifiedTime: string;
    lastModifiedBy: string;
    versionIncrement: boolean;
  };

  /**
   * All record IDs being updated (in order).
   */
  recordIds: string[];
}

/**
 * Internal structure for a single record's mutation processing.
 */
interface RecordMutationData {
  recordId: string;
  setClauses: Record<string, unknown>;
  additionalStatements: CompiledSqlStatement[];
  changedFieldIds: FieldId[];
}

/**
 * Builds batch UPDATE data for multiple records using mutation specifications.
 *
 * This builder processes multiple record updates, collecting update values
 * and generating structured data for efficient batch SQL execution.
 *
 * Unlike RecordUpdateBuilder which returns compiled SQL, this builder returns
 * raw data structures that can be combined and batched before SQL generation.
 *
 * @example
 * ```typescript
 * const batchBuilder = new BatchRecordUpdateBuilder(db);
 * const result = await batchBuilder.buildBatchUpdateData({
 *   table,
 *   tableName: 'my_table',
 *   updates: [
 *     { recordId: rec1, mutateSpec: spec1 },
 *     { recordId: rec2, mutateSpec: spec2 },
 *   ],
 *   context: { actorId: 'usr_xxx', now: new Date().toISOString() },
 * });
 * ```
 */
export class BatchRecordUpdateBuilder {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  /**
   * Build batch update data for multiple records (raw form for batching).
   *
   * This method:
   * 1. Processes each mutateSpec using CellValueMutateVisitor
   * 2. Collects raw SET clause values per record per column
   * 3. Transposes data from per-record to per-column structure
   * 4. Generates additional statements for link fields
   * 5. Aggregates impact and locks across all records
   * 6. Returns structured data ready for batch SQL generation
   *
   * @param params.table - The table being updated
   * @param params.tableName - Physical DB table name
   * @param params.updates - Array of record updates (recordId + mutateSpec)
   * @param params.context - Actor and timestamp context
   * @returns Structured batch update data ready for SQL generation
   */
  async buildBatchUpdateData(params: {
    table: Table;
    tableName: string;
    updates: ReadonlyArray<BatchRecordUpdateInput>;
    context: RecordUpdateBuilderContext;
  }): Promise<Result<BatchRecordUpdateDataResult, DomainError>> {
    const { table, tableName, updates, context } = params;
    const builder = this;

    return safeTry<BatchRecordUpdateDataResult, DomainError>(async function* () {
      // Early return for empty batch
      if (updates.length === 0) {
        return ok({
          columnUpdateData: new Map(),
          additionalStatements: [],
          linkedRecordLocks: [],
          impact: {
            impactHint: { valueFieldIds: [], linkFieldIds: [] },
            extraSeedRecords: [],
            linkChanges: createEmptyCollectedLinkChanges(),
            valueFieldIds: [],
            linkedRecordLocks: [],
          },
          systemColumns: {
            lastModifiedTime: context.now,
            lastModifiedBy: context.actorId,
            versionIncrement: true,
          },
          recordIds: [],
        });
      }

      // Step 1: Process each record's mutation
      const recordMutations: RecordMutationData[] = [];
      const allAdditionalStatements: CompiledSqlStatement[] = [];
      const allChangedFieldIds = new Set<string>();
      const recordUpdateValues = new Map<string, Map<string, unknown>>();

      const lastModifiedByDbFieldNames = new Set<string>();
      for (const field of table.getFields()) {
        if (!field.type().equals(FieldType.lastModifiedBy())) continue;
        const isGenerated = yield* isPersistedAsGeneratedColumn(field);
        if (isGenerated) continue;

        const dbFieldName = yield* field.dbFieldName();
        const dbFieldNameValue = yield* dbFieldName.value();
        lastModifiedByDbFieldNames.add(dbFieldNameValue);
      }
      const lastModifiedByJsonValue =
        lastModifiedByDbFieldNames.size > 0 ? buildLastModifiedByJsonValue(context) : undefined;

      for (const update of updates) {
        const recordIdStr = update.recordId.toString();

        // Use CellValueMutateVisitor to process this record's spec
        const mutateVisitor = CellValueMutateVisitor.create(builder.db, table, tableName, {
          recordId: recordIdStr,
          actorId: context.actorId,
          now: context.now,
          actorName: context.actorName,
          actorEmail: context.actorEmail,
        });

        // Accept the mutation spec
        yield* update.mutateSpec.accept(mutateVisitor);

        // Apply tracked field updates (LastModifiedTime, LastModifiedBy)
        // This is normally done in build(), but we need raw values
        const statementsResult = mutateVisitor.build();
        if (statementsResult.isErr()) {
          return err(statementsResult.error);
        }

        // Get raw SET clauses before SQL compilation
        const raw = mutateVisitor.getSetClausesRaw();

        // Store for this record
        const recordSetClauses = new Map<string, unknown>();
        for (const [columnName, value] of Object.entries(raw.setClauses)) {
          // Skip VERSION_COLUMN as it's handled specially in batch SQL
          if (columnName === '__version') {
            continue;
          }
          const resolvedValue =
            lastModifiedByJsonValue && lastModifiedByDbFieldNames.has(columnName)
              ? lastModifiedByJsonValue
              : value;
          recordSetClauses.set(columnName, resolvedValue);
        }
        recordUpdateValues.set(recordIdStr, recordSetClauses);

        // Collect additional statements (junction tables, FK updates)
        const { additionalStatements, changedFieldIds } = statementsResult.value;
        for (const stmt of additionalStatements) {
          allAdditionalStatements.push({
            description: `Additional statement for record ${recordIdStr}`,
            compiled: stmt,
          });
        }

        // Collect changed field IDs
        for (const fieldId of changedFieldIds) {
          allChangedFieldIds.add(fieldId.toString());
        }

        recordMutations.push({
          recordId: recordIdStr,
          setClauses: Object.fromEntries(recordSetClauses),
          additionalStatements: [],
          changedFieldIds,
        });
      }

      // Step 2: Transpose data structure for batch SQL generation
      // From Map<recordId, Map<column, value>> to Map<column, Array<{ recordId, value }>>
      const columnUpdateData = builder.transposeUpdateData(recordUpdateValues);

      // Step 3: Collect impact data (for now, simplified version)
      // TODO: Implement full impact collection with link change analysis
      const allFieldIds = Array.from(allChangedFieldIds, (id) => {
        const result = FieldId.create(id);
        if (result.isErr()) throw new Error(`Invalid field ID: ${id}`);
        return result.value;
      });

      const valueFieldIds: FieldId[] = [];
      const linkFieldIds: FieldId[] = [];
      for (const fieldId of allFieldIds) {
        const fieldResult = table.getField((candidate) => candidate.id().equals(fieldId));
        if (fieldResult.isOk()) {
          const field = fieldResult.value;
          if (field.type().toString() === 'link') {
            linkFieldIds.push(fieldId);
          } else {
            valueFieldIds.push(fieldId);
          }
        }
      }

      // Step 4: Deduplicate and sort locks
      // For now, simplified - full implementation would collect from link changes
      const linkedRecordLocks: LinkedRecordLockInfo[] = [];

      // Step 5: Build impact structure
      const impact: BatchRecordUpdateImpact = {
        impactHint: {
          valueFieldIds,
          linkFieldIds,
        },
        extraSeedRecords: [],
        linkChanges: createEmptyCollectedLinkChanges(),
        valueFieldIds,
        linkedRecordLocks,
      };

      return ok({
        columnUpdateData,
        additionalStatements: allAdditionalStatements,
        linkedRecordLocks,
        impact,
        systemColumns: {
          lastModifiedTime: context.now,
          lastModifiedBy: context.actorId,
          versionIncrement: true,
        },
        recordIds: updates.map((u) => u.recordId.toString()),
      });
    });
  }

  /**
   * Transform per-record column values to per-column record arrays.
   *
   * Input: Map<recordId, Map<columnName, value>>
   * Output: Map<columnName, Array<{ recordId, value }>>
   *
   * This transpose operation prepares data for the unnest(ARRAY[...]) pattern
   * used in PostgreSQL batch updates.
   *
   * @private
   */
  private transposeUpdateData(
    recordUpdateValues: Map<string, Map<string, unknown>>
  ): Map<string, Array<{ recordId: string; value: unknown }>> {
    const columnUpdateData = new Map<string, Array<{ recordId: string; value: unknown }>>();

    for (const [recordId, columns] of recordUpdateValues) {
      for (const [columnName, value] of columns) {
        if (!columnUpdateData.has(columnName)) {
          columnUpdateData.set(columnName, []);
        }
        columnUpdateData.get(columnName)!.push({ recordId, value });
      }
    }

    return columnUpdateData;
  }

  /**
   * Deduplicate and sort linked record locks to prevent deadlocks.
   *
   * Locks must be acquired in consistent order across transactions
   * to prevent circular wait conditions.
   *
   * @private
   */
  private deduplicateLinkedRecordLocks(locks: LinkedRecordLockInfo[]): LinkedRecordLockInfo[] {
    const lockKeysSet = new Set<string>();
    const lockMap = new Map<string, LinkedRecordLockInfo>();

    for (const lock of locks) {
      const key = `${lock.foreignTableId}:${lock.foreignRecordId}`;
      if (!lockKeysSet.has(key)) {
        lockKeysSet.add(key);
        lockMap.set(key, lock);
      }
    }

    // Sort by key to ensure consistent lock ordering
    const sortedKeys = Array.from(lockKeysSet).sort();
    return sortedKeys.map((key) => lockMap.get(key)!);
  }
}

const LAST_MODIFIED_BY_AVATAR_PREFIX = '/api/attachments/read/public/avatar/';

function buildLastModifiedByJsonValue(context: RecordUpdateBuilderContext): string {
  const title = context.actorName ?? context.actorId;
  const email = context.actorEmail ?? null;
  return JSON.stringify({
    id: context.actorId,
    title,
    email,
    avatarUrl: `${LAST_MODIFIED_BY_AVATAR_PREFIX}${context.actorId}`,
  });
}
