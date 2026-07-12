import { FieldType } from '@teable/core';
import type { IFieldInstance } from '../field/model/factory';

type LinkPasteItem = { id: string; title?: string };

/**
 * Convert a copied cell into a paste value for a link field.
 *
 * Sync copy serializes structured link values (`{ id, title }`) into the HTML
 * clipboard. Stripping titles down to ids causes realtime update events to push
 * unresolved links, so the grid shows "Untitled" until a full refresh.
 */
export const convertLinkPasteCellValue = (
  targetField: Pick<IFieldInstance, 'isMultipleCellValue'>,
  sourceField: Pick<IFieldInstance, 'type' | 'cellValue2String'>,
  cellValue: unknown
): unknown => {
  if (cellValue == null) {
    return null;
  }

  if (sourceField.type !== FieldType.Link) {
    return sourceField.cellValue2String(cellValue);
  }

  const items = [cellValue]
    .flat()
    .map((value): string | LinkPasteItem | null => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
      }

      if (value && typeof value === 'object' && 'id' in value) {
        const id = String((value as { id?: unknown }).id ?? '').trim();
        if (!id) {
          return null;
        }
        const title = (value as { title?: unknown }).title;
        return typeof title === 'string' ? { id, title } : { id };
      }

      return null;
    })
    .filter((value): value is string | LinkPasteItem => value != null);

  if (items.length === 0) {
    return null;
  }

  const allStructured = items.every((item) => typeof item === 'object');
  if (allStructured) {
    return targetField.isMultipleCellValue ? items : items[0] ?? null;
  }

  // Plain-text / title tokens remain comma-joined for typecast resolution.
  return items.map((item) => (typeof item === 'string' ? item : item.id)).join(',');
};
