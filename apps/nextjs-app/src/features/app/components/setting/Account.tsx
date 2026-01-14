import { useMutation } from '@tanstack/react-query';
import { updateUserAvatar, updateUserName } from '@teable/openapi';
import { useIsTouchDevice, useSession } from '@teable/sdk';
import {
  Button,
  Input,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { AddPassword } from './account/AddPassword';
import { ChangeEmailDialog } from './account/ChangeEmailDialog';
import { ChangePasswordDialog } from './account/ChangePasswordDialog';
import { DeleteAccountDialog } from './account/DeleteAccountDialog';

export const Account: React.FC = () => {
  const { user: sessionUser, refresh, refreshAvatar } = useSession();
  const { t } = useTranslation('common');
  const isTouchDevice = useIsTouchDevice();

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
    <div className="group relative flex h-fit items-center justify-center">
      <UserAvatar className="size-14 border" width={80} height={80} user={sessionUser} />
      <div className="absolute left-0 top-0 size-full rounded-full bg-transparent group-hover:bg-muted-foreground/20">
        <input
          type="file"
          className="absolute inset-0 size-full opacity-0"
          accept="image/*"
          onChange={uploadAvatar}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-6 border-l px-8 py-4">
      <h3 className="text-lg font-medium">{t('settings.account.title')}</h3>
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col items-start justify-start">
          {isTouchDevice ? (
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
          )}
          <div className="flex-1 pt-4">
            <Input
              className="max-w-[320px]"
              defaultValue={sessionUser.name}
              onBlur={(e) => toggleRenameUser(e)}
            />
            <Label className="text-xs font-normal text-muted-foreground" htmlFor="Preferred name">
              {t('settings.account.updateNameDesc')}
            </Label>
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium">
            {t('settings.account.securityTitle')}
            {!sessionUser.hasPassword && <AddPassword />}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{t('settings.account.email')}</p>
                <div className="text-xs text-muted-foreground">{sessionUser.email}</div>
              </div>
              <ChangeEmailDialog>
                <Button className="float-right" size={'sm'} variant={'outline'}>
                  {t('settings.account.changeEmail.title')}
                </Button>
              </ChangeEmailDialog>
            </div>
            {sessionUser.hasPassword && (
              <div className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{t('settings.account.password')}</p>
                  <div className="text-xs text-muted-foreground">
                    {t('settings.account.passwordDesc')}
                  </div>
                </div>
                <ChangePasswordDialog>
                  <Button className="float-right" size={'sm'} variant={'outline'}>
                    {t('settings.account.changePassword.title')}
                  </Button>
                </ChangePasswordDialog>
              </div>
            )}
          </div>
        </div>
        <div>
          {' '}
          <DeleteAccountDialog />
        </div>
      </div>
      <div className="flex w-full items-center justify-center pt-4 text-xs text-muted-foreground">
        {`${t('settings.setting.version')}: ${process.env.NEXT_PUBLIC_BUILD_VERSION}`}
      </div>
    </div>
  );
};
