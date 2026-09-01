import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';
import type {
  IRecordReadQuerySource,
  IRecordSearchAccessPath,
} from '../ports/TableRecordQueryRepository';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';
import { recordSearchInputSchema, type RecordSearchInput } from './RecordSearch';

/** Default page size for records */
export const DEFAULT_RECORDS_LIMIT = 100;
/** Maximum page size for records */
export const MAX_RECORDS_LIMIT = 1000;
/** Default maximum number of leaf group buckets returned with record metadata. */
export const DEFAULT_GROUP_METADATA_LIMIT = 5_000;

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
const queryBooleanSchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
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
    projection: parseJsonInput(z.array(z.string().min(1))).optional(),
    includeTotal: z.coerce.boolean().optional(),
    includeGroups: queryBooleanSchema.optional(),
    includeSearchMatches: queryBooleanSchema.optional(),
    searchIndexMode: z.enum(['matched', 'view']).optional(),
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

export interface IListTableRecordsQueryOptions {
  /** Trusted host fallback for grouped count metadata. */
  readonly includeGroupMetadata?: boolean;
  /** Trusted host-only cap for leaf group buckets. */
  readonly groupLimit?: number;
  /**
   * Preferred pure-V2 permission scope (row filter + field allow-list + masks).
   * When set, handlers should not depend on outer permission CTEs.
   */
  readonly queryScope?: RecordQueryPluginScope;
  /**
   * @deprecated Prefer {@link queryScope}. Kept for transitional CTE-based reads.
   */
  readonly recordReadQuerySource?: IRecordReadQuerySource;
  readonly recordSearchAccessPath?: IRecordSearchAccessPath;
  readonly includeSearchFieldMatches?: boolean;
  readonly searchIndexMode?: 'matched' | 'view';
  /** Trusted host-only: explicit search fields outside the static allow-list are not-found. */
  readonly requireReadableSearchFields?: boolean;
  /**
   * Field set the search row filter resolves against when
   * {@link includeSearchFieldMatches} is combined with an explicit projection.
   * 'projection' (default) narrows the row search to projection ∩ visible —
   * the search-index API semantics where rows exist to carry hits.
   * 'visible' keeps the full visible-field row scope and only the match
   * columns follow the projection — the record-list semantics where search
   * filters rows and matches are a side channel (grid highlight).
   */
  readonly searchFieldScope?: 'projection' | 'visible';
  /**
   * Trusted host-only id-resolution mode: the repository selects only record
   * ids (filter/search/order/pagination semantics unchanged) and skips field
   * column reads and cell mapping. Returned records carry empty fields.
   */
  readonly idsOnly?: boolean;
  /**
   * Trusted host-only page size for {@link idsOnly} sweeps, overriding the
   * request limit. MAX_RECORDS_LIMIT bounds how heavy a response page may be;
   * an id-only page carries no field payload, so resolving a large selection
   * should not pay a round trip (plus its column-existence probe) per 1000
   * rows. Ignored unless idsOnly is set.
   */
  readonly idsOnlyPageSize?: number;
  /**
   * Trusted host-only preloaded table aggregate. When set, the handler reuses it
   * instead of re-running the fields+views aggregate query for the same table.
   */
  readonly table?: Table;
}

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
    readonly projection?: ReadonlyArray<string>,
    readonly includeTotal?: boolean,
    readonly includeSearchFieldMatches?: boolean,
    readonly searchIndexMode?: 'matched' | 'view',
    readonly requireReadableSearchFields?: boolean,
    readonly searchFieldScope?: 'projection' | 'visible',
    readonly idsOnly?: boolean,
    readonly includeGroupMetadata?: boolean,
    readonly groupLimit?: number,
    readonly viewId?: string,
    readonly ignoreViewQuery?: boolean,
    readonly queryScope?: RecordQueryPluginScope,
    readonly recordReadQuerySource?: IRecordReadQuerySource,
    readonly recordSearchAccessPath?: IRecordSearchAccessPath,
    readonly table?: Table
  ) {}

  static create(
    raw: unknown,
    options?: IListTableRecordsQueryOptions
  ): Result<ListTableRecordsQuery, DomainError> {
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
      this.buildPagination(parsed.data, options).map((pagination) => {
        const includeGroupMetadata =
          parsed.data.includeGroups ?? options?.includeGroupMetadata ?? false;
        const groupLimit = includeGroupMetadata
          ? Math.max(1, Math.floor(options?.groupLimit ?? DEFAULT_GROUP_METADATA_LIMIT))
          : undefined;

        return new ListTableRecordsQuery(
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
          parsed.data.projection,
          parsed.data.includeTotal,
          parsed.data.includeSearchMatches ?? options?.includeSearchFieldMatches,
          parsed.data.searchIndexMode ?? options?.searchIndexMode,
          options?.requireReadableSearchFields,
          options?.searchFieldScope,
          options?.idsOnly,
          includeGroupMetadata,
          groupLimit,
          parsed.data.viewId,
          parsed.data.ignoreViewQuery,
          options?.queryScope,
          // Prefer queryScope: do not pass CTE source when scope is present.
          options?.queryScope ? undefined : options?.recordReadQuerySource,
          options?.recordSearchAccessPath,
          options?.table
        );
      })
    );
  }

  private static buildPagination(
    data: IListTableRecordsQueryOutput,
    options?: IListTableRecordsQueryOptions
  ): Result<OffsetPagination, DomainError> {
    // Host-only ids-only sweeps carry their own page size: the public limit
    // cap bounds response payload weight, which an id-only page does not have.
    const idsOnlyPageSize =
      options?.idsOnly && options.idsOnlyPageSize !== undefined && options.idsOnlyPageSize > 0
        ? Math.floor(options.idsOnlyPageSize)
        : undefined;
    if (data.offset !== undefined && data.limit === undefined && idsOnlyPageSize === undefined) {
      return err(domainError.unexpected({ message: 'Pagination offset requires limit' }));
    }

    const limitValue = idsOnlyPageSize ?? data.limit ?? DEFAULT_RECORDS_LIMIT;
    const offsetValue = data.offset ?? 0;

    return PageLimit.create(limitValue).andThen((limit) =>
      PageOffset.create(offsetValue).map((offset) => OffsetPagination.create(limit, offset))
    );
  }
}
