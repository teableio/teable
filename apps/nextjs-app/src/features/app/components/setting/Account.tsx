import { useMutation } from '@tanstack/react-query';
import { updateUserAvatar, updateUserName, USER_NAME_MAX_LENGTH } from '@teable/openapi';
import { useSession } from '@teable/sdk';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import React from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { useEnv } from '@/features/app/hooks/useEnv';
import { AccountDataExport } from '@overridable/AccountDataExport';
import { AddPassword } from './account/AddPassword';
import { ChangeEmailDialog } from './account/ChangeEmailDialog';
import { ChangePasswordDialog } from './account/ChangePasswordDialog';
import { DeleteAccountDialog } from './account/DeleteAccountDialog';
import { SettingItem, SettingSection, SettingStack } from './SettingSection';
import { SettingTabShell } from './SettingTabShell';

interface IAccountProps {
  /** Extra rows under account security (the enterprise edition adds signed-in devices). */
  securityItems?: ReactNode;
}

export const Account = ({ securityItems }: IAccountProps) => {
  const { user: sessionUser, refresh, refreshAvatar } = useSession();
  const { t } = useTranslation('common');
  const { buildVersion, gitCommitSha, previewTag } = useEnv();
  const shortGitCommitSha = gitCommitSha?.slice(0, 12);
  const displayBuildVersion = buildVersion ?? process.env.APP_VERSION ?? 'develop';

  const updateUserAvatarMutation = useMutation({
    mutationFn: updateUserAvatar,
    onSuccess: () => {
      refreshAvatar?.();
    },
  });

  const updateUserNameMutation = useMutation({
    mutationFn: updateUserName,
    onSuccess: () => {
      refresh?.();
    },
  });

  const toggleRenameUser = (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const name = e.target.value;
    if (name && name !== sessionUser.name) {
      updateUserNameMutation.mutate({ name });
    }
  };

  const uploadAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const avatarFille = e.target.files?.[0];
    if (!avatarFille) {
      return;
    }
    const formData = new FormData();
    formData.append('file', avatarFille);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateUserAvatarMutation.mutate(formData as any);
    // Let the same file be picked again after a failed upload.
    e.target.value = '';
  };

  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <SettingTabShell
      title={t('settings.account.tab')}
      description={t('settings.account.description')}
      footer={
        <div className="flex w-full flex-col items-center justify-center gap-1 pb-[env(safe-area-inset-bottom)] text-center text-xs text-muted-foreground">
          <div>{`${t('settings.setting.version')}: ${displayBuildVersion}`}</div>
          {previewTag && (
            <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
              <span>{`preview: ${previewTag}`}</span>
              {shortGitCommitSha && <span>{`commit: ${shortGitCommitSha}`}</span>}
            </div>
          )}
        </div>
      }
    >
      <SettingStack>
        <SettingSection title={t('settings.account.profileTitle')}>
          <SettingItem
            label={t('settings.account.photo')}
            description={t('settings.account.photoDesc')}
            inline
            action={
              <>
                <UserAvatar className="size-10 border" user={sessionUser} />
                <input
                  ref={avatarInputRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={t('settings.account.photo')}
                  onChange={uploadAvatar}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updateUserAvatarMutation.isPending}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {t('settings.account.updatePhoto')}
                </Button>
              </>
            }
          />
          <SettingItem
            label={t('name')}
            description={t('settings.account.nameDesc')}
            htmlFor="account-name"
            action={
              <Input
                id="account-name"
                className="w-full sm:w-64"
                defaultValue={sessionUser.name}
                maxLength={USER_NAME_MAX_LENGTH}
                onBlur={(e) => toggleRenameUser(e)}
              />
            }
          />
        </SettingSection>
        <SettingSection title={t('settings.account.securityTitle')}>
          <SettingItem
            label={t('settings.account.email')}
            description={sessionUser.email}
            action={
              <ChangeEmailDialog>
                <Button className="w-full sm:w-auto" size="sm" variant="outline">
                  {t('settings.account.changeEmail.title')}
                </Button>
              </ChangeEmailDialog>
            }
          />
          <SettingItem
            label={t('settings.account.password')}
            description={t('settings.account.passwordDesc')}
            action={
              sessionUser.hasPassword ? (
                <ChangePasswordDialog>
                  <Button className="w-full sm:w-auto" size="sm" variant="outline">
                    {t('settings.account.changePassword.title')}
                  </Button>
                </ChangePasswordDialog>
              ) : (
                <AddPassword>
                  <Button className="w-full sm:w-auto" size="sm" variant="outline">
                    {t('settings.account.addPassword.title')}
                  </Button>
                </AddPassword>
              )
            }
          />
          {securityItems}
        </SettingSection>
        <AccountDataExport />
        <SettingSection title={t('settings.dangerZone')} danger>
          <SettingItem
            label={t('settings.account.deleteAccount.title')}
            description={t('settings.account.deleteAccount.desc')}
            action={<DeleteAccountDialog />}
          />
        </SettingSection>
      </SettingStack>
    </SettingTabShell>
  );
};
