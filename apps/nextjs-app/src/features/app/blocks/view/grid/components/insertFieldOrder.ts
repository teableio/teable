import { insertSingle } from '@teable/sdk/utils';

// deliberately looser than IGridColumnMeta: the schema types every entry as
// present, which is exactly the assumption that breaks below
interface IOrderedColumnMeta {
  [fieldId: string]: { order: number } | undefined;
}

/**
 * Order for a field inserted before/after `fieldId`.
 *
 * The field list and the view doc are two independently synced pieces of
 * state: a just-created field shows up in the field list before the view op
 * carrying its `columnMeta` entry lands. `useFields` tolerates that by sorting
 * such fields to the tail (`order ?? Infinity`), so they reach here with no
 * position to compute against — and `insertSingle` reads the *neighbours* of
 * the clicked field, which is how a field the user never touched could blow up
 * the insert.
 *
 * Narrowing to the fields that actually carry an order keeps every lookup
 * inside `insertSingle` defined. Returns undefined when the clicked field is
 * not one of them, so the caller skips the insert rather than writing NaN.
 */
export const getInsertFieldOrder = (
  fields: { id: string }[],
  columnMeta: IOrderedColumnMeta,
  fieldId: string,
  isInsertAfter: boolean
): number | undefined => {
  const ordered = fields
    .map((field) => ({ id: field.id, order: columnMeta[field.id]?.order }))
    .filter((field): field is { id: string; order: number } => field.order != null);
  const index = ordered.findIndex((field) => field.id === fieldId);

  if (index === -1) return;

  return insertSingle(
    index,
    ordered.length,
    (index: number) => ordered[index].order,
    isInsertAfter
  );
};
