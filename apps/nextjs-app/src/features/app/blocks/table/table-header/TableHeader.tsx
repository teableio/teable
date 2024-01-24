import { Settings, UserPlus } from '@teable-group/icons';
import { useBase, useTableId } from '@teable-group/sdk/hooks';
import { Button } from '@teable-group/ui-lib/shadcn';

import Link from 'next/link';
import { SpaceCollaboratorModalTrigger } from '@/features/app/components/collaborator-manage/space/SpaceCollaboratorModalTrigger';
import { DraggableViewList } from '../../view/list/DraggableViewList';

import { AddView } from './AddView';
import { Collaborators } from './Collaborators';
import { TableInfo } from './TableInfo';

export const TableHeader: React.FC = () => {
  const base = useBase();
  const tableId = useTableId();
  return (
    <div className="flex h-[42px] shrink-0 flex-row items-center gap-2 px-4">
      <TableInfo className="shrink-0 grow-0" />
      <div className="flex overflow-x-auto">
        <DraggableViewList />
      </div>
      <AddView />
      <div className="grow basis-0"></div>
      <Collaborators />

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
      <SpaceCollaboratorModalTrigger
        space={{
          name: base.name,
          role: base.role,
          id: base.spaceId,
        }}
      >
        <Button variant="default" size="xs" className="hidden sm:flex">
          <UserPlus className="size-4" /> Invite
        </Button>
      </SpaceCollaboratorModalTrigger>
    </div>
  );
};
