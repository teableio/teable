import { z } from '../../../zod';
import { CellValueType } from '../constant';
import { multiNumberShowAsSchema, singleNumberShowAsSchema } from './number';

export * from './number';

export const getShowAsSchema = (
  cellValueType: CellValueType,
  isMultipleCellValue: boolean | undefined
) => {
  if (cellValueType === CellValueType.Number) {
    return isMultipleCellValue
      ? multiNumberShowAsSchema.optional()
      : singleNumberShowAsSchema.optional();
  }

  return z.undefined().openapi({
    description: 'Only number cell value type support show as',
  });
};
