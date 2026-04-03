import { safeParseOptions } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import type { IFieldEditorRo } from '../type';

type LookupHydrationInput = {
  field: IFieldEditorRo;
  lookupField: Pick<IFieldVo, 'type' | 'cellValueType' | 'options' | 'isMultipleCellValue'>;
  linkField?: Pick<IFieldVo, 'isMultipleCellValue'>;
};

export const hydrateLookupFieldState = ({
  field,
  lookupField,
  linkField,
}: LookupHydrationInput): IFieldEditorRo | undefined => {
  if (!field.isLookup || field.isConditionalLookup) {
    return;
  }

  const nextIsMultipleCellValue =
    linkField?.isMultipleCellValue || lookupField.isMultipleCellValue || false;
  const needsHydration =
    field.type !== lookupField.type ||
    field.cellValueType !== lookupField.cellValueType ||
    field.isMultipleCellValue !== nextIsMultipleCellValue;

  if (!needsHydration) {
    return;
  }

  const optionsResult = safeParseOptions(lookupField.type, lookupField.options);

  return {
    ...field,
    type: lookupField.type,
    cellValueType: lookupField.cellValueType,
    isMultipleCellValue: nextIsMultipleCellValue,
    options:
      field.options ??
      (optionsResult.success ? (optionsResult.data as IFieldVo['options']) : undefined),
  };
};
