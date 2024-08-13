import { z } from 'zod';
import type { FieldType } from '../constant';
import { UserAbstractCore } from './abstract/user.field.abstract';

export const createdByFieldOptionsSchema = z.object({}).strict();

export type ICreatedByFieldOptions = z.infer<typeof createdByFieldOptionsSchema>;

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
}
