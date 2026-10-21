import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { viewSortSchema, type ViewSortDTO } from '../domain/table/views/ViewSort';
import { PublicCommand } from './PublicCommand';

export const updateViewSortInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  sort: viewSortSchema,
});

export class UpdateViewSortCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly sort: ViewSortDTO
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewSortCommand, DomainError> {
    const parsed = updateViewSortInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewSortCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new UpdateViewSortCommand(tableId, viewId, parsed.data.sort)
      )
    );
  }
}
