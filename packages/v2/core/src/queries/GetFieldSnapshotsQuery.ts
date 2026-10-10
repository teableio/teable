import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';

export const getFieldSnapshotsInputSchema = z
  .object({
    tableId: z.string(),
    fieldIds: z.array(z.string()),
  })
  .strict();

export type IGetFieldSnapshotsQueryInput = z.input<typeof getFieldSnapshotsInputSchema>;

export class GetFieldSnapshotsQuery {
  private constructor(
    readonly tableId: TableId,
    readonly fieldIds: ReadonlyArray<FieldId>
  ) {}

  static create(raw: unknown): Result<GetFieldSnapshotsQuery, DomainError> {
    const parsed = getFieldSnapshotsInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetFieldSnapshotsQuery input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const fieldIds: FieldId[] = [];
    for (const rawFieldId of parsed.data.fieldIds) {
      const fieldIdResult = FieldId.create(rawFieldId);
      if (fieldIdResult.isErr()) return err(fieldIdResult.error);
      fieldIds.push(fieldIdResult.value);
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new GetFieldSnapshotsQuery(tableId, fieldIds)
    );
  }
}
