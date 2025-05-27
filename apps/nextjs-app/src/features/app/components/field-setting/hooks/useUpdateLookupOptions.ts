import type { ILookupOptionsRo } from '@teable/core';
import { safeParseOptions } from '@teable/core';
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
      if (!field.isLookup) {
        setFieldFn({
          ...field,
          lookupOptions: newLookupOptions,
        });
        return;
      }

      const optionsResult =
        lookupField?.type && safeParseOptions(lookupField.type, lookupField.options);
      const options = optionsResult?.success ? optionsResult.data : field.options;
      const newField: IFieldEditorRo = lookupField
        ? {
            ...field,
            options,
            lookupOptions: newLookupOptions,
            type: field.isLookup ? lookupField.type : field.type,
            cellValueType: lookupField.cellValueType,
            isMultipleCellValue: linkField?.isMultipleCellValue || lookupField.isMultipleCellValue,
          }
        : {
            ...field,
            options,
            lookupOptions: newLookupOptions,
          };

      setFieldFn(newField);
    },
    [field, setFieldFn]
  );
}
