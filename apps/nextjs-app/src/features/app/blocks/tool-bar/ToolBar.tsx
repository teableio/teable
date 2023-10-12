import { Plus } from '@teable-group/icons';
import { useTable } from '@teable-group/sdk/hooks';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { useCallback } from 'react';
import { Others } from './Others';
import { ViewOperators } from './ViewOperators';

export const ToolBar: React.FC = () => {
  const table = useTable();

  const addRecord = useCallback(async () => {
    if (!table) {
      return;
    }
    await table.createRecord({});
  }, [table]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
      <Button
        className="h-6 w-6 rounded-full p-0 font-normal"
        size={'xs'}
        variant={'outline'}
        onClick={addRecord}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <div className="mx-2 h-4 w-px bg-slate-200"></div>
      <ViewOperators />
      <div className="grow basis-0"></div>
      <Others />
    </div>
  );
};
