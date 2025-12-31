import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { Field } from './Field';
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
): field is RollupField | LinkField | LookupField =>
  field instanceof LinkField || field instanceof RollupField || field instanceof LookupField;

export const validateForeignTablesForFields = (
  fields: ReadonlyArray<Field>,
  context: ForeignTableValidationContext
): Result<void, DomainError> =>
  fields.reduce<Result<void, DomainError>>(
    (acc, field) =>
      acc.andThen(() => {
        if (!isForeignTableRelatedField(field)) return ok(undefined);
        return field.validateForeignTables(context);
      }),
    ok(undefined)
  );
