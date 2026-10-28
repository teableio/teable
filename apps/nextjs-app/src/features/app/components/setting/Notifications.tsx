import { updateUserNotifyMeta } from '@teable/openapi';
import { useSession } from '@teable/sdk';
import { Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { SettingGroup, SettingRow } from './SettingGroup';

/** The notifications group of the preferences page. */
export const Notifications: React.FC = () => {
  const { t } = useTranslation('common');
  const { user: sessionUser, refresh } = useSession();
  const onNotifyMetaEmailSwitchChange = (check: boolean) => {
    updateUserNotifyMeta({ email: check }).then(() => refresh?.());
  };

  return (
    <SettingGroup title={t('settings.notify.title')}>
      <SettingRow
        label={t('settings.notify.label')}
        htmlFor="notify-meta-email"
        description={t('settings.notify.desc')}
        action={
          <Switch
            id="notify-meta-email"
            checked={Boolean(sessionUser?.notifyMeta?.email)}
            onCheckedChange={onNotifyMetaEmailSwitchChange}
          />
        }
      />
    </SettingGroup>
  );
};
