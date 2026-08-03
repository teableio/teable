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

export class CreatedByField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly metaValue: GeneratedColumnMeta
  ) {
    super(id, name, FieldType.createdBy(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    meta?: GeneratedColumnMeta;
  }): Result<CreatedByField, DomainError> {
    const metaResult = params.meta
      ? ok(params.meta)
      : GeneratedColumnMeta.rehydrate({ persistedAsGeneratedColumn: false });
    return metaResult.map((metaValue) => new CreatedByField(params.id, params.name, metaValue));
  }

  meta(): GeneratedColumnMeta {
    return this.metaValue;
  }

  isPersistedAsGeneratedColumn(): Result<boolean, DomainError> {
    return this.metaValue.persistedAsGeneratedColumn();
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    return CreatedByField.create({
      id: params.newId,
      name: params.newName,
      meta: this.meta(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitCreatedByField(this);
  }
}
