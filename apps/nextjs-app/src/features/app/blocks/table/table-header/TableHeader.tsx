import { HelpCircle, MoreHorizontal, Settings, UserPlus } from '@teable/icons';
import { useBase, useTableId } from '@teable/sdk/hooks';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { SpaceCollaboratorModalTrigger } from '@/features/app/components/collaborator-manage/space/SpaceCollaboratorModalTrigger';
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
  const base = useBase();
  const tableId = useTableId();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  return (
    <div className={cn('flex', className)}>
      <Collaborators className="flex" />
      <div className="flex">
        <Button asChild variant="ghost" size="xs" className={cn('flex', buttonClassName)}>
          <Link
            href={{
              pathname: '/base/[baseId]/[tableId]/design',
              query: { baseId: base.id, tableId },
            }}
            title="Design"
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
      <SpaceCollaboratorModalTrigger
        space={{
          name: base.name,
          role: base.role,
          id: base.spaceId,
        }}
      >
        <Button variant="default" size="xs" className="flex">
          <UserPlus className="size-4" />{' '}
          <span className="hidden @md/view-header:inline">{t('space:action.invite')}</span>
        </Button>
      </SpaceCollaboratorModalTrigger>
    </div>
  );
};

const RightMenu = ({ className }: { className?: string }) => {
  const base = useBase();
  const tableId = useTableId();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
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
          <SpaceCollaboratorModalTrigger
            space={{
              name: base.name,
              role: base.role,
              id: base.spaceId,
            }}
          >
            <Button variant="ghost" size="xs" className="flex justify-start">
              <UserPlus className="size-4" /> {t('space:action.invite')}
            </Button>
          </SpaceCollaboratorModalTrigger>
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
      <RightList className="hidden gap-2 @sm/view-header:flex" />
      <RightMenu className="flex @sm/view-header:hidden" />
    </div>
  );
};
