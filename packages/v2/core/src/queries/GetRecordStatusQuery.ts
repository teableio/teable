import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { type FieldKeyType, fieldKeyTypeSchema } from '../domain/table/fields/FieldKeyType';
import { RecordId } from '../domain/table/records/RecordId';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';
import { MAX_RECORDS_LIMIT, type RecordSortValue } from './ListTableRecordsQuery';
import { recordFilterSchema, type RecordFilter } from './RecordFilterDto';
import { recordSearchInputSchema, type RecordSearchInput } from './RecordSearch';

const parseJsonInput = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, schema);

const incomingLinkSelectionSchema = z.union([
  z.string().min(1),
  z.tuple([z.string().min(1), z.string().min(1)]),
]);

export const getRecordStatusInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
  filter: parseJsonInput(recordFilterSchema).optional(),
  sort: parseJsonInput(
    z.array(
      z.object({
        fieldId: z.string().min(1),
        order: z.enum(['asc', 'desc']),
      })
    )
  ).optional(),
  groupBy: parseJsonInput(z.array(z.string().min(1))).optional(),
  search: parseJsonInput(recordSearchInputSchema).optional(),
  filterLinkCellSelected: parseJsonInput(incomingLinkSelectionSchema).optional(),
  filterLinkCellCandidate: parseJsonInput(incomingLinkSelectionSchema).optional(),
  selectedRecordIds: parseJsonInput(z.array(z.string().min(1))).optional(),
  viewId: z.string().min(1).optional(),
  ignoreViewQuery: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(MAX_RECORDS_LIMIT).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  fieldKeyType: fieldKeyTypeSchema.optional(),
});

export type IGetRecordStatusQueryInput = z.input<typeof getRecordStatusInputSchema>;

export interface IGetRecordStatusQueryOptions {
  readonly queryScope?: RecordQueryPluginScope;
  readonly table?: Table;
}

export class GetRecordStatusQuery {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId,
    readonly filter: RecordFilter | undefined,
    readonly sort: ReadonlyArray<RecordSortValue> | undefined,
    readonly groupBy: ReadonlyArray<string> | undefined,
    readonly search: RecordSearchInput | undefined,
    readonly filterLinkCellSelected: string | [string, string] | undefined,
    readonly filterLinkCellCandidate: string | [string, string] | undefined,
    readonly selectedRecordIds: ReadonlyArray<string> | undefined,
    readonly viewId: string | undefined,
    readonly ignoreViewQuery: boolean | undefined,
    readonly limit: number | undefined,
    readonly offset: number | undefined,
    readonly fieldKeyType: FieldKeyType,
    readonly queryScope: RecordQueryPluginScope | undefined,
    readonly table: Table | undefined
  ) {}

  static create(
    raw: unknown,
    options?: IGetRecordStatusQueryOptions
  ): Result<GetRecordStatusQuery, DomainError> {
    const parsed = getRecordStatusInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid GetRecordStatusQuery input' }));
    }

    return safeTry<GetRecordStatusQuery, DomainError>(function* () {
      const tableId = yield* TableId.create(parsed.data.tableId);
      const recordId = yield* RecordId.create(parsed.data.recordId);
      return ok(
        new GetRecordStatusQuery(
          tableId,
          recordId,
          parsed.data.filter,
          parsed.data.sort,
          parsed.data.groupBy,
          parsed.data.search,
          parsed.data.filterLinkCellSelected,
          parsed.data.filterLinkCellCandidate,
          parsed.data.selectedRecordIds,
          parsed.data.viewId,
          parsed.data.ignoreViewQuery,
          parsed.data.limit,
          parsed.data.offset,
          parsed.data.fieldKeyType ?? 'id',
          options?.queryScope,
          options?.table
        )
      );
    });
  }
}
