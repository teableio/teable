import type { Field } from '../Field';
import { FieldType } from '../FieldType';

/**
 * v1 `SingleLineTextFieldCore.convertStringToCellValue`:
 * newlines and tabs become spaces, then surrounding whitespace is removed.
 * An empty result is stored as null. Long text must not use this.
 */
export const normalizeSingleLineTextCellValue = (value: string): string | null => {
  const normalized = value.replace(/[\n\r\t]/g, ' ').trim();
  return normalized === '' ? null : normalized;
};

/**
 * Lookup and dedup key for a foreign primary title.
 * Single-line text uses the stored form. Long text stays unchanged.
 */
export const titleKeyForPrimaryField = (field: Field, title: string): string | null => {
  if (field.type().equals(FieldType.singleLineText())) {
    return normalizeSingleLineTextCellValue(title);
  }
  return title === '' ? null : title;
};
