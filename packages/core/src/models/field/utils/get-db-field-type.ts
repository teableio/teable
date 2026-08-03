import { match } from 'ts-pattern';
import { FieldType, CellValueType, DbFieldType } from '../constant';

/**
 * Get database field type based on field type, cell value type, and multiplicity
 * This is a pure function that doesn't depend on any services
 */
export function getDbFieldType(
  fieldType: FieldType,
  cellValueType: CellValueType,
  isMultipleCellValue?: boolean
): DbFieldType {
  // Multiple cell values are always stored as JSON
  if (isMultipleCellValue) {
    return DbFieldType.Json;
  }

  return match(fieldType)
    .with(
      FieldType.Link,
      FieldType.User,
      FieldType.Attachment,
      FieldType.Button,
      FieldType.CreatedBy,
      FieldType.LastModifiedBy,
      () => DbFieldType.Json
    )
    .with(FieldType.AutoNumber, () => DbFieldType.Integer)
    .otherwise(() =>
      match(cellValueType)
        .with(CellValueType.Number, () => DbFieldType.Real)
        .with(CellValueType.DateTime, () => DbFieldType.DateTime)
        .with(CellValueType.Boolean, () => DbFieldType.Boolean)
        .with(CellValueType.String, () => DbFieldType.Text)
        .exhaustive()
    );
}
