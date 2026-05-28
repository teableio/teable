import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType, isCrossBaseField } from '@teable/core';

export { isCrossBaseField, hasCrossBaseField } from '@teable/core';

/**
 * Rewrites cross-base headers to plain SingleLineText so the paste target
 * cannot reconstruct link relationships or surface foreign record IDs. The
 * predicate lives in @teable/core; this helper is the UX-specific transform
 * applied at the clipboard boundary.
 */
const buildPlainTextHeader = (header: IFieldVo): IFieldVo => ({
  id: header.id,
  name: header.name,
  description: header.description,
  type: FieldType.SingleLineText,
  options: {},
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
  dbFieldName: header.dbFieldName,
  isMultipleCellValue: false,
});

export const downgradeCrossBaseHeaders = (
  headers: IFieldVo[],
  currentBaseId?: string
): { headers: IFieldVo[]; downgradedIndices: Set<number> } => {
  const downgradedIndices = new Set<number>();
  const next = headers.map((header, index) => {
    if (isCrossBaseField(header, currentBaseId)) {
      downgradedIndices.add(index);
      return buildPlainTextHeader(header);
    }
    return header;
  });
  return { headers: next, downgradedIndices };
};
