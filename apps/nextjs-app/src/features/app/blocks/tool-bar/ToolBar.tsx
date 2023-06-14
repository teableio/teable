import { useTable, useUndoManager } from '@teable-group/sdk/hooks';
import AddIcon from '@teable-group/ui-lib/icons/app/add-circle.svg';
import BackIcon from '@teable-group/ui-lib/icons/app/back.svg';
import ColorIcon from '@teable-group/ui-lib/icons/app/color.svg';
import FilterIcon from '@teable-group/ui-lib/icons/app/filter.svg';
import ForwardIcon from '@teable-group/ui-lib/icons/app/forward.svg';
import GroupIcon from '@teable-group/ui-lib/icons/app/group.svg';
import RowHeightIcon from '@teable-group/ui-lib/icons/app/row-height.svg';
import SortingIcon from '@teable-group/ui-lib/icons/app/sorting.svg';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { FilterColumnsButton } from './FilterColumnsButton';

export const ToolBar: React.FC = () => {
  const undoManager = useUndoManager();
  const table = useTable();

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
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <FilterIcon className="text-lg pr-1" />
        Filter
      </Button>
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
      <Button className="font-normal" size={'xs'} variant={'ghost'}>
        <RowHeightIcon className="text-lg pr-1" />
        Row Height
      </Button>
    </div>
  );
};
