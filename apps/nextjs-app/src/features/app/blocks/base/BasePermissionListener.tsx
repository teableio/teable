import { useQuery } from '@tanstack/react-query';
import { getBaseById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, usePermissionUpdateListener } from '@teable/sdk/hooks';
import { AlertDialog, AlertDialogContent, Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useState } from 'react';
import { baseConfig } from '@/features/i18n/base.config';

export const BasePermissionListener = () => {
  const baseId = useBaseId();
  const router = useRouter();
  const { t } = useTranslation(baseConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);

  const { data: base, refetch } = useQuery({
    queryKey: ReactQueryKeys.base(baseId!),
    queryFn: ({ queryKey }) => getBaseById(queryKey[1]).then((res) => res.data),
    enabled: !!baseId,
  });

  const isUnrestricted = base?.isUnrestricted;

  const onPermissionUpdate = useCallback(async () => {
    await refetch();
    if (isUnrestricted) {
      return;
    }
    setOpen(true);
  }, [isUnrestricted, refetch]);

  usePermissionUpdateListener(baseId, onPermissionUpdate);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <div className="text-sm">{t('common:pagePermissionChangeTip')}</div>
        <div className="text-right">
          <Button className="h-7" size={'sm'} onClick={() => router.reload()}>
            {t('common:actions.refreshPage')}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
