import { HelpCircle, History, MoreHorizontal, Settings, UserPlus } from '@teable/icons';
import { RecordHistory } from '@teable/sdk/components/expand-record/RecordHistory';
import { useBase, useBasePermission, useTableId } from '@teable/sdk/hooks';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { BaseCollaboratorModalTrigger } from '@/features/app/components/collaborator-manage/base/BaseCollaboratorModal';
import { tableConfig } from '@/features/i18n/table.config';
import { ExpandViewList } from '../../view/list/ExpandViewList';
import { ViewList } from '../../view/list/ViewList';

import { AddView } from './AddView';
import { Collaborators } from './Collaborators';
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
      <Collaborators className="flex" />
      <div className="flex">
        {basePermission?.['table_record_history|read'] && (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className={cn('flex', buttonClassName)}
                title={t('table:table.tableRecordHistory')}
              >
                <History className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="flex h-[90%] max-w-4xl flex-col gap-0 p-0">
              <DialogHeader className="border-b p-4">
                <DialogTitle>{t('table:table.tableRecordHistory')}</DialogTitle>
              </DialogHeader>
              <RecordHistory onRecordClick={onRecordClick} />
            </DialogContent>
          </Dialog>
        )}

        <Button asChild variant="ghost" size="xs" className={cn('flex', buttonClassName)}>
          <Link
            href={{
              pathname: '/base/[baseId]/[tableId]/design',
              query: { baseId: base.id, tableId },
            }}
            title={t('table:table.design')}
          >
            <Settings className="size-4" />
          </Link>
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
    </div>
  );
};

const RightMenu = ({ className }: { className?: string }) => {
  const router = useRouter();
  const base = useBase();
  const tableId = useTableId();
  const basePermission = useBasePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

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
    <Popover>
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
          {basePermission?.['table_record_history|read'] && (
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
          <Button asChild variant="ghost" size="xs" className="flex justify-start">
            <Link
              href={{
                pathname: '/base/[baseId]/[tableId]/design',
                query: { baseId: base.id, tableId },
              }}
              title={t('table:table.design')}
            >
              <Settings className="size-4" /> {t('table:table.design')}
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
  return (
    <div className="flex h-[42px] shrink-0 flex-row items-center gap-2 px-4 @container/view-header">
      <TableInfo className="shrink-0 grow-0" />
      <ExpandViewList />
      <div className="flex h-full items-center gap-2 overflow-x-auto">
        <ViewList />
      </div>
      <AddView />
      <div className="grow basis-0"></div>
      <RightList className="hidden gap-2 @md/view-header:flex" />
      <RightMenu className="flex @md/view-header:hidden" />
    </div>
  );
};
