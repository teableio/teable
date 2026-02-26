import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { RollupField } from '../../fields/types/RollupField';
import type { RollupExpression } from '../../fields/types/RollupExpression';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a rollup field's expression.
 */
export class UpdateRollupExpressionSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousExpressionValue: RollupExpression,
    private readonly nextExpressionValue: RollupExpression
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousExpression: RollupExpression,
    nextExpression: RollupExpression
  ): UpdateRollupExpressionSpec {
    return new UpdateRollupExpressionSpec(fieldId, previousExpression, nextExpression);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousExpression(): RollupExpression {
    return this.previousExpressionValue;
  }

  nextExpression(): RollupExpression {
    return this.nextExpressionValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof RollupField)) {
      return err(domainError.validation({ message: 'Field is not a rollup field' }));
    }

    const cellValueTypeResult = field.cellValueType();
    const isMultipleResult = field.isMultipleCellValue();
    const resultType =
      cellValueTypeResult.isOk() && isMultipleResult.isOk()
        ? {
            cellValueType: cellValueTypeResult.value,
            isMultipleCellValue: isMultipleResult.value,
          }
        : undefined;

    const updatedFieldResult = RollupField.createPending({
      id: field.id(),
      name: field.name(),
      config: field.config(),
      expression: this.nextExpressionValue,
      timeZone: field.timeZone(),
      formatting: field.formatting(),
      showAs: field.showAs(),
      resultType,
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateRollupExpression(this).map(() => undefined);
  }
}
