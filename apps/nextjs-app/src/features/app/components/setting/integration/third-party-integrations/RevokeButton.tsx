import { useMutation, useQueryClient } from '@tanstack/react-query';
import { revokeToken } from '@teable/openapi';
import { ConfirmDialog, Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const RevokeButton = (props: { name: string; clientId: string; onSuccess?: () => void }) => {
  const { name, clientId, onSuccess } = props;
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const {
    mutate: revokeTokenMutate,
    isPending: revokeTokenLoading,
    isSuccess: revoked,
  } = useMutation({
    mutationFn: revokeToken,
    onSuccess: () => {
      setRevokeConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['integration'] });
      onSuccess?.();
    },
  });
  // Stays disabled after success too: the confirm button is still clickable while the dialog
  // animates closed, and a second click there would send a second revoke.
  const revokeDisabled = revokeTokenLoading || revoked;

  return (
    <ConfirmDialog
      open={revokeConfirm}
      onOpenChange={setRevokeConfirm}
      title={t('settings.integration.thirdPartyIntegrations.revokeTitle')}
      description={t('settings.integration.thirdPartyIntegrations.revokeDesc', { name })}
      cancelText={t('actions.cancel')}
      confirmText={t('actions.confirm')}
      confirmLoading={revokeTokenLoading}
      confirmDisabled={revokeDisabled}
      onCancel={() => setRevokeConfirm(false)}
      onConfirm={() => revokeTokenMutate(clientId)}
    >
      <Button size={'xs'} variant={'destructive'} disabled={revokeDisabled}>
        {revokeTokenLoading && <Spin />}
        {t('settings.integration.thirdPartyIntegrations.revoke')}
      </Button>
    </ConfirmDialog>
  );
};
