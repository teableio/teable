import { useMutation } from '@tanstack/react-query';
import { RefreshCcw } from '@teable/icons';
import { autoFillCell } from '@teable/openapi';
import { Button, cn, sonner } from '@teable/ui-lib';
import { useCallback, useEffect, useState } from 'react';
import { useTableListener } from '../../hooks';

const { toast } = sonner;

export const AiFieldGenerateButton = (props: {
  tableId: string;
  recordId: string;
  fieldId: string;
  isInTaskQueue: boolean;
}) => {
  const { tableId, recordId, fieldId, isInTaskQueue } = props;
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

  const handleTaskFailed = useCallback(
    (_actionKey: string, payload?: { recordId: string; fieldId: string; errorMsg: string }) => {
      if (!payload) return;
      if (payload.recordId === recordId && payload.fieldId === fieldId) {
        setPendingCell(null);
        toast.error(payload.errorMsg);
      }
    },
    [recordId, fieldId, setPendingCell]
  );

  useTableListener(tableId, ['taskFailed'], handleTaskFailed);

  useEffect(() => {
    if (isInTaskQueue) {
      setPendingCell(null);
    }
  }, [setPendingCell, isInTaskQueue]);
  const isPending = Boolean(pendingCell) || isInTaskQueue;

  const onGenerate = () => {
    if (isPending) return;
    setPendingCell({ recordId, fieldId });
    mutateGenerate({ recordId, fieldId });
  };

  return (
    <Button
      variant="outline"
      size="icon-xs"
      onClick={onGenerate}
      disabled={!!isPending}
      aria-label="Generate by AI"
    >
      <RefreshCcw className={cn('size-3.5 shrink-0', isPending && 'animate-spin')} />
    </Button>
  );
};
