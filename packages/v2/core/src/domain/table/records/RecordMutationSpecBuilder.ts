import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { AndSpec } from '../../shared/specification/AndSpec';
import type { Field } from '../fields/Field';
import { FieldToSpecVisitor } from '../fields/visitors/FieldToSpecVisitor';
import type { ICellValueSpec, ICellValueSpecVisitor } from './specs/values/ICellValueSpecVisitor';
import { SetFieldValueSpecFactory } from './specs/values/SetFieldValueSpecFactory';
import type { TableRecord } from './TableRecord';

/**
 * Builder for creating composite record mutation specifications.
 *
 * This builder collects multiple set operations and combines them using AndSpec.
 * The resulting spec can be used to:
 * 1. Mutate a record in memory (via spec.mutate())
 * 2. Generate SQL for UPDATE operations (via spec.accept())
 *
 * Usage:
 * ```typescript
 * const builder = RecordMutationSpecBuilder.create();
 * builder
 *   .set(nameField, 'John')
 *   .set(ageField, 30)
 *   .set(activeField, true);
 *
 * const specResult = builder.build();
 * const recordResult = specResult.andThen(spec => spec.mutate(record));
 * ```
 *
 * With typecast:
 * ```typescript
 * const builder = RecordMutationSpecBuilder.create().withTypecast(true);
 * builder.set(numberField, '123'); // String will be converted to number
 * ```
 */
export class RecordMutationSpecBuilder {
  private readonly specs: ICellValueSpec[] = [];
  private readonly errors: DomainError[] = [];
  private typecastMode: boolean = false;

  private constructor() {}

  /**
   * Create a new builder instance.
   */
  static create(): RecordMutationSpecBuilder {
    return new RecordMutationSpecBuilder();
  }

  /**
   * Enable or disable typecast mode.
   *
   * When typecast is enabled:
   * - Values are converted to the expected type (e.g., "123" → 123 for number fields)
   * - Select fields accept option names in addition to option IDs
   * - Link fields accept record titles (requires Repository SQL lookup)
   * - Invalid values are converted to null instead of returning errors
   *
   * @param typecast - Whether to enable typecast mode
   * @returns this builder for chaining
   */
  withTypecast(typecast: boolean): this {
    this.typecastMode = typecast;
    return this;
  }

  /**
   * Add a set operation for a field.
   *
   * When typecast is disabled (default):
   * - The value is validated against the field's schema before being added.
   * - If validation fails, the error is collected and will be returned on build().
   *
   * When typecast is enabled:
   * - Values are converted to the expected type when possible.
   * - Invalid values are converted to null.
   *
   * @param field - The field to set
   * @param value - The raw value to set
   * @returns this builder for chaining
   */
  set(field: Field, value: unknown): this {
    if (this.typecastMode) {
      // Use FieldToSpecVisitor for typecast mode
      const visitor = FieldToSpecVisitor.create(value, true);
      const result = field.accept(visitor);
      result.match(
        (spec) => this.specs.push(spec),
        (error) => this.errors.push(error)
      );
    } else {
      // Use SetFieldValueSpecFactory for strict validation
      const result = SetFieldValueSpecFactory.create(field, value);
      result.match(
        (spec) => this.specs.push(spec),
        (error) => this.errors.push(error)
      );
    }
    return this;
  }

  /**
   * Add a set operation with strict validation (ignores typecast mode).
   *
   * The value is validated against the field's schema before being added.
   * If validation fails, the error is collected and will be returned on build().
   *
   * @param field - The field to set
   * @param value - The raw value to set
   * @returns this builder for chaining
   */
  setStrict(field: Field, value: unknown): this {
    const result = SetFieldValueSpecFactory.create(field, value);
    result.match(
      (spec) => this.specs.push(spec),
      (error) => this.errors.push(error)
    );
    return this;
  }

  /**
   * Add a set operation with a pre-validated value.
   *
   * Use this when the value has already been validated externally.
   *
   * @param field - The field to set
   * @param validatedValue - The pre-validated value
   * @returns this builder for chaining
   */
  setValidated(field: Field, validatedValue: unknown): this {
    const result = SetFieldValueSpecFactory.createFromValidated(field, validatedValue);
    result.match(
      (spec) => this.specs.push(spec),
      (error) => this.errors.push(error)
    );
    return this;
  }

  /**
   * Check if the builder has any specs.
   */
  hasSpecs(): boolean {
    return this.specs.length > 0;
  }

  /**
   * Check if the builder has any errors.
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Get collected errors.
   */
  getErrors(): ReadonlyArray<DomainError> {
    return [...this.errors];
  }

  /**
   * Build the composite specification.
   *
   * If there are validation errors, returns the first error.
   * If there are no specs, returns an error.
   * Otherwise, returns a spec that combines all set operations with AndSpec.
   *
   * @returns A Result containing either the composite spec or an error
   */
  build(): Result<ICellValueSpec, DomainError> {
    // Check for validation errors
    if (this.errors.length > 0) {
      // Return the first error, or could combine them
      return err(this.errors[0]!);
    }

    // Check for empty specs
    if (this.specs.length === 0) {
      return err(domainError.validation({ message: 'No field values to set' }));
    }

    // If only one spec, return it directly
    if (this.specs.length === 1) {
      return ok(this.specs[0]!);
    }

    // Combine multiple specs using AndSpec
    // We need to cast to the correct type since AndSpec implements ISpecification
    let combined: ICellValueSpec = this.specs[0]!;
    for (let i = 1; i < this.specs.length; i++) {
      combined = new AndSpec<TableRecord, ICellValueSpecVisitor>(combined, this.specs[i]!);
    }

    return ok(combined);
  }

  /**
   * Build and immediately mutate a record.
   *
   * Convenience method that combines build() and mutate() in one call.
   *
   * @param record - The record to mutate
   * @returns A Result containing either the mutated record or an error
   */
  buildAndMutate(record: TableRecord): Result<TableRecord, DomainError> {
    return this.build().andThen((spec) => spec.mutate(record));
  }
}
