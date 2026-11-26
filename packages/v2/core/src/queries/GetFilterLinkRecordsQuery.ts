import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { FilterLinkReferenceGroup } from '../domain/table/methods/viewFilterLinkReferences';
import { TableId } from '../domain/table/TableId';

// Candidate reads only collect literal IDs. Filter operands are not evaluated.
const filterLinkReferenceGroupSchema: z.ZodType<FilterLinkReferenceGroup> = z.object({
  conjunction: z.enum(['and', 'or']),
  filterSet: z.array(
    z.lazy(() =>
      z.union([
        filterLinkReferenceGroupSchema,
        z.object({ fieldId: z.string(), value: z.unknown().optional() }),
      ])
    )
  ),
});

export const getFilterLinkRecordsInputSchema = z.object({
  tableId: z.string(),
  filter: filterLinkReferenceGroupSchema.nullish(),
});

export type IGetFilterLinkRecordsQueryInput = z.input<typeof getFilterLinkRecordsInputSchema>;

interface IGetFilterLinkRecordsQueryOptions {
  /** Omit related tables denied by the record read guard after the source table is authorized. */
  readonly omitForbiddenGroups?: boolean;
}

export class GetFilterLinkRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly filter: FilterLinkReferenceGroup | null,
    readonly options?: IGetFilterLinkRecordsQueryOptions
  ) {}

  static create(
    raw: unknown,
    options?: IGetFilterLinkRecordsQueryOptions
  ): Result<GetFilterLinkRecordsQuery, DomainError> {
    const parsed = getFilterLinkRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetFilterLinkRecordsQuery input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).map(
      (tableId) => new GetFilterLinkRecordsQuery(tableId, parsed.data.filter ?? null, options)
    );
  }
}
