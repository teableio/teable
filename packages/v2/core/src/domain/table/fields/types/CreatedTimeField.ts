import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { DateTimeFormatting } from './DateTimeFormatting';
import { FieldComputed } from './FieldComputed';
import { FormulaExpression } from './FormulaExpression';

export class CreatedTimeField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly formattingValue: DateTimeFormatting,
    private readonly expressionValue: FormulaExpression
  ) {
    super(id, name, FieldType.createdTime(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    formatting?: DateTimeFormatting;
  }): Result<CreatedTimeField, string> {
    const formatting = params.formatting ?? DateTimeFormatting.default();
    return FormulaExpression.create('CREATED_TIME()').map(
      (expression) => new CreatedTimeField(params.id, params.name, formatting, expression)
    );
  }

  formatting(): DateTimeFormatting {
    return this.formattingValue;
  }

  expression(): FormulaExpression {
    return this.expressionValue;
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitCreatedTimeField(this);
  }
}
