import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { DateTimeFormatting } from './DateTimeFormatting';
import { FieldComputed } from './FieldComputed';
import { FormulaExpression } from './FormulaExpression';

export class LastModifiedTimeField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly formattingValue: DateTimeFormatting,
    private readonly trackedFieldIdsValue: ReadonlyArray<FieldId>,
    private readonly expressionValue: FormulaExpression
  ) {
    super(id, name, FieldType.lastModifiedTime(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    formatting?: DateTimeFormatting;
    trackedFieldIds?: ReadonlyArray<FieldId>;
  }): Result<LastModifiedTimeField, string> {
    const formatting = params.formatting ?? DateTimeFormatting.default();
    const trackedFieldIds = params.trackedFieldIds ?? [];
    return FormulaExpression.create('LAST_MODIFIED_TIME()').map(
      (expression) =>
        new LastModifiedTimeField(params.id, params.name, formatting, trackedFieldIds, expression)
    );
  }

  formatting(): DateTimeFormatting {
    return this.formattingValue;
  }

  trackedFieldIds(): ReadonlyArray<FieldId> {
    return [...this.trackedFieldIdsValue];
  }

  isTrackAll(): boolean {
    return this.trackedFieldIdsValue.length === 0;
  }

  expression(): FormulaExpression {
    return this.expressionValue;
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitLastModifiedTimeField(this);
  }
}
