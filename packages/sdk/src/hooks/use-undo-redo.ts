import { redo, undo } from '@teable/openapi';
import { toast } from '@teable/ui-lib/src/shadcn/ui/sonner';
import { useCallback } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useTableId } from './use-table-id';

export const useUndoRedo = () => {
  const tableId = useTableId();
  const { t } = useTranslation();
  const performUndo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to undo');
      return;
    }

    toast.promise(
      async () => {
        const res = await undo(tableId);
        if (res.data.status === 'fulfilled') {
          return t('undoRedo.undoSucceed');
        }
        if (res.data.status === 'empty') {
          return t('undoRedo.nothingToUndo');
        }
        throw new Error(res.data.errorMessage);
      },
      {
        duration: 1500,
        loading: t('undoRedo.undoing'),
        success: (message) => message,
        error: (e) => {
          return `${t('undoRedo.undoFailed')}: ${(e as { message: string }).message}`;
        },
      }
    );
  }, [t, tableId]);

  const performRedo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to redo');
      return;
    }

    toast.promise(
      async () => {
        const res = await redo(tableId);
        if (res.data.status === 'fulfilled') {
          return t('undoRedo.redoSucceed');
        }
        if (res.data.status === 'empty') {
          return t('undoRedo.nothingToRedo');
        }
        throw new Error(res.data.errorMessage);
      },
      {
        duration: 1500,
        loading: t('undoRedo.redoing'),
        success: (message) => message,
        error: (e) => {
          return `${t('undoRedo.redoFailed')}: ${(e as { message: string }).message}`;
        },
      }
    );
  }, [t, tableId]);

  return { undo: performUndo, redo: performRedo };
};
