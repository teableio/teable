import { useMutation } from '@tanstack/react-query';
import { Pencil, Settings, Trash2, Import } from '@teable/icons';
import { type INotifyVo, type IGetSpaceVo, type ImportBaseRo, importBase } from '@teable/openapi';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import React from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { UploadPanel } from './upload-panel';

interface ISpaceActionTrigger {
  space: IGetSpaceVo;
  showRename?: boolean;
  showDelete?: boolean;
  showSpaceSetting?: boolean;
  showImportBase?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onSpaceSetting?: () => void;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

export const SpaceActionTrigger: React.FC<React.PropsWithChildren<ISpaceActionTrigger>> = (
  props
) => {
  const {
    space,
    children,
    showDelete,
    showRename,
    showSpaceSetting,
    showImportBase,
    onDelete,
    onRename,
    onSpaceSetting,
    open,
    setOpen,
  } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [importBaseOpen, setImportBaseOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [notify, setNotify] = React.useState<INotifyVo | null>(null);
  const router = useRouter();

  const { mutate: importBaseFn } = useMutation({
    mutationFn: (importBaseRo: ImportBaseRo) => importBase(importBaseRo),
    onSuccess: (result) => {
      const { id: baseId } = result.data;
      setImportBaseOpen(false);
      router.push(`/base/${baseId}`);
    },
  });

  if (!showDelete && !showRename) {
    return null;
  }
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showRename && (
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2" />
              {t('actions.rename')}
            </DropdownMenuItem>
          )}
          {showSpaceSetting && (
            <DropdownMenuItem onClick={onSpaceSetting}>
              <Settings className="mr-2" />
              {t('space:spaceSetting.title')}
            </DropdownMenuItem>
          )}
          {showImportBase && (
            <DropdownMenuItem onClick={() => setImportBaseOpen(true)}>
              <Import className="mr-2" />
              {t('space:spaceSetting.importBase')}
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
        title={
          <Trans ns="space" i18nKey={'tip.delete'}>
            {space?.name}
          </Trans>
        }
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={onDelete}
      />

      <Dialog
        open={importBaseOpen}
        onOpenChange={(open) => {
          setImportBaseOpen(open);
          if (!open) {
            setFile(null);
            setNotify(null);
          }
        }}
      >
        <DialogContent className="min-w-[700px]">
          <DialogHeader>
            <DialogTitle>{t('space:spaceSetting.importBase')}</DialogTitle>
          </DialogHeader>
          <div className="w-full">
            <UploadPanel
              file={file}
              onClose={() => {
                setFile(null);
                setNotify(null);
              }}
              onChange={(file) => {
                setFile(file);
              }}
              accept="application/zip"
              onFinished={(notify) => {
                setNotify(notify);
              }}
            />
          </div>
          <DialogFooter className={cn('opacity-100', { 'opacity-0': !notify })}>
            <Button
              variant={'default'}
              size={'sm'}
              onClick={() => {
                notify && importBaseFn({ spaceId: space.id, notify });
              }}
            >
              {t('space:import.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
