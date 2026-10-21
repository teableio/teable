import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { ViewName } from '../domain/table/views/ViewName';
import { PublicCommand } from './PublicCommand';

export const renameViewInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  name: z.string(),
});

export type IRenameViewCommandInput = z.input<typeof renameViewInputSchema>;

export class RenameViewCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly name: ViewName
  ) {
    super();
  }

  static create(raw: unknown): Result<RenameViewCommand, DomainError> {
    const parsed = renameViewInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid RenameViewCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).andThen((viewId) =>
        ViewName.create(parsed.data.name).map(
          (name) => new RenameViewCommand(tableId, viewId, name)
        )
      )
    );
  }
}
