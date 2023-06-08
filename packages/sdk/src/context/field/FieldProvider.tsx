import type { IFieldVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { FC, ReactNode } from 'react';
import { useContext, useMemo } from 'react';
import { createFieldInstance } from '../../model';
import { AnchorContext } from '../anchor';
import { useInstances } from '../use-instances';
import { FieldContext } from './FieldContext';

interface IFieldProviderProps {
  fallback: React.ReactNode;
  children: ReactNode;
  serverSideData?: IFieldVo[];
}

export const FieldProvider: FC<IFieldProviderProps> = ({ children, fallback, serverSideData }) => {
  const { tableId } = useContext(AnchorContext);

  const fields = useInstances({
    collection: `${IdPrefix.Field}_${tableId}`,
    factory: createFieldInstance,
    initData: serverSideData ? serverSideData.map((d) => ({ field: d })) : undefined,
    queryParams: {},
  });

  const value = useMemo(() => {
    return { fields };
  }, [fields]);

  if (fallback && !fields.length) {
    return <>{fallback}</>;
  }

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
};
