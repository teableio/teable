import { ArrowUpRight, MoreHorizontal } from '@teable/icons';
import { useIsReadOnlyPreview, useTableId, useTablePermission, useView } from '@teable/sdk/hooks';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useBaseNodeContext } from '@/features/app/blocks/base/base-node/hooks/useBaseNodeContext';
import { useSharedNodeIds } from '@/features/app/blocks/base/base-side-bar/BaseNodeShareIndicator';
import { tableConfig } from '@/features/i18n/table.config';
import { SearchButton } from '../search/SearchButton';
import { PersonalViewSwitch } from './components';
import { UndoRedoButtons } from './components/UndoRedoButtons';
import { ToolBarButton } from './ToolBarButton';
import { UnifiedShareDialog } from './UnifiedShareDialog';

const ShareButton = ({
  textClassName,
  buttonClassName,
  foldButton,
}: {
  textClassName?: string;
  buttonClassName?: string;
  foldButton?: boolean;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permission = useTablePermission();
  const view = useView();
  const tableId = useTableId();
  const { treeItems } = useBaseNodeContext();
  const sharedNodeIds = useSharedNodeIds();
  const [open, setOpen] = useState(false);

  const isNodeShared = useMemo(() => {
    if (!tableId) return false;
    const entry = Object.entries(treeItems).find(([, item]) => item.resourceId === tableId);
    return entry ? sharedNodeIds.has(entry[0]) : false;
  }, [tableId, treeItems, sharedNodeIds]);

  const isActive = !!view?.enableShare || isNodeShared;
  const text = t('table:toolbar.others.share.label');

  return (
    <>
      <ToolBarButton
        isActive={isActive}
        text={text}
        textClassName={textClassName}
        className={cn(buttonClassName, { 'w-full justify-start rounded-sm': foldButton })}
        disabled={!permission['view|update']}
        onClick={() => setOpen(true)}
      >
        <ArrowUpRight className="size-4 shrink-0" />
      </ToolBarButton>
      <UnifiedShareDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

const OthersList = ({
  classNames,
  className,
  foldButton,
}: {
  classNames?: { textClassName?: string; buttonClassName?: string };
  className?: string;
  foldButton?: boolean;
}) => {
  const { textClassName, buttonClassName } = classNames ?? {};

  return (
    <div className={cn('gap-1 flex items-center', className)}>
      <ShareButton
        textClassName={textClassName}
        buttonClassName={buttonClassName}
        foldButton={foldButton}
      />
      {!foldButton && <div className="mx-1 h-4 w-px shrink-0 bg-border" />}
      <PersonalViewSwitch
        textClassName={textClassName}
        buttonClassName={cn(buttonClassName, { 'w-full justify-start pl-2': foldButton })}
      />
    </div>
  );
};

const OthersMenu = ({ className }: { className?: string }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={'ghost'}
          size={'icon-xs'}
          className={cn('font-normal shrink-0 truncate', className)}
        >
          <MoreHorizontal className="size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-40 p-1">
        <OthersList
          className="flex w-full flex-col items-start"
          classNames={{ textClassName: 'inline', buttonClassName: 'justify-start rounded-none' }}
          foldButton={true}
        />
      </PopoverContent>
    </Popover>
  );
};

export const Others: React.FC = () => {
  const isReadOnlyPreview = useIsReadOnlyPreview();
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end pl-6 md:gap-0',
        'bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,hsl(var(--background))_5%)]',
        'dark:bg-[linear-gradient(90deg,rgba(0,0,0,0)_0%,hsl(var(--background))_5%)]'
      )}
    >
      <SearchButton className="size-7 shrink-0" />
      {!isReadOnlyPreview && (
        <>
          <div className="mx-1 h-4 w-px shrink-0 bg-border"></div>
          <UndoRedoButtons />
          <div className="mx-1 h-4 w-px shrink-0 bg-border"></div>
          <OthersList
            className="hidden @md/toolbar:flex"
            classNames={{ textClassName: '@2xl/toolbar:inline' }}
          />
          <OthersMenu className="@md/toolbar:hidden" />
        </>
      )}
    </div>
  );
};
