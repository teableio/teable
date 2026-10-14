import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../../shared/DomainContext';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { DbFieldName } from '../../fields/DbFieldName';
import type { FieldId } from '../../fields/FieldId';
import {
  ensureSelectFieldOptionCountWithinLimit,
  ensureSelectFieldOptionNamesWithinLimit,
} from '../../fields/types/SelectFieldOptionWriteConfig';
import type { SelectDefaultValue } from '../../fields/types/SelectDefaultValue';
import type { SelectOption } from '../../fields/types/SelectOption';
import { SingleSelectField } from '../../fields/types/SingleSelectField';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * A default-value change that travels with the option rewrite.
 *
 * Renaming an option and re-pointing the default in the same request cannot be
 * validated option-by-option: the old default no longer names a live option and
 * the new default does not name an existing one yet. Carrying both in one spec
 * lets the field be rebuilt once with the new options and the new default, so
 * the pair validates as a whole instead of failing halfway.
 */
export interface SelectDefaultValueChange {
  readonly next: SelectDefaultValue | undefined;
}

/**
 * Specification for updating a single select field's options.
 * Repository can handle this specifically to update the options table.
 */
export class UpdateSingleSelectOptionsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly dbFieldNameValue: DbFieldName,
    private readonly previousOptionsValue: ReadonlyArray<SelectOption>,
    private readonly nextOptionsValue: ReadonlyArray<SelectOption>,
    private readonly domainContextValue: IDomainContext | undefined,
    private readonly defaultValueChangeValue: SelectDefaultValueChange | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    dbFieldName: DbFieldName,
    previousOptions: ReadonlyArray<SelectOption>,
    nextOptions: ReadonlyArray<SelectOption>,
    domainContext?: IDomainContext,
    defaultValueChange?: SelectDefaultValueChange
  ): UpdateSingleSelectOptionsSpec {
    return new UpdateSingleSelectOptionsSpec(
      fieldId,
      dbFieldName,
      previousOptions,
      nextOptions,
      domainContext,
      defaultValueChange
    );
  }

  /** The default to write alongside the option rewrite, when one was requested. */
  defaultValueChange(): SelectDefaultValueChange | undefined {
    return this.defaultValueChangeValue;
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
    const limitResult = ensureSelectFieldOptionCountWithinLimit(
      this.nextOptionsValue.length,
      this.domainContextValue
    );
    if (limitResult.isErr()) return err(limitResult.error);
    const nameLimitResult = ensureSelectFieldOptionNamesWithinLimit(
      this.nextOptionsValue.map((option) => option.name().toString()),
      this.domainContextValue
    );
    if (nameLimitResult.isErr()) return err(nameLimitResult.error);

    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof SingleSelectField)) {
      return err(domainError.validation({ message: 'Field is not a single select field' }));
    }

    // Create updated select field with new options. When the request also
    // changes the default, the new default is what has to validate against the
    // new option names — carrying the old default across would reject a
    // rename+repoint that is perfectly coherent as a whole.
    const updatedFieldResult = SingleSelectField.create({
      id: field.id(),
      name: field.name(),
      options: this.nextOptionsValue,
      defaultValue: this.defaultValueChangeValue
        ? this.defaultValueChangeValue.next
        : field.defaultValue(),
      preventAutoNewOptions: field.preventAutoNewOptions(),
      domainContext: this.domainContextValue,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateSingleSelectOptions(this).map(() => undefined);
  }
}
