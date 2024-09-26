import { Plus } from '@teable/icons';
import { CreateRecordModal } from '@teable/sdk/components';
import { useTablePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { GridViewOperators } from './components';
import { UndoRedoButtons } from './components/UndoRedoButtons';
import { Others } from './Others';

export const GridToolBar: React.FC = () => {
  const permission = useTablePermission();

  return (
    <div className="flex items-center border-t px-1 py-2 @container/toolbar sm:gap-1 sm:px-2 md:gap-2 md:px-4">
      <UndoRedoButtons />
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200"></div>
      <CreateRecordModal>
        <Button
          className="size-6 shrink-0 rounded-full p-0"
          size={'xs'}
          variant={'outline'}
          disabled={!permission['record|create']}
        >
          <Plus className="size-4" />
        </Button>
      </CreateRecordModal>
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200"></div>
      <div className="flex flex-1 justify-between">
        <GridViewOperators disabled={!permission['view|update']} />
        <Others />
      </div>
    </div>
  );
};
