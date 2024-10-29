import type { IRecord } from '@teable/core';
import { IdPrefix } from '@teable/core';
import { keyBy } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import type { Record } from '../model/record';
import { recordInstanceFieldMap, createRecordInstance } from '../model/record';
import { useConnection } from './use-connection';
import { useFields } from './use-fields';
import { useTableId } from './use-table-id';

export const useRecord = (recordId: string | undefined, initData?: IRecord) => {
  const { connection, connected } = useConnection();
  const tableId = useTableId();

  const fields = useFields();

  const [instance, setInstance] = useState<Record | undefined>(() => {
    return initData && !connected ? createRecordInstance(initData) : undefined;
  });

  useEffect(() => {
    if (!connection || !recordId) {
      return undefined;
    }
    const doc = connection.get(`${IdPrefix.Record}_${tableId}`, recordId);

    doc.fetch((err) => {
      if (err) {
        console.error('Failed to fetch document:', err);
        return;
      }
      setInstance(createRecordInstance(doc.data, doc));
    });

    const listeners = () => {
      setInstance(createRecordInstance(doc.data, doc));
    };

    doc.subscribe(() => {
      doc.on('op batch', listeners);
    });

    return () => {
      doc.removeListener('op batch', listeners);
      doc.listenerCount('op batch') === 0 && doc.unsubscribe();
      doc.listenerCount('op batch') === 0 && doc.destroy();
    };
  }, [connection, recordId, tableId]);

  return useMemo(() => {
    if (!instance || !fields.length || recordId == null) {
      return undefined;
    }
    const fieldMap = keyBy(fields, 'id');
    return recordInstanceFieldMap(instance, fieldMap);
  }, [fields, instance, recordId]);
};
