import { UserPlus, Plus } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useAddView } from '../../view/list/useAddView';

import { ViewList } from '../../view/list/ViewList';
import { Collaborators } from './Collaborators';
import { TableInfo } from './TableInfo';

export const TableHeader: React.FC = () => {
  const addView = useAddView();

  return (
    <div className="flex h-[42px] flex-row items-center gap-2 px-4">
      <TableInfo className="shrink-0 grow-0" />
      <ViewList className="overflow-x-auto" />
      <Button className="h-7 w-7 shrink-0 px-0" size={'xs'} variant={'outline'} onClick={addView}>
        <Plus className="h-4 w-4" />
      </Button>
      <div className="grow basis-0"></div>
      <Collaborators />
      <Button variant="default" size="xs">
        <UserPlus className="h-4 w-4" /> Invite
      </Button>
    </div>
  );
};
