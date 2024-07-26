import { HelpCircle } from '@teable/icons';
import { useSession } from '@teable/sdk/hooks';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import Head from 'next/head';
import React from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';

interface ISettingRight {
  title?: string | React.ReactNode;
  children: React.ReactNode;
  helpLink?: string;
}

export const SettingRight = (props: ISettingRight) => {
  const { title, children, helpLink } = props;
  const { user } = useSession();
  return (
    <div className="size-full">
      {typeof title === 'string' && (
        <Head>
          <title>{title}</title>
        </Head>
      )}
      <div className="flex h-full flex-1 flex-col">
        <div className="flex h-16 items-center gap-x-4 px-8">
          {typeof title === 'string' ? <h2 className="flex-1 text-base">{title}</h2> : title}
          {helpLink && (
            <Button variant="link" asChild>
              <a href={helpLink} target="_blank" rel="noreferrer">
                <HelpCircle />
              </a>
            </Button>
          )}
          <UserAvatar user={user} />
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto px-8">{children}</div>
      </div>
    </div>
  );
};
