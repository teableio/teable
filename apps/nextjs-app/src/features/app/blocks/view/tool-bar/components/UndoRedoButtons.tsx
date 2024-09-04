import { Undo2, Redo2 } from '@teable/icons';
import { useTablePermission, useUndoRedo } from '@teable/sdk/hooks';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useModKeyStr } from '@/features/app/utils/get-mod-key-str';

export const UndoRedoButtons = () => {
  const permission = useTablePermission();
  const { t } = useTranslation(['sdk']);

  const { undo, redo } = useUndoRedo();

  const modKeyStr = useModKeyStr();

  return (
    <>
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Button
              className="size-6 shrink-0 p-0"
              size={'xs'}
              variant={'ghost'}
              disabled={!permission['record|update']}
              onClick={undo}
            >
              <Undo2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {t('sdk:undoRedo.undo')} {modKeyStr} z
            </p>
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
              disabled={!permission['record|update']}
              onClick={redo}
            >
              <Redo2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {t('sdk:undoRedo.redo')} {modKeyStr} shift z
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
};
