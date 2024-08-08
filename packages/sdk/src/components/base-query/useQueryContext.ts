import { getFields, BaseQueryColumnType } from '@teable/openapi';
import type { IBaseQueryColumn } from '@teable/openapi';
import { useState, useEffect } from 'react';

export const useQueryContext = (tableIds: string[]) => {
  const [context, setContext] = useState<IBaseQueryColumn[]>([]);

  useEffect(() => {
    const fetchContext = async () => {
      const fields = await Promise.all(
        tableIds.map((tableId) =>
          getFields(tableId).then((res) => res.data.map((v) => ({ ...v, tableId })))
        )
      );
      setContext(
        fields.flat().map(
          (field) =>
            ({
              column: field.id,
              type: BaseQueryColumnType.Field,
              name: field.name,
              fieldSource: field,
              tableId: field.tableId,
            }) as IBaseQueryColumn & { tableId: string }
        )
      );
    };

    fetchContext();
  }, [tableIds]);

  return context;
};
