import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const updateViewLockedInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  isLocked: z.boolean().optional(),
});

export type IUpdateViewLockedCommandInput = z.input<typeof updateViewLockedInputSchema>;

export class UpdateViewLockedCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly isLocked: boolean | undefined
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewLockedCommand, DomainError> {
    const parsed = updateViewLockedInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewLockedCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new UpdateViewLockedCommand(tableId, viewId, parsed.data.isLocked)
      )
    );
  }
}
