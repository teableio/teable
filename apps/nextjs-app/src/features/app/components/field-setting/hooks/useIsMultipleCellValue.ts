import type { ILookupOptionsRo } from '@teable-group/core';
import { isMultiValueLink } from '@teable-group/core';
import { useFields } from '@teable-group/sdk/hooks';
import type { IFieldInstance, LinkField } from '@teable-group/sdk/model';
import { useMemo } from 'react';

export const useIsMultipleCellValue = (
  isLookup: boolean | undefined,
  lookupField: IFieldInstance | undefined,
  lookupOptions: ILookupOptionsRo | undefined
) => {
  const fields = useFields();

  return useMemo(() => {
    if (isLookup && lookupField?.isMultipleCellValue) return true;
    const { linkFieldId } = lookupOptions || {};
    if (linkFieldId == null) return false;

    const linkField = fields.find((f) => f.id === linkFieldId) as LinkField;

    if (linkField == null) return false;

    const relationship = linkField.options.relationship;

    return Boolean(isMultiValueLink(relationship));
  }, [fields, isLookup, lookupField?.isMultipleCellValue, lookupOptions]);
};
