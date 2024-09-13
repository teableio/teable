import type { IFieldVo } from '@teable/core';
import { IdPrefix } from '@teable/core';
import type { FC, ReactNode } from 'react';
import { useContext, useMemo } from 'react';
import { createFieldInstance } from '../../model';
import { AnchorContext } from '../anchor/AnchorContext';
import { useInstances } from '../use-instances';
import { FieldContext } from './FieldContext';

interface IFieldProviderProps {
  children: ReactNode;
  serverSideData?: IFieldVo[];
  fallback?: React.ReactNode;
}

export const FieldProvider: FC<IFieldProviderProps> = ({ children, fallback, serverSideData }) => {
  const { viewId, tableId } = useContext(AnchorContext);

  const { instances: fields } = useInstances({
    collection: `${IdPrefix.Field}_${tableId}`,
    factory: createFieldInstance,
    initData: serverSideData,
    queryParams: { viewId },
  });

  const value = useMemo(() => {
    return { fields };
  }, [fields]);

  if (fallback && !fields.length) {
    return <>{fallback}</>;
  }

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
};
