import type { FieldType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { UserAbstractCore } from './abstract/user.field.abstract';
import type { ILastModifiedByFieldOptions } from './last-modified-by-option.schema';
import { lastModifiedByFieldOptionsSchema } from './last-modified-by-option.schema';

export class LastModifiedByFieldCore extends UserAbstractCore {
  type!: FieldType.LastModifiedBy;
  options!: ILastModifiedByFieldOptions;

  override get isStructuredCellValue() {
    return true;
  }

  convertStringToCellValue(_value: string) {
    return null;
  }

  repair(_value: unknown) {
    return null;
  }

  validateOptions() {
    return lastModifiedByFieldOptionsSchema.safeParse(this.options);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitLastModifiedByField(this);
  }
}
