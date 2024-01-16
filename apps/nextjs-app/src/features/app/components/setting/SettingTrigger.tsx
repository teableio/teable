import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable-group/ui-lib/shadcn';
import { System } from '@/features/app/components/setting/System';
import { Account } from './Account';
import { Notifications } from './Notifications';

export const SettingTrigger: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-5/6 max-h-[800px] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your account settings and set e-mail preferences.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="profile" className="flex gap-4 overflow-y-auto pt-4">
          <TabsList className="grid-row-2 grid w-36 gap-2 bg-inherit">
            <TabsTrigger value="profile" className="w-36 data-[state=active]:bg-muted">
              My Account
            </TabsTrigger>
            <TabsTrigger value="system" className="data-[state=active]:bg-muted">
              My Settings
            </TabsTrigger>
            <TabsTrigger value="notifications" className="data-[state=active]:bg-muted">
              My Notifications
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
