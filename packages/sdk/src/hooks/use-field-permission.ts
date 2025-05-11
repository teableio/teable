import { useContext } from 'react';
import { TablePermissionContext } from '../context/table-permission';

export type IUseFieldPermissionAction = keyof ReturnType<typeof useFieldPermission>;

export const useFieldPermission = () => {
  const { field } = useContext(TablePermissionContext) ?? {};
  return field;
};
