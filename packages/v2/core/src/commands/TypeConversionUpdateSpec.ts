import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Field } from '../domain/table/fields/Field';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import type { Table } from '../domain/table/Table';
import type { TableId } from '../domain/table/TableId';
import type { IUpdateTableFieldSpec } from './IUpdateTableFieldSpec';
import type { ICreateTableFieldSpec } from './TableFieldSpecs';

/**
 * TypeConversionUpdateSpec wraps type conversion from one field type to another.
 *
 * This spec:
 * 1. Stores the old field and the spec for creating the new field
 * 2. Generates a single TableUpdateFieldTypeSpec containing both old and new fields
 * 3. Delegates field creation to the inner ICreateTableFieldSpec
 *
 * The multi-stage conversion flow is handled by the UpdateFieldHandler:
 * - Stage 1: Close constraints (if any)
 * - Stage 2: Generate TableUpdateFieldTypeSpec
 * - Stage 3: Repository converts data values (SQL CAST)
 * - Stage 4: Restore constraints (if any)
 *
 * Example: Converting singleLineText → number
 * ```typescript
 * const conversionSpec = TypeConversionUpdateSpec.create(
 *   currentTextField,
 *   numberFieldCreateSpec
 * );
 *
 * const specs = conversionSpec.buildSpecs(currentTextField);
 * // Returns [TableUpdateFieldTypeSpec(textField, numberField)]
 * ```
 */
export class TypeConversionUpdateSpec implements IUpdateTableFieldSpec {
  private constructor(
    private readonly oldField: Field,
    private readonly newFieldSpec: ICreateTableFieldSpec
  ) {}

  /**
   * Create a TypeConversionUpdateSpec from an old field and new field spec.
   *
   * @param oldField - The existing field being converted
   * @param newFieldSpec - The spec for creating the new field type
   */
  static create(oldField: Field, newFieldSpec: ICreateTableFieldSpec): TypeConversionUpdateSpec {
    return new TypeConversionUpdateSpec(oldField, newFieldSpec);
  }

  /**
   * Build specs for type conversion.
   * Returns a single TableUpdateFieldTypeSpec containing both old and new fields.
   *
   * @param currentField - The field to validate against (must match oldField)
   */
  buildSpecs(
    currentField: Field
  ): Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError> {
    // Validate that currentField matches our stored oldField
    if (!currentField.id().equals(this.oldField.id())) {
      return err(
        domainError.invariant({
          message: 'TypeConversionUpdateSpec: currentField does not match oldField',
        })
      );
    }

    // Create the new field
    const newFieldResult = this.newFieldSpec.createField();
    if (newFieldResult.isErr()) {
      return err(newFieldResult.error);
    }
    const newField = newFieldResult.value;

    // Generate the type conversion spec
    const typeConversionSpec = TableUpdateFieldTypeSpec.create(this.oldField, newField);

    return ok([typeConversionSpec]);
  }

  /**
   * Create the new field instance.
   * Delegates to the inner ICreateTableFieldSpec.
   *
   * @param params - Optional parameters like baseId and tableId for link fields
   */
  createField(params?: { baseId?: BaseId; tableId?: TableId }): Result<Field, DomainError> {
    return this.newFieldSpec.createField(params);
  }

  /**
   * This is a type conversion.
   */
  isTypeConversion(): boolean {
    return true;
  }

  /**
   * Get the old field type.
   */
  oldFieldType(): string {
    return this.oldField.type().toString();
  }

  /**
   * Get the new field type (from the create spec).
   */
  newFieldType(): Result<string, DomainError> {
    return this.createField().map((f) => f.type().toString());
  }

  /**
   * Get foreign table references from the new field configuration.
   */
  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return this.newFieldSpec.foreignTableReferences();
  }
}
