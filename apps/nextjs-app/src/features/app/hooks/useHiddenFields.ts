import { useFields } from '@teable/sdk/hooks';
import { useMemo } from 'react';

export const useHiddenFields = () => {
  const allFields = useFields({ withHidden: true, withDenied: true });
  const showFields = useFields();

  const showFieldsId = useMemo(() => new Set(showFields.map((field) => field.id)), [showFields]);

  return useMemo(
    () => allFields.filter((field) => !showFieldsId.has(field.id)),
    [allFields, showFieldsId]
  );
};
