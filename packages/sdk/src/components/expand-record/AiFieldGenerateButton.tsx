import { useMutation } from '@tanstack/react-query';
import { RefreshCcw } from '@teable/icons';
import { autoFillCell } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib';
import { useCallback, useContext, useState } from 'react';
import { TaskStatusCollectionContext } from '../../context';
import { useTableListener } from '../../hooks';

export const AiFieldGenerateButton = (props: {
  tableId: string;
  recordId: string;
  fieldId: string;
}) => {
  const { tableId, recordId, fieldId } = props;
  const taskStatusCollection = useContext(TaskStatusCollectionContext);
  const [pendingCell, setPendingCell] = useState<{
    recordId: string;
    fieldId: string;
  } | null>(null);

  const { mutate: mutateGenerate } = useMutation({
    mutationFn: ({ recordId, fieldId }: { recordId: string; fieldId: string }) =>
      autoFillCell(tableId!, recordId, fieldId),
    onError: () => {
      setPendingCell(null);
    },
  });

  const handleTaskEvent = useCallback(() => {
    if (!pendingCell) return;
    setPendingCell(null);
  }, [pendingCell]);

  useTableListener(
    tableId,
    ['taskProcessing', 'taskCompleted', 'taskCancelled', 'taskFailed'],
    handleTaskEvent
  );

  const isCellInTaskQueue =
    taskStatusCollection?.cells?.some((c) => c.recordId === recordId && c.fieldId === fieldId) ??
    false;
  const isLocalPending = pendingCell?.recordId === recordId && pendingCell?.fieldId === fieldId;
  const isPending = isLocalPending || isCellInTaskQueue;

  const onGenerate = () => {
    if (isPending) return;
    setPendingCell({ recordId, fieldId });
    mutateGenerate({ recordId, fieldId });
  };

  return (
    <Button
      className="mt-0.5 shrink-0"
      variant="outline"
      size="xs"
      onClick={onGenerate}
      disabled={!!isPending}
    >
      <RefreshCcw className={cn('size-3.5', isPending && 'animate-spin')} />
    </Button>
  );
};
