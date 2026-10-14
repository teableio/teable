import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type {
  FieldDeletionContext,
  FieldDeletionReaction,
  OnTeableFieldDeleted,
} from '../../OnTeableFieldDeleted';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
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

export class LastModifiedTimeField extends Field implements OnTeableFieldDeleted {
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

  onFieldDeleted(
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<FieldDeletionReaction | undefined, DomainError> {
    if (
      !context.sourceTable.id().equals(context.table.id()) ||
      !this.trackedFieldIdsValue.some((id) => id.equals(deletedField.id()))
    ) {
      return ok(undefined);
    }

    return LastModifiedTimeField.create({
      id: this.id(),
      name: this.name(),
      formatting: this.formatting(),
      trackedFieldIds: this.trackedFieldIdsValue.filter((id) => !id.equals(deletedField.id())),
      // Track-all writes also support stored columns. Keep historical stamps so
      // undoing this metadata-only cleanup can restore the original tracking.
      meta: this.meta(),
    }).andThen((updatedField) =>
      updatedField.setDescription(this.description()).map(() => ({
        spec: TableUpdateFieldTypeSpec.create(this, updatedField),
        relatedFieldIds: [this.id()],
      }))
    );
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
