import { Component } from '@teable/icons';
import type { IGetSpaceVo } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRef } from 'react';
import { useMount } from 'react-use';

interface IProps {
  space: IGetSpaceVo;
  isActive: boolean;
}

export const SpaceItem: React.FC<IProps> = ({ space, isActive }) => {
  const { id, name } = space;
  const ref = useRef<HTMLButtonElement>(null);

  useMount(() => {
    isActive && ref.current?.scrollIntoView({ block: 'center' });
  });

  return (
    <Button
      ref={ref}
      variant={'ghost'}
      size={'xs'}
      asChild
      className={cn('my-[2px] w-full px-2 justify-start text-sm font-normal gap-2 group', {
        'bg-secondary': isActive,
      })}
    >
      <Link
        href={{
          pathname: '/space/[spaceId]',
          query: {
            spaceId: id,
          },
        }}
        title={name}
      >
        <Component className="size-4 shrink-0" />
        <p className="grow truncate">{' ' + name}</p>
      </Link>
    </Button>
  );
};
