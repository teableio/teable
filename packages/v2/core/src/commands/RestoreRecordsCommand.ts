import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IRecordRemovalReason } from '../domain/table/events/RecordsDeleted';
import { TableId } from '../domain/table/TableId';

export const restoreRecordsInputSchema = z.object({
  tableId: z.string(),
  records: z
    .array(
      z.object({
        recordId: z.string(),
        fields: z.record(z.string(), z.unknown()).default({}),
        version: z.number().int().optional(),
        orders: z.record(z.string(), z.number()).optional(),
        autoNumber: z.number().optional(),
        createdTime: z.string().optional(),
        createdBy: z.string().optional(),
        lastModifiedTime: z.string().optional(),
        lastModifiedBy: z.string().optional(),
        extraColumnValues: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1, 'At least one record is required'),
});

export type IRestoreRecordsCommandInput = z.input<typeof restoreRecordsInputSchema>;

export type RestoreRecordInput = z.infer<typeof restoreRecordsInputSchema>['records'][number];

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
}

export class RestoreRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly records: ReadonlyArray<RestoreRecordInput>,
    readonly cleanupAttachmentRefs?: boolean,
    readonly requireTrashRowReason?: IRecordRemovalReason
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
          options?.requireTrashRowReason
        )
    );
  }
}
