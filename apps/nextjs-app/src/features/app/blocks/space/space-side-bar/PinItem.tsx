import { ViewType } from '@teable/core';
import { Component, Database, Table2 } from '@teable/icons';
import type { IGetPinListVo } from '@teable/openapi';
import { BaseNodeResourceType, PinType } from '@teable/openapi';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { BaseNodeResourceIconMap, getNodeUrl } from '../../base/base-node/hooks';
import { VIEW_ICON_MAP } from '../../view/constant';
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
          <Link href={`/base/${pin.parentBaseId}/table/${pin.id}`} title={pin.name}>
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
      if (!pin.viewMeta) {
        return;
      }
      const ViewIcon = VIEW_ICON_MAP[pin.viewMeta.type];
      return (
        <ItemButton className={className}>
          <Link
            href={
              getNodeUrl({
                baseId: pin.parentBaseId!,
                resourceType: BaseNodeResourceType.Table,
                resourceId: pin.viewMeta.tableId,
                viewId: pin.id,
              }) ?? {}
            }
            title={pin.name}
          >
            {pin.viewMeta?.type === ViewType.Plugin && pin.viewMeta?.pluginLogo ? (
              <img className="mr-1 size-4 shrink-0" src={pin.viewMeta?.pluginLogo} alt={pin.name} />
            ) : (
              <ViewIcon className="size-4 shrink-0" />
            )}
            <p className="grow truncate">{pin.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    case PinType.Dashboard: {
      const IconComponent = BaseNodeResourceIconMap.dashboard;
      return (
        <ItemButton className={className}>
          <Link
            href={
              getNodeUrl({
                baseId: pin.parentBaseId!,
                resourceType: BaseNodeResourceType.Dashboard,
                resourceId: pin.id,
              }) ?? {}
            }
            title={pin.name}
          >
            <IconComponent className="size-4 shrink-0" />
            <p className="grow truncate">{pin.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    case PinType.Workflow: {
      const IconComponent = BaseNodeResourceIconMap.workflow;
      return (
        <ItemButton className={className}>
          <Link
            href={
              getNodeUrl({
                baseId: pin.parentBaseId!,
                resourceType: BaseNodeResourceType.Workflow,
                resourceId: pin.id,
              }) ?? {}
            }
            title={pin.name}
          >
            <IconComponent className="size-4 shrink-0" />
            <p className="grow truncate">{pin.name}</p>
            {right}
          </Link>
        </ItemButton>
      );
    }
    case PinType.App: {
      const IconComponent = BaseNodeResourceIconMap.app;
      return (
        <ItemButton className={className}>
          <Link
            href={
              getNodeUrl({
                baseId: pin.parentBaseId!,
                resourceType: BaseNodeResourceType.App,
                resourceId: pin.id,
              }) ?? {}
            }
            title={pin.name}
          >
            <IconComponent className="size-4 shrink-0" />
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
