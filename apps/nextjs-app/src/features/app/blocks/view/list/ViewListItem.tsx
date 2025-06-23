import { ViewType } from '@teable/core';
import { Pencil, Trash2, Export, Copy, Lock, Star } from '@teable/icons';
import { useTableId, useTablePermission } from '@teable/sdk/hooks';
import type { IViewInstance } from '@teable/sdk/model';
import {
  Button,
  Separator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  PopoverAnchor,
} from '@teable/ui-lib/shadcn';
import { Input } from '@teable/ui-lib/shadcn/ui/input';
import { Unlock } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useRef, Fragment, useEffect } from 'react';
import { useDownload } from '../../../hooks/useDownLoad';
import { usePinMap } from '../../space/usePinMap';
import { VIEW_ICON_MAP } from '../constant';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import { PinViewItem } from './PinViewItem';
import { useDeleteView } from './useDeleteView';
import { useDuplicateView } from './useDuplicateView';

interface IProps {
  view: IViewInstance;
  removable: boolean;
  isActive: boolean;
}

export const ViewListItem: React.FC<IProps> = ({ view, removable, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const tableId = useTableId();
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const duplicateView = useDuplicateView(view);
  const deleteView = useDeleteView(view.id);
  const permission = useTablePermission();
  const { t } = useTranslation('table');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewItemRef = useRef<HTMLDivElement>(null);
  const { trigger } = useDownload({
    downloadUrl: `/api/export/${tableId}?viewId=${view.id}`,
    key: 'view',
  });
  const { resetSearchHandler } = useGridSearchStore();

  useEffect(() => {
    isActive &&
      setTimeout(() => {
        viewItemRef.current?.scrollIntoView({
          behavior: 'smooth',
        });
      }, 0);
  }, [isActive]);

  const navigateHandler = () => {
    resetSearchHandler?.();
    router.push(
      {
        pathname: '/base/[baseId]/[tableId]/[viewId]',
        query: { baseId, tableId: tableId, viewId: view.id },
      },
      undefined,
      { shallow: Boolean(view.id) }
    );
  };
  const ViewIcon = VIEW_ICON_MAP[view.type];
  const pinMap = usePinMap();
  const isPin = pinMap?.[view.id];

  const showViewMenu = !isEditing;

  const commonPart = (
    <div className="relative flex w-full items-center overflow-hidden px-0.5">
      {view.type === ViewType.Plugin ? (
        <Image
          className="mr-1 size-4 shrink-0"
          width={16}
          height={16}
          src={view.options.pluginLogo}
          alt={view.name}
        />
      ) : (
        <Fragment>
          {view.isLocked && <Lock className="mr-[2px] size-4 shrink-0" />}
          <ViewIcon className="mr-1 size-4 shrink-0" />
        </Fragment>
      )}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div className="truncate text-xs font-medium leading-5">{view.name}</div>
      </div>
      {isPin && <Star className="ml-1 size-4 shrink-0 fill-yellow-400 text-yellow-400" />}
      {isEditing && (
        <Input
          type="text"
          placeholder="name"
          defaultValue={view.name}
          className="absolute left-0 top-0 size-full py-0 text-xs focus-visible:ring-transparent focus-visible:ring-offset-0"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onBlur={(e) => {
            if (e.target.value && e.target.value !== view.name) {
              view.updateName(e.target.value);
            }
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.currentTarget.value && e.currentTarget.value !== view.name) {
                view.updateName(e.currentTarget.value);
              }
              setIsEditing(false);
            }
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );

  return (
    <div
      ref={viewItemRef}
      role="button"
      tabIndex={0}
      className={cn(
        'flex h-7 max-w-52 items-center overflow-hidden rounded-md bg-popover p-1 text-sm hover:bg-secondary',
        {
          'bg-secondary': isActive,
        }
      )}
      onDoubleClick={() => {
        permission['view|update'] && setIsEditing(true);
      }}
      onKeyDown={(e) => {
        if (isEditing) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          navigateHandler();
        }
      }}
      onClick={() => {
        if (isEditing) {
          return;
        }
        navigateHandler();
      }}
      onContextMenu={() => showViewMenu && setOpen(true)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          size="xs"
          className={cn('m-0 flex w-full rounded-sm p-0', {
            'bg-secondary': isActive,
          })}
        >
          {isActive && showViewMenu ? (
            <PopoverTrigger asChild>{commonPart}</PopoverTrigger>
          ) : (
            <PopoverAnchor asChild>{commonPart}</PopoverAnchor>
          )}
        </Button>
        {open && (
          <PopoverContent className="w-auto p-1">
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
            <div className="flex flex-col" onClick={(ev) => ev.stopPropagation()}>
              {permission['view|update'] && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setIsEditing(true);
                  }}
                  className="flex justify-start"
                >
                  <Pencil className="size-3 shrink-0" />
                  {t('view.action.rename')}
                </Button>
              )}
              {view.type === 'grid' && permission['table|export'] && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    trigger?.();
                  }}
                  className="flex justify-start"
                >
                  <Export className="size-3 shrink-0" />
                  {t('import.menu.downAsCsv')}
                </Button>
              )}
              {permission['view|create'] && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      await duplicateView();
                      setOpen(false);
                    }}
                    className="flex justify-start"
                  >
                    <Copy className="size-3" />
                    {t('view.action.duplicate')}
                  </Button>
                </>
              )}
              {permission['view|update'] && (
                <>
                  <Separator className="my-0.5" />
                  <Button
                    size="xs"
                    variant="ghost"
                    className="flex justify-start"
                    onClick={(e) => {
                      e.preventDefault();
                      view.updateLocked(!view.isLocked);
                    }}
                  >
                    {view.isLocked ? (
                      <Unlock className="size-3 shrink-0" />
                    ) : (
                      <Lock className="size-3 shrink-0" />
                    )}
                    {view.isLocked ? t('view.action.unlock') : t('view.action.lock')}
                  </Button>
                </>
              )}
              <PinViewItem viewId={view.id} />
              {permission['view|delete'] && (
                <>
                  <Separator className="my-0.5" />
                  <Button
                    size="xs"
                    disabled={!removable}
                    variant="ghost"
                    className="flex justify-start text-red-500"
                    onClick={(e) => {
                      e.preventDefault();
                      deleteView();
                    }}
                  >
                    <Trash2 className="size-3 shrink-0" />
                    {t('view.action.delete')}
                  </Button>
                </>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>
      <iframe ref={iframeRef} title="This for export csv download" style={{ display: 'none' }} />
    </div>
  );
};
