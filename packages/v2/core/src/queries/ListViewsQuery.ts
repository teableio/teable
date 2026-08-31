import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

export const listViewsInputSchema = z.object({
  tableId: z.string(),
  viewIds: z.array(z.string()).optional(),
});

export type IListViewsQueryInput = z.input<typeof listViewsInputSchema>;

export class ListViewsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewIds: ReadonlyArray<ViewId> | undefined
  ) {}

  static create(raw: unknown): Result<ListViewsQuery, DomainError> {
    const parsed = listViewsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid ListViewsQuery input' }));
    }

    const viewIds: ViewId[] | undefined = parsed.data.viewIds ? [] : undefined;
    if (viewIds) {
      const seen = new Set<string>();
      for (const rawViewId of parsed.data.viewIds ?? []) {
        const viewIdResult = ViewId.create(rawViewId);
        if (viewIdResult.isErr()) return err(viewIdResult.error);
        const viewId = viewIdResult.value;
        if (seen.has(viewId.toString())) continue;
        seen.add(viewId.toString());
        viewIds.push(viewId);
      }
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new ListViewsQuery(tableId, viewIds)
    );
  }
}
