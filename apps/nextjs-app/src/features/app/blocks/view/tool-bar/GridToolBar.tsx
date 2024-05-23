import { Plus } from '@teable/icons';
import { useTablePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { AddRecordModal } from '../AddRecordModal';
import { GridViewOperators } from './components';
import { Others } from './Others';

export const GridToolBar: React.FC = () => {
  const permission = useTablePermission();

  return (
    <div className="flex items-center gap-2 border-t px-4 py-2 @container/toolbar">
      <AddRecordModal>
        <Button
          className="size-6 shrink-0 rounded-full p-0 font-normal"
          size={'xs'}
          variant={'outline'}
          disabled={!permission['record|create']}
        >
          <Plus className="size-4" />
        </Button>
      </AddRecordModal>
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200"></div>
      <div className="flex flex-1 justify-between">
        <GridViewOperators disabled={!permission['view|update']} />
        <Others />
      </div>
    </div>
  );
};
