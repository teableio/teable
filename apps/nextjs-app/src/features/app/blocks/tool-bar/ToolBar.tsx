import type { IFilter } from '@teable-group/core';
import { Filter } from '@teable-group/sdk';
import { useTable, useUndoManager } from '@teable-group/sdk/hooks';
import { useView } from '@teable-group/sdk/hooks/use-view';
import { useToast } from '@teable-group/ui-lib';
import AddIcon from '@teable-group/ui-lib/icons/app/add-circle.svg';
import BackIcon from '@teable-group/ui-lib/icons/app/back.svg';
import ColorIcon from '@teable-group/ui-lib/icons/app/color.svg';
import ForwardIcon from '@teable-group/ui-lib/icons/app/forward.svg';
import GroupIcon from '@teable-group/ui-lib/icons/app/group.svg';
import SortingIcon from '@teable-group/ui-lib/icons/app/sorting.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { cloneDeep } from 'lodash';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { FilterColumnsButton } from './FilterColumnsButton';
import { RowHeightButton } from './RowHeightButton';

export const ToolBar: React.FC = () => {
  const undoManager = useUndoManager();
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

  const initFilters = useMemo<IFilter>(() => {
    return cloneDeep(view?.filter) as IFilter;
  }, [view]);

  const undo = useCallback(() => {
    const undo = undoManager?.undo();
    console.log(undoManager, undo);
  }, [undoManager]);

  const redo = useCallback(() => {
    return undoManager?.redo();
  }, [undoManager]);

  const addRecord = useCallback(async () => {
    if (!table) {
      return;
    }
    await table.createRecord({});
  }, [table]);

  return (
    <div className="flex px-4 py-2 border-y space-x-2 flex-wrap">
      <Button className="font-normal" size={'xs'} variant={'ghost'} onClick={undo}>
        <BackIcon className="text-lg pr-1" />
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'} onClick={redo}>
        <ForwardIcon className="text-lg pr-1" />
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'} onClick={addRecord}>
        <AddIcon className="text-lg pr-1" />
        Insert record
      </Button>
      <FilterColumnsButton />
      <Filter filters={initFilters} onChange={onFilterChange} />
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <SortingIcon className="text-lg pr-1" />
        Sort
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <GroupIcon className="text-lg pr-1" />
        Group
      </Button>
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <ColorIcon className="text-lg pr-1" />
        Color
      </Button>
      <RowHeightButton />
    </div>
  );
};
