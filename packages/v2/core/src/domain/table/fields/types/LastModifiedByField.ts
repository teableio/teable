import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { FieldComputed } from './FieldComputed';
import { GeneratedColumnMeta } from './GeneratedColumnMeta';

export class LastModifiedByField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly trackedFieldIdsValue: ReadonlyArray<FieldId>,
    private readonly metaValue: GeneratedColumnMeta
  ) {
    super(id, name, FieldType.lastModifiedBy(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    trackedFieldIds?: ReadonlyArray<FieldId>;
    meta?: GeneratedColumnMeta;
  }): Result<LastModifiedByField, DomainError> {
    const trackedFieldIds = params.trackedFieldIds ?? [];
    const metaResult = params.meta
      ? ok(params.meta)
      : GeneratedColumnMeta.rehydrate({
          persistedAsGeneratedColumn: false,
        });
    return metaResult.map(
      (metaValue) => new LastModifiedByField(params.id, params.name, trackedFieldIds, metaValue)
    );
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

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return LastModifiedByField.create({
      id: params.newId,
      name: params.newName,
      trackedFieldIds: this.trackedFieldIds(),
      meta: this.meta(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLastModifiedByField(this);
  }
}
