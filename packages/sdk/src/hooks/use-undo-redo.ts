import { redo, undo } from '@teable/openapi';
import { toast } from '@teable/ui-lib/src/shadcn/ui/sonner';
import { useCallback } from 'react';
import { useTableId } from './use-table-id';

export const useUndoRedo = () => {
  const tableId = useTableId();

  const performUndo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to undo');
      return;
    }

    toast.promise(
      async () => {
        const res = await undo(tableId);
        if (res.data.status === 'fulfilled') {
          return 'undo success';
        }
        if (res.data.status === 'empty') {
          return 'nothing to undo';
        }
        throw new Error(res.data.errorMessage);
      },
      {
        duration: 1500,
        loading: 'undoing...',
        success: (message) => message,
        error: (e) => {
          return `undo failed: ${(e as { message: string }).message}`;
        },
      }
    );
  }, [tableId]);

  const performRedo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to redo');
      return;
    }

    toast.promise(
      async () => {
        const res = await redo(tableId);
        if (res.data.status === 'fulfilled') {
          return 'redo success';
        }
        if (res.data.status === 'empty') {
          return 'nothing to redo';
        }
        throw new Error(res.data.errorMessage);
      },
      {
        duration: 1500,
        loading: 'redoing...',
        success: (message) => message,
        error: (e) => {
          return `redo failed: ${(e as { message: string }).message}`;
        },
      }
    );
  }, [tableId]);

  return { undo: performUndo, redo: performRedo };
};
