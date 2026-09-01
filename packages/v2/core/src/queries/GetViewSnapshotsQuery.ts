import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

export const getViewSnapshotsInputSchema = z
  .object({
    tableId: z.string(),
    viewIds: z.array(z.string()),
  })
  .strict();

export type IGetViewSnapshotsQueryInput = z.input<typeof getViewSnapshotsInputSchema>;

export class GetViewSnapshotsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewIds: ReadonlyArray<ViewId>
  ) {}

  static create(raw: unknown): Result<GetViewSnapshotsQuery, DomainError> {
    const parsed = getViewSnapshotsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetViewSnapshotsQuery input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const viewIds: ViewId[] = [];
    for (const rawViewId of parsed.data.viewIds) {
      const viewIdResult = ViewId.create(rawViewId);
      if (viewIdResult.isErr()) return err(viewIdResult.error);
      viewIds.push(viewIdResult.value);
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new GetViewSnapshotsQuery(tableId, viewIds)
    );
  }
}
