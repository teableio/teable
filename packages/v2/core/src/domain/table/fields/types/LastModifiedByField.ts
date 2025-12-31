import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { FieldComputed } from './FieldComputed';

export class LastModifiedByField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private readonly trackedFieldIdsValue: ReadonlyArray<FieldId>
  ) {
    super(id, name, FieldType.lastModifiedBy(), undefined, [], FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    trackedFieldIds?: ReadonlyArray<FieldId>;
  }): Result<LastModifiedByField, DomainError> {
    return ok(new LastModifiedByField(params.id, params.name, params.trackedFieldIds ?? []));
  }

  trackedFieldIds(): ReadonlyArray<FieldId> {
    return [...this.trackedFieldIdsValue];
  }

  isTrackAll(): boolean {
    return this.trackedFieldIdsValue.length === 0;
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLastModifiedByField(this);
  }
}
