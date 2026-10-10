import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateAuthorizedNotifications } from '@teable/openapi';
import { Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

/** Whether an authorized app may notify the user: off keeps it authorized but quiet. */
export const NotificationsSwitch = (props: { clientId: string; name: string; muted?: boolean }) => {
  const { clientId, name, muted } = props;
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(!muted);
  const { mutate, isPending } = useMutation({
    mutationFn: (on: boolean) => updateAuthorizedNotifications(clientId, { muted: !on }),
    onMutate: (on) => setEnabled(on),
    onError: (_error, on) => setEnabled(!on),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['integration'] }),
  });

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="text-sm">
          {t('settings.integration.thirdPartyIntegrations.notifications')}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('settings.integration.thirdPartyIntegrations.notificationsDesc', { name })}
        </div>
      </div>
      <Switch
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(on) => mutate(on)}
        aria-label={t('settings.integration.thirdPartyIntegrations.notifications')}
      />
    </div>
  );
};
