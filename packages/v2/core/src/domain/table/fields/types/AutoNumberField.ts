import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { FieldComputed } from './FieldComputed';
import { FormulaExpression } from './FormulaExpression';

export class AutoNumberField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly expressionValue: FormulaExpression
  ) {
    super(id, name, FieldType.autoNumber(), undefined, [], FieldComputed.computed());
  }

  static create(params: { id: FieldId; name: FieldName }): Result<AutoNumberField, string> {
    return FormulaExpression.create('AUTO_NUMBER()').map(
      (expression) => new AutoNumberField(params.id, params.name, expression)
    );
  }

  expression(): FormulaExpression {
    return this.expressionValue;
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitAutoNumberField(this);
  }
}
