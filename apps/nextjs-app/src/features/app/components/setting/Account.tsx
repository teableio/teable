import { useMutation } from '@tanstack/react-query';
import { updateUserAvatar, updateUserName, USER_NAME_MAX_LENGTH } from '@teable/openapi';
import { useIsTouchDevice, useSession } from '@teable/sdk';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
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
import { SettingGroup, SettingRow } from './SettingGroup';
import { SettingTabShell } from './SettingTabShell';

interface IAccountProps {
  /** Extra rows under account security (the enterprise edition adds signed-in devices). */
  securityItems?: ReactNode;
}

export const Account = ({ securityItems }: IAccountProps) => {
  const { user: sessionUser, refresh, refreshAvatar } = useSession();
  const { t } = useTranslation('common');
  const isTouchDevice = useIsTouchDevice();
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
  };

  const avatarComponent = (
    <div className="group relative flex h-fit shrink-0 items-center justify-center">
      <UserAvatar className="size-10 border" user={sessionUser} />
      <div className="absolute start-0 top-0 size-full rounded-full bg-transparent group-hover:bg-muted-foreground/20">
        <input
          type="file"
          className="absolute inset-0 size-full opacity-0"
          accept="image/png,image/jpeg,image/webp"
          aria-label={t('settings.account.photo')}
          onChange={uploadAvatar}
        />
      </div>
    </div>
  );

  return (
    <SettingTabShell title={t('settings.account.tab')}>
      {/* The version sits at the bottom of a short page and scrolls with a long one, rather than
          pinning to the dialog's edge and eating the room the settings need. */}
      <div className="flex min-h-full flex-col gap-8">
        <div className="flex max-w-3xl flex-col gap-8">
          <SettingGroup title={t('settings.account.profileTitle')}>
            <SettingRow
              label={t('settings.account.photo')}
              description={t('settings.account.photoDesc')}
              action={
                isTouchDevice ? (
                  avatarComponent
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>{avatarComponent}</TooltipTrigger>
                      <TooltipContent>
                        <p>{t('settings.account.updatePhoto')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )
              }
            />
            <SettingRow
              label={t('name')}
              htmlFor="account-name"
              action={
                <Input
                  id="account-name"
                  className="w-full px-3 sm:w-64"
                  defaultValue={sessionUser.name}
                  maxLength={USER_NAME_MAX_LENGTH}
                  onBlur={(e) => toggleRenameUser(e)}
                />
              }
            />
          </SettingGroup>
          <SettingGroup title={t('settings.account.securityTitle')}>
            <SettingRow
              label={t('settings.account.email')}
              description={sessionUser.email}
              action={
                <ChangeEmailDialog>
                  <Button className="w-full sm:w-auto" size={'sm'} variant={'outline'}>
                    {t('settings.account.changeEmail.title')}
                  </Button>
                </ChangeEmailDialog>
              }
            />
            <SettingRow
              label={t('settings.account.password')}
              description={t('settings.account.passwordDesc')}
              action={
                sessionUser.hasPassword ? (
                  <ChangePasswordDialog>
                    <Button className="w-full sm:w-auto" size={'sm'} variant={'outline'}>
                      {t('settings.account.changePassword.title')}
                    </Button>
                  </ChangePasswordDialog>
                ) : (
                  <AddPassword>
                    <Button className="w-full sm:w-auto" size={'sm'} variant={'outline'}>
                      {t('settings.account.addPassword.title')}
                    </Button>
                  </AddPassword>
                )
              }
            />
            {securityItems}
          </SettingGroup>
          <SettingGroup title={t('settings.account.dataTitle')}>
            <AccountDataExport />
            <SettingRow
              label={t('settings.account.deleteAccount.title')}
              description={t('settings.account.deleteAccount.desc')}
              action={<DeleteAccountDialog />}
            />
          </SettingGroup>
        </div>
        <div className="mt-auto flex w-full flex-col items-center justify-center gap-1 pb-[env(safe-area-inset-bottom)] text-center text-xs text-muted-foreground">
          <div>{`${t('settings.setting.version')}: ${displayBuildVersion}`}</div>
          {previewTag && (
            <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
              <span>{`preview: ${previewTag}`}</span>
              {shortGitCommitSha && <span>{`commit: ${shortGitCommitSha}`}</span>}
            </div>
          )}
        </div>
      </div>
    </SettingTabShell>
  );
};
