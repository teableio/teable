import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

export const getViewFilterLinkRecordsInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
});

export type IGetViewFilterLinkRecordsQueryInput = z.input<
  typeof getViewFilterLinkRecordsInputSchema
>;

export class GetViewFilterLinkRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {}

  static create(raw: unknown): Result<GetViewFilterLinkRecordsQuery, DomainError> {
    const parsed = getViewFilterLinkRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid GetViewFilterLinkRecordsQuery input' })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new GetViewFilterLinkRecordsQuery(tableId, viewId)
      )
    );
  }
}
