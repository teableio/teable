import { useMutation } from '@tanstack/react-query';
import { updateUserAvatar, updateUserName } from '@teable-group/openapi';
import { useSession } from '@teable-group/sdk';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Input,
  Label,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable-group/ui-lib/shadcn';
import React from 'react';
import { ChangePasswordDialog } from './account/ChangePasswordDialog';

export const Account: React.FC = () => {
  const { user: sessionUser, refresh, refreshAvatar } = useSession();

  const updateUserAvatarMutation = useMutation(updateUserAvatar, {
    onSuccess: () => {
      refreshAvatar?.();
    },
  });

  const updateUserNameMutation = useMutation(updateUserName, {
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">My profile</h3>
      </div>
      <Separator />
      <div className="flex">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="group relative flex h-fit items-center justify-center">
                <Avatar className="h-14 w-14">
                  <AvatarImage
                    id={`${sessionUser.id}-avatar`}
                    src={sessionUser.avatar as string}
                    alt="avatar-name"
                  />
                  <AvatarFallback className="text-2xl">
                    {sessionUser.name.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>

                <div className="absolute left-0 top-0 h-full w-full rounded-full bg-transparent group-hover:bg-muted-foreground/20">
                  <input
                    type="file"
                    className="absolute inset-0 h-full w-full opacity-0"
                    accept="image/*"
                    onChange={uploadAvatar}
                  ></input>
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Upload photo</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="ml-4 pt-3">
          <Input
            className="w-64"
            defaultValue={sessionUser.name}
            onBlur={(e) => toggleRenameUser(e)}
          />
          <Label className="text-xs text-muted-foreground" htmlFor="Preferred name">
            Your name will be displayed on contributions and mentions. You can change it anytime.
          </Label>
        </div>
      </div>
      <div>
        <h3 className="text-base font-medium">Account security</h3>
        <Separator className="my-2" />
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Email</Label>
              <div className="text-xs text-muted-foreground">{sessionUser.email}</div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Password</Label>
              <div className="text-xs text-muted-foreground">
                Set a permanent password to login to your account.
              </div>
            </div>
            <ChangePasswordDialog>
              <Button className="float-right" size={'sm'} variant={'outline'}>
                Change password
              </Button>
            </ChangePasswordDialog>
          </div>
        </div>
      </div>
    </div>
  );
};
