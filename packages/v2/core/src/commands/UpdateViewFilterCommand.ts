import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import {
  viewSourceFilterSchema,
  type ViewSourceFilterDTO,
} from '../domain/table/views/ViewSourceFilter';
import { PublicCommand } from './PublicCommand';

export const updateViewFilterInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  filter: viewSourceFilterSchema,
});

export class UpdateViewFilterCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly filter: ViewSourceFilterDTO | null
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewFilterCommand, DomainError> {
    const parsed = updateViewFilterInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewFilterCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new UpdateViewFilterCommand(tableId, viewId, parsed.data.filter)
      )
    );
  }
}
