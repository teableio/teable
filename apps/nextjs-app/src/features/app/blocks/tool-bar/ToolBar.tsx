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
    <div className="flex px-4 py-2 bg-base-100 border-y border-base-300 space-x-2">
      <button className="btn btn-xs btn-ghost" onClick={undo}>
        <BackIcon className="text-lg pr-1" />
      </button>
      <button className="btn btn-xs btn-ghost" onClick={redo}>
        <ForwardIcon className="text-lg pr-1" />
      </button>
      <button className="btn btn-xs btn-ghost font-normal" onClick={addRecord}>
        <AddIcon className="text-lg pr-1" />
        Insert record
      </button>
      <FilterColumnsButton />
      <button className="btn btn-xs btn-ghost font-normal">
        <FilterIcon className="text-lg pr-1" />
        Filter
      </button>
      <button className="btn btn-xs btn-ghost font-normal">
        <SortingIcon className="text-lg pr-1" />
        Sort
      </button>
      <button className="btn btn-xs btn-ghost font-normal">
        <GroupIcon className="text-lg pr-1" />
        Group
      </button>
      <button className="btn btn-xs btn-ghost font-normal">
        <ColorIcon className="text-lg pr-1" />
        Color
      </button>
      <button className="btn btn-xs btn-ghost font-normal">
        <RowHeightIcon className="text-lg pr-1" />
        Row Height
      </button>
    </div>
  );
};
