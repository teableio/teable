import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import { TableId } from '../domain/table/TableId';
import { recordSearchInputSchema, type RecordSearchInput } from './RecordSearch';
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

const recordGroupBySchema = z.array(z.string().min(1));
const incomingLinkSelectionSchema = z.union([
  z.string().min(1),
  z.tuple([z.string().min(1), z.string().min(1)]),
]);

export type RecordSortValue = z.infer<typeof recordSortSchema>;
export type RecordSearchValue = RecordSearchInput;

export const listTableRecordsInputSchema = z
  .object({
    tableId: z.string(),
    filter: parseJsonInput(recordFilterSchema).optional(),
    sort: parseJsonInput(z.array(recordSortSchema)).optional(),
    groupBy: parseJsonInput(recordGroupBySchema).optional(),
    search: parseJsonInput(recordSearchInputSchema).optional(),
    filterLinkCellSelected: parseJsonInput(incomingLinkSelectionSchema).optional(),
    filterLinkCellCandidate: parseJsonInput(incomingLinkSelectionSchema).optional(),
    selectedRecordIds: parseJsonInput(z.array(z.string().min(1))).optional(),
    viewId: z.string().min(1).optional(),
    ignoreViewQuery: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().positive().max(MAX_RECORDS_LIMIT).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
    fieldKeyType: fieldKeyTypeSchema,
  })
  .superRefine((value, ctx) => {
    if (value.filterLinkCellSelected && value.filterLinkCellCandidate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'filterLinkCellSelected and filterLinkCellCandidate can not be set at the same time',
        path: ['filterLinkCellSelected'],
      });
    }
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
    readonly search?: RecordSearchInput,
    readonly groupBy?: ReadonlyArray<string>,
    readonly filterLinkCellSelected?: string | [string, string],
    readonly filterLinkCellCandidate?: string | [string, string],
    readonly selectedRecordIds?: ReadonlyArray<string>,
    readonly viewId?: string,
    readonly ignoreViewQuery?: boolean
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
            parsed.data.groupBy,
            parsed.data.filterLinkCellSelected,
            parsed.data.filterLinkCellCandidate,
            parsed.data.selectedRecordIds,
            parsed.data.viewId,
            parsed.data.ignoreViewQuery
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
