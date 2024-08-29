import { Undo2, Redo2 } from '@teable/icons';
import { useTablePermission, useUndoRedo } from '@teable/sdk/hooks';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useHotkeys } from 'react-hotkeys-hook';
import { getModKeyStr } from '@/features/app/utils/get-mod-key-str';

export const UndoRedoButtons = () => {
  const permission = useTablePermission();

  const { undo, redo } = useUndoRedo();

  useHotkeys(`mod+z`, () => undo(), {
    preventDefault: true,
  });

  useHotkeys([`mod+shift+z`, `mod+y`], () => redo(), {
    preventDefault: true,
  });

  const modKeyStr = getModKeyStr();

  return (
    <>
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              className="size-6 shrink-0 p-0"
              size={'xs'}
              variant={'ghost'}
              disabled={!permission['table|read']}
              onClick={undo}
            >
              <Undo2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Undo {modKeyStr} z </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              className="size-6 shrink-0 p-0"
              size={'xs'}
              variant={'ghost'}
              disabled={!permission['table|read']}
              onClick={redo}
            >
              <Redo2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Undo {modKeyStr} shift z </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
};
