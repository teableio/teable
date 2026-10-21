import { err, ok, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import { ConditionalRollupField } from '../fields/types/ConditionalRollupField';
import { LinkField } from '../fields/types/LinkField';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import { viewSourceFilterSchema, type ViewSourceFilterDTO } from '../views/ViewSourceFilter';

export type FieldFilterLinkScope = {
  readonly foreignTableId: TableId;
  readonly filter: ViewSourceFilterDTO;
};

export const fieldFilterLinkScope = function (
  this: Table,
  fieldId: FieldId
): Result<FieldFilterLinkScope | null, DomainError> {
  const fieldResult = this.getField((field) => field.id().equals(fieldId));
  if (fieldResult.isErr()) return err(fieldResult.error);

  const field = fieldResult.value;
  let foreignTableId: TableId;
  let rawFilter: unknown;

  if (field instanceof LinkField) {
    foreignTableId = field.foreignTableId();
    rawFilter = field.config().filter();
  } else if (field instanceof ConditionalRollupField) {
    foreignTableId = field.foreignTableId();
    rawFilter = field.config().condition().toDto().filter;
  } else {
    return ok(null);
  }

  if (rawFilter == null) return ok(null);

  const parsed = viewSourceFilterSchema.safeParse(rawFilter);
  if (!parsed.success) {
    return err(
      domainError.validation({
        message: 'Invalid field filter',
        details: { issues: parsed.error.issues },
      })
    );
  }
  if (parsed.data == null) return ok(null);

  return ok({
    foreignTableId,
    filter: parsed.data,
  });
};
