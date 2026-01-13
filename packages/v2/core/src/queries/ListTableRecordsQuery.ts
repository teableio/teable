import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { TableId } from '../domain/table/TableId';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';

/** Default page size for records */
export const DEFAULT_RECORDS_LIMIT = 100;
/** Maximum page size for records */
export const MAX_RECORDS_LIMIT = 1000;

export const listTableRecordsInputSchema = z.object({
  tableId: z.string(),
  filter: recordFilterSchema.optional(),
  limit: z.coerce.number().int().positive().max(MAX_RECORDS_LIMIT).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export type IListTableRecordsQueryInput = z.input<typeof listTableRecordsInputSchema>;
type IListTableRecordsQueryOutput = z.output<typeof listTableRecordsInputSchema>;

export class ListTableRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly filter: RecordFilter | null | undefined,
    readonly pagination: OffsetPagination
  ) {}

  static create(raw: unknown): Result<ListTableRecordsQuery, DomainError> {
    const parsed = listTableRecordsInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid ListTableRecordsQuery input' }));

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      this.buildPagination(parsed.data).map(
        (pagination) => new ListTableRecordsQuery(tableId, parsed.data.filter, pagination)
      )
    );
  }

  private static buildPagination(
    data: IListTableRecordsQueryOutput
  ): Result<OffsetPagination, DomainError> {
    if (data.offset !== undefined && data.limit === undefined) {
      return err(domainError.unexpected({ message: 'Pagination offset requires limit' }));
    }

    const limitValue = data.limit ?? DEFAULT_RECORDS_LIMIT;
    const offsetValue = data.offset ?? 0;

    return PageLimit.create(limitValue).andThen((limit) =>
      PageOffset.create(offsetValue).map((offset) => OffsetPagination.create(limit, offset))
    );
  }
}
