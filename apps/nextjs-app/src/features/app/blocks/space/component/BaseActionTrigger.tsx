import { Copy, Pencil, Trash2 } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import React from 'react';
import { useDuplicateBaseStore } from '../../base/duplicate/useDuplicateBaseStore';

interface IBaseActionTrigger {
  base: IGetBaseVo;
  showRename: boolean;
  showDelete: boolean;
  showDuplicate: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  align?: 'center' | 'end' | 'start';
}

export const BaseActionTrigger: React.FC<React.PropsWithChildren<IBaseActionTrigger>> = (props) => {
  const {
    base,
    children,
    showRename,
    showDelete,
    showDuplicate,
    onDelete,
    onRename,
    align = 'end',
  } = props;
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const baseStore = useDuplicateBaseStore();
  if (!showDelete && !showRename && !showDuplicate) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          className="w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {showRename && (
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2" />
              Rename
            </DropdownMenuItem>
          )}
          {showDuplicate && (
            <DropdownMenuItem onClick={() => baseStore.openModal(base)}>
              <Copy className="mr-2" />
              Duplicate
            </DropdownMenuItem>
          )}
          {showDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="mr-2" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={`Are you sure you want to delete ${base.name}?`}
        cancelText="Cancel"
        confirmText="Continue"
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={onDelete}
      />
    </>
  );
};
