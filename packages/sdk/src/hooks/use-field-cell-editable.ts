import { map } from 'lodash';
import { useCallback } from 'react';
import type { IFieldInstance } from '../model';
import { useTablePermission } from './use-table-permission';
import { useTables } from './use-tables';

export const useFieldCellEditable = () => {
  const tables = useTables();
  const tableIds = map(tables, 'id');
  const permission = useTablePermission();
  const defaultEditable = !!permission['record|update'];

  return useCallback(
    (_field: IFieldInstance) => {
      if (!defaultEditable) {
        return false;
      }
      // if (field.lookupOptions) {
      //   return tableIds.includes(field.lookupOptions.foreignTableId);
      // }
      // if (field.type === FieldType.Link) {
      //   return tableIds.includes(field.options.foreignTableId);
      // }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(tableIds), defaultEditable]
  );
};
