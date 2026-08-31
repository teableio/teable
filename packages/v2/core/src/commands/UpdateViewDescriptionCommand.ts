import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const updateViewDescriptionInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  description: z.string(),
});

export type IUpdateViewDescriptionCommandInput = z.input<typeof updateViewDescriptionInputSchema>;

export class UpdateViewDescriptionCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly description: string
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewDescriptionCommand, DomainError> {
    const parsed = updateViewDescriptionInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewDescriptionCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new UpdateViewDescriptionCommand(tableId, viewId, parsed.data.description)
      )
    );
  }
}
