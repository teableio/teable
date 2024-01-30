import type { ILookupOptionsRo } from '@teable/core';
import type { LinkField, IFieldInstance } from '@teable/sdk/model';
import { useCallback } from 'react';
import type { IFieldEditorRo } from '../type';

export function useUpdateLookupOptions(
  field: IFieldEditorRo,
  setFieldFn: (field: IFieldEditorRo) => void
) {
  return useCallback(
    (
      lookupOptions: Partial<ILookupOptionsRo>,
      linkField?: LinkField,
      lookupField?: IFieldInstance
    ) => {
      const newLookupOptions = {
        ...field.lookupOptions,
        ...(lookupOptions || {}),
      } as ILookupOptionsRo;

      const newField: IFieldEditorRo = lookupField
        ? {
            ...field,
            lookupOptions: newLookupOptions,
            type: field.isLookup ? lookupField.type : field.type,
            cellValueType: lookupField.cellValueType,
            isMultipleCellValue: linkField?.isMultipleCellValue || lookupField.isMultipleCellValue,
          }
        : {
            ...field,
            lookupOptions: newLookupOptions,
          };

      setFieldFn(newField);
    },
    [field, setFieldFn]
  );
}
