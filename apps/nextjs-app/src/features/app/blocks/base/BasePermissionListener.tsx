import { isUnrestrictedRole } from '@teable/core';
import { useBase, usePermissionUpdateListener } from '@teable/sdk/hooks';
import { AlertDialog, AlertDialogContent, Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useState } from 'react';
import { baseConfig } from '@/features/i18n/base.config';

export const BasePermissionListener = () => {
  const base = useBase();
  const router = useRouter();
  const isUnrestricted = isUnrestrictedRole(base.role);
  const { t } = useTranslation(baseConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);

  const onPermissionUpdate = useCallback(() => {
    if (isUnrestricted) {
      return;
    }
    setOpen(true);
  }, [isUnrestricted]);

  usePermissionUpdateListener(base.id, onPermissionUpdate);

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
