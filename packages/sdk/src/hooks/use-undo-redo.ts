import { redoStream, undoStream } from '@teable/openapi';
import { sonner } from '@teable/ui-lib';
import { useCallback } from 'react';
import { useTranslation } from '../context/app/i18n';
import { useTableId } from './use-table-id';

const { toast } = sonner;

const toastDuration = 1500;
const loadingToastDuration = Infinity;

const formatProgressMessage = (label: string, processedCount: number, totalCount: number) => {
  if (totalCount <= 0) {
    return label;
  }
  return `${label} ${processedCount}/${totalCount}`;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const showTransientToastAfterLoading = (toastId: string | number, message: string) => {
  toast.dismiss(toastId);
  toast(message, { duration: toastDuration });
};

export const useUndoRedo = () => {
  const tableId = useTableId();
  const { t } = useTranslation();
  const performUndo = useCallback(async () => {
    if (!tableId) {
      toast(t('undoRedo.nothingToUndo'), { duration: toastDuration });
      return;
    }
    const toastId = toast.loading(t('undoRedo.undoing'), { duration: loadingToastDuration });
    try {
      const res = await undoStream(tableId, {
        onProgress: (progress) => {
          toast.loading(
            formatProgressMessage(
              t('undoRedo.undoing'),
              progress.processedCount,
              progress.totalCount
            ),
            { id: toastId, duration: loadingToastDuration }
          );
        },
      });
      if (res.data.status === 'fulfilled') {
        toast.success(t('undoRedo.undoSucceed'), { id: toastId, duration: toastDuration });
        return;
      }
      if (res.data.status === 'empty') {
        showTransientToastAfterLoading(toastId, t('undoRedo.nothingToUndo'));
        return;
      }
      throw new Error(res.data.errorMessage);
    } catch (e) {
      toast.error(`${t('undoRedo.undoFailed')}: ${getErrorMessage(e)}`, {
        id: toastId,
      });
    }
  }, [t, tableId]);

  const performRedo = useCallback(async () => {
    if (!tableId) {
      toast(t('undoRedo.nothingToRedo'), { duration: toastDuration });
      return;
    }

    const toastId = toast.loading(t('undoRedo.redoing'), { duration: loadingToastDuration });
    try {
      const res = await redoStream(tableId, {
        onProgress: (progress) => {
          toast.loading(
            formatProgressMessage(
              t('undoRedo.redoing'),
              progress.processedCount,
              progress.totalCount
            ),
            { id: toastId, duration: loadingToastDuration }
          );
        },
      });
      if (res.data.status === 'fulfilled') {
        toast.success(t('undoRedo.redoSucceed'), { id: toastId, duration: toastDuration });
        return;
      }
      if (res.data.status === 'empty') {
        showTransientToastAfterLoading(toastId, t('undoRedo.nothingToRedo'));
        return;
      }
      throw new Error(res.data.errorMessage);
    } catch (e) {
      toast.error(`${t('undoRedo.redoFailed')}: ${getErrorMessage(e)}`, {
        id: toastId,
      });
    }
  }, [t, tableId]);

  return { undo: performUndo, redo: performRedo };
};
