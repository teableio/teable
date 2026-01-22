import { ExitIcon } from '@radix-ui/react-icons';
import { useMutation } from '@tanstack/react-query';
import { Key, HelpCircle, License, MessageSquare, Settings } from '@teable/icons';
import { signout } from '@teable/openapi';
import { useSession } from '@teable/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useIsCloud } from '../../hooks/useIsCloud';
import { SettingTab, useSettingStore } from '../setting/useSettingStore';

export const UserNav: React.FC<React.PropsWithChildren> = (props) => {
  const { children } = props;
  const router = useRouter();
  const { t } = useTranslation(['common', 'setting']);
  const { user } = useSession();
  const setting = useSettingStore();
  const { mutateAsync: loginOut, isPending: isLoading } = useMutation({
    mutationFn: signout,
  });
  const isCloud = useIsCloud();

  const loginOutClick = async () => {
    await loginOut();
    router.push('/auth/login');
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="truncate text-sm font-medium" title={user.name}>
              {user.name}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={user.email}>
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="flex gap-2" onClick={() => setting.setOpen(true)}>
          <Settings className="size-4 shrink-0" />
          {t('settings.nav.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem className="flex gap-2" asChild>
          <a href={t('help.mainLink')} target="_blank" rel="noreferrer">
            <HelpCircle className="size-4 shrink-0" />
            {t('help.title')}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem className="flex gap-2" asChild>
          <a
            href="https://app.teable.ai/share/shrX1qxpciRUj1Jww2b/view"
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageSquare className="size-4 shrink-0" />
            {t('settings.nav.contactSupport')}
          </a>
        </DropdownMenuItem>
        {isCloud && (
          <DropdownMenuItem
            className="flex gap-2"
            onClick={() => {
              setting.setOpen(true, SettingTab.License);
            }}
          >
            <License className="size-4 shrink-0" />
            {t('noun.license')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="flex gap-2"
          onClick={() => {
            setting.setOpen(true, SettingTab.PersonalAccessToken);
          }}
        >
          <Key className="size-4 shrink-0" />
          {t('setting:personalAccessToken')}
        </DropdownMenuItem>
        <DropdownMenuItem className="flex gap-2" onClick={loginOutClick} disabled={isLoading}>
          <ExitIcon className="size-4 shrink-0" />
          {t('settings.nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
