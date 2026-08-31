import type { FieldCore } from '@teable/core';

/**
 * Normalize a raw cell value against the field used for display.
 *
 * After singleSelect ↔ multipleSelect (and similar) converts, record docs may
 * still hold the previous shape while the display field instance already has
 * the new type. Strict validate alone would blank the cell even though the
 * value is still present (copy/paste works; refresh reloads the matching shape).
 *
 * Prefer validate → repair → keep repaired/raw over returning undefined.
 */
export function normalizeCellValueForDisplay(field: FieldCore, cellValue: unknown): unknown {
  if (cellValue == null) {
    return cellValue;
  }

  const validated = field.validateCellValue(cellValue);
  if (validated?.success) {
    return validated.data;
  }

  try {
    const repaired = field.repair(cellValue);
    const repairedValidated = field.validateCellValue(repaired);
    return repairedValidated?.success ? repairedValidated.data : repaired;
  } catch {
    return cellValue;
  }
}
