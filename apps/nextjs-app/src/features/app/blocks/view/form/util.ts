import type { IFieldInstance } from '@teable/sdk/model';

export const generateUniqLocalKey = (tableId?: string, viewId?: string) => `${tableId}-${viewId}`;

/**
 * A not-null field is protected in a form view when a record cannot take a
 * value without user input: it carries no default the backends can fill.
 * `false` (checkbox) resolves to a null cell and `''` is not a value, while `0`
 * is a real default both engines write into the record.
 */
export const isProtectedField = (field: IFieldInstance) => {
  const { options, notNull } = field;
  if (!notNull) return false;

  const defaultValue =
    options && typeof options === 'object' && 'defaultValue' in options
      ? options.defaultValue
      : undefined;

  return (
    defaultValue === undefined ||
    defaultValue === null ||
    defaultValue === '' ||
    defaultValue === false
  );
};
