import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { FieldId } from '../domain/table/fields/FieldId';
import type { ViewLinkRecordsRequestType } from '../domain/table/methods/createViewLinkRecordsQueryPlan';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

const getViewLinkRecordsInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  fieldId: z.string(),
  requestType: z.enum(['candidate', 'selected']).optional(),
  includeHiddenFields: z.boolean().optional(),
  search: z.string().optional(),
  take: z.coerce.number().int().positive().max(1000).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
});

export class GetViewLinkRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly fieldId: FieldId,
    readonly requestType: ViewLinkRecordsRequestType | undefined,
    readonly includeHiddenFields: boolean,
    readonly search: string | undefined,
    readonly pagination: OffsetPagination
  ) {}

  static create(raw: unknown): Result<GetViewLinkRecordsQuery, DomainError> {
    const parsed = getViewLinkRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetViewLinkRecordsQuery input',
          details: { issues: parsed.error.issues },
        })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).andThen((viewId) =>
        FieldId.create(parsed.data.fieldId).andThen((fieldId) =>
          PageLimit.create(parsed.data.take ?? 100).andThen((limit) =>
            PageOffset.create(parsed.data.skip ?? 0).map(
              (offset) =>
                new GetViewLinkRecordsQuery(
                  tableId,
                  viewId,
                  fieldId,
                  parsed.data.requestType,
                  parsed.data.includeHiddenFields ?? false,
                  parsed.data.search,
                  OffsetPagination.create(limit, offset)
                )
            )
          )
        )
      )
    );
  }
}
