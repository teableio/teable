import { Undo2, Redo2 } from '@teable/icons';
import { useTablePermission, useUndoRedo } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useHotkeys } from 'react-hotkeys-hook';

export const UndoRedoButtons = () => {
  const permission = useTablePermission();

  const { undo, redo } = useUndoRedo();

  useHotkeys(`mod+z`, () => undo(), {
    preventDefault: true,
  });

  useHotkeys([`mod+shift+z`, `mod+y`], () => redo(), {
    preventDefault: true,
  });

  return (
    <>
      <Button
        className="size-6 shrink-0 p-0"
        size={'xs'}
        variant={'ghost'}
        disabled={!permission['table|read']}
        onClick={undo}
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        className="size-6 shrink-0 p-0"
        size={'xs'}
        variant={'ghost'}
        disabled={!permission['table|read']}
        onClick={redo}
      >
        <Redo2 className="size-4" />
      </Button>
    </>
  );
};
