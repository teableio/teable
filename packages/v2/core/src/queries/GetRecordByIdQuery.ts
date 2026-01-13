import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';

export const getRecordByIdInputSchema = z.object({
  tableId: z.string(),
  recordId: z.string(),
});

export type IGetRecordByIdQueryInput = z.input<typeof getRecordByIdInputSchema>;

export class GetRecordByIdQuery {
  private constructor(
    readonly tableId: TableId,
    readonly recordId: RecordId
  ) {}

  static create(raw: unknown): Result<GetRecordByIdQuery, DomainError> {
    const parsed = getRecordByIdInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid GetRecordByIdQuery input' }));

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      RecordId.create(parsed.data.recordId).map(
        (recordId) => new GetRecordByIdQuery(tableId, recordId)
      )
    );
  }
}
