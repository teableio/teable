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

export class LastModifiedTimeField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly formattingValue: DateTimeFormatting,
    private readonly trackedFieldIdsValue: ReadonlyArray<FieldId>,
    private readonly metaValue: GeneratedColumnMeta,
    private readonly expressionValue: FormulaExpression
  ) {
    super(id, name, FieldType.lastModifiedTime(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    formatting?: DateTimeFormatting;
    trackedFieldIds?: ReadonlyArray<FieldId>;
    meta?: GeneratedColumnMeta;
  }): Result<LastModifiedTimeField, DomainError> {
    const formatting = params.formatting ?? DateTimeFormatting.default();
    const trackedFieldIds = params.trackedFieldIds ?? [];
    const metaResult = params.meta
      ? ok(params.meta)
      : GeneratedColumnMeta.rehydrate({
          persistedAsGeneratedColumn: trackedFieldIds.length === 0,
        });
    return metaResult.andThen((metaValue) =>
      FormulaExpression.create('LAST_MODIFIED_TIME()').map(
        (expression) =>
          new LastModifiedTimeField(
            params.id,
            params.name,
            formatting,
            trackedFieldIds,
            metaValue,
            expression
          )
      )
    );
  }

  formatting(): DateTimeFormatting {
    return this.formattingValue;
  }

  trackedFieldIds(): ReadonlyArray<FieldId> {
    return [...this.trackedFieldIdsValue];
  }

  meta(): GeneratedColumnMeta {
    return this.metaValue;
  }

  isPersistedAsGeneratedColumn(): Result<boolean, DomainError> {
    return this.metaValue.persistedAsGeneratedColumn();
  }

  isTrackAll(): boolean {
    return this.trackedFieldIdsValue.length === 0;
  }

  expression(): FormulaExpression {
    return this.expressionValue;
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return LastModifiedTimeField.create({
      id: params.newId,
      name: params.newName,
      formatting: this.formatting(),
      trackedFieldIds: this.trackedFieldIds(),
      meta: this.meta(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLastModifiedTimeField(this);
  }
}
