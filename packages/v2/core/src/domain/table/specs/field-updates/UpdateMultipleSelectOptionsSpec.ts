import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { DbFieldName } from '../../fields/DbFieldName';
import type { FieldId } from '../../fields/FieldId';
import { MultipleSelectField } from '../../fields/types/MultipleSelectField';
import type { SelectOption } from '../../fields/types/SelectOption';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a multiple select field's options.
 */
export class UpdateMultipleSelectOptionsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly dbFieldNameValue: DbFieldName,
    private readonly previousOptionsValue: ReadonlyArray<SelectOption>,
    private readonly nextOptionsValue: ReadonlyArray<SelectOption>
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    dbFieldName: DbFieldName,
    previousOptions: ReadonlyArray<SelectOption>,
    nextOptions: ReadonlyArray<SelectOption>
  ): UpdateMultipleSelectOptionsSpec {
    return new UpdateMultipleSelectOptionsSpec(fieldId, dbFieldName, previousOptions, nextOptions);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  dbFieldName(): DbFieldName {
    return this.dbFieldNameValue;
  }

  previousOptions(): ReadonlyArray<SelectOption> {
    return this.previousOptionsValue;
  }

  nextOptions(): ReadonlyArray<SelectOption> {
    return this.nextOptionsValue;
  }

  /**
   * Get options that were added (exist in next but not in previous by ID)
   */
  addedOptions(): ReadonlyArray<SelectOption> {
    const previousIds = new Set(this.previousOptionsValue.map((o) => o.id().toString()));
    return this.nextOptionsValue.filter((o) => !previousIds.has(o.id().toString()));
  }

  /**
   * Get options that were removed (exist in previous but not in next by ID)
   */
  removedOptions(): ReadonlyArray<SelectOption> {
    const nextIds = new Set(this.nextOptionsValue.map((o) => o.id().toString()));
    return this.previousOptionsValue.filter((o) => !nextIds.has(o.id().toString()));
  }

  /**
   * Get options that were renamed (same ID, different name)
   */
  renamedOptions(): ReadonlyArray<{ previous: SelectOption; next: SelectOption }> {
    const previousById = new Map(this.previousOptionsValue.map((o) => [o.id().toString(), o]));
    const renamed: { previous: SelectOption; next: SelectOption }[] = [];

    for (const next of this.nextOptionsValue) {
      const previous = previousById.get(next.id().toString());
      if (previous && !previous.name().equals(next.name())) {
        renamed.push({ previous, next });
      }
    }

    return renamed;
  }

  /**
   * Get options that were modified (exist in both but with different properties)
   */
  modifiedOptions(): ReadonlyArray<{ previous: SelectOption; next: SelectOption }> {
    const previousById = new Map(this.previousOptionsValue.map((o) => [o.id().toString(), o]));
    const modified: { previous: SelectOption; next: SelectOption }[] = [];

    for (const next of this.nextOptionsValue) {
      const previous = previousById.get(next.id().toString());
      if (previous && !previous.equals(next)) {
        modified.push({ previous, next });
      }
    }

    return modified;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof MultipleSelectField)) {
      return err(domainError.validation({ message: 'Field is not a multiple select field' }));
    }

    const updatedFieldResult = MultipleSelectField.create({
      id: field.id(),
      name: field.name(),
      options: this.nextOptionsValue,
      defaultValue: field.defaultValue(),
      preventAutoNewOptions: field.preventAutoNewOptions(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateMultipleSelectOptions(this).map(() => undefined);
  }
}
