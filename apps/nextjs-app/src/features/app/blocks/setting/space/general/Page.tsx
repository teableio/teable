import { ArrowLeft } from '@teable/icons';
import { Button, Input, Label, Progress, Separator } from '@teable/ui-lib';
import Link from 'next/link';
import { useRouter } from 'next/router';
import React, { type FC } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';

export const GeneralPage: FC = () => {
  const router = useRouter();
  const { spaceId } = router.query as { spaceId: string };

  const backSpace = () => {
    router.push({
      pathname: '/space/[spaceId]',
      query: { spaceId },
    });
  };

  return (
    <div>
      <div>
        <Button size="sm" type="button" variant="ghost" onClick={backSpace}>
          <ArrowLeft />
          Go to Space
        </Button>
      </div>
      <Separator className="my-2" />
      <div className="ml-4 space-y-2 pt-3">
        <Label className="text-lg font-medium">Space name</Label>
        <div className="flex gap-2">
          <Input className="w-64" defaultValue={'1'} />
          <Button className="">Rename</Button>
        </div>
      </div>
      <div className="ml-4 space-y-2 pt-3">
        <Label className="text-lg font-medium">Your Free workspace summary</Label>
        <Separator className="my-2" />
        <div>
          <div className="my-4 w-7/12">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h3 className="text-sm">Creators and editors</h3>
              </div>
              <span className="text-sm">1 of ∞</span>
            </div>
            <div className="mt-2">
              <Progress value={1} max={Number.MAX_VALUE} />
            </div>
          </div>
          <div className="my-4 w-7/12">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h3 className="text-sm">Records</h3>
              </div>
              <span className="text-sm">36846 of ∞</span>
            </div>
            <div className="mt-2">
              <Progress value={36846} max={Number.MAX_VALUE} />
            </div>
          </div>
          <div className="my-4 w-7/12">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h3 className="text-sm">Attachments</h3>
              </div>
              <span className="text-sm">35.23GB of ∞</span>
            </div>
            <div className="mt-2">
              <Progress value={35.23} max={Number.MAX_VALUE} />
            </div>
          </div>
        </div>
      </div>
      {/* 2. */}
      <div className="ml-4 space-y-2 pt-3">
        <Label className="text-lg font-medium">Billable collaborators</Label>
        <Separator className="my-2" />
        <div>
          {/* 123 */}
          <div className="my-5 flex">
            <div className="flex w-7/12 items-center">
              <UserAvatar user={{ name: 'Teable' }} className="size-9" />
              <div className="ml-2 flex flex-1 flex-col space-y-1">
                <p className="text-sm font-medium leading-none">Teable</p>
                <p className="text-xs leading-none text-muted-foreground">xxx@teable.io</p>
              </div>
            </div>
            <div className="flex flex-col items-end justify-center">
              <div className="flex text-left text-xs">
                <span className="">Workspace collaborator</span>
                <span className="">(Owner)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* 3. */}
      <div className="ml-4 space-y-2 pt-3">
        <Label className="text-lg font-medium">Usage</Label>
        <Separator className="my-2" />
        {/* 456 */}
        {/* w-6/12 */}
        <div className="my-5 flex">
          <Link className="flex w-7/12 items-center" href={'https://baidu.com'}>
            <Emoji className="w-7 shrink-0" emoji={'🤖'} size={30} />
            <div className="ml-2 flex flex-1 flex-col space-y-1">
              <p className="text-sm font-medium leading-none">Test Space Name</p>
              <p className="text-xs leading-none text-muted-foreground">Last activity today</p>
            </div>
          </Link>
          <div className="flex flex-col items-end justify-center">
            {/* 1 */}
            <div className="flex items-center justify-center">
              <div className="mr-1 flex-auto text-xs leading-none text-muted-foreground">
                143 / 1,000 Records
              </div>
              <Progress className="w-16" value={10} />
            </div>
            {/*  2 */}
            <div className="flex items-center justify-center">
              <div className="mr-1 flex-auto text-xs leading-none text-muted-foreground">
                0MB / 1GB Attachment space
              </div>
              <Progress className="w-16" value={10} />
            </div>
            {/*  3 */}
            <div className="flex items-center justify-center">
              <div className="mr-1 flex-auto text-xs leading-none text-muted-foreground">
                3 / 0 Extensions
              </div>
              <Progress className="w-16" value={10} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
