import {
  HelpCircle,
  History,
  MoreHorizontal,
  Puzzle,
  Settings,
  Trash2,
  UserPlus,
} from '@teable/icons';
import { RecordHistory } from '@teable/sdk/components/expand-record/RecordHistory';
import { useBase, useBasePermission, useIsHydrated, useTableId, useView } from '@teable/sdk/hooks';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { Fragment, useState } from 'react';
import { BaseCollaboratorModalTrigger } from '@/features/app/components/collaborator-manage/base/BaseCollaboratorModal';
import { tableConfig } from '@/features/i18n/table.config';
import { usePluginPanelStorage } from '../../../components/plugin-panel/hooks/usePluginPanelStorage';
import { TableTrash } from '../../trash/components/TableTrash';
import { TableTrashDialog } from '../../trash/components/TableTrashDialog';
import { ExpandViewList } from '../../view/list/ExpandViewList';
import { ViewList } from '../../view/list/ViewList';
import { useLockedViewTipStore } from '../store';
import { AddView } from './AddView';
import { Collaborators } from './Collaborators';
import { LockedViewTip } from './LockedViewTip';
import { TableInfo } from './TableInfo';

const RightList = ({
  className,
  buttonClassName,
}: {
  className?: string;
  buttonClassName?: string;
}) => {
  const router = useRouter();
  const base = useBase();
  const tableId = useTableId();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const basePermission = useBasePermission();
  const isHydrated = useIsHydrated();

  const hasTableHistoryPermission = basePermission?.['table_record_history|read'];
  const hasTableTrashPermission = basePermission?.['table|trash_read'];

  const [isHistoryDialogOpen, setHistoryDialogOpen] = useState(false);
  const [isTrashDialogOpen, setTrashDialogOpen] = useState(false);
  const { toggleVisible: togglePluginPanel } = usePluginPanelStorage(tableId!);

  const onRecordClick = (recordId: string) => {
    router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, recordId },
      },
      undefined,
      {
        shallow: true,
      }
    );
  };

  return (
    <div className={cn('flex', className)}>
      {isHydrated && <Collaborators className="flex" />}
      <div className="flex">
        {(hasTableHistoryPermission || hasTableTrashPermission) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className={cn('flex', buttonClassName)}>
                <History className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              {hasTableHistoryPermission && (
                <DropdownMenuItem onSelect={() => setHistoryDialogOpen(true)}>
                  <History className="mr-1 size-4" />
                  {t('table:table.tableRecordHistory')}
                </DropdownMenuItem>
              )}
              {hasTableTrashPermission && (
                <DropdownMenuItem onSelect={() => setTrashDialogOpen(true)}>
                  <Trash2 className="mr-1 size-4" />
                  {t('table:tableTrash.title')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button asChild variant="ghost" size="xs" className={cn('flex', buttonClassName)}>
          <Link
            href={{
              pathname: '/base/[baseId]/design',
              query: { baseId: base.id, tableId },
            }}
            title={t('common:noun.design')}
          >
            <Settings className="size-4" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className={cn('flex', buttonClassName)}
          onClick={togglePluginPanel}
        >
          <Puzzle className="size-4" />
        </Button>
        <Button asChild variant="ghost" size="xs" className={cn('flex', buttonClassName)}>
          <a href={t('help.mainLink')} title={t('help.title')} target="_blank" rel="noreferrer">
            <HelpCircle className="size-4" />
          </a>
        </Button>
      </div>
      <BaseCollaboratorModalTrigger
        base={{
          name: base.name,
          role: base.role,
          id: base.id,
        }}
      >
        <Button variant="default" size="xs" className="flex">
          <UserPlus className="size-4" />{' '}
          <span className="hidden @md/view-header:inline">{t('space:action.invite')}</span>
        </Button>
      </BaseCollaboratorModalTrigger>

      {hasTableHistoryPermission && (
        <Dialog open={isHistoryDialogOpen} onOpenChange={setHistoryDialogOpen}>
          <DialogContent className="flex h-[90%] max-w-4xl flex-col gap-0 p-0">
            <DialogHeader className="border-b p-4">
              <DialogTitle>{t('table:table.tableRecordHistory')}</DialogTitle>
            </DialogHeader>
            <RecordHistory onRecordClick={onRecordClick} />
          </DialogContent>
        </Dialog>
      )}

      {hasTableTrashPermission && (
        <TableTrashDialog open={isTrashDialogOpen} onOpenChange={setTrashDialogOpen} />
      )}
    </div>
  );
};

const RightMenu = ({ className }: { className?: string }) => {
  const router = useRouter();
  const base = useBase();
  const tableId = useTableId();
  const basePermission = useBasePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [open, setOpen] = useState(false);

  const hasTableHistoryPermission = basePermission?.['table_record_history|read'];
  const hasTableTrashPermission = basePermission?.['table|trash_read'];

  // eslint-disable-next-line sonarjs/no-identical-functions
  const onRecordClick = (recordId: string) => {
    router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, recordId },
      },
      undefined,
      {
        shallow: true,
      }
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={'ghost'}
          size={'xs'}
          className={cn('font-normal shrink-0 truncate', className)}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-32 p-0">
        <div className="flex flex-col">
          <Collaborators className="flex p-2" />
          <BaseCollaboratorModalTrigger
            base={{
              name: base.name,
              role: base.role,
              id: base.id,
            }}
          >
            <Button variant="ghost" size="xs" className="flex justify-start">
              <UserPlus className="size-4" /> {t('space:action.invite')}
            </Button>
          </BaseCollaboratorModalTrigger>
          {hasTableHistoryPermission && (
            <Sheet modal={true}>
              <SheetTrigger asChild>
                <Button size="xs" variant="ghost" className="flex justify-start">
                  <History className="size-4" />
                  {t('table:table.tableRecordHistory')}
                </Button>
              </SheetTrigger>
              <SheetContent
                className="h-5/6 overflow-hidden rounded-t-lg p-0"
                side="bottom"
                closeable={false}
              >
                <SheetHeader className="h-16 justify-center border-b text-2xl">
                  {t('table:table.tableRecordHistory')}
                </SheetHeader>
                <RecordHistory onRecordClick={onRecordClick} />
              </SheetContent>
            </Sheet>
          )}
          {hasTableTrashPermission && (
            <Sheet modal={true}>
              <SheetTrigger asChild>
                <Button size="xs" variant="ghost" className="flex justify-start">
                  <Trash2 className="size-4" />
                  {t('table:tableTrash.title')}
                </Button>
              </SheetTrigger>
              <SheetContent
                className="h-5/6 overflow-hidden rounded-t-lg p-0"
                side="bottom"
                closeable={false}
              >
                <SheetHeader className="h-16 justify-center border-b text-2xl">
                  {t('table:tableTrash.title')}
                </SheetHeader>
                <TableTrash />
              </SheetContent>
            </Sheet>
          )}
          <Button asChild variant="ghost" size="xs" className="flex justify-start">
            <Link
              href={{
                pathname: '/base/[baseId]/design',
                query: { baseId: base.id, tableId },
              }}
              title={t('common:noun.design')}
            >
              <Settings className="size-4" /> {t('common:noun.design')}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="xs" className="flex justify-start">
            <a href={t('help.mainLink')} title={t('help.title')} target="_blank" rel="noreferrer">
              <HelpCircle className="size-4" /> {t('help.title')}
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const TableHeader: React.FC = () => {
  const view = useView();
  const { visible } = useLockedViewTipStore();
  const tipVisible = view?.isLocked && visible;

  return (
    <Fragment>
      <div
        className={cn(
          'flex h-[42px] shrink-0 flex-row items-center gap-2 px-4 @container/view-header',
          tipVisible && 'border-b'
        )}
      >
        <TableInfo className="shrink-0 grow-0" />
        <ExpandViewList />
        <ScrollArea className="h-[42px]">
          <div className="flex h-[42px] items-center gap-2">
            <ViewList />
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <AddView />
        <div className="grow basis-0"></div>
        <RightList className="hidden gap-2 @md/view-header:flex" />
        <RightMenu className="flex @md/view-header:hidden" />
      </div>
      {tipVisible && <LockedViewTip />}
    </Fragment>
  );
};
