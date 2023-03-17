import { useUndoManager } from '@teable-group/sdk/hooks';
import BackIcon from '@teable-group/ui-lib/icons/app/back.svg';
import ForwardIcon from '@teable-group/ui-lib/icons/app/forward.svg';
import { useCallback } from 'react';

export const ToolBar: React.FC = () => {
  const undoManager = useUndoManager();

  const undo = useCallback(() => {
    const undo = undoManager?.undo();
    console.log(undoManager, undo);
  }, [undoManager]);

  const redo = useCallback(() => {
    return undoManager?.redo();
  }, [undoManager]);

  return (
    <div className="flex px-4 py-2 bg-base-100 border-b border-base-200">
      <div className="btn-group">
        <button className="btn btn-xs btn-outline" onClick={undo}>
          <BackIcon />
        </button>
        <button className="btn btn-xs btn-outline" onClick={redo}>
          <ForwardIcon />
        </button>
      </div>
    </div>
  );
};
