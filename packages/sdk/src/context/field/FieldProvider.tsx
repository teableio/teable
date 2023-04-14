import type { IFieldSnapshot, IFieldVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useMemo, useState } from 'react';
import type { IFieldInstance } from '../../model';
import { createFieldInstance } from '../../model';
import { AppContext } from '../app/AppContext';
import { TableContext } from '../table/TableContext';
import { FieldContext } from './FieldContext';

interface IFieldProviderProps {
  fallback: React.ReactNode;
  children: ReactNode;
  serverSideData?: IFieldVo[];
}

export const FieldProvider: FC<IFieldProviderProps> = ({ children, fallback, serverSideData }) => {
  const { connection } = useContext(AppContext);
  const { tableId } = useContext(TableContext);

  const [fields, setFields] = useState<IFieldInstance[]>(() => {
    if (serverSideData) {
      return serverSideData.map((field) => createFieldInstance(field));
    }
    return [];
  });

  // const [fieldDocs, setFieldDocs] = useState<Doc<IFieldSnapshot>[]>([]);

  useEffect(() => {
    if (!tableId || !connection) {
      return;
    }
    const fieldsQuery = connection.createSubscribeQuery<IFieldSnapshot>(
      `${IdPrefix.Field}_${tableId}`,
      {}
    );

    fieldsQuery.on('ready', () => {
      console.log('fields:ready:', fieldsQuery.results);
      // setFieldDocs(fieldsQuery.results);
      setFields(fieldsQuery.results.map((r) => createFieldInstance(r.data.field, r)));
    });

    fieldsQuery.on('changed', () => {
      console.log('fields:changed:', fieldsQuery.results);
      // setFieldDocs(fieldsQuery.results);
      setFields(fieldsQuery.results.map((r) => createFieldInstance(r.data.field, r)));
    });

    return () => {
      fieldsQuery.removeAllListeners('ready');
      fieldsQuery.removeAllListeners('changed');
      fieldsQuery.destroy();
    };
  }, [connection, tableId]);

  const value = useMemo(() => {
    return { fields, setFields };
  }, [fields]);

  if (fallback && !fields) {
    return <>{fallback}</>;
  }

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
};
