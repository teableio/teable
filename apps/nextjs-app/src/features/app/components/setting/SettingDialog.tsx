import { Bell, Settings, UserEdit } from '@teable/icons';
import {
  Dialog,
  DialogContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { System } from '@/features/app/components/setting/System';
import { Account } from './Account';
import { Notifications } from './Notifications';
import { useSettingStore } from './useSettingStore';

export const SettingDialog = () => {
  const { t } = useTranslation('common');
  const { open, setOpen } = useSettingStore();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="h-5/6 max-h-[800px] max-w-6xl">
        <Tabs defaultValue="profile" className="flex min-h-[40rem] gap-4 pt-4">
          <TabsList className="grid w-36 gap-2 bg-inherit text-left">
            <TabsTrigger
              value="profile"
              className="w-36 justify-start gap-2 font-normal data-[state=active]:bg-muted data-[state=active]:font-medium"
            >
              <UserEdit className="shrink-0" />
              {t('settings.account.tab')}
            </TabsTrigger>
            <TabsTrigger
              value="system"
              className="w-36 justify-start gap-2 font-normal data-[state=active]:bg-muted data-[state=active]:font-medium"
            >
              <Settings className="shrink-0" />
              {t('settings.setting.title')}
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className="w-36 justify-start gap-2 font-normal data-[state=active]:bg-muted data-[state=active]:font-medium"
            >
              <Bell className="shrink-0" />
              {t('settings.notify.title')}
            </TabsTrigger>
          </TabsList>
          <TabsContent tabIndex={-1} value="profile" className="mt-0 w-full">
            <Account />
          </TabsContent>
          <TabsContent tabIndex={-1} value="system" className="mt-0 w-full">
            <System />
          </TabsContent>
          <TabsContent tabIndex={-1} value="notifications" className="mt-0 w-full">
            <Notifications />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
