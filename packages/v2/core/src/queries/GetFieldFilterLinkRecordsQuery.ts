import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';

export const getFieldFilterLinkRecordsInputSchema = z.object({
  tableId: z.string(),
  fieldId: z.string(),
});

export type IGetFieldFilterLinkRecordsQueryInput = z.input<
  typeof getFieldFilterLinkRecordsInputSchema
>;

export class GetFieldFilterLinkRecordsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly fieldId: FieldId
  ) {}

  static create(raw: unknown): Result<GetFieldFilterLinkRecordsQuery, DomainError> {
    const parsed = getFieldFilterLinkRecordsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid GetFieldFilterLinkRecordsQuery input' })
      );
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      FieldId.create(parsed.data.fieldId).map(
        (fieldId) => new GetFieldFilterLinkRecordsQuery(tableId, fieldId)
      )
    );
  }
}
