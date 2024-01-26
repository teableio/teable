import {
  Dialog,
  DialogContent,
  DialogTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable-group/ui-lib/shadcn';
import { useTranslation } from 'react-i18next';
import { System } from '@/features/app/components/setting/System';
import { Account } from './Account';
import { Notifications } from './Notifications';

export const SettingTrigger: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation('common');
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="h-5/6 max-h-[800px] max-w-6xl">
        <Tabs defaultValue="profile" className="flex min-h-[40rem] gap-4 pt-4">
          <TabsList className="grid w-36 gap-2 bg-inherit text-left">
            <TabsTrigger
              value="profile"
              className="w-36 justify-start data-[state=active]:bg-muted"
            >
              {t('settings.account.tab')}
            </TabsTrigger>
            <TabsTrigger value="system" className="justify-start data-[state=active]:bg-muted">
              {t('settings.setting.title')}
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className="justify-start data-[state=active]:bg-muted"
            >
              {t('settings.notify.title')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-0 w-full">
            <Account />
          </TabsContent>
          <TabsContent value="system" className="mt-0 w-full">
            <System />
          </TabsContent>
          <TabsContent value="notifications" className="mt-0 w-full">
            <Notifications />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
