import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Info,
  Copy,
  Database,
  Download,
  Export,
  Loader2,
  Pencil,
  Trash2,
  ArrowRight,
} from '@teable/icons';
import { useTheme } from '@teable/next-themes';
import { exportBase, getSpaceList, moveBase } from '@teable/openapi';
import type { IGetBaseVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Button,
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
  Switch,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import Image from 'next/image';
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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [exportConfirm, setExportConfirm] = React.useState(false);
  const [exportState, setExportState] = React.useState<'idle' | 'loading' | 'done'>('idle');
  const [exportDownloadUrl, setExportDownloadUrl] = React.useState<string | null>(null);
  const [showSlowTip, setShowSlowTip] = React.useState(false);
  const [moveConfirm, setMoveConfirm] = React.useState(false);
  const [spaceId, setSpaceId] = React.useState<string | null>(null);
  const [includeData, setIncludeData] = React.useState(true);
  const slowTipTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseStore = useDuplicateBaseStore();
  const queryClient = useQueryClient();
  const { mutateAsync: exportBaseFn } = useMutation({
    mutationFn: ({ baseId, includeData }: { baseId: string; includeData: boolean }) =>
      exportBase(baseId, { includeData }),
  });

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const { mutateAsync: moveBaseFn, isPending: moveBaseLoading } = useMutation({
    mutationFn: (baseId: string) => moveBase(baseId, spaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseList(spaceId!) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      const newSpace = spaceList?.find((space) => space.id === spaceId)?.name;
      toast.success(t('space:tip.moveBaseSuccessTitle'), {
        description: t('space:tip.moveBaseSuccessDescription', {
          baseName: base.name,
          spaceName: newSpace,
        }),
      });
    },
  });

  React.useEffect(() => {
    if (!exportConfirm) {
      setIncludeData(true);
      setExportState('idle');
      setExportDownloadUrl(null);
      setShowSlowTip(false);
      if (slowTipTimerRef.current) {
        clearTimeout(slowTipTimerRef.current);
        slowTipTimerRef.current = null;
      }
    }
  }, [exportConfirm]);

  React.useEffect(() => {
    if (exportState !== 'loading') return;

    const handleExportComplete = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        downloadUrl: string;
        fileName: string;
        baseName: string;
        isSuccess: boolean;
      };
      if (detail.baseName === base.name) {
        if (slowTipTimerRef.current) {
          clearTimeout(slowTipTimerRef.current);
          slowTipTimerRef.current = null;
        }
        if (detail.isSuccess && detail.downloadUrl) {
          e.preventDefault(); // Handled by dialog, skip toast
          setExportDownloadUrl(detail.downloadUrl);
          setExportState('done');
        } else {
          // Export failed — close dialog, let toast show the error
          setExportConfirm(false);
        }
      }
    };

    window.addEventListener('export-base-complete', handleExportComplete);
    return () => window.removeEventListener('export-base-complete', handleExportComplete);
  }, [exportState, base.name]);

  if (!showDelete && !showRename && !showDuplicate && !showExport && !showMove) {
    return null;
  }

  const handleDelete = (permanent?: boolean) => {
    if (onDelete) {
      onDelete(permanent);
    }
    setDeleteConfirm(false);
  };

  const handleStartExport = async () => {
    setExportState('loading');
    setShowSlowTip(false);
    slowTipTimerRef.current = setTimeout(() => {
      setShowSlowTip(true);
    }, 10000);
    try {
      await exportBaseFn({ baseId: base.id, includeData });
    } catch {
      // API request failed (network error, etc.)
      if (slowTipTimerRef.current) {
        clearTimeout(slowTipTimerRef.current);
        slowTipTimerRef.current = null;
      }
      setExportState('idle');
      toast.error(t('notification.exportBase.failedText'));
    }
  };

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
              <Button size={'sm'} onClick={() => handleDelete()}>
                {t('common:trash.addToTrash')}
              </Button>
            </DialogFooter>
          </>
        }
      />

      <Dialog
        open={exportConfirm}
        onOpenChange={setExportConfirm}
      >
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          closeable
        >
          <DialogHeader className="overflow-hidden">
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-6">
              <span className="shrink-0">{t('space:tip.exportTitle')}</span>
              <Database className="size-5 shrink-0" />
              <span className="truncate">{base.name}</span>
            </DialogTitle>
          </DialogHeader>

          {exportState === 'done' ? (
            <div className="flex flex-col items-center py-4">
              <Image
                src={isDark ? '/images/savefile-dark.png' : '/images/savefile-light.png'}
                alt=""
                width={200}
                height={200}
              />
              <p className="mt-4 text-center text-base font-medium">
                {t('common:notification.exportBase.successText')}
              </p>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                {t('space:tip.exportReadyDescription', { importHint: t('space:tip.exportTips2') })}
              </p>
              <a href={exportDownloadUrl || ''} download className="mt-4">
                <Button size="sm" className="gap-1">
                  <Download className="size-4" />
                  {t('actions.download')}
                </Button>
              </a>
            </div>
          ) : (
            <>
              <div className="space-y-4 text-sm">
                <div className="space-y-2 text-wrap">
                  <p>{t('space:tip.exportDescription')}</p>
                  <p>{t('space:tip.exportTips2')}</p>
                  <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                    <Info className="size-4 shrink-0" />
                    <span>Tips: {t('space:tip.exportTips3')}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t('space:tip.exportIncludeDataLabel')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('space:tip.exportIncludeDataDescription')}
                    </p>
                  </div>
                  <Switch
                    checked={includeData}
                    onCheckedChange={setIncludeData}
                    disabled={exportState === 'loading'}
                  />
                </div>
                {showSlowTip && (
                  <p className="text-sm text-amber-600 dark:text-amber-500">
                    {t('space:tip.exportSlowTip')}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExportConfirm(false)}
                  disabled={exportState === 'loading'}
                >
                  {t('actions.cancel')}
                </Button>
                <Button size="sm" onClick={handleStartExport} disabled={exportState === 'loading'}>
                  {exportState === 'loading' && <Loader2 className="size-4 animate-spin" />}
                  {t('space:tip.exportStartButton')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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
