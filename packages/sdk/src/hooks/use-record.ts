import { IdPrefix } from '@teable-group/core';
import { keyBy } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import type { Record } from '../model/record';
import { recordInstanceFieldMap, createRecordInstance } from '../model/record';
import { useConnection } from './use-connection';
import { useFields } from './use-fields';
import { useTableId } from './use-table-id';

export const useRecord = (recordId: string | undefined) => {
  const { connection } = useConnection();
  const tableId = useTableId();

  const fields = useFields();

  const [instance, setInstance] = useState<Record>();

  useEffect(() => {
    if (!recordId) {
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

    doc.on('op', listeners);

    return () => {
      doc.destroy();
      doc.removeListener('op', listeners);
    };
  }, [connection, recordId, tableId]);

  return useMemo(() => {
    if (!instance) {
      return undefined;
    }
    const fieldMap = keyBy(fields, 'id');
    return recordInstanceFieldMap(instance, fieldMap);
  }, [fields, instance]);
};
