import { z } from 'zod';
import type { FieldType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { UserAbstractCore } from './abstract/user.field.abstract';

export const lastModifiedByFieldOptionsSchema = z.object({}).strict();

export type ILastModifiedByFieldOptions = z.infer<typeof lastModifiedByFieldOptionsSchema>;

export class LastModifiedByFieldCore extends UserAbstractCore {
  type!: FieldType.LastModifiedBy;
  options!: ILastModifiedByFieldOptions;

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
