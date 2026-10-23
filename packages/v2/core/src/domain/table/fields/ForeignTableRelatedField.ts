import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { Field } from './Field';
import { ConditionalLookupField } from './types/ConditionalLookupField';
import { ConditionalRollupField } from './types/ConditionalRollupField';
import { LinkField } from './types/LinkField';
import { LookupField } from './types/LookupField';
import { RollupField } from './types/RollupField';

export type ForeignTableValidationContext = {
  hostTable: Table;
  foreignTables: ReadonlyArray<Table>;
};

export interface ForeignTableRelatedField {
  validateForeignTables(context: ForeignTableValidationContext): Result<void, DomainError>;
}

export const isForeignTableRelatedField = (
  field: Field
): field is
  | RollupField
  | LinkField
  | LookupField
  | ConditionalRollupField
  | ConditionalLookupField =>
  field instanceof LinkField ||
  field instanceof RollupField ||
  field instanceof LookupField ||
  field instanceof ConditionalRollupField ||
  field instanceof ConditionalLookupField;

export const validateForeignTablesForFields = (
  fields: ReadonlyArray<Field>,
  context: ForeignTableValidationContext
): Result<void, DomainError> => {
  // A pending conditional lookup validates predicates through the outer field and
  // accepts every operator. Resolve its inner field first so a conditional field
  // that appears earlier in the field list still validates against the real
  // operator set instead of depending on table field order.
  for (const foreignTable of context.foreignTables) {
    for (const candidate of foreignTable.getFields()) {
      if (candidate instanceof ConditionalLookupField && candidate.innerField().isErr()) {
        candidate.validateForeignTables({ ...context, hostTable: foreignTable });
      }
    }
  }

  return fields.reduce<Result<void, DomainError>>(
    (acc, field) =>
      acc.andThen(() => {
        if (!isForeignTableRelatedField(field)) return ok(undefined);
        return field.validateForeignTables(context);
      }),
    ok(undefined)
  );
};
