import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const updateViewOptionsInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  options: z.record(z.string(), z.unknown()),
});

export class UpdateViewOptionsCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly options: Readonly<Record<string, unknown>>
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewOptionsCommand, DomainError> {
    const parsed = updateViewOptionsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewOptionsCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new UpdateViewOptionsCommand(tableId, viewId, parsed.data.options)
      )
    );
  }
}
