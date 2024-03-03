import { HelpCircle, Settings, UserPlus } from '@teable/icons';
import { useBase, useTableId } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { SpaceCollaboratorModalTrigger } from '@/features/app/components/collaborator-manage/space/SpaceCollaboratorModalTrigger';
import { spaceConfig } from '@/features/i18n/space.config';
import { getHelpLink } from '@/lib/off-site-link';
import { ExpandViewList } from '../../view/list/ExpandViewList';
import { ViewList } from '../../view/list/ViewList';

import { AddView } from './AddView';
import { Collaborators } from './Collaborators';
import { TableInfo } from './TableInfo';

export const TableHeader: React.FC = () => {
  const base = useBase();
  const tableId = useTableId();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  return (
    <div className="flex h-[42px] shrink-0 flex-row items-center gap-2 px-4">
      <TableInfo className="shrink-0 grow-0" />
      <ExpandViewList />
      <div className="flex h-full items-center gap-2 overflow-x-auto">
        <ViewList />
      </div>
      <AddView />
      <div className="grow basis-0"></div>
      <Collaborators />

      <div className="flex">
        <Button asChild variant="ghost" size="xs" className="hidden sm:flex">
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
        <Button asChild variant="ghost" size="xs" className="hidden sm:flex">
          <a href={getHelpLink()} title="Help" target="_blank" rel="noreferrer">
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
        <Button variant="default" size="xs" className="hidden sm:flex">
          <UserPlus className="size-4" /> {t('space:action.invite')}
        </Button>
      </SpaceCollaboratorModalTrigger>
    </div>
  );
};
