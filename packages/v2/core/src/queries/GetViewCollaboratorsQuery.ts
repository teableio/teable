import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

const getViewCollaboratorsInputSchema = z.object({
  tableId: z.string(),
  viewId: z.string().optional(),
  fieldId: z.string().optional(),
  includeHiddenFields: z.boolean().optional(),
  canReadAllCollaborators: z.boolean().optional(),
  search: z.string().optional(),
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
});

export class GetViewCollaboratorsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId | undefined,
    readonly fieldId: FieldId | undefined,
    readonly includeHiddenFields: boolean,
    readonly canReadAllCollaborators: boolean,
    readonly search: string | undefined,
    readonly pagination: OffsetPagination
  ) {}

  static create(raw: unknown): Result<GetViewCollaboratorsQuery, DomainError> {
    const parsed = getViewCollaboratorsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetViewCollaboratorsQuery input',
          details: { issues: parsed.error.issues },
        })
      );
    }

    return safeTry<GetViewCollaboratorsQuery, DomainError>(function* () {
      const tableId = yield* TableId.create(parsed.data.tableId);
      const viewId = parsed.data.viewId ? yield* ViewId.create(parsed.data.viewId) : undefined;
      const fieldId = parsed.data.fieldId ? yield* FieldId.create(parsed.data.fieldId) : undefined;
      const limit = yield* PageLimit.create(parsed.data.take ?? 50);
      const offset = yield* PageOffset.create(parsed.data.skip ?? 0);
      return ok(
        new GetViewCollaboratorsQuery(
          tableId,
          viewId,
          fieldId,
          parsed.data.includeHiddenFields ?? false,
          parsed.data.canReadAllCollaborators ?? false,
          parsed.data.search,
          OffsetPagination.create(limit, offset)
        )
      );
    });
  }
}
