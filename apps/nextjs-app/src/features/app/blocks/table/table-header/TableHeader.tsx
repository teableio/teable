import { Copy, HelpCircle, MoreHorizontal, UserPlus } from '@teable/icons';
import { BaseNodeResourceType } from '@teable/openapi';
import {
  useBase,
  useIsHydrated,
  useIsReadOnlyPreview,
  useIsTouchDevice,
  useTable,
  useTablePermission,
  useTemplate,
  useView,
} from '@teable/sdk/hooks';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
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
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Info } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ShareBasePopover } from '@/features/app/components/collaborator/share/ShareBasePopover';
import { PublicOperateButton } from '@/features/app/components/PublicOperateButton';
import {
  normalizeResourceDescription,
  ResourceDescriptionDialog,
} from '@/features/app/components/ResourceDescription';
import type { IBaseResourceTable } from '@/features/app/hooks/useBaseResource';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { useEmbedMode } from '@/features/app/hooks/useEmbedMode';
import { useIsInIframe } from '@/features/app/hooks/useIsInIframe';
import { tableConfig } from '@/features/i18n/table.config';
import { BaseNodeMore } from '../../base/base-side-bar/BaseNodeMore';
import { ExpandViewList } from '../../view/list/ExpandViewList';
import { ViewList } from '../../view/list/ViewList';
import { useLockedViewTipStore } from '../store';
import { AddView } from './AddView';
import { Collaborators } from './Collaborators';
import { LockedViewTip } from './LockedViewTip';
import { TableInfo } from './TableInfo';

/**
 * Rename inside the native mobile app: the inline name input lives in the title block, which
 * embed mode hides (the app's own header shows the name), so the menu's "Rename" opens this.
 */
const TableRenameDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const table = useTable();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    const next = inputRef.current?.value.trim();
    if (next && next !== table?.name) table?.updateName(next);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>{t('table:table.rename')}</DialogTitle>
        </DialogHeader>
        <Input
          // Remounted per opening so it starts from the current name every time.
          key={String(open)}
          ref={inputRef}
          defaultValue={table?.name}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button size="sm" onClick={submit}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RightActions = ({ setIsEditing }: { setIsEditing?: (isEditing: boolean) => void }) => {
  const base = useBase();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);
  const { tableId } = useBaseResource() as IBaseResourceTable;
  const isTouchDevice = useIsTouchDevice();
  const isHydrated = useIsHydrated();
  const router = useRouter();
  const url = router.asPath;
  // Native mobile app: the title block (emoji, name, description) is hidden, so its two
  // editors reach the menu instead: rename opens a dialog, the description gets a row. Help
  // and invite are the app's own screens there.
  const isEmbed = useEmbedMode();
  const table = useTable();
  const tablePermission = useTablePermission();
  const canUpdateTable = Boolean(tablePermission['table|update']);
  const [renameOpen, setRenameOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const showDescription =
    isEmbed && (canUpdateTable || Boolean(normalizeResourceDescription(table?.description)));
  const onRename = () => {
    setOpen(false);
    if (isEmbed) setRenameOpen(true);
    else setIsEditing?.(true);
  };

  const collapsedTrigger = (
    <Button
      variant="ghost"
      size="icon-xs"
      className="shrink-0 truncate font-normal @md/view-header:hidden"
    >
      <MoreHorizontal className="size-4 shrink-0" />
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
          {!isEmbed && (
            <ShareBasePopover
              base={{
                name: base.name,
                role: base.role,
                id: base.id,
                spaceId: base.spaceId,
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
          )}
          {!isEmbed && (
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
          )}
          {showDescription && (
            <Button
              variant="ghost"
              className="flex w-full items-center justify-start gap-3 border-b p-3"
              onClick={() => {
                setOpen(false);
                setDescriptionOpen(true);
              }}
            >
              <Info className="size-4" />
              <span>{t('common:resourceDescription.nodeDescription')}</span>
            </Button>
          )}

          <BaseNodeMore
            resourceType={BaseNodeResourceType.Table}
            resourceId={tableId}
            variant="list"
            onRename={onRename}
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
              spaceId: base.spaceId,
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
            onRename={onRename}
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
              spaceId: base.spaceId,
              enabledAuthority: base.enabledAuthority,
            }}
          >
            <Button variant="default" className="me-1 px-2 @md/view-header:px-3" size="sm">
              <UserPlus className="size-4" />
              <span className="hidden @md/view-header:inline">{t('space:action.invite')}</span>
            </Button>
          </ShareBasePopover>
          <Button asChild variant="ghost" size="icon-xs">
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
            onRename={onRename}
          >
            <Button variant="ghost" size="icon-xs">
              <MoreHorizontal className="size-4" />
            </Button>
          </BaseNodeMore>
        </div>
      </div>

      {/* Collapsed menu for small screens (only on touch devices) */}
      {isTouchDevice && collapsedContent}

      {isEmbed && <TableRenameDialog open={renameOpen} onOpenChange={setRenameOpen} />}
      {showDescription && (
        <ResourceDescriptionDialog
          key={table?.id}
          description={table?.description}
          open={descriptionOpen}
          onOpenChange={setDescriptionOpen}
          onSave={async (description) => {
            await table?.updateDescription(description);
          }}
          readOnly={!canUpdateTable}
          errorLogName="table"
        />
      )}
    </>
  );
};

export const TableHeader: React.FC = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const view = useView();
  const { visible } = useLockedViewTipStore();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const template = useTemplate();
  const isInIframe = useIsInIframe();
  // The native mobile app's header shows the table's name and emoji: no title block there.
  const isEmbed = useEmbedMode();
  // Only show PublicOperateButton for real templates, not for share mode
  const isRealTemplate = !!template && !isInIframe;
  const tipVisible = view?.isLocked && visible;
  const [isEditing, setIsEditing] = useState(false);
  return (
    <Fragment>
      <div
        className={cn(
          'flex h-12 shrink-0 flex-row items-center gap-2 ps-4 pe-2 @container/view-header',
          tipVisible && 'border-b'
        )}
      >
        {!isEmbed && (
          <TableInfo
            className="shrink-0 grow-0"
            isEditing={isEditing}
            setIsEditing={setIsEditing}
          />
        )}
        <ExpandViewList />
        <ScrollArea className="h-[42px]">
          <div className="flex h-[42px] items-center gap-2">
            <ViewList />
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <AddView />
        <div className="grow basis-0"></div>
        {!isReadOnlyPreview && <RightActions setIsEditing={setIsEditing} />}
        {isRealTemplate && (
          <div className="flex min-w-20 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="text-[13px] font-normal"
              onClick={() => {
                const link = `${window.location.origin}/t/${template!.id}`;
                navigator.clipboard.writeText(link);
                toast.success(t('common:actions.copyLink'));
              }}
            >
              <Copy className="size-4" />
              {t('common:actions.copyLink')}
            </Button>
            <PublicOperateButton />
          </div>
        )}
      </div>
      {tipVisible && <LockedViewTip />}
    </Fragment>
  );
};
