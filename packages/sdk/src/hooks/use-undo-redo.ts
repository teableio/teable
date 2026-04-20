import { redoStream, undoStream } from '@teable/openapi';
import { sonner } from '@teable/ui-lib';
import { useCallback } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useTableId } from './use-table-id';

const { toast } = sonner;

const formatProgressMessage = (label: string, processedCount: number, totalCount: number) => {
  if (totalCount <= 0) {
    return label;
  }
  return `${label} ${processedCount}/${totalCount}`;
};

export const useUndoRedo = () => {
  const tableId = useTableId();
  const { t } = useTranslation();
  const performUndo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to undo');
      return;
    }
    const toastId = toast.loading(t('undoRedo.undoing'), { duration: Infinity });
    try {
      const res = await undoStream(tableId, {
        onProgress: (progress) => {
          toast.loading(
            formatProgressMessage(
              t('undoRedo.undoing'),
              progress.processedCount,
              progress.totalCount
            ),
            { id: toastId, duration: Infinity }
          );
        },
      });
      if (res.data.status === 'fulfilled') {
        toast.success(t('undoRedo.undoSucceed'), { id: toastId, duration: 1500 });
        return;
      }
      if (res.data.status === 'empty') {
        toast(t('undoRedo.nothingToUndo'), { id: toastId, duration: 1500 });
        return;
      }
      throw new Error(res.data.errorMessage);
    } catch (e) {
      toast.error(`${t('undoRedo.undoFailed')}: ${(e as { message: string }).message}`, {
        id: toastId,
      });
    }
  }, [t, tableId]);

  const performRedo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to redo');
      return;
    }

    const toastId = toast.loading(t('undoRedo.redoing'), { duration: Infinity });
    try {
      const res = await redoStream(tableId, {
        onProgress: (progress) => {
          toast.loading(
            formatProgressMessage(
              t('undoRedo.redoing'),
              progress.processedCount,
              progress.totalCount
            ),
            { id: toastId, duration: Infinity }
          );
        },
      });
      if (res.data.status === 'fulfilled') {
        toast.success(t('undoRedo.redoSucceed'), { id: toastId, duration: 1500 });
        return;
      }
      if (res.data.status === 'empty') {
        toast(t('undoRedo.nothingToRedo'), { id: toastId, duration: 1500 });
        return;
      }
      throw new Error(res.data.errorMessage);
    } catch (e) {
      toast.error(`${t('undoRedo.redoFailed')}: ${(e as { message: string }).message}`, {
        id: toastId,
      });
    }
  }, [t, tableId]);

  return { undo: performUndo, redo: performRedo };
};
