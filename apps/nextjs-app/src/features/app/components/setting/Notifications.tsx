import { updateUserNotifyMeta } from '@teable-group/openapi';
import { useSession } from '@teable-group/sdk';
import { Label, Separator, Switch } from '@teable-group/ui-lib/shadcn';

export const Notifications: React.FC = () => {
  const { user: sessionUser, refresh } = useSession();
  const onNotifyMetaEmailSwitchChange = (check: boolean) => {
    updateUserNotifyMeta({ email: check }).then(() => refresh?.());
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">My notifications</h3>
      </div>
      <Separator />
      <div className="flex items-center justify-start">
        <div className="mr-[10%]">
          <Label>Activity in your workspace</Label>
          <div className="text-sm text-muted-foreground">
            Receive emails when you get comments, mentions, page invites, reminders, access
            requests, and property changes
          </div>
        </div>
        <Switch
          id="notify-meta-email"
          checked={Boolean(sessionUser?.notifyMeta?.email)}
          onCheckedChange={onNotifyMetaEmailSwitchChange}
        />
      </div>
    </div>
  );
};
