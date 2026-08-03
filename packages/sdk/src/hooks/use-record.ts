import type { IRecord } from '@teable/core';
import { FieldKeyType, IdPrefix } from '@teable/core';
import { getRecord, getShareViewRecords } from '@teable/openapi';
import { keyBy } from 'lodash';
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
  // withHidden also exposes fields hidden in the current view: the ShareDB
  // document is projected to visible fields, so hidden values are hydrated
  // once over HTTP and merged for display without widening the shared
  // document. Enable it only when the view actually hides fields — every
  // recordId change refetches
  options?: { withHidden?: boolean }
) => {
  const withHidden = options?.withHidden ?? false;
  const { connection, connected } = useConnection();
  const tableId = useTableId();
  const { shareId, tableId: shareTableId } = useContext(ShareViewContext);
  const fields = useFields({ withHidden });

  const [source, setSource] = useState<{ data: IRecord; doc?: Doc<IRecord> } | undefined>(() => {
    return initData && !connected ? { data: initData } : undefined;
  });
  const [hydratedFields, setHydratedFields] = useState<IRecord['fields'] | undefined>();

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
    setHydratedFields(undefined);
    if (!withHidden || !recordId || !tableId) {
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
    // no projection: the record endpoint returns every readable field and the
    // share endpoint bounds the result to the share's allowed set. fieldKeyType
    // must be id (the REST default is name) so the merge keys line up
    const request = shareId
      ? getShareViewRecords(shareId, {
          fieldKeyType: FieldKeyType.Id,
          selectedRecordIds: [recordId],
          take: 1,
        }).then((res) => res.data.records[0]?.fields)
      : getRecord(tableId, recordId, { fieldKeyType: FieldKeyType.Id }).then(
          (res) => res.data.fields
        );
    request
      .then((hydrated) => !canceled && setHydratedFields(hydrated))
      .catch((error) => console.error('Failed to hydrate hidden fields:', error));
    return () => {
      canceled = true;
    };
  }, [withHidden, recordId, tableId, shareId, shareTableId]);

  return useMemo(() => {
    if (!source || !fields.length || recordId == null) {
      return undefined;
    }
    const { data, doc } = source;
    // live document values win, including explicit nulls; hydrated values only
    // fill fields the projected document never carried. This relies on cell
    // clears arriving as explicit nulls (SetRecordBuilder and the v2 realtime
    // projection both emit oi-carrying set ops, never a key delete), otherwise
    // a remote clear would resurface the stale hydrated value
    const record = hydratedFields
      ? { ...data, fields: { ...hydratedFields, ...data.fields } }
      : data;
    return recordInstanceFieldMap(createRecordInstance(record, doc), keyBy(fields, 'id'));
  }, [fields, source, hydratedFields, recordId]);
};
