export abstract class IFieldBase {
  isStructuredCellValue: boolean = false;

  abstract convertDBValue2CellValue(value: unknown): unknown;

  abstract convertCellValue2DBValue(value: unknown): unknown;
}
