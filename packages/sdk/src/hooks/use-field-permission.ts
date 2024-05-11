import { useContext, useMemo } from 'react';
import { TablePermissionContext } from '../context/table-permission';

export type IUseFieldPermissionAction = keyof ReturnType<typeof useFieldPermission>;

export const useFieldPermission = (fieldId: string | undefined) => {
  const { field } = useContext(TablePermissionContext) ?? {};
  return useMemo(() => {
    if (!fieldId || !field?.fields) return {};
    return field.fields[fieldId] || {};
  }, [field, fieldId]);
};
