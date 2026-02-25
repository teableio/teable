import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { RollupField, type RollupShowAs } from '../../fields/types/RollupField';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a rollup field's showAs property.
 */
export class UpdateRollupShowAsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousShowAsValue: RollupShowAs | undefined,
    private readonly nextShowAsValue: RollupShowAs | undefined
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousShowAs: RollupShowAs | undefined,
    nextShowAs: RollupShowAs | undefined
  ): UpdateRollupShowAsSpec {
    return new UpdateRollupShowAsSpec(fieldId, previousShowAs, nextShowAs);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousShowAs(): RollupShowAs | undefined {
    return this.previousShowAsValue;
  }

  nextShowAs(): RollupShowAs | undefined {
    return this.nextShowAsValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof RollupField)) {
      return err(domainError.validation({ message: 'Field is not a rollup field' }));
    }

    const cellValueType = field.cellValueType();
    const isMultipleCellValue = field.isMultipleCellValue();
    if (cellValueType.isErr() || isMultipleCellValue.isErr()) {
      return err(domainError.validation({ message: 'Rollup field result type not set' }));
    }

    const updatedFieldResult = RollupField.rehydrate({
      id: field.id(),
      name: field.name(),
      config: field.config(),
      expression: field.expression(),
      timeZone: field.timeZone(),
      formatting: field.formatting(),
      showAs: this.nextShowAsValue,
      resultType: {
        cellValueType: cellValueType.value,
        isMultipleCellValue: isMultipleCellValue.value,
      },
      dependencies: field.dependencies(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateRollupShowAs(this).map(() => undefined);
  }
}
