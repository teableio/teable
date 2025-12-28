import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { Table } from '../Table';
import type { Field } from './Field';
import { LinkField } from './types/LinkField';
import { RollupField } from './types/RollupField';

export type ForeignTableValidationContext = {
  hostTable: Table;
  foreignTables: ReadonlyArray<Table>;
};

export interface ForeignTableRelatedField {
  validateForeignTables(context: ForeignTableValidationContext): Result<void, string>;
}

export const isForeignTableRelatedField = (field: Field): field is RollupField | LinkField =>
  field instanceof LinkField || field instanceof RollupField;

export const validateForeignTablesForFields = (
  fields: ReadonlyArray<Field>,
  context: ForeignTableValidationContext
): Result<void, string> =>
  fields.reduce<Result<void, string>>(
    (acc, field) =>
      acc.andThen(() => {
        if (!isForeignTableRelatedField(field)) return ok(undefined);
        return field.validateForeignTables(context);
      }),
    ok(undefined)
  );
