import type { IRecord } from '@teable-group/core';
import { ExpandRecorder, useExpandRecord } from '@teable-group/sdk';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export const ExpandRecordContainer = (props: { recordServerData: IRecord }) => {
  const { recordServerData } = props;
  const router = useRouter();
  const { nodeId, viewId, recordId } = router.query;
  const { addExpandRecord, removeExpandRecord } = useExpandRecord();

  useEffect(() => {
    const onClose = () => {
      router.push(
        {
          pathname: '/space/[nodeId]/[viewId]',
          query: { nodeId, viewId },
        },
        undefined,
        {
          shallow: Boolean(viewId),
        }
      );
    };
    recordId &&
      addExpandRecord({
        recordId: recordId as string,
        tableId: nodeId as string,
        serverData: recordServerData,
        onClose: onClose,
      });
    return () => {
      removeExpandRecord(nodeId as string, recordId as string);
    };
  }, [nodeId, recordId, router, viewId, recordServerData, addExpandRecord, removeExpandRecord]);

  return <ExpandRecorder />;
};
