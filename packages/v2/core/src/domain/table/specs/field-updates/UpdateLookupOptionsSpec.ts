import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { LookupField } from '../../fields/types/LookupField';
import type { LookupOptions } from '../../fields/types/LookupOptions';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a lookup field's options.
 */
export class UpdateLookupOptionsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousOptionsValue: LookupOptions,
    private readonly nextOptionsValue: LookupOptions
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousOptions: LookupOptions,
    nextOptions: LookupOptions
  ): UpdateLookupOptionsSpec {
    return new UpdateLookupOptionsSpec(fieldId, previousOptions, nextOptions);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousOptions(): LookupOptions {
    return this.previousOptionsValue;
  }

  nextOptions(): LookupOptions {
    return this.nextOptionsValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof LookupField)) {
      return err(domainError.validation({ message: 'Field is not a lookup field' }));
    }

    // Preserve isMultipleCellValue from the current field so that the pending field
    // keeps the correct column type semantics (e.g. scalar vs jsonb). Without this,
    // pending fields default to multiple, causing IS DISTINCT FROM type mismatches
    // during backfill when the actual PG column is scalar.
    const isMultipleResult = field.isMultipleCellValue();
    const isMultipleCellValue = isMultipleResult.isOk()
      ? isMultipleResult.value.isMultiple()
      : undefined;
    const dbFieldNameResult = field.dbFieldName();

    // Note: Lookup field inner field resolution happens during foreign table validation
    // Here we just create a pending lookup field with the new options
    const updatedFieldResult = LookupField.createPending({
      id: field.id(),
      name: field.name(),
      lookupOptions: this.nextOptionsValue,
      dbFieldName: dbFieldNameResult.isOk() ? dbFieldNameResult.value : undefined,
      dependencies: field.dependencies(),
      isMultipleCellValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateLookupOptions(this).map(() => undefined);
  }
}
