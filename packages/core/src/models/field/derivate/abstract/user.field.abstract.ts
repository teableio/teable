import { z } from 'zod';
import type { CellValueType } from '../../constant';
import { FieldCore } from '../../field';

export const userCellValueSchema = z.object({
  id: z.string(),
  title: z.string(),
  email: z.string().optional(),
  avatarUrl: z.string().optional().nullable(),
});

export type IUserCellValue = z.infer<typeof userCellValueSchema>;

export abstract class UserAbstractCore extends FieldCore {
  cellValueType!: CellValueType.String;

  item2String(value: unknown) {
    if (value == null) {
      return '';
    }

    const { title } = value as IUserCellValue;

    if (this.isMultipleCellValue && title?.includes(',')) {
      return `"${title}"`;
    }
    return title || '';
  }

  cellValue2String(cellValue?: unknown) {
    if (Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }
    return this.item2String(cellValue);
  }

  validateCellValue(cellValue: unknown) {
    if (this.isMultipleCellValue) {
      return z
        .array(userCellValueSchema)
        .transform((arr) => (arr.length === 0 ? null : arr))
        .nullable()
        .safeParse(cellValue);
    }
    return userCellValueSchema.nullable().safeParse(cellValue);
  }
}
