import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { SingleSelectField } from '../../fields/types/SingleSelectField';
import type { SelectAutoNewOptions } from '../../fields/types/SelectAutoNewOptions';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a single select field's auto new options setting.
 */
export class UpdateSingleSelectAutoNewOptionsSpec<
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
  ): UpdateSingleSelectAutoNewOptionsSpec {
    return new UpdateSingleSelectAutoNewOptionsSpec(
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
    if (!(field instanceof SingleSelectField)) {
      return err(domainError.validation({ message: 'Field is not a single select field' }));
    }

    const updatedFieldResult = SingleSelectField.create({
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
    return v.visitUpdateSingleSelectAutoNewOptions(this).map(() => undefined);
  }
}
