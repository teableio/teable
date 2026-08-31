import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const deleteViewInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
});

export type IDeleteViewCommandInput = z.input<typeof deleteViewInputSchema>;

export class DeleteViewCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {
    super();
  }

  static create(raw: unknown): Result<DeleteViewCommand, DomainError> {
    const parsed = deleteViewInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DeleteViewCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => new DeleteViewCommand(tableId, viewId))
    );
  }
}
