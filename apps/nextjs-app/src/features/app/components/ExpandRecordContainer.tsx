import { ExpandRecord, IExpandRecordModel } from '@teable-group/sdk';
import { useRouter } from 'next/router';

export const ExpandRecordContainer = () => {
  const router = useRouter();
  const { nodeId, viewId, recordId } = router.query;
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

  if (!recordId) return <></>;

  return (
    <ExpandRecord
      forceModel={IExpandRecordModel.Modal}
      recordId={recordId as string}
      visible={Boolean(recordId)}
      onClose={onClose}
    />
  );
};
