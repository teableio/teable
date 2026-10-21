import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

export const getViewInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
});

export type IGetViewQueryInput = z.input<typeof getViewInputSchema>;

export class GetViewQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {}

  static create(raw: unknown): Result<GetViewQuery, DomainError> {
    const parsed = getViewInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid GetViewQuery input' }));
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map((viewId) => new GetViewQuery(tableId, viewId))
    );
  }
}
