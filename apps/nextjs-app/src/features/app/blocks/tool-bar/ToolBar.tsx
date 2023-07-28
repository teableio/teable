import type { IFilter } from '@teable-group/core';
import { ArrowUpDown, LayoutList, PaintBucket, Plus } from '@teable-group/icons';
import { Filter } from '@teable-group/sdk';
import { useTable } from '@teable-group/sdk/hooks';
import { useView } from '@teable-group/sdk/hooks/use-view';
import { useToast } from '@teable-group/ui-lib';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { useCallback } from 'react';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { FilterColumnsButton } from './FilterColumnsButton';
import { RowHeightButton } from './RowHeightButton';

export const ToolBar: React.FC = () => {
  const table = useTable();
  const view = useView();
  const { toast } = useToast();

  const onFilterChange = useCallback(
    async (filters: IFilter | null) => {
      await view?.setFilter(filters).catch((e) => {
        let message;
        if (e instanceof z.ZodError) {
          message = fromZodError(e).message;
        } else {
          message = e.message;
        }
        toast({
          variant: 'destructive',
          title: 'Uh oh! Something went wrong.',
          description: message,
        });
      });
    },
    [toast, view]
  );

  const addRecord = useCallback(async () => {
    if (!table) {
      return;
    }
    await table.createRecord({});
  }, [table]);

  return (
    <div className="items-center flex px-4 py-2 border-y gap-2 flex-wrap">
      <Button
        className="font-normal rounded-full h-7 w-7"
        size={'xs'}
        variant={'outline'}
        onClick={addRecord}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <div className="mx-2 h-4 w-px bg-slate-200"></div>
      <FilterColumnsButton />
      <Filter filters={view?.filter as IFilter} onChange={onFilterChange} />
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <ArrowUpDown className="text-lg pr-1" />
        Sort
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <LayoutList className="text-lg pr-1" />
        Group
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <PaintBucket className="text-lg pr-1" />
        Color
      </Button>
      <RowHeightButton />
    </div>
  );
};
