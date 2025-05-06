import { ViewType } from '@teable/core';
import { Component, Database, Table2 } from '@teable/icons';
import type { IGetPinListVo } from '@teable/openapi';
import { PinType } from '@teable/openapi';
import { ViewIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { ItemButton } from './ItemButton';

interface IPinItemProps {
  className?: string;
  right?: React.ReactNode;
  pin: IGetPinListVo[number];
}

export const PinItem = (props: IPinItemProps) => {
  const { className, pin, right } = props;
  const router = useRouter();

  switch (pin.type) {
    case PinType.Space: {
      return (
        <ItemButton isActive={router.query.spaceId === pin.id} className={className}>
          <Link
            className="gap-1"
            href={{
              pathname: '/space/[spaceId]',
              query: {
                spaceId: pin.id,
              },
            }}
            title={pin.name}
          >
            <Component className="size-4 shrink-0" />
            <p className="grow truncate">{pin.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    case PinType.Base: {
      return (
        <ItemButton className={className}>
          <Link
            className="gap-1"
            href={{
              pathname: '/base/[baseId]',
              query: {
                baseId: pin.id,
              },
            }}
            title={pin.name}
          >
            {pin.icon ? (
              <div className="size-4 shrink-0 text-[3.5rem] leading-none">
                <Emoji emoji={pin.icon} size={16} />
              </div>
            ) : (
              <Database className="size-4 shrink-0" />
            )}
            <p className="grow truncate">{pin.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    case PinType.Table: {
      return (
        <ItemButton className={className}>
          <Link
            href={{
              pathname: '/base/[baseId]/table/[tableId]',
              query: { baseId: pin.parentBaseId, tableId: pin.id },
            }}
            title={pin.name}
          >
            {pin.icon ? (
              <div className="size-4 shrink-0 text-[3.5rem] leading-none">
                <Emoji emoji={pin.icon} size={16} />
              </div>
            ) : (
              <Table2 className="size-4 shrink-0" />
            )}
            <p className="grow truncate">{pin.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    case PinType.View: {
      return (
        <ItemButton className={className}>
          <Link href={{ pathname: '/view/[viewId]', query: { viewId: pin.id } }} title={pin.name}>
            <ViewIcon className="size-4 shrink-0" />
            {pin.viewMeta?.type === ViewType.Plugin && pin.viewMeta?.pluginLogo ? (
              <Image
                className="mr-1 size-4 shrink-0"
                width={16}
                height={16}
                src={pin.viewMeta?.pluginLogo}
                alt={pin.name}
              />
            ) : (
              <ViewIcon className="size-4 shrink-0" />
            )}
            <p className="grow truncate">{pin.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }

    default:
      return <div>unknown</div>;
  }
};
