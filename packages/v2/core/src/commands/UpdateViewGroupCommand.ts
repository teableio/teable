import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { viewGroupSchema, type ViewGroupDTO } from '../domain/table/views/ViewGroup';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const updateViewGroupInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  group: viewGroupSchema,
});

export class UpdateViewGroupCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly group: ViewGroupDTO
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewGroupCommand, DomainError> {
    const parsed = updateViewGroupInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewGroupCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new UpdateViewGroupCommand(tableId, viewId, parsed.data.group)
      )
    );
  }
}
