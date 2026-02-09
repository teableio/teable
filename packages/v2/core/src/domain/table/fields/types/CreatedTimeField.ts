import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { DateTimeFormatting } from './DateTimeFormatting';
import { FieldComputed } from './FieldComputed';
import { FormulaExpression } from './FormulaExpression';
import { GeneratedColumnMeta } from './GeneratedColumnMeta';

export class CreatedTimeField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly formattingValue: DateTimeFormatting,
    private readonly metaValue: GeneratedColumnMeta,
    private readonly expressionValue: FormulaExpression
  ) {
    super(id, name, FieldType.createdTime(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    formatting?: DateTimeFormatting;
    meta?: GeneratedColumnMeta;
  }): Result<CreatedTimeField, DomainError> {
    const formatting = params.formatting ?? DateTimeFormatting.default();
    const metaResult = params.meta
      ? ok(params.meta)
      : GeneratedColumnMeta.rehydrate({
          persistedAsGeneratedColumn: true,
        });
    return metaResult.andThen((metaValue) =>
      FormulaExpression.create('CREATED_TIME()').map(
        (expression) =>
          new CreatedTimeField(params.id, params.name, formatting, metaValue, expression)
      )
    );
  }

  formatting(): DateTimeFormatting {
    return this.formattingValue;
  }

  meta(): GeneratedColumnMeta {
    return this.metaValue;
  }

  isPersistedAsGeneratedColumn(): Result<boolean, DomainError> {
    return this.metaValue.persistedAsGeneratedColumn();
  }

  expression(): FormulaExpression {
    return this.expressionValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return CreatedTimeField.create({
      id: params.newId,
      name: params.newName,
      formatting: this.formatting(),
      meta: this.meta(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitCreatedTimeField(this);
  }
}
