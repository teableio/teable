import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { MultipleSelectField } from '../../fields/types/MultipleSelectField';
import type { SelectAutoNewOptions } from '../../fields/types/SelectAutoNewOptions';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a multiple select field's auto new options setting.
 */
export class UpdateMultipleSelectAutoNewOptionsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousAutoNewOptionsValue: SelectAutoNewOptions,
    private readonly nextAutoNewOptionsValue: SelectAutoNewOptions
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousAutoNewOptions: SelectAutoNewOptions,
    nextAutoNewOptions: SelectAutoNewOptions
  ): UpdateMultipleSelectAutoNewOptionsSpec {
    return new UpdateMultipleSelectAutoNewOptionsSpec(
      fieldId,
      previousAutoNewOptions,
      nextAutoNewOptions
    );
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousAutoNewOptions(): SelectAutoNewOptions {
    return this.previousAutoNewOptionsValue;
  }

  nextAutoNewOptions(): SelectAutoNewOptions {
    return this.nextAutoNewOptionsValue;
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
      options: field.selectOptions(),
      defaultValue: field.defaultValue(),
      preventAutoNewOptions: this.nextAutoNewOptionsValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateMultipleSelectAutoNewOptions(this).map(() => undefined);
  }
}
