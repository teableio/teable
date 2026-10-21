import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import type { ViewShareMetaValue } from '../domain/table/views/ViewProperties';
import { PublicCommand } from './PublicCommand';

export const updateViewShareMetaInputSchema = z
  .object({
    tableId: z.string(),
    viewId: z.string(),
    shareMeta: z
      .object({
        allowCopy: z.boolean().optional(),
        includeHiddenField: z.boolean().optional(),
        password: z.string().min(3).optional(),
        includeRecords: z.boolean().optional(),
        submit: z.object({ requireLogin: z.boolean().optional() }).strict().optional(),
        allowEdit: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export class UpdateViewShareMetaCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly shareMeta: ViewShareMetaValue
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewShareMetaCommand, DomainError> {
    const parsed = updateViewShareMetaInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewShareMetaCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new UpdateViewShareMetaCommand(tableId, viewId, parsed.data.shareMeta)
      )
    );
  }
}
