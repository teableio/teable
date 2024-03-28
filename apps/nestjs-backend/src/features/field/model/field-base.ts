export abstract class IFieldBase {
  abstract get isStructuredCellValue(): boolean;

  abstract convertDBValue2CellValue(value: unknown): unknown;

  abstract convertCellValue2DBValue(value: unknown): unknown;
}
