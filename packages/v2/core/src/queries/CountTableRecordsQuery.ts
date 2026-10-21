import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
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

export const countTableRecordsInputSchema = z
  .object({
    tableId: z.string(),
    filter: parseJsonInput(recordFilterSchema).optional(),
    search: parseJsonInput(recordSearchInputSchema).optional(),
    projection: parseJsonInput(z.array(z.string().min(1))).optional(),
    filterLinkCellSelected: parseJsonInput(incomingLinkSelectionSchema).optional(),
    filterLinkCellCandidate: parseJsonInput(incomingLinkSelectionSchema).optional(),
    selectedRecordIds: parseJsonInput(z.array(z.string().min(1))).optional(),
    viewId: z.string().min(1).optional(),
    ignoreViewQuery: z.coerce.boolean().optional(),
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

export type ICountTableRecordsQueryInput = z.input<typeof countTableRecordsInputSchema>;

export interface ICountTableRecordsQueryOptions {
  readonly queryScope?: RecordQueryPluginScope;
  /** @deprecated Prefer {@link queryScope}. Kept for transitional CTE-based reads. */
  readonly recordReadQuerySource?: IRecordReadQuerySource;
  readonly recordSearchAccessPath?: IRecordSearchAccessPath;
  /**
   * Field set the search row filter resolves against when an explicit projection
   * is present. 'projection' (default when projection is set) narrows search to
   * projection ∩ visible. 'visible' keeps the full visible-field row scope.
   */
  readonly searchFieldScope?: 'projection' | 'visible';
  readonly table?: Table;
}

export class CountTableRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly filter: RecordFilter | null | undefined,
    readonly fieldKeyType: FieldKeyType,
    readonly search?: RecordSearchInput,
    readonly projection?: ReadonlyArray<string>,
    readonly filterLinkCellSelected?: string | [string, string],
    readonly filterLinkCellCandidate?: string | [string, string],
    readonly selectedRecordIds?: ReadonlyArray<string>,
    readonly searchFieldScope?: 'projection' | 'visible',
    readonly viewId?: string,
    readonly ignoreViewQuery?: boolean,
    readonly queryScope?: RecordQueryPluginScope,
    readonly recordReadQuerySource?: IRecordReadQuerySource,
    readonly recordSearchAccessPath?: IRecordSearchAccessPath,
    readonly table?: Table
  ) {}

  static create(
    raw: unknown,
    options?: ICountTableRecordsQueryOptions
  ): Result<CountTableRecordsQuery, DomainError> {
    const parsed = countTableRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid CountTableRecordsQuery input',
          details: { issues: parsed.error.issues },
        })
      );
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) =>
        new CountTableRecordsQuery(
          tableId,
          parsed.data.filter,
          parsed.data.fieldKeyType,
          parsed.data.search,
          parsed.data.projection,
          parsed.data.filterLinkCellSelected,
          parsed.data.filterLinkCellCandidate,
          parsed.data.selectedRecordIds,
          options?.searchFieldScope,
          parsed.data.viewId,
          parsed.data.ignoreViewQuery,
          options?.queryScope,
          options?.queryScope ? undefined : options?.recordReadQuerySource,
          options?.recordSearchAccessPath,
          options?.table
        )
    );
  }
}
