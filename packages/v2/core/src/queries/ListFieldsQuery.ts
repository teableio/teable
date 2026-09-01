import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

export const listFieldsInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string().optional(),
});

export type IListFieldsQueryInput = z.input<typeof listFieldsInputSchema>;

export class ListFieldsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId?: ViewId
  ) {}

  static create(raw: unknown): Result<ListFieldsQuery, DomainError> {
    const parsed = listFieldsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid ListFieldsQuery input' }));
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) => {
      if (parsed.data.viewId == null) return ok(new ListFieldsQuery(tableId));
      return ViewId.create(parsed.data.viewId).map(
        (viewId) => new ListFieldsQuery(tableId, viewId)
      );
    });
  }
}
