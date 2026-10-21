import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const duplicateViewInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
});

export type IDuplicateViewCommandInput = z.input<typeof duplicateViewInputSchema>;

export class DuplicateViewCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {
    super();
  }

  static create(raw: unknown): Result<DuplicateViewCommand, DomainError> {
    const parsed = duplicateViewInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DuplicateViewCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => new DuplicateViewCommand(tableId, viewId))
    );
  }
}
