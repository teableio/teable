import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { RecordId } from '../domain/table/records/RecordId';
import { TableId } from '../domain/table/TableId';

const getTableCommentCountInputSchema = z
  .object({
    tableId: z.string(),
    recordIds: z.array(z.string()).max(1000),
  })
  .strict();

export type IGetTableCommentCountQueryInput = z.input<typeof getTableCommentCountInputSchema>;

export class GetTableCommentCountQuery {
  private constructor(
    readonly tableId: TableId,
    readonly recordIds: ReadonlyArray<RecordId>
  ) {}

  static create(raw: unknown): Result<GetTableCommentCountQuery, DomainError> {
    return safeTry(function* () {
      const parsed = getTableCommentCountInputSchema.safeParse(raw);
      if (!parsed.success) {
        return err(
          domainError.validation({
            message: 'Invalid GetTableCommentCountQuery input',
            details: { issues: parsed.error.issues },
          })
        );
      }
      const tableId = yield* TableId.create(parsed.data.tableId);
      const recordIds: RecordId[] = [];
      for (const id of new Set(parsed.data.recordIds)) {
        recordIds.push(yield* RecordId.create(id));
      }
      return ok(new GetTableCommentCountQuery(tableId, recordIds));
    });
  }
}
