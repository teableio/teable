import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

const restoreViewInputSchema = z.object({ tableId: z.string(), viewId: z.string() }).strict();

export class RestoreViewCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {
    super();
  }

  static create(raw: unknown): Result<RestoreViewCommand, DomainError> {
    const parsed = restoreViewInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid RestoreViewCommand input' }));
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => new RestoreViewCommand(tableId, viewId))
    );
  }
}
