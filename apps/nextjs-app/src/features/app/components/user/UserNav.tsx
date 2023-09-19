import { useMutation } from '@tanstack/react-query';
import { AuthApi } from '@teable-group/sdk';
import { useSession } from '@teable-group/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import React from 'react';

export const UserNav: React.FC<React.PropsWithChildren> = (props) => {
  const { children } = props;
  const router = useRouter();
  const { user } = useSession();
  const { mutateAsync: loginOut, isLoading } = useMutation({
    mutationFn: AuthApi.signout,
  });

  const loginOutClick = async () => {
    await loginOut();
    router.push('/auth/login');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.name}</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={loginOutClick} disabled={isLoading}>
          Log out
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
