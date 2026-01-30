import { HelpCircle, MoreHorizontal, UserPlus } from '@teable/icons';
import { BaseNodeResourceType } from '@teable/openapi';
import {
  useBase,
  useIsHydrated,
  useIsTemplate,
  useIsTouchDevice,
  useView,
} from '@teable/sdk/hooks';
import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  ScrollBar,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from '@teable/ui-lib/shadcn';

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { Fragment, useEffect, useState } from 'react';
import { ShareBasePopover } from '@/features/app/components/collaborator/share/ShareBasePopover';
import { PublicOperateButton } from '@/features/app/components/PublicOperateButton';
import type { IBaseResourceTable } from '@/features/app/hooks/useBaseResource';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { tableConfig } from '@/features/i18n/table.config';
import { BaseNodeMore } from '../../base/base-side-bar/BaseNodeMore';
import { ExpandViewList } from '../../view/list/ExpandViewList';
import { ViewList } from '../../view/list/ViewList';
import { useLockedViewTipStore } from '../store';
import { AddView } from './AddView';
import { Collaborators } from './Collaborators';
import { LockedViewTip } from './LockedViewTip';
import { TableInfo } from './TableInfo';

const RightActions = ({ setIsEditing }: { setIsEditing?: (isEditing: boolean) => void }) => {
  const base = useBase();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);
  const { tableId } = useBaseResource() as IBaseResourceTable;
  const isTouchDevice = useIsTouchDevice();
  const isHydrated = useIsHydrated();
  const router = useRouter();
  const url = router.asPath;

  const collapsedTrigger = (
    <Button
      variant="ghost"
      size="xs"
      className="shrink-0 truncate font-normal @md/view-header:hidden"
    >
      <MoreHorizontal className="size-4" />
    </Button>
  );

  useEffect(() => {
    setOpen(false);
  }, [url, setOpen]);

  // Collapsed menu content (for small screens)
  const collapsedContent = isTouchDevice ? (
    // Touch device: Sheet
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{collapsedTrigger}</SheetTrigger>
      <SheetContent side="bottom" className="h-auto max-h-[80vh] overflow-y-auto rounded-t-lg p-0">
        <SheetHeader className="sticky top-0 z-10 flex h-12 items-center justify-center border-b bg-background text-lg font-medium">
          {t('common:actions.more')}
        </SheetHeader>
        <div className="pb-safe flex flex-col">
          <Collaborators className="flex border-b p-3" />
          <ShareBasePopover
            base={{
              name: base.name,
              role: base.role,
              id: base.id,
              enabledAuthority: base.enabledAuthority,
            }}
          >
            <Button
              variant="ghost"
              className="flex w-full items-center justify-start gap-3 border-b p-3"
            >
              <UserPlus className="size-4" />
              <span>{t('space:action.invite')}</span>
            </Button>
          </ShareBasePopover>
          <Button
            asChild
            variant="ghost"
            className="flex w-full items-center justify-start gap-3 border-b p-3"
          >
            <Link
              href={t('help.mainLink')}
              title={t('help.title')}
              target="_blank"
              rel="noreferrer"
            >
              <HelpCircle className="size-4" />
              <span>{t('help.title')}</span>
            </Link>
          </Button>

          <BaseNodeMore
            resourceType={BaseNodeResourceType.Table}
            resourceId={tableId}
            variant="list"
            onRename={() => {
              setOpen(false);
              setIsEditing?.(true);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  ) : (
    // Non-touch device: Popover
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{collapsedTrigger}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-40 p-0">
        <div className="flex flex-col">
          <Collaborators className="flex p-2" />
          <ShareBasePopover
            base={{
              name: base.name,
              role: base.role,
              id: base.id,
              enabledAuthority: base.enabledAuthority,
            }}
          >
            <Button variant="ghost" size="xs" className="flex justify-start">
              <UserPlus className="size-4" /> {t('space:action.invite')}
            </Button>
          </ShareBasePopover>
          <Button asChild variant="ghost" size="xs" className="flex justify-start">
            <a href={t('help.mainLink')} title={t('help.title')} target="_blank" rel="noreferrer">
              <HelpCircle className="size-4" /> {t('help.title')}
            </a>
          </Button>
          <BaseNodeMore
            resourceType={BaseNodeResourceType.Table}
            resourceId={tableId}
            onRename={() => {
              setOpen(false);
              setIsEditing?.(true);
            }}
          >
            <Button variant="ghost" size="xs" className="flex justify-start">
              <MoreHorizontal className="size-4" /> {t('common:actions.more')}
            </Button>
          </BaseNodeMore>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <>
      {/* Expanded layout for large screens (always visible on non-touch devices) */}
      <div className={cn('gap-2 md:gap-3', isTouchDevice ? 'hidden @md/view-header:flex' : 'flex')}>
        {isHydrated && <Collaborators className="flex" />}
        <div className="flex items-center gap-1">
          <ShareBasePopover
            base={{
              name: base.name,
              role: base.role,
              id: base.id,
              enabledAuthority: base.enabledAuthority,
            }}
          >
            <Button variant="default" className="mr-1 px-2 @md/view-header:px-3" size="sm">
              <UserPlus className="size-4" />
              <span className="hidden @md/view-header:inline">{t('space:action.invite')}</span>
            </Button>
          </ShareBasePopover>
          <Button asChild variant="ghost" className="w-7 p-0" size="xs">
            <Link
              href={t('help.mainLink')}
              title={t('help.title')}
              target="_blank"
              rel="noreferrer"
            >
              <HelpCircle className="size-4" />
            </Link>
          </Button>
          <BaseNodeMore
            resourceType={BaseNodeResourceType.Table}
            resourceId={tableId}
            onRename={() => setIsEditing?.(true)}
          >
            <Button className="w-7 p-0" variant="ghost" size="xs">
              <MoreHorizontal className="size-4" />
            </Button>
          </BaseNodeMore>
        </div>
      </div>

      {/* Collapsed menu for small screens (only on touch devices) */}
      {isTouchDevice && collapsedContent}
    </>
  );
};

export const TableHeader: React.FC = () => {
  const view = useView();
  const { visible } = useLockedViewTipStore();
  const isTemplate = useIsTemplate();
  const tipVisible = view?.isLocked && visible;
  const [isEditing, setIsEditing] = useState(false);
  return (
    <Fragment>
      <div
        className={cn(
          'flex h-12 shrink-0 flex-row items-center gap-2 pl-4 pr-2 @container/view-header',
          tipVisible && 'border-b'
        )}
      >
        <TableInfo className="shrink-0 grow-0" isEditing={isEditing} setIsEditing={setIsEditing} />
        <ExpandViewList />
        <ScrollArea className="h-[42px]">
          <div className="flex h-[42px] items-center gap-2">
            <ViewList />
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <AddView />
        <div className="grow basis-0"></div>
        {!isTemplate && <RightActions setIsEditing={setIsEditing} />}
        {isTemplate && (
          <div className="min-w-20">
            <PublicOperateButton />
          </div>
        )}
      </div>
      {tipVisible && <LockedViewTip />}
    </Fragment>
  );
};
