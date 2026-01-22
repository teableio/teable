import { Bell, Key, Link, Lock, Settings, User } from '@teable/icons';
import { useIsTouchDevice } from '@teable/sdk/hooks';
import {
  Dialog,
  DialogContent,
  Sheet,
  SheetContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { System } from '@/features/app/components/setting/System';
import { settingConfig } from '@/features/i18n/setting.config';
import { Account } from './Account';
import { Integration } from './integration/Integration';
import { Notifications } from './Notifications';
import { OAuthAppSection } from './oauth-app';
import { PersonalAccessTokenSection } from './personal-access-token';
import { SettingTab, useSettingStore } from './useSettingStore';

export const SettingDialog = () => {
  const { t } = useTranslation(settingConfig.i18nNamespaces);
  const isTouchDevice = useIsTouchDevice();
  const { open, setOpen, tab, setTab } = useSettingStore();

  const tabList = useMemo(() => {
    return [
      {
        key: SettingTab.Profile,
        name: t('settings.account.tab'),
        Icon: User,
      },
      {
        key: SettingTab.System,
        name: t('settings.setting.title'),
        Icon: Settings,
      },
      {
        key: SettingTab.Notifications,
        name: t('settings.notify.title'),
        Icon: Bell,
      },
      {
        key: SettingTab.Integration,
        name: t('settings.integration.title'),
        Icon: Link,
      },
      {
        key: SettingTab.PersonalAccessToken,
        name: t('setting:personalAccessToken'),
        Icon: Key,
      },
      {
        key: SettingTab.OAuthApp,
        name: t('setting:oauthApps'),
        Icon: Lock,
      },
    ];
  }, [t]);

  const content = (
    <Tabs
      defaultValue={SettingTab.Profile}
      value={tab}
      onValueChange={(value) => setTab(value as SettingTab)}
      className="flex h-full gap-0 overflow-hidden"
    >
      <TabsList className="flex h-full w-fit max-w-72 flex-col items-start justify-start gap-1 rounded-none border-none bg-muted p-4">
        {tabList.map(({ key, name, Icon }) => {
          return (
            <TabsTrigger
              key={key}
              value={key}
              className="h-8 w-full cursor-pointer justify-start gap-2 rounded-md font-normal data-[state=active]:bg-surface data-[state=active]:font-medium data-[state=active]:shadow-none hover:bg-surface"
            >
              <Icon className="size-5 shrink-0 sm:size-4" />
              <span className="hidden sm:inline">{name}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.Profile}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <Account />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.System}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <System />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.Notifications}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <Notifications />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.Integration}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <Integration />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.PersonalAccessToken}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <PersonalAccessTokenSection />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.OAuthApp}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <OAuthAppSection />
      </TabsContent>
    </Tabs>
  );

  return (
    <>
      {isTouchDevice ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            className="h-5/6 rounded-t-lg px-1 pb-0 pt-4 [&>button]:right-4 [&>button]:top-4 "
            side="bottom"
          >
            {content}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className="h-4/5 max-h-[80vh] max-w-6xl overflow-hidden p-0 [&>button]:right-4 [&>button]:top-4 "
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {content}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
