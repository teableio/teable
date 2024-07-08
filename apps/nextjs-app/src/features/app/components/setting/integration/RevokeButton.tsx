import { useMutation, useQueryClient } from '@tanstack/react-query';
import { revokeAccess } from '@teable/openapi';
import { ConfirmDialog, Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const RevokeButton = (props: { name: string; clientId: string; onSuccess?: () => void }) => {
  const { name, clientId, onSuccess } = props;
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { mutate: revokeAccessMutate, isLoading: revokeAccessLoading } = useMutation({
    mutationFn: revokeAccess,
    onSuccess: () => {
      setRevokeConfirm(false);
      queryClient.invalidateQueries(['integration']);
      onSuccess?.();
    },
  });

  return (
    <ConfirmDialog
      open={revokeConfirm}
      onOpenChange={setRevokeConfirm}
      title={t('settings.integration.revokeTitle')}
      description={t('settings.integration.revokeDesc', { name })}
      cancelText={t('actions.cancel')}
      confirmText={t('actions.confirm')}
      onCancel={() => setRevokeConfirm(false)}
      onConfirm={() => revokeAccessMutate(clientId)}
    >
      <Button size={'xs'} variant={'destructive'} disabled={revokeAccessLoading}>
        {revokeAccessLoading && <Spin />}
        {t('settings.integration.revoke')}
      </Button>
    </ConfirmDialog>
  );
};
