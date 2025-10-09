import type { IConditionalLookupOptions } from '@teable/core';
import { isConditionalLookupOptions, safeParseOptions } from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';
import { useCallback } from 'react';
import type { IFieldEditorRo } from '../type';

export function useUpdateConditionalLookupOptions(
  field: IFieldEditorRo,
  setFieldFn: (field: IFieldEditorRo) => void
) {
  return useCallback(
    (partial: Partial<IConditionalLookupOptions>, lookupField?: IFieldInstance) => {
      const existing = isConditionalLookupOptions(field.lookupOptions)
        ? field.lookupOptions
        : undefined;

      const nextLookupOptions: IConditionalLookupOptions = {
        ...existing,
        ...(partial || {}),
      } as IConditionalLookupOptions;

      const nextField: IFieldEditorRo = {
        ...field,
        lookupOptions: nextLookupOptions,
        isMultipleCellValue: lookupField?.isMultipleCellValue ?? field.isMultipleCellValue,
      };

      if (lookupField) {
        nextField.type = lookupField.type;
        nextField.cellValueType = lookupField.cellValueType;

        const optionsResult = safeParseOptions(lookupField.type, lookupField.options);
        if (optionsResult.success) {
          nextField.options = optionsResult.data;
        }
      }

      setFieldFn(nextField);
    },
    [field, setFieldFn]
  );
}
