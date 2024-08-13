import { z } from 'zod';
import type { FieldType } from '../constant';
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
}
