import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import { InternalCommand } from './InternalCommand';

const inputSchema = z.object({
  fields: z.array(z.object({ tableId: z.string(), fieldId: z.string() })).min(1),
});

/** Internal conversion of a complete set of reciprocal links and their dependents. */
export class ConvertLinkFieldsToTextCommand extends InternalCommand {
  private constructor(readonly fields: ReadonlyArray<{ tableId: TableId; fieldId: FieldId }>) {
    super();
  }

  static create(raw: unknown): Result<ConvertLinkFieldsToTextCommand, DomainError> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid link text conversion batch' }));
    return safeTry<ConvertLinkFieldsToTextCommand, DomainError>(function* () {
      const fields: Array<{ tableId: TableId; fieldId: FieldId }> = [];
      const seen = new Set<string>();
      for (const input of parsed.data.fields) {
        const key = `${input.tableId}:${input.fieldId}`;
        if (seen.has(key))
          return err(domainError.validation({ message: 'Duplicate field in conversion batch' }));
        seen.add(key);
        fields.push({
          tableId: yield* TableId.create(input.tableId),
          fieldId: yield* FieldId.create(input.fieldId),
        });
      }
      return ok(new ConvertLinkFieldsToTextCommand(fields));
    });
  }
}
