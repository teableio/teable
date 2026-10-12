import type { IRecord } from '@teable/core';
import { FieldKeyType, IdPrefix } from '@teable/core';
import { getRecords, getShareViewRecords } from '@teable/openapi';
import { isEmpty, keyBy } from 'lodash';
import { useContext, useEffect, useMemo, useState } from 'react';
import type { Doc } from 'sharedb/lib/client';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { recordInstanceFieldMap, createRecordInstance } from '../model/record';
import { useConnection } from './use-connection';
import { useFields } from './use-fields';
import { useTableId } from './use-table-id';

export const useRecord = (
  recordId: string | undefined,
  initData?: IRecord,
  // Detail surfaces hydrate independently of the grid's sparse ShareDB projection.
  // withHidden also includes view-hidden fields in the instance's field map.
  // HTTP values and permissions stay local to this hook; live document entries win.
  options?: { withHidden?: boolean; hydrate?: boolean }
) => {
  const withHidden = options?.withHidden ?? false;
  const hydrate = Boolean(options?.hydrate || withHidden);
  const { connection, connected } = useConnection();
  const tableId = useTableId();
  const { shareId, tableId: shareTableId } = useContext(ShareViewContext);
  const fields = useFields({ withHidden });

  const [source, setSource] = useState<{ data: IRecord; doc?: Doc<IRecord> } | undefined>(() => {
    return initData && !connected ? { data: initData } : undefined;
  });
  const [hydratedRecord, setHydratedRecord] = useState<IRecord | undefined>();

  useEffect(() => {
    if (!connection || !recordId) {
      return undefined;
    }
    const doc: Doc<IRecord> = connection.get(`${IdPrefix.Record}_${tableId}`, recordId);

    doc.fetch((err) => {
      if (err) {
        console.error('Failed to fetch document:', err);
        return;
      }
      setSource({ data: doc.data, doc });
    });

    const listeners = () => {
      setSource({ data: doc.data, doc });
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

  useEffect(() => {
    setHydratedRecord(undefined);
    if (!hydrate || !recordId || !tableId) {
      return undefined;
    }
    let canceled = false;
    // In a share context the only hydration source is the share's own
    // /view/records endpoint, which is bound to the share's table. A linked
    // record expanded from another table (StandaloneViewProvider switches the
    // anchor table but keeps the outer ShareViewContext) can't be fetched
    // through it, and the authed record endpoint is off-limits to anonymous
    // visitors — skip hydration instead of firing a request that can't match
    if (shareId && tableId !== shareTableId) {
      return undefined;
    }
    // No projection: fetch all readable fields, including their per-record permissions.
    // The authenticated list endpoint supplies permissions; the single-record endpoint
    // does not. The share endpoint always bounds the result to the share's allowed set.
    const request = shareId
      ? getShareViewRecords(shareId, {
          fieldKeyType: FieldKeyType.Id,
          selectedRecordIds: [recordId],
          take: 1,
        }).then((res) => res.data.records[0])
      : getRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          selectedRecordIds: [recordId],
          take: 1,
          ignoreViewQuery: true,
        }).then((res) => res.data.records[0]);
    request
      .then((hydrated) => !canceled && setHydratedRecord(hydrated))
      .catch((error) => console.error('Failed to hydrate record fields:', error));
    return () => {
      canceled = true;
    };
  }, [hydrate, recordId, tableId, shareId, shareTableId]);

  return useMemo(() => {
    if (!source || !fields.length || recordId == null || source.data.id !== recordId) {
      return undefined;
    }
    const { data, doc } = source;
    // live document values win, including explicit nulls; hydrated values only
    // fill fields the projected document never carried. This relies on cell
    // clears arriving as explicit nulls (SetRecordBuilder and the v2 realtime
    // projection both emit oi-carrying set ops, never a key delete), otherwise
    // a remote clear would resurface the stale hydrated value
    const hydrated = hydratedRecord?.id === recordId ? hydratedRecord : undefined;
    const record = hydrated
      ? {
          ...data,
          fields: { ...hydrated.fields, ...data.fields },
          permissions: isEmpty(data.permissions)
            ? hydrated.permissions
            : {
                read: { ...hydrated.permissions?.read, ...data.permissions?.read },
                update: { ...hydrated.permissions?.update, ...data.permissions?.update },
              },
        }
      : data;
    return recordInstanceFieldMap(createRecordInstance(record, doc), keyBy(fields, 'id'));
  }, [fields, source, hydratedRecord, recordId]);
};
