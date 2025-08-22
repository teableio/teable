import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Export, Pencil, Trash2, ArrowRight } from '@teable/icons';
import { exportBase, getSpaceList, moveBase } from '@teable/openapi';
import type { IGetBaseVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  DialogFooter,
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
  onDelete?: (permanent?: boolean) => void;
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

  const handleDelete = (permanent?: boolean) => {
    if (onDelete) {
      onDelete(permanent);
    }
    setDeleteConfirm(false);
  };

  const exportTips = (
    <div className="text-wrap text-sm">
      <p>{t('space:tip.exportTips1')}</p>
      <p>{t('space:tip.exportTips2')}</p>
      <br />
      <p>Tips:</p>
      <p>{t('space:tip.exportTips3')}</p>
    </div>
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
        title={t('base.deleteTip', { name: base.name })}
        onCancel={() => setDeleteConfirm(false)}
        content={
          <>
            <div className="space-y-2 text-sm">
              <p>{t('common:trash.description')}</p>
            </div>
            <DialogFooter>
              <Button size={'sm'} variant={'ghost'} onClick={() => setDeleteConfirm(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button variant="destructive" size={'sm'} onClick={() => handleDelete(true)}>
                {t('common:actions.permanentDelete')}
              </Button>
              <Button size={'sm'} onClick={() => handleDelete()}>
                {t('common:trash.addToTrash')}
              </Button>
            </DialogFooter>
          </>
        }
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
