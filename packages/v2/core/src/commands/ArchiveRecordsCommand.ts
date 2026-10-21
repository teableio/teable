import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import type { UndoRedoArchiveTrashRow } from '../ports/UndoRedoStore';

export const archiveRecordsInputSchema = z.object({
  tableId: z.string(),
  recordIds: z.array(z.string()).min(1, 'At least one recordId is required'),
});

export type IArchiveRecordsCommandInput = z.input<typeof archiveRecordsInputSchema>;

export interface IArchiveRecordsCommandOptions {
  /**
   * Stamped on the record_trash rows this archive persists. One id groups the rows
   * of one archive operation — the v1 undo path restores by it. Never accepted from
   * the HTTP contract — internal callers only.
   */
  operationId?: string;
  /**
   * Undo-stack group id: a streamed archive spans several commands, one shared id
   * pops them as a single undo/redo step. Never accepted from the HTTP contract —
   * internal callers only.
   */
  archiveGroupId?: string;
  /**
   * Redo replay only: the record_trash rows captured at original archive time. When
   * present the handler re-persists them (narrowed to what this run actually deletes)
   * instead of rebuilding snapshots, so a redo restores the exact rows the undo
   * removed. Never accepted from the HTTP contract — internal callers only.
   */
  archiveRows?: ReadonlyArray<UndoRedoArchiveTrashRow>;
}

export class ArchiveRecordsCommand {
  readonly operationId?: string;
  readonly archiveGroupId?: string;
  readonly archiveRows?: ReadonlyArray<UndoRedoArchiveTrashRow>;

  private constructor(
    readonly tableId: TableId,
    readonly recordIds: ReadonlyArray<RecordId>,
    options?: IArchiveRecordsCommandOptions
  ) {
    this.operationId = options?.operationId;
    this.archiveGroupId = options?.archiveGroupId;
    this.archiveRows = options?.archiveRows;
  }

  static create(
    raw: unknown,
    options?: IArchiveRecordsCommandOptions
  ): Result<ArchiveRecordsCommand, DomainError> {
    const parsed = archiveRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ArchiveRecordsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      parseRecordIds(parsed.data.recordIds).map(
        (recordIds) => new ArchiveRecordsCommand(tableId, recordIds, options)
      )
    );
  }
}

const parseRecordIds = (
  recordIds: ReadonlyArray<string>
): Result<ReadonlyArray<RecordId>, DomainError> => {
  const parsed: RecordId[] = [];

  for (const rawId of recordIds) {
    const idResult = RecordId.create(rawId);
    if (idResult.isErr()) {
      return err(
        domainError.validation({
          message: 'Invalid recordId in ArchiveRecordsCommand',
          details: { recordId: rawId },
        })
      );
    }
    parsed.push(idResult.value);
  }

  return parsed.length === 0
    ? err(domainError.validation({ message: 'At least one recordId is required' }))
    : (ok(parsed) as Result<ReadonlyArray<RecordId>, DomainError>);
};
