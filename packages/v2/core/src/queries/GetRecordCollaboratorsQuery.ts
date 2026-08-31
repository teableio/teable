import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import { PageLimit } from '../domain/shared/pagination/PageLimit';
import { PageOffset } from '../domain/shared/pagination/PageOffset';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';

export interface IGetRecordCollaboratorsQueryOptions {
  readonly queryScope?: RecordQueryPluginScope;
}

const getRecordCollaboratorsInputSchema = z.object({
  tableId: z.string(),
  fieldId: z.string(),
  search: z.string().optional(),
  take: z.coerce.number().int().positive().optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
});

export class GetRecordCollaboratorsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly fieldId: FieldId,
    readonly search: string | undefined,
    readonly pagination: OffsetPagination,
    readonly queryScope: RecordQueryPluginScope | undefined
  ) {}

  static create(
    raw: unknown,
    options?: IGetRecordCollaboratorsQueryOptions
  ): Result<GetRecordCollaboratorsQuery, DomainError> {
    const parsed = getRecordCollaboratorsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid GetRecordCollaboratorsQuery input' }));
    }

    return safeTry<GetRecordCollaboratorsQuery, DomainError>(function* () {
      const tableId = yield* TableId.create(parsed.data.tableId);
      const fieldId = yield* FieldId.create(parsed.data.fieldId);
      const limit = yield* PageLimit.create(parsed.data.take ?? 50);
      const offset = yield* PageOffset.create(parsed.data.skip ?? 0);
      return ok(
        new GetRecordCollaboratorsQuery(
          tableId,
          fieldId,
          parsed.data.search,
          OffsetPagination.create(limit, offset),
          options?.queryScope
        )
      );
    });
  }
}
