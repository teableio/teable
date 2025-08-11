import type { FieldType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { UserAbstractCore } from './abstract/user.field.abstract';
import {
  createdByFieldOptionsSchema,
  type ICreatedByFieldOptions,
} from './created-by-option.schema';

export class CreatedByFieldCore extends UserAbstractCore {
  type!: FieldType.CreatedBy;
  options!: ICreatedByFieldOptions;

  convertStringToCellValue(_value: string) {
    return null;
  }

  repair(_value: unknown) {
    return null;
  }

  validateOptions() {
    return createdByFieldOptionsSchema.safeParse(this.options);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitCreatedByField(this);
  }
}
