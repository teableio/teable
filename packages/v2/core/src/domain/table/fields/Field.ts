import type { Result } from 'neverthrow';

import { Entity } from '../../shared/Entity';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import type { FieldType } from './FieldType';
import type { IFieldVisitor } from './visitors/IFieldVisitor';

export abstract class Field extends Entity<FieldId> {
  protected constructor(
    id: FieldId,
    private readonly nameValue: FieldName,
    private readonly typeValue: FieldType
  ) {
    super(id);
  }

  name(): FieldName {
    return this.nameValue;
  }

  type(): FieldType {
    return this.typeValue;
  }

  abstract accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string>;
}
