import type { IRecordInsertOrderRo } from '@teable/openapi';
import { useRecordOperations } from '@teable/sdk/hooks';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IDuplicateRecordParams {
  tableId: string;
  recordId: string;
  order: IRecordInsertOrderRo;
}

/**
 * Duplicates a single record from a context menu. The menu closes on click, but the
 * copy only exists once the server answers, so the request stays visible as a
 * loading toast that turns into success when it lands. A failure is reported by
 * the global mutation error handler with the server's reason, and the loading
 * toast is removed so the user can retry from the menu.
 */
export const useDuplicateRecord = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { duplicateRecord } = useRecordOperations();

  return useCallback(
    async (params: IDuplicateRecordParams) => {
      const toastId = toast.loading(t('table:import.menu.duplicating'));
      try {
        await duplicateRecord(params);
        toast.success(t('table:import.menu.duplicateSuccess'), { id: toastId });
      } catch {
        toast.dismiss(toastId);
      }
    },
    [duplicateRecord, t]
  );
};
