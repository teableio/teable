import { AppContext } from '../app/AppContext';
import { IFieldSnapshot, IFieldVo } from '@teable-group/core';
import { FC, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { FieldContext } from './FieldContext';
import { createFieldInstance, IFieldInstance } from '../../model';
import { TableContext } from '../table/TableContext';

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
    if (!tableId) {
      return;
    }
    const fieldsQuery = connection.createSubscribeQuery<IFieldSnapshot>(tableId, {
      type: 'field',
      // fieldDocs,
    });

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

  if (fallback && !fields.length) {
    return <>{fallback}</>;
  }

  const value = useMemo(() => {
    return { fields };
  }, [fields]);

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
};
