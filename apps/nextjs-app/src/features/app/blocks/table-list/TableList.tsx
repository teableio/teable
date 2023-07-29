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
    <div className="pt-4 flex flex-col overflow-hidden gap-2">
      <div className="px-3">
        <Button variant={'outline'} size={'xs'} className="w-full" onClick={addTable}>
          <AddBoldIcon />
        </Button>
      </div>
      <div className="px-3 overflow-y-auto">
        {connected ? <DraggableList /> : <NoDraggableList />}
      </div>
    </div>
  );
};
