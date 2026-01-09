import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const createRecordInputSchema = z.object({
  tableId: z.string(),
  fields: z.record(z.string(), z.unknown()).default({}),
  typecast: z.boolean().optional().default(false),
});

export type ICreateRecordCommandInput = z.input<typeof createRecordInputSchema>;

/**
 * Field value specification for record creation.
 * Maps field IDs to their raw values.
 */
export type RecordFieldValues = ReadonlyMap<string, unknown>;

export class CreateRecordCommand {
  private constructor(
    readonly tableId: TableId,
    readonly fieldValues: RecordFieldValues,
    readonly typecast: boolean
  ) {}

  static create(raw: unknown): Result<CreateRecordCommand, DomainError> {
    const parsed = createRecordInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid CreateRecordCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map((tableId) => {
      const fieldValues = new Map(Object.entries(parsed.data.fields));
      return new CreateRecordCommand(tableId, fieldValues, parsed.data.typecast);
    });
  }
}
