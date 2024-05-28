import { Component } from '@teable/icons';
import { PinType, type IGetSpaceVo } from '@teable/openapi';
import Link from 'next/link';
import { useRef } from 'react';
import { useMount } from 'react-use';
import { ItemButton } from './ItemButton';
import { StarButton } from './StarButton';

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
    <ItemButton className="group" isActive={isActive} ref={ref}>
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
        <StarButton id={id} type={PinType.Space} />
      </Link>
    </ItemButton>
  );
};
