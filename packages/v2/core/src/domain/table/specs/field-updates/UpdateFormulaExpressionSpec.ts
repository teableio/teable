import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../fields/FieldId';
import { FormulaField } from '../../fields/types/FormulaField';
import type { FormulaExpression } from '../../fields/types/FormulaExpression';
import { FieldValueTypeVisitor } from '../../fields/visitors/FieldValueTypeVisitor';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for updating a formula field's expression.
 * This is a fine-grained spec that repository can handle specifically for expression changes.
 */
export class UpdateFormulaExpressionSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousExpressionValue: FormulaExpression,
    private readonly nextExpressionValue: FormulaExpression
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousExpression: FormulaExpression,
    nextExpression: FormulaExpression
  ): UpdateFormulaExpressionSpec {
    return new UpdateFormulaExpressionSpec(fieldId, previousExpression, nextExpression);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousExpression(): FormulaExpression {
    return this.previousExpressionValue;
  }

  nextExpression(): FormulaExpression {
    return this.nextExpressionValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    const fieldResult = t.getField((f) => f.id().equals(this.fieldIdValue));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (!(field instanceof FormulaField)) {
      return err(domainError.validation({ message: 'Field is not a formula field' }));
    }

    const buildUpdatedField = (clearStyle: boolean): Result<FormulaField, DomainError> =>
      FormulaField.create({
        id: field.id(),
        name: field.name(),
        expression: this.nextExpressionValue,
        timeZone: field.timeZone(),
        formatting: clearStyle ? undefined : field.formatting(),
        showAs: clearStyle ? undefined : field.showAs(),
      });

    let updatedFieldResult = buildUpdatedField(false);
    if (updatedFieldResult.isErr()) {
      return err(updatedFieldResult.error);
    }

    // If expression value type can be inferred and current style options are incompatible
    // with that inferred type, clear formatting/showAs to keep conversion resilient.
    const valueTypeVisitor = new FieldValueTypeVisitor();
    const valueTypes = t
      .getFields()
      .filter((candidate) => !candidate.id().equals(field.id()))
      .flatMap((candidate) => {
        const result = candidate.accept(valueTypeVisitor);
        if (result.isErr()) return [];
        return [{ id: candidate.id(), valueType: result.value }];
      });

    const inferredType = this.nextExpressionValue.getParsedValueType(valueTypes);
    if (inferredType.isOk()) {
      const strictField = FormulaField.create({
        id: field.id(),
        name: field.name(),
        expression: this.nextExpressionValue,
        timeZone: field.timeZone(),
        formatting: field.formatting(),
        showAs: field.showAs(),
        resultType: inferredType.value,
      });

      if (strictField.isErr()) {
        const fallbackField = buildUpdatedField(true);
        if (fallbackField.isErr()) return err(fallbackField.error);
        updatedFieldResult = fallbackField;
      }
    }

    return t.replaceField(this.fieldIdValue, updatedFieldResult.value);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitUpdateFormulaExpression(this).map(() => undefined);
  }
}
