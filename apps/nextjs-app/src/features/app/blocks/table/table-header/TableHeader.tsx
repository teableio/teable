import { UserPlus } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

import { ViewList } from '../../view/list/ViewList';
import { AddView } from './AddView';
import { Collaborators } from './Collaborators';
import { TableInfo } from './TableInfo';

export const TableHeader: React.FC = () => {
  return (
    <div className="flex h-[42px] shrink-0 flex-row items-center gap-2 px-4">
      <TableInfo className="shrink-0 grow-0" />
      <ViewList className="overflow-x-auto" />
      <AddView />
      <div className="grow basis-0"></div>
      <Collaborators />
      <Button variant="default" size="xs" className="hidden sm:flex">
        <UserPlus className="h-4 w-4" /> Invite
      </Button>
    </div>
  );
};
