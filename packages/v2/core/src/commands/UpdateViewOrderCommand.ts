import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const updateViewOrderInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  anchorId: z.string(),
  position: z.enum(['before', 'after']),
});

export class UpdateViewOrderCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly anchorId: ViewId,
    readonly position: 'before' | 'after'
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewOrderCommand, DomainError> {
    const parsed = updateViewOrderInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewOrderCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).andThen((viewId) =>
        ViewId.create(parsed.data.anchorId).map(
          (anchorId) => new UpdateViewOrderCommand(tableId, viewId, anchorId, parsed.data.position)
        )
      )
    );
  }
}
