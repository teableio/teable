export abstract class FieldBase {
  // whether the storage structure of the value is a json Object, notice title key in json object is required
  // example: { title: 'title', id: 'id1' } or [{ title: 'title1', id: 'id1' }, { title: 'title2', id: 'id2' }]
  abstract get isStructuredCellValue(): boolean;

  abstract convertDBValue2CellValue(value: unknown, context?: unknown): unknown;

  abstract convertCellValue2DBValue(value: unknown): unknown;
}
