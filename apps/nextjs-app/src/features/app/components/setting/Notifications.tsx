import { updateUserNotifyMeta } from '@teable/openapi';
import { useSession } from '@teable/sdk';
import { Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { SettingTabHeader, SettingTabShell } from './SettingTabShell';

export const Notifications: React.FC = () => {
  const { t } = useTranslation('common');
  const { user: sessionUser, refresh } = useSession();
  const onNotifyMetaEmailSwitchChange = (check: boolean) => {
    updateUserNotifyMeta({ email: check }).then(() => refresh?.());
  };

  return (
    <SettingTabShell header={<SettingTabHeader title={t('settings.notify.title')} />}>
      <div className="flex items-center justify-between gap-4 rounded-md border bg-card px-4 py-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t('settings.notify.label')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.notify.desc')}</p>
        </div>
        <Switch
          id="notify-meta-email"
          checked={Boolean(sessionUser?.notifyMeta?.email)}
          onCheckedChange={onNotifyMetaEmailSwitchChange}
        />
      </div>
    </SettingTabShell>
  );
};
