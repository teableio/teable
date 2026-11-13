import { FieldType } from '@teable/core';
import { normalizeRecordLinkPasteValue } from '@teable/v2-core';

type LinkPasteTarget = { readonly isMultipleCellValue?: boolean };
type LinkPasteSource = {
  readonly type: FieldType;
  cellValue2String(value: unknown): unknown;
};

/**
 * Convert a copied cell into a paste value for a link field.
 *
 * Sync copy serializes structured link values (`{ id, title }`) into the HTML
 * clipboard. Stripping titles down to ids causes realtime update events to push
 * unresolved links, so the grid shows "Untitled" until a full refresh.
 */
export const convertLinkPasteCellValue = (
  targetField: LinkPasteTarget,
  sourceField: LinkPasteSource,
  cellValue: unknown
): unknown => {
  if (cellValue == null) {
    return null;
  }

  if (sourceField.type !== FieldType.Link) {
    return sourceField.cellValue2String(cellValue);
  }

  const normalized = normalizeRecordLinkPasteValue(
    cellValue,
    targetField.isMultipleCellValue === true
  );
  if (normalized.isErr()) {
    // Retain the existing thrown-error boundary for callers using legacy source metadata.
    if (normalized.error.cause instanceof Error) throw normalized.error.cause;
    throw new Error(normalized.error.message);
  }
  return normalized.value;
};
