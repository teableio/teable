import { useBaseId, useTableId } from '@teable/sdk/hooks';
import { syncCopy } from '@teable/sdk/utils';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { tableConfig } from '@/features/i18n/table.config';

export const useContextMenu = () => {
  const baseId = useBaseId();
  const tableId = useTableId();
  const { publicOrigin } = useEnv();
  const router = useRouter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const copyRecordUrl = useCallback(
    async (recordId: string) => {
      if (!baseId || !tableId || !recordId) return;
      const recordUrl = `${publicOrigin}/base/${baseId}/table/${tableId}?recordId=${recordId}`;
      await syncCopy(recordUrl);
      toast.success(t('sdk:expandRecord.copy'));
    },
    [publicOrigin, baseId, tableId, t]
  );

  const viewRecordHistory = useCallback(
    async (recordId: string) => {
      if (!baseId || !tableId || !recordId) return;
      await router.push(
        {
          pathname: router.pathname,
          query: { ...router.query, recordId, showHistory: true },
        },
        undefined,
        {
          shallow: true,
        }
      );
    },
    [baseId, tableId, router]
  );

  const addRecordComment = useCallback(
    async (recordId: string) => {
      if (!baseId || !tableId || !recordId) return;
      await router.push(
        {
          pathname: router.pathname,
          query: { ...router.query, recordId, showComment: true },
        },
        undefined,
        {
          shallow: true,
        }
      );
    },
    [baseId, tableId, router]
  );

  return {
    copyRecordUrl,
    viewRecordHistory,
    addRecordComment,
  };
};
