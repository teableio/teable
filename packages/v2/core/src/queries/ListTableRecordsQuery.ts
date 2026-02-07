import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import { TableId } from '../domain/table/TableId';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';

/** Default page size for records */
export const DEFAULT_RECORDS_LIMIT = 100;
/** Maximum page size for records */
export const MAX_RECORDS_LIMIT = 1000;

const parseJsonInput = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, schema);

const recordSortSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

const recordSearchSchema = z.tuple([z.string(), z.string(), z.boolean().optional()]);

const recordGroupBySchema = z.array(z.string().min(1));

export type RecordSortValue = z.infer<typeof recordSortSchema>;
export type RecordSearchValue = z.infer<typeof recordSearchSchema>;

export const listTableRecordsInputSchema = z.object({
  tableId: z.string(),
  filter: parseJsonInput(recordFilterSchema).optional(),
  sort: parseJsonInput(z.array(recordSortSchema)).optional(),
  groupBy: parseJsonInput(recordGroupBySchema).optional(),
  search: parseJsonInput(recordSearchSchema).optional(),
  limit: z.coerce.number().int().positive().max(MAX_RECORDS_LIMIT).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  fieldKeyType: fieldKeyTypeSchema,
});

export type IListTableRecordsQueryInput = z.input<typeof listTableRecordsInputSchema>;
type IListTableRecordsQueryOutput = z.output<typeof listTableRecordsInputSchema>;

export class ListTableRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly filter: RecordFilter | null | undefined,
    readonly pagination: OffsetPagination,
    readonly fieldKeyType: FieldKeyType,
    readonly sort?: ReadonlyArray<RecordSortValue>,
    readonly search?: RecordSearchValue,
    readonly groupBy?: ReadonlyArray<string>
  ) {}

  static create(raw: unknown): Result<ListTableRecordsQuery, DomainError> {
    const parsed = listTableRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ListTableRecordsQuery input',
          details: { issues: parsed.error.issues },
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      this.buildPagination(parsed.data).map(
        (pagination) =>
          new ListTableRecordsQuery(
            tableId,
            parsed.data.filter,
            pagination,
            parsed.data.fieldKeyType,
            parsed.data.sort,
            parsed.data.search,
            parsed.data.groupBy
          )
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
