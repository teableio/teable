import { useMutation } from '@tanstack/react-query';
import { Undo2, Redo2 } from '@teable/icons';
import { undo, McpToolInvocationName, redo } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import { Button, useToast } from '@teable/ui-lib/shadcn';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatControlStore } from '../store/useChatControl';

export const AiSuggestionControl = () => {
  const { t } = useTranslation(['table', 'sdk']);
  const [undoAccessible, setUndoAccessible] = useState(true);
  const { toast } = useToast();
  const [undoLoading, setUndoLoading] = useState(false);
  const [redoLoading, setRedoLoading] = useState(false);
  const timerRef = useRef<NodeJS.Timeout>();

  const { mutate: undoFn } = useMutation({
    mutationFn: ({ tableId }: { tableId: string }) => undo(tableId),
  });

  const { mutate: redoFn } = useMutation({
    mutationFn: ({ tableId }: { tableId: string }) => redo(tableId),
  });

  const { toolCallInfo, setToolCallInfo } = useChatControlStore();

  const { tableId, toolName } = toolCallInfo;

  const refreshTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setToolCallInfo(null, null);
    }, 5000);
  }, [setToolCallInfo]);

  const revokeHandle = async () => {
    toast({
      title: t('sdk:undoRedo.undoing'),
    });
    setUndoLoading(true);
    if (tableId) {
      await undoFn({ tableId });
      refreshTimer();
    }
    setUndoLoading(false);
    toast({
      title: t('sdk:undoRedo.undoSucceed'),
    });
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const redoHandle = async () => {
    toast({
      title: t('sdk:undoRedo.redoing'),
    });
    setRedoLoading(true);
    if (tableId) {
      await redoFn({ tableId });
      refreshTimer();
    }
    setRedoLoading(false);
    toast({
      title: t('sdk:undoRedo.redoSucceed'),
    });
  };

  const shouldControl = useMemo(() => {
    const notAllowUndoRedoActions = [
      McpToolInvocationName.CreateTable,
      McpToolInvocationName.DeleteTable,
    ];
    return tableId && !notAllowUndoRedoActions.includes(toolName as McpToolInvocationName);
  }, [tableId, toolName]);

  useEffect(() => {
    if (shouldControl) {
      refreshTimer();
    }
  }, [shouldControl, refreshTimer]);

  return (
    shouldControl && (
      <div className="absolute bottom-44 left-1/2 z-[51] flex -translate-x-1/2 gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await revokeHandle();
            setUndoAccessible(false);
          }}
          disabled={!undoAccessible}
        >
          {t('table:aiChat.control.undo')}
          {undoLoading && <Spin className="size-4" />}
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await redoHandle();
            setUndoAccessible(true);
          }}
          disabled={undoAccessible}
        >
          {t('table:aiChat.control.redo')}
          {redoLoading && <Spin />}
          <Redo2 className="size-4 " />
        </Button>
      </div>
    )
  );
};
