import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const refreshViewShareIdInputSchema = z
  .object({
    tableId: z.string(),
    viewId: z.string(),
  })
  .strict();

export class RefreshViewShareIdCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {
    super();
  }

  static create(raw: unknown): Result<RefreshViewShareIdCommand, DomainError> {
    const parsed = refreshViewShareIdInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid RefreshViewShareIdCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new RefreshViewShareIdCommand(tableId, viewId)
      )
    );
  }
}
