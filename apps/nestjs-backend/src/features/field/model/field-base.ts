export interface IFieldBase {
  convertDBValue2CellValue(value: unknown): unknown;

  convertCellValue2DBValue(value: unknown): unknown;
}
