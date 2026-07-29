import type { IFieldVo } from '@teable/core';
import { IdPrefix } from '@teable/core';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';
import type { Doc } from 'sharedb/lib/client';
import { createFieldInstance } from '../../model';
import { AnchorContext } from '../anchor/AnchorContext';
import { useInstances } from '../use-instances';
import { FieldContext } from './FieldContext';

interface IFieldProviderProps {
  children: ReactNode;
  serverSideData?: IFieldVo[];
  fallback?: React.ReactNode;
}

const emptyParams = {};
export const FieldProvider: FC<IFieldProviderProps> = ({ children, fallback, serverSideData }) => {
  const { tableId } = useContext(AnchorContext);

  const factory = useCallback(
    (field: IFieldVo, doc?: Doc<IFieldVo>) => {
      const instance = createFieldInstance(field, doc);
      if (!doc && tableId) {
        // doc-less (seeded) instance: the factory derives tableId from the
        // doc collection, so inject it here to keep field mutations working
        instance.tableId = tableId;
      }
      return instance;
    },
    [tableId]
  );

  const { instances: fields } = useInstances({
    collection: `${IdPrefix.Field}_${tableId}`,
    factory,
    initData: serverSideData,
    queryParams: emptyParams,
  });

  const value = useMemo(() => {
    return { fields };
  }, [fields]);

  if (fallback && !fields.length) {
    return <>{fallback}</>;
  }

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
};
