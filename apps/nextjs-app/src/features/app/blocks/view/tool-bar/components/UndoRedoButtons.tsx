import { Undo2, Redo2 } from '@teable/icons';
import { redo, undo } from '@teable/openapi';
import { useTableId, useTablePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

export const UndoRedoButtons = () => {
  const permission = useTablePermission();
  const tableId = useTableId();

  const performUndo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to undo');
      return;
    }

    toast.promise(
      async () => {
        const res = await undo(tableId);
        if (res.data.status === 'fulfilled') {
          return 'undo success';
        }
        if (res.data.status === 'empty') {
          return 'nothing to undo';
        }
        throw new Error(res.data.errorMessage);
      },
      {
        duration: 1500,
        loading: 'undoing...',
        success: (message) => message,
        error: (e) => {
          return `undo failed: ${(e as { message: string }).message}`;
        },
      }
    );
  }, [tableId]);

  const performRedo = useCallback(async () => {
    if (!tableId) {
      toast('nothing to redo');
      return;
    }

    toast.promise(
      async () => {
        const res = await redo(tableId);
        if (res.data.status === 'fulfilled') {
          return 'redo success';
        }
        if (res.data.status === 'empty') {
          return 'nothing to redo';
        }
        throw new Error(res.data.errorMessage);
      },
      {
        duration: 1500,
        loading: 'redoing...',
        success: (message) => message,
        error: (e) => {
          return `redo failed: ${(e as { message: string }).message}`;
        },
      }
    );
  }, [tableId]);

  useHotkeys(
    `mod+z`,
    async () => {
      await performUndo();
    },
    {
      preventDefault: true,
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    [`mod+shift+z`, `mod+y`],
    async () => {
      await performRedo();
    },
    {
      preventDefault: true,
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  return (
    <>
      <Button
        className="size-6 shrink-0 p-0"
        size={'xs'}
        variant={'ghost'}
        disabled={!permission['table|read']}
        onClick={performUndo}
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        className="size-6 shrink-0 p-0"
        size={'xs'}
        variant={'ghost'}
        disabled={!permission['table|read']}
        onClick={performRedo}
      >
        <Redo2 className="size-4" />
      </Button>
    </>
  );
};
