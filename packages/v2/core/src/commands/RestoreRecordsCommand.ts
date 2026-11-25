import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IRecordRemovalReason } from '../domain/table/events/RecordsDeleted';
import { TableId } from '../domain/table/TableId';
import type { IExecutionContext } from '../ports/ExecutionContext';

const actorColumnNames: Record<string, true> = {
  __created_by_actor_type: true,
  __created_by_actor_id: true,
  __last_modified_by_actor_type: true,
  __last_modified_by_actor_id: true,
};

export const restoreRecordsInputSchema = z.object({
  tableId: z.string(),
  records: z
    .array(
      z.object({
        recordId: z.string(),
        fields: z.record(z.string(), z.unknown()).default({}),
        version: z.number().int().optional(),
        orders: z.record(z.string(), z.number()).optional(),
        defaultOrder: z.number().optional(),
        autoNumber: z.number().optional(),
        createdTime: z.string().optional(),
        createdBy: z.string().optional(),
        lastModifiedTime: z.string().optional(),
        lastModifiedBy: z.string().optional(),
        extraColumnValues: z
          .record(z.string(), z.unknown())
          .refine(
            (values) => !Object.keys(values).some((name) => Object.hasOwn(actorColumnNames, name)),
            'Actor columns cannot be restored through extraColumnValues'
          )
          .optional(),
      })
    )
    .min(1, 'At least one record is required'),
});

export type IRestoreRecordsCommandInput = z.input<typeof restoreRecordsInputSchema>;

export type RestoreRecordInput = z.infer<typeof restoreRecordsInputSchema>['records'][number];

export interface IDeferredSelfReferentialLinkRecord {
  recordId: string;
  fields: Record<string, unknown>;
  cleanupTrash?: boolean;
}

export interface IRestoreRecordsCommandOptions {
  /**
   * Delete the attachments_table reference rows of the restored records before
   * re-inserting them. Used when restoring archived records: archiving kept the
   * reference rows (they count toward attachment usage), and the restore insert
   * rebuilds them — without the cleanup they would be double-counted. Never accepted
   * from the HTTP contract — internal callers only.
   */
  cleanupAttachmentRefs?: boolean;
  /**
   * Restore ONLY records that still hold a record_trash row with this reason; the
   * rest are silently skipped. Undo/redo replay sets it: the stack entry carries
   * full snapshots, so a replay after the user purged the trash rows (permanently
   * deleted archive items, emptied the recycle bin) would otherwise resurrect
   * them — the v1 stack is immune because it resolves undo FROM record_trash.
   * Regular restores must NOT set it: the trash cold-fallback restore feeds
   * snapshots whose rows already sank out of PG, and the archive restore runs
   * while its rows are being deleted in the same flow. Never accepted from the
   * HTTP contract — internal callers only.
   */
  requireTrashRowReason?: IRecordRemovalReason;
  /** Server-owned snapshots only; never read from command JSON or archive files. */
  trustedCreatedActorsByRecordId?: ReadonlyMap<string, IExecutionContext['initiator'] | null>;
  /**
   * Internal collector used by multi-chunk undo replay so Phase 1 inserts every
   * record across all chunks before Phase 2 links self-referential FKs. Never
   * accepted from the HTTP contract — internal callers only.
   */
  deferSelfReferentialLinks?: IDeferredSelfReferentialLinkRecord[];
  /**
   * Internal hook populated when the handler resolves the target table's
   * self-referential link field ids.
   */
  onTableSelfLinkFieldsResolved?: (selfLinkFieldIds: ReadonlySet<string>) => void;
  /**
   * Internal flag indicating Phase 2 of a two-phase self-referential link
   * restore against records already inserted in Phase 1. Never accepted from
   * the HTTP contract — internal callers only.
   */
  selfReferentialLinksOnly?: boolean;
  /**
   * Trash record ids whose `record_trash` / `table_trash` cleanup was deferred
   * from Phase 1 until Phase 2 completes. Internal callers only.
   */
  cleanupTrashRecordIds?: ReadonlyArray<string>;
}

export class RestoreRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly records: ReadonlyArray<RestoreRecordInput>,
    readonly cleanupAttachmentRefs?: boolean,
    readonly requireTrashRowReason?: IRecordRemovalReason,
    readonly trustedCreatedActorsByRecordId?: ReadonlyMap<
      string,
      IExecutionContext['initiator'] | null
    >,
    readonly deferSelfReferentialLinks?: IDeferredSelfReferentialLinkRecord[],
    readonly onTableSelfLinkFieldsResolved?: (selfLinkFieldIds: ReadonlySet<string>) => void,
    readonly selfReferentialLinksOnly?: boolean,
    readonly cleanupTrashRecordIds?: ReadonlyArray<string>
  ) {}

  static create(
    raw: unknown,
    options?: IRestoreRecordsCommandOptions
  ): Result<RestoreRecordsCommand, DomainError> {
    const parsed = restoreRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid RestoreRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) =>
        new RestoreRecordsCommand(
          tableId,
          parsed.data.records,
          options?.cleanupAttachmentRefs,
          options?.requireTrashRowReason,
          options?.trustedCreatedActorsByRecordId,
          options?.deferSelfReferentialLinks,
          options?.onTableSelfLinkFieldsResolved,
          options?.selfReferentialLinksOnly,
          options?.cleanupTrashRecordIds
        )
    );
  }
}
