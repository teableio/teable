import { useMutation } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { Pencil, Trash2, Export, Copy, Lock, Star } from '@teable/icons';
import { BaseNodeResourceType, duplicateView } from '@teable/openapi';
import {
  useBaseId,
  useIsTemplate,
  usePersonalView,
  useTableId,
  useTablePermission,
  useView,
} from '@teable/sdk/hooks';
import type { IViewInstance } from '@teable/sdk/model';
import { Spin } from '@teable/ui-lib/base';
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
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useRef, Fragment, useEffect, useCallback, useMemo } from 'react';
import { useIsInIframe } from '@/features/app/hooks/useIsInIframe';
import { useDownload } from '../../../hooks/useDownLoad';
import { getNodeUrl } from '../../base/base-node/hooks';
import { usePinMap } from '../../space/usePinMap';
import { VIEW_ICON_MAP } from '../constant';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import { PinViewItem } from './PinViewItem';
import { useDeleteView } from './useDeleteView';

interface IProps {
  view: IViewInstance;
  removable: boolean;
  isActive: boolean;
  onEdit: (value: boolean) => void;
}

export const ViewListItem: React.FC<IProps> = ({ view, removable, isActive, onEdit }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [open, _setOpen] = useState(false);
  const tableId = useTableId() as string;
  const baseId = useBaseId() as string;
  const router = useRouter();
  const deleteView = useDeleteView(view.id);
  const permission = useTablePermission();
  const { t } = useTranslation('table');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewItemRef = useRef<HTMLDivElement>(null);
  const { highlightedViewId } = useGridSearchStore();
  const isHighlighted = highlightedViewId === view.id;
  const isTemplate = useIsTemplate();
  const { personalViewCommonQuery } = usePersonalView();
  const viewData = useView();

  const setOpen = useCallback(
    (value: boolean) => {
      if (value && isTemplate) {
        return;
      }
      _setOpen(value);
    },
    [isTemplate, _setOpen]
  );
  const { mutateAsync: duplicateViewFn, isPending: isDuplicateViewLoading } = useMutation({
    mutationFn: () => duplicateView(tableId, view.id),
    onSuccess: (data) => {
      const { id } = data?.data || {};
      if (!id) {
        return;
      }
      const url = getNodeUrl({
        baseId,
        resourceType: BaseNodeResourceType.Table,
        resourceId: tableId,
        viewId: id,
      });
      if (url) {
        router.push(url, undefined, { shallow: true });
      }
    },
  });
  const downloadUrl = useMemo(() => {
    const { ignoreViewQuery, filter, orderBy, groupBy, projection } = personalViewCommonQuery || {};

    if (!ignoreViewQuery) {
      return `/api/export/${tableId}?viewId=${viewData?.id}`;
    }

    const params = new URLSearchParams();
    params.set('viewId', viewData?.id ?? '');
    params.set('ignoreViewQuery', 'true');

    filter && params.set('filter', JSON.stringify(filter));
    orderBy && !viewData?.sort?.manualSort && params.set('orderBy', JSON.stringify(orderBy));
    groupBy && params.set('groupBy', JSON.stringify(groupBy));
    projection?.forEach((field) => params.append('projection[]', field));

    if (viewData?.columnMeta) {
      const columnMetaWithOrderOnly = Object.fromEntries(
        Object.entries(viewData.columnMeta).map(([fieldId, meta]) => [
          fieldId,
          { order: meta.order },
        ])
      );
      params.set('columnMeta', JSON.stringify(columnMetaWithOrderOnly));
    }

    return `/api/export/${tableId}?${params.toString()}`;
  }, [
    personalViewCommonQuery,
    tableId,
    viewData?.columnMeta,
    viewData?.id,
    viewData?.sort?.manualSort,
  ]);

  const { trigger } = useDownload({
    downloadUrl,
    key: 'view',
  });

  const { resetSearchHandler } = useGridSearchStore();
  const isInIframe = useIsInIframe();

  useEffect(() => {
    if (isActive && !isInIframe) {
      setTimeout(() => {
        viewItemRef.current?.scrollIntoView({
          behavior: 'smooth',
        });
      }, 0);
    }
  }, [isActive, isInIframe]);

  const navigateHandler = () => {
    resetSearchHandler?.();
    const url = getNodeUrl({
      baseId,
      resourceType: BaseNodeResourceType.Table,
      resourceId: tableId,
      viewId: view.id,
    });
    if (url) {
      router.push(url, undefined, { shallow: true });
    }
  };
  const ViewIcon = VIEW_ICON_MAP[view.type];
  const pinMap = usePinMap();
  const isPin = pinMap?.[view.id];

  const showViewMenu = !isEditing;

  const commonPart = (
    <div className="relative flex w-full items-center overflow-hidden px-0.5">
      {view.type === ViewType.Plugin ? (
        <img className="mr-1 size-4 shrink-0" src={view.options.pluginLogo} alt={view.name} />
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
            onEdit(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.currentTarget.value && e.currentTarget.value !== view.name) {
                view.updateName(e.currentTarget.value);
              }
              setIsEditing(false);
              onEdit(false);
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
        'flex h-7 max-w-52 items-center overflow-hidden rounded-md p-1 text-sm hover:bg-accent',
        {
          'bg-accent': isActive && !isHighlighted,
          'bg-orange-300/40 hover:bg-orange-300/40': isHighlighted,
        }
      )}
      onDoubleClick={() => {
        if (permission['view|update']) {
          setIsEditing(true);
          onEdit(true);
        }
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
          className={cn('m-0 flex w-full rounded-sm hover:bg-transparent p-0', {
            'bg-secondary': isActive && !isHighlighted,
            'bg-orange-300/40': isHighlighted,
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
                    onEdit(true);
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
                      await duplicateViewFn();
                      setOpen(false);
                    }}
                    className="flex justify-start"
                    disabled={isDuplicateViewLoading}
                  >
                    <Copy className="size-3" />
                    {t('view.action.duplicate')}
                    {isDuplicateViewLoading && <Spin className="size-3 shrink-0" />}
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
