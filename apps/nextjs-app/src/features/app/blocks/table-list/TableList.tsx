import { useConnection, useTablePermission } from '@teable/sdk';
import AddBoldIcon from '@teable/ui-lib/icons/app/add-bold.svg';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { GUIDE_CREATE_TABLE } from '@/components/Guide';
import { DraggableList } from './DraggableList';
import { NoDraggableList } from './NoDraggableList';
import { useAddTable } from './useAddTable';

export const TableList: React.FC = () => {
  const { connected } = useConnection();
  const addTable = useAddTable();
  const permission = useTablePermission();

  return (
    <div className="flex flex-col gap-2 overflow-auto pt-4">
      <div className="px-3">
        {permission['table|create'] && (
          <Button
            variant={'outline'}
            size={'xs'}
            className={`${GUIDE_CREATE_TABLE} w-full`}
            onClick={addTable}
          >
            <AddBoldIcon />
          </Button>
        )}
      </div>
      <div className="overflow-y-auto px-3">
        {connected && permission['table|update'] ? <DraggableList /> : <NoDraggableList />}
      </div>
    </div>
  );
};
