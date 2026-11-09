import { FieldType } from '@teable/core';

interface CopyField {
  id: string;
  type: string;
  isLookup?: boolean | null;
}

/** Rich values are a projection of cells already admitted by the source read.
 * Never look up an identity or forward arbitrary stored properties for copy.
 */
export const buildRawCopyContent = (
  records: ReadonlyArray<{ fields: Record<string, unknown> }>,
  fields: ReadonlyArray<CopyField>,
  formattedRows: ReadonlyArray<ReadonlyArray<string>>
): unknown[][] | undefined => {
  const userColumns = new Map(
    fields.flatMap((field, index) =>
      field.type === FieldType.User && !field.isLookup ? [[index, field.id] as const] : []
    )
  );
  if (!userColumns.size) return undefined;

  return formattedRows.map((row, rowIndex) =>
    row.map((text, columnIndex) => {
      const fieldId = userColumns.get(columnIndex);
      if (!fieldId) return text;
      const value = records[rowIndex]?.fields[fieldId];
      const projectUser = (item: unknown): unknown => {
        if (item == null) return null;
        if (typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('Invalid user cell in copy source');
        }
        const user = item as { id?: unknown; title?: unknown; email?: unknown };
        if (typeof user.id !== 'string' || !user.id) {
          throw new Error('Invalid user cell in copy source');
        }
        return {
          id: user.id,
          ...(typeof user.title === 'string' ? { title: user.title } : {}),
          ...(typeof user.email === 'string' ? { email: user.email } : {}),
        };
      };
      return Array.isArray(value) ? value.map(projectUser) : projectUser(value);
    })
  );
};
