import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import z from 'zod';
import { domainError, type DomainError } from '../../../../shared/DomainError';
import type { Field } from '../../../fields/Field';
import { FieldType } from '../../../fields/FieldType';
import { FieldCellValueSchemaVisitor } from '../../../fields/visitors/FieldCellValueSchemaVisitor';
import { SetFieldValueSpecFactoryVisitor } from '../../../fields/visitors/SetFieldValueSpecFactoryVisitor';
import type { ICellValueSpec } from './ICellValueSpecVisitor';
import { NoopCellValueSpec } from './NoopCellValueSpec';
import { ClearFieldValueSpec } from './ClearFieldValueSpec';

/**
 * Factory for creating SetValueSpec instances.
 *
 * This factory:
 * 1. Validates the input value using FieldCellValueSchemaVisitor
 * 2. Creates the appropriate SetValueSpec using SetFieldValueSpecFactoryVisitor
 *
 * Usage:
 * ```typescript
 * const result = SetFieldValueSpecFactory.create(field, rawValue);
 * // result is Result<ICellValueSpec, DomainError>
 * ```
 */
export class SetFieldValueSpecFactory {
  /**
   * Create a SetValueSpec for the given field and value.
   *
   * @param field - The field to create the spec for
   * @param value - The raw value to validate and wrap
   * @returns A Result containing either the spec or a validation error
   */
  static create(field: Field, value: unknown): Result<ICellValueSpec, DomainError> {
    if (field.type().equals(FieldType.button())) {
      return ok(NoopCellValueSpec.create());
    }
    // Null values use ClearFieldValueSpec for optimized SQL generation
    if (value === null || value === undefined) {
      if (field.notNull().toBoolean()) {
        return err(
          domainError.validation({
            code: 'validation.field.not_null',
            message: `Cannot set null: field "${field.name().toString()}" violates not-null constraint`,
            details: {
              fieldId: field.id().toString(),
              fieldName: field.name().toString(),
              fieldType: field.type().toString(),
            },
          })
        );
      }
      return ok(ClearFieldValueSpec.create(field));
    }
    // Step 1: Get the validation schema for this field type
    const schemaVisitor = FieldCellValueSchemaVisitor.create();
    return field.accept(schemaVisitor).andThen((schema) => {
      // Step 2: Validate the value against the schema
      const parseResult = schema.safeParse(value);
      if (!parseResult.success) {
        const errorMessage = z.prettifyError(parseResult.error);
        return err(
          domainError.validation({
            code: 'validation.field.invalid_value',
            message: `Invalid value for field "${field.name().toString()}": ${errorMessage}`,
            details: {
              fieldId: field.id().toString(),
              fieldName: field.name().toString(),
              fieldType: field.type().toString(),
              providedValue: value,
              zodError: parseResult.error.issues,
            },
          })
        );
      }

      // Step 3: Create the SetValueSpec with the validated value
      const factoryVisitor = new SetFieldValueSpecFactoryVisitor(parseResult.data);
      return field.accept(factoryVisitor);
    });
  }

  /**
   * Create a SetValueSpec without validation.
   * Use this when the value is already validated.
   *
   * @param field - The field to create the spec for
   * @param validatedValue - The pre-validated value
   * @returns A Result containing either the spec or an error (for computed fields)
   */
  static createFromValidated(
    field: Field,
    validatedValue: unknown
  ): Result<ICellValueSpec, DomainError> {
    if (field.type().equals(FieldType.button())) {
      return ok(NoopCellValueSpec.create());
    }
    // Null values use ClearFieldValueSpec for optimized SQL generation
    if (validatedValue === null || validatedValue === undefined) {
      return ok(ClearFieldValueSpec.create(field));
    }
    const factoryVisitor = new SetFieldValueSpecFactoryVisitor(validatedValue);
    return field.accept(factoryVisitor);
  }
}
