import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { TableId } from '../domain/table/TableId';
import type { IFieldUpdateInput } from '../commands/UpdateFieldCommand';
import { updateFieldInputSchema } from '../commands/UpdateFieldCommand';

/**
 * Dry-run a field conversion/update without persisting anything.
 *
 * Input shape matches UpdateFieldCommand so callers (e.g. the v1-compatible
 * convert endpoint glue) can reuse the same payload.
 */
export class DryRunFieldConversionQuery {
  private constructor(
    readonly tableId: TableId,
    readonly fieldId: FieldId,
    readonly fieldUpdate: IFieldUpdateInput
  ) {}

  static create(raw: unknown): Result<DryRunFieldConversionQuery, DomainError> {
    const parsed = updateFieldInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid DryRunFieldConversionQuery input' }));
    }

    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      FieldId.create(parsed.data.fieldId).map(
        (fieldId) => new DryRunFieldConversionQuery(tableId, fieldId, parsed.data.field)
      )
    );
  }
}
