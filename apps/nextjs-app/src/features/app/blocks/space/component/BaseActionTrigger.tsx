import { useMutation } from '@tanstack/react-query';
import { Copy, Export, Pencil, Trash2 } from '@teable/icons';
import { exportBase } from '@teable/openapi';
import type { IGetBaseVo } from '@teable/openapi';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useDuplicateBaseStore } from '../../base/duplicate/useDuplicateBaseStore';

interface IBaseActionTrigger {
  base: IGetBaseVo;
  showRename: boolean;
  showDelete: boolean;
  showDuplicate: boolean;
  showExport: boolean;
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
    showExport,
    onDelete,
    onRename,
    align = 'end',
  } = props;
  const { t } = useTranslation(['common', 'space']);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [exportConfirm, setExportConfirm] = React.useState(false);
  const baseStore = useDuplicateBaseStore();

  const { mutateAsync: exportBaseFn } = useMutation({
    mutationFn: (baseId: string) => exportBase(baseId),
  });

  if (!showDelete && !showRename && !showDuplicate) {
    return null;
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
    }
    setDeleteConfirm(false);
  };

  const exportTips = (
    <pre className="text-wrap text-sm leading-relaxed">{t('space:tip.exportTips')}</pre>
  );
  return (
    <>
      <DropdownMenu modal>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          className="w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {showRename && (
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2" />
              {t('actions.rename')}
            </DropdownMenuItem>
          )}
          {showDuplicate && (
            <DropdownMenuItem onClick={() => baseStore.openModal(base)}>
              <Copy className="mr-2" />
              {t('actions.duplicate')}
            </DropdownMenuItem>
          )}
          {showExport && (
            <DropdownMenuItem
              onClick={() => {
                setExportConfirm(true);
              }}
            >
              <Export className="mr-2" />
              {t('actions.export')}
            </DropdownMenuItem>
          )}
          {showDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="mr-2" />
                {t('actions.delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={t('actions.deleteTip', { name: base.name })}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.delete')}
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={exportConfirm}
        onOpenChange={setExportConfirm}
        content={exportTips}
        title={t('space:tip.title')}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setExportConfirm(false)}
        onConfirm={() => {
          exportBaseFn(base.id);
          setExportConfirm(false);
        }}
      />
    </>
  );
};
