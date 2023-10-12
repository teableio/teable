import { z } from '../../../zod';
import { CellValueType } from '../constant';
import { multiNumberShowAsSchema, numberShowAsSchema, singleNumberShowAsSchema } from './number';
import { singleLineTextShowAsSchema } from './text';

export * from './number';
export * from './text';

export const getShowAsSchema = (
  cellValueType: CellValueType,
  isMultipleCellValue: boolean | undefined
) => {
  if (cellValueType === CellValueType.Number) {
    return isMultipleCellValue
      ? multiNumberShowAsSchema.optional()
      : singleNumberShowAsSchema.optional();
  }

  if (cellValueType === CellValueType.String) {
    return singleLineTextShowAsSchema.optional();
  }

  return z.undefined().openapi({
    description: 'Only number cell value type support show as',
  });
};

export const unionShowAsSchema = z.union([singleLineTextShowAsSchema, numberShowAsSchema]);

export type IUnionShowAs = z.infer<typeof unionShowAsSchema>;
