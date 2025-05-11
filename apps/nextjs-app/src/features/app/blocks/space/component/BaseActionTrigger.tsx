import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Export, Pencil, Trash2, ArrowRight } from '@teable/icons';
import { exportBase, getSpaceList, moveBase } from '@teable/openapi';
import type { IGetBaseVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useDuplicateBaseStore } from '../../base/duplicate/useDuplicateBaseStore';
import { EditableSpaceSelect } from './EditableSpaceSelect';

interface IBaseActionTrigger {
  base: IGetBaseVo;
  showRename: boolean;
  showDelete: boolean;
  showDuplicate: boolean;
  showExport: boolean;
  showMove: boolean;
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
    showMove,
    onDelete,
    onRename,
    align = 'end',
  } = props;
  const { t } = useTranslation(['common', 'space']);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [exportConfirm, setExportConfirm] = React.useState(false);
  const [moveConfirm, setMoveConfirm] = React.useState(false);
  const [spaceId, setSpaceId] = React.useState<string | null>(null);
  const baseStore = useDuplicateBaseStore();
  const queryClient = useQueryClient();
  const { mutateAsync: exportBaseFn } = useMutation({
    mutationFn: (baseId: string) => exportBase(baseId),
  });

  const { toast } = useToast();

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const { mutateAsync: moveBaseFn, isLoading: moveBaseLoading } = useMutation({
    mutationFn: (baseId: string) => moveBase(baseId, spaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseList(spaceId!) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      const newSpace = spaceList?.find((space) => space.id === spaceId)?.name;
      toast({
        title: t('space:tip.moveBaseSuccessTitle'),
        description: t('space:tip.moveBaseSuccessDescription', {
          baseName: base.name,
          spaceName: newSpace,
        }),
      });
    },
  });

  if (!showDelete && !showRename && !showDuplicate && !showExport && !showMove) {
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

  const moveBaseContent = (
    <div className="flex flex-col justify-start gap-2">
      <span className="text-sm text-gray-400">{t('space:baseModal.chooseSpace')}</span>
      <EditableSpaceSelect
        spaceId={base.spaceId}
        value={spaceId}
        onChange={(spaceId) => {
          setSpaceId(spaceId);
        }}
      />
    </div>
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
          {showMove && (
            <DropdownMenuItem
              onClick={() => {
                setMoveConfirm(true);
              }}
            >
              <ArrowRight className="mr-2" />
              {t('actions.move')}
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

      <ConfirmDialog
        open={moveConfirm}
        onOpenChange={setMoveConfirm}
        content={moveBaseContent}
        title={t('space:baseModal.moveBaseToAnotherSpace', { baseName: base.name })}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setMoveConfirm(false)}
        confirmLoading={moveBaseLoading}
        onConfirm={() => {
          base.id && spaceId && moveBaseFn(base.id);
          setMoveConfirm(false);
        }}
      />
    </>
  );
};
