import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { Sort } from '../domain/shared/sort/Sort';
import { SortDirection, sortDirectionSchema } from '../domain/shared/sort/SortDirection';
import { TableName } from '../domain/table/TableName';
import { TableSortKey, tableSortKeySchema } from '../domain/table/TableSortKey';

export const listTablesInputSchema = z.object({
  baseId: z.string(),
  q: z.string().trim().min(1).max(255).optional(),
  sortBy: tableSortKeySchema.optional(),
  sortDirection: sortDirectionSchema.optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export type IListTablesQueryInput = z.input<typeof listTablesInputSchema>;
type IListTablesQueryOutput = z.output<typeof listTablesInputSchema>;

export class ListTablesQuery {
  private constructor(
    readonly baseId: BaseId,
    readonly sort: Sort<TableSortKey>,
    readonly pagination?: OffsetPagination,
    readonly nameQuery?: TableName
  ) {}

  static create(raw: unknown): Result<ListTablesQuery, DomainError> {
    const parsed = listTablesInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid ListTablesQuery input' }));

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      this.buildSort(parsed.data).andThen((sort) =>
        this.buildPagination(parsed.data).andThen((pagination) =>
          this.buildNameQuery(parsed.data).map(
            (nameQuery) => new ListTablesQuery(baseId, sort, pagination, nameQuery)
          )
        )
      )
    );
  }

  private static buildSort(data: IListTablesQueryOutput): Result<Sort<TableSortKey>, DomainError> {
    if (data.sortDirection && !data.sortBy) {
      return err(domainError.unexpected({ message: 'Sort direction requires sortBy' }));
    }

    const key = data.sortBy ? TableSortKey.from(data.sortBy) : TableSortKey.default();
    const direction = data.sortDirection
      ? SortDirection.from(data.sortDirection)
      : data.sortBy
        ? SortDirection.asc()
        : SortDirection.desc();

    return Sort.create([{ key, direction }]);
  }

  private static buildPagination(
    data: IListTablesQueryOutput
  ): Result<OffsetPagination | undefined, DomainError> {
    if (data.offset !== undefined && data.limit === undefined) {
      return err(domainError.unexpected({ message: 'Pagination offset requires limit' }));
    }

    if (data.limit === undefined) return ok(undefined);

    return PageLimit.create(data.limit).andThen((limit) =>
      PageOffset.create(data.offset ?? 0).map((offset) => OffsetPagination.create(limit, offset))
    );
  }

  private static buildNameQuery(
    data: IListTablesQueryOutput
  ): Result<TableName | undefined, DomainError> {
    if (!data.q) return ok(undefined);
    return TableName.create(data.q);
  }
}
