import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { RecordId } from '../domain/table/records/RecordId';
import { RecordId as TableRecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';
import type { ViewId } from '../domain/table/views/ViewId';
import { ViewId as TableViewId } from '../domain/table/views/ViewId';

export const applyRecordOrdersInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  records: z.array(
    z.object({
      recordId: z.string(),
      order: z.number().nullable().optional(),
    })
  ),
});

export type IApplyRecordOrdersCommandInput = z.input<typeof applyRecordOrdersInputSchema>;

type ApplyRecordOrderItem = {
  readonly recordId: RecordId;
  readonly order?: number;
};

export class ApplyRecordOrdersCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly records: ReadonlyArray<ApplyRecordOrderItem>
  ) {}

  static create(raw: unknown): Result<ApplyRecordOrdersCommand, DomainError> {
    const parsed = applyRecordOrdersInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ApplyRecordOrdersCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      TableViewId.create(parsed.data.viewId).andThen((viewId) => {
        const records: ApplyRecordOrderItem[] = [];
        for (const item of parsed.data.records) {
          const recordIdResult = TableRecordId.create(item.recordId);
          if (recordIdResult.isErr()) {
            return err(recordIdResult.error);
          }

          records.push({
            recordId: recordIdResult.value,
            ...(typeof item.order === 'number' ? { order: item.order } : {}),
          });
        }

        return ok(new ApplyRecordOrdersCommand(tableId, viewId, records));
      })
    );
  }
}
