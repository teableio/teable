import { Bell, Link, Settings, User } from '@teable/icons';
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
import { Account } from './Account';
import { Integration } from './integration/Integration';
import { Notifications } from './Notifications';
import { useSettingStore } from './useSettingStore';

export const SettingDialog = () => {
  const { t } = useTranslation('common');
  const isTouchDevice = useIsTouchDevice();
  const { open, setOpen, tab, setTab } = useSettingStore();

  const tabList = useMemo(() => {
    return [
      {
        key: 'profile',
        name: t('settings.account.tab'),
        Icon: User,
      },
      {
        key: 'system',
        name: t('settings.setting.title'),
        Icon: Settings,
      },
      {
        key: 'notifications',
        name: t('settings.notify.title'),
        Icon: Bell,
      },
      {
        key: 'integration',
        name: t('settings.integration.title'),
        Icon: Link,
      },
    ];
  }, [t]);

  const content = (
    <Tabs
      defaultValue="profile"
      value={tab}
      onValueChange={(value) =>
        setTab(value as 'profile' | 'system' | 'notifications' | 'integration')
      }
      className="flex h-full gap-0 overflow-hidden"
    >
      <TabsList className="flex h-full w-[200px] flex-col items-start justify-start gap-1 rounded-none border-none bg-muted p-4">
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
        value="profile"
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <Account />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value="system"
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <System />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value="notifications"
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <Notifications />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value="integration"
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <Integration />
      </TabsContent>
    </Tabs>
  );

  return (
    <>
      {isTouchDevice ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent className="h-5/6 rounded-t-lg px-1 pb-0 pt-4" side="bottom">
            {content}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="h-4/5 max-h-[800px] max-w-[860px] overflow-hidden p-0">
            {content}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
