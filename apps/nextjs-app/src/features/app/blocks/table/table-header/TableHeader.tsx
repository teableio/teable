import { UserPlus, Plus } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useAddView } from '../../view/list/useAddView';

import { ViewList } from '../../view/list/ViewList';
import { Collaborators } from './Collaborators';
import { TableInfo } from './TableInfo';

export const TableHeader: React.FC = () => {
  const addView = useAddView();

  return (
    <div className="flex flex-row px-4 h-[42px] gap-2 items-center">
      <TableInfo className="grow-0 shrink-0" />
      <ViewList className="overflow-x-auto" />
      <Button className="w-7 h-7 px-0 shrink-0" size={'xs'} variant={'outline'} onClick={addView}>
        <Plus className="w-4 h-4" />
      </Button>
      <div className="grow basis-0"></div>
      <Collaborators />
      <Button variant="default" size="xs">
        <UserPlus className="w-4 h-4" /> Invite
      </Button>
    </div>
  );
};
