import { Component, Database } from '@teable/icons';
import type { IGetPinListVo, IGetBaseVo, IGetSpaceVo } from '@teable/openapi';
import { PinType } from '@teable/openapi';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { ItemButton } from './ItemButton';

interface IPinItemProps {
  className?: string;
  right?: React.ReactNode;
  pin: IGetPinListVo[number];
  baseMap: { [key in string]: IGetBaseVo };
  spaceMap: { [key in string]: IGetSpaceVo };
}

export const PinItem = (props: IPinItemProps) => {
  const { className, pin, baseMap, spaceMap, right } = props;
  const router = useRouter();

  switch (pin.type) {
    case PinType.Space: {
      const space = spaceMap[pin.id];
      if (!space) {
        return <div />;
      }
      return (
        <ItemButton isActive={router.query.spaceId === space.id} className={className}>
          <Link
            className="gap-1"
            href={{
              pathname: '/space/[spaceId]',
              query: {
                spaceId: space.id,
              },
            }}
            title={space.name}
          >
            <Component className="size-4 shrink-0" />
            <p className="grow truncate">{space.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    case PinType.Base: {
      const base = baseMap[pin.id];
      if (!base) {
        return <div />;
      }
      return (
        <ItemButton className={className}>
          <Link
            className="gap-1"
            href={{
              pathname: '/base/[baseId]',
              query: {
                baseId: base.id,
              },
            }}
            title={base.name}
          >
            {base.icon ? (
              <div className="size-4 shrink-0 text-[3.5rem] leading-none">
                <Emoji emoji={base.icon} size={16} />
              </div>
            ) : (
              <Database className="size-4 shrink-0" />
            )}
            <p className="grow truncate">{base.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    default:
      return <div>unknown</div>;
  }
};
