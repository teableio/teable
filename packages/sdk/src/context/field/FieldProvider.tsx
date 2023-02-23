import { AppContext } from '../app/AppContext';
import { IFieldSnapshot } from '@teable-group/core';
import { FC, ReactNode, useContext, useEffect, useState } from 'react';
import { FieldContext } from './FieldContext';
import { createFieldInstance, IFieldInstance } from '../../model';
import { TableContext } from '../table/TableContext';
import { Doc } from 'sharedb/lib/client';

interface IFieldProviderProps {
  fallback: React.ReactNode;
  children: ReactNode;
}

export const FieldProvider: FC<IFieldProviderProps> = ({ children, fallback }) => {
  const { connection } = useContext(AppContext);
  const { tableId } = useContext(TableContext);
  const [fields, setFields] = useState<IFieldInstance[]>([]);
  const [fieldDocs, setFieldDocs] = useState<Doc<IFieldSnapshot>[]>([]);

  useEffect(() => {
    if (!tableId) {
      return;
    }
    const fieldsQuery = connection.createSubscribeQuery<IFieldSnapshot>(tableId, {
      type: 'field',
      fieldDocs,
    });

    fieldsQuery.on('ready', () => {
      console.log('fields:ready:', fieldsQuery.results);
      setFieldDocs(fieldsQuery.results);
      setFields(fieldsQuery.results.map((r) => createFieldInstance(r, r.data.field)));
    });

    fieldsQuery.on('changed', () => {
      console.log('fields:changed:', fieldsQuery.results);
      setFieldDocs(fieldsQuery.results);
      setFields(fieldsQuery.results.map((r) => createFieldInstance(r, r.data.field)));
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

  return (
    <FieldContext.Provider
      value={{
        fields,
      }}
    >
      {children}
    </FieldContext.Provider>
  );
};
