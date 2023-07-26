import { useConnection } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { DraggableList } from './DraggableList';
import { NoDraggableList } from './NoDraggableList';
import { useAddTable } from './useAddTable';

export const TableList: React.FC = () => {
  const { connected } = useConnection();
  const addTable = useAddTable();

  return (
    <div className="py-2 flex flex-col overflow-hidden">
      <div className="mx-2 ">
        <Button variant={'ghost'} size={'xs'} className="w-full" onClick={addTable}>
          <AddBoldIcon />
          <span className="ml-1">Table</span>
        </Button>
      </div>
      <div className="overflow-y-auto">{connected ? <DraggableList /> : <NoDraggableList />}</div>
    </div>
  );
};
