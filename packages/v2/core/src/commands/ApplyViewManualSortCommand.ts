import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { viewSortItemSchema, type ViewSortItem } from '../domain/table/views/ViewSort';
import { PublicCommand } from './PublicCommand';

export const applyViewManualSortInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  sort: z.array(viewSortItemSchema),
});

export class ApplyViewManualSortCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly sort: ReadonlyArray<ViewSortItem>
  ) {
    super();
  }

  static create(raw: unknown): Result<ApplyViewManualSortCommand, DomainError> {
    const parsed = applyViewManualSortInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ApplyViewManualSortCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new ApplyViewManualSortCommand(tableId, viewId, parsed.data.sort)
      )
    );
  }
}
