import { Pencil } from '@teable-group/icons';
import { updateUserName } from '@teable-group/openapi';
import { useSession } from '@teable-group/sdk';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Input,
  Label,
  Separator,
} from '@teable-group/ui-lib/shadcn';
import React from 'react';

export const Account: React.FC = () => {
  const { user: sessionUser, refresh } = useSession();

  const toggleRenameUser = (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const name = e.target.value;
    if (name && name !== sessionUser.name) {
      updateUserName({ name }).then(() => refresh?.());
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">My profile</h3>
      </div>
      <div className="flex">
        <div className="relative flex h-20 w-20 cursor-pointer items-center justify-center">
          <Avatar className="h-20 w-20 hover:shadow-[0_0_0_10px_rgba(0,0,0,0.05)] dark:hover:shadow-slate-700">
            <AvatarImage src={sessionUser.avatar as string} alt="avatar-name" />
            <AvatarFallback>{sessionUser.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <div className="absolute bottom-[-1px] right-[-1px] flex h-5 w-5 items-center justify-center rounded-full bg-background">
            <Pencil />
          </div>
        </div>

        <div className="ml-4 pt-3">
          <Input
            className="w-64"
            defaultValue={sessionUser.name}
            onBlur={(e) => toggleRenameUser(e)}
          />
          <Label className="text-sm text-muted-foreground" htmlFor="Preferred name">
            Your name will be displayed on contributions and mentions. You can change it anytime.
          </Label>
        </div>
      </div>
      <div>
        <h3 className="text-lg font-medium">Account security</h3>
        <Separator className="my-2" />
        <div className="grid grid-flow-col grid-rows-3 gap-4">
          <div>
            <Label>Email</Label>
            <div className="text-sm text-muted-foreground">{sessionUser.email}</div>
          </div>
          <div className="row-span-2">
            <Label>Password</Label>
            <div className="text-sm text-muted-foreground">
              Set a permanent password to login to your account.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
