import { updateUserNotifyMeta } from '@teable/openapi';
import { useSession } from '@teable/sdk';
import { Label, Separator, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

export const Notifications: React.FC = () => {
  const { t } = useTranslation('common');
  const { user: sessionUser, refresh } = useSession();
  const onNotifyMetaEmailSwitchChange = (check: boolean) => {
    updateUserNotifyMeta({ email: check }).then(() => refresh?.());
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t('settings.notify.title')}</h3>
      </div>
      <Separator />
      <div className="flex items-center justify-start">
        <div className="mr-[10%]">
          <Label>{t('settings.notify.label')}</Label>
          <div className="text-sm text-muted-foreground">{t('settings.notify.desc')}</div>
        </div>
        <Switch
          id="notify-meta-email"
          checked={Boolean(sessionUser?.notifyMeta?.email)}
          onCheckedChange={onNotifyMetaEmailSwitchChange}
        />
      </div>
    </div>
  );
};
