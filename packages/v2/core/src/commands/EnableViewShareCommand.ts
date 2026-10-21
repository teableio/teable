import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const enableViewShareInputSchema = z
  .object({
    tableId: z.string(),
    viewId: z.string(),
  })
  .strict();

export type IEnableViewShareCommandInput = z.input<typeof enableViewShareInputSchema>;

export class EnableViewShareCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {
    super();
  }

  static create(raw: unknown): Result<EnableViewShareCommand, DomainError> {
    const parsed = enableViewShareInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid EnableViewShareCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => new EnableViewShareCommand(tableId, viewId))
    );
  }
}
