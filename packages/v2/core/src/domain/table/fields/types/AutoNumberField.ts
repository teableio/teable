import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { FieldComputed } from './FieldComputed';
import { FormulaExpression } from './FormulaExpression';
import { GeneratedColumnMeta } from './GeneratedColumnMeta';

export class AutoNumberField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly metaValue: GeneratedColumnMeta,
    private readonly expressionValue: FormulaExpression
  ) {
    super(id, name, FieldType.autoNumber(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    meta?: GeneratedColumnMeta;
  }): Result<AutoNumberField, DomainError> {
    const metaResult = params.meta
      ? ok(params.meta)
      : GeneratedColumnMeta.rehydrate({ persistedAsGeneratedColumn: true });
    return metaResult.andThen((metaValue) =>
      FormulaExpression.create('AUTO_NUMBER()').map(
        (expression) => new AutoNumberField(params.id, params.name, metaValue, expression)
      )
    );
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
    return AutoNumberField.create({
      id: params.newId,
      name: params.newName,
      meta: this.meta(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitAutoNumberField(this);
  }
}
