import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Info,
  Copy,
  Database,
  Download,
  Export,
  Loader2,
  Pencil,
  Share2,
  Trash2,
  ArrowRight,
} from '@teable/icons';
import { useTheme } from '@teable/next-themes';
import { exportBaseStream, getSpaceList, moveBase, moveBaseCheck } from '@teable/openapi';
import type {
  ICrossSpaceAffectedField,
  IExportBaseProgressEvent,
  IGetBaseVo,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
import { downloadUrlWithFileName } from '@/features/app/utils/download-url';
import { BaseShareDialog } from '../../base/base-side-bar/BaseShareDialog';
import { useDuplicateBaseStore } from '../../base/duplicate/useDuplicateBaseStore';
import { EditableSpaceSelect } from './EditableSpaceSelect';

const EXPORT_PHASE_I18N_MAP: Record<string, string> = {
  preparing: 'space:export.phase.preparing',
  exporting_archive: 'space:export.phase.exportingArchive',
  exporting_structure: 'space:export.phase.exportingStructure',
  exporting_attachments: 'space:export.phase.exportingAttachments',
  exporting_attachment_metadata: 'space:export.phase.exportingAttachmentMetadata',
  exporting_table_data: 'space:export.phase.exportingTableData',
  table_data_started: 'space:export.phase.tableDataStarted',
  table_data_progress: 'space:export.phase.tableDataProgress',
  table_data_done: 'space:export.phase.tableDataDone',
  exporting_extra_files: 'space:export.phase.exportingExtraFiles',
  exporting_app_files: 'space:export.phase.exportingAppFiles',
  uploading_archive: 'space:export.phase.uploadingArchive',
  generating_download_url: 'space:export.phase.generatingDownloadUrl',
  done: 'space:export.phase.done',
};

interface IBaseActionTrigger {
  base: IGetBaseVo;
  showRename: boolean;
  showDelete: boolean;
  showDuplicate: boolean;
  showExport: boolean;
  showMove: boolean;
  showShare?: boolean;
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
    showShare,
    onDelete,
    onRename,
    align = 'end',
  } = props;
  const { t } = useTranslation(['common', 'space']);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [exportConfirm, setExportConfirm] = React.useState(false);
  const [exportState, setExportState] = React.useState<'idle' | 'loading' | 'done'>('idle');
  const [exportDownloadUrl, setExportDownloadUrl] = React.useState<string | null>(null);
  const [exportDownloadFileName, setExportDownloadFileName] = React.useState<string | null>(null);
  const [exportProgressMessage, setExportProgressMessage] = React.useState<string | null>(null);
  const [exportProgress, setExportProgress] = React.useState<IExportBaseProgressEvent | null>(null);
  const [showSlowTip, setShowSlowTip] = React.useState(false);
  const [moveConfirm, setMoveConfirm] = React.useState(false);
  const [spaceId, setSpaceId] = React.useState<string | null>(null);
  const [includeData, setIncludeData] = React.useState(true);
  const slowTipTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseStore = useDuplicateBaseStore();
  const queryClient = useQueryClient();
  // t() receives runtime keys for stream phases, so keep the cast local to this component.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tAny = t as (key: string, options?: Record<string, any>) => string;

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const [crossSpaceConfirm, setCrossSpaceConfirm] = React.useState<{
    open: boolean;
    affectedFields: ICrossSpaceAffectedField[];
  }>({ open: false, affectedFields: [] });

  // Group by destination table (baseId + tableId). Move-base may include
  // incoming refs from other bases, so we surface baseName as part of the
  // group header to keep cross-base context visible.
  const crossSpaceGrouped = React.useMemo(() => {
    if (!crossSpaceConfirm.affectedFields.length) return null;
    const groups = new Map<
      string,
      { baseName: string; tableName: string; fields: ICrossSpaceAffectedField[] }
    >();
    for (const f of crossSpaceConfirm.affectedFields) {
      const key = `${f.baseId}:${f.tableId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.fields.push(f);
      } else {
        groups.set(key, { baseName: f.baseName, tableName: f.tableName, fields: [f] });
      }
    }
    return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
  }, [crossSpaceConfirm.affectedFields]);

  const { mutate: moveBaseFn, isPending: moveBaseLoading } = useMutation({
    mutationFn: ({ baseId }: { baseId: string }) => moveBase(baseId, spaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseList(spaceId!) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      setCrossSpaceConfirm({ open: false, affectedFields: [] });
      const newSpace = spaceList?.find((space) => space.id === spaceId)?.name;
      toast.success(t('space:tip.moveBaseSuccessTitle'), {
        description: t('space:tip.moveBaseSuccessDescription', {
          baseName: base.name,
          spaceName: newSpace,
        }),
      });
    },
  });

  const { mutate: checkMoveFn, isPending: checkMoveLoading } = useMutation({
    mutationFn: ({ baseId }: { baseId: string }) =>
      moveBaseCheck(baseId, spaceId!).then((res) => res.data),
    onSuccess: (data, { baseId }) => {
      if (data.affectedFields.length > 0) {
        setMoveConfirm(false);
        setCrossSpaceConfirm({ open: true, affectedFields: data.affectedFields });
      } else {
        setMoveConfirm(false);
        moveBaseFn({ baseId });
      }
    },
  });

  React.useEffect(() => {
    if (!exportConfirm) {
      setIncludeData(true);
      setExportState('idle');
      setExportDownloadUrl(null);
      setExportDownloadFileName(null);
      setExportProgressMessage(null);
      setExportProgress(null);
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
          setExportDownloadFileName(detail.fileName);
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

  const translateExportPhase = React.useCallback(
    (phase: string, detail?: string, event?: IExportBaseProgressEvent) => {
      const i18nKey = EXPORT_PHASE_I18N_MAP[phase];
      if (!i18nKey) return detail ?? phase;
      return tAny(i18nKey, {
        detail,
        tableName: event?.tableName ?? detail,
        tableIndex: event?.tableIndex,
        totalTables: event?.totalTables,
        processedRows: event?.processedRows,
        batchProcessedRows: event?.batchProcessedRows,
        currentBatch: event?.currentBatch,
      });
    },
    [tAny]
  );

  if (!showDelete && !showRename && !showDuplicate && !showExport && !showMove && !showShare) {
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
    setExportProgressMessage(translateExportPhase('preparing'));
    setExportProgress(null);
    slowTipTimerRef.current = setTimeout(() => {
      setShowSlowTip(true);
    }, 10000);
    try {
      const result = await exportBaseStream(base.id, { includeData }, (phase, detail, event) => {
        setExportProgress(event ?? null);
        setExportProgressMessage(translateExportPhase(phase, detail, event));
      });
      if (slowTipTimerRef.current) {
        clearTimeout(slowTipTimerRef.current);
        slowTipTimerRef.current = null;
      }
      setExportDownloadUrl(result.data.previewUrl);
      setExportDownloadFileName(result.data.fileName);
      setExportState('done');
    } catch {
      // API request failed (network error, etc.)
      if (slowTipTimerRef.current) {
        clearTimeout(slowTipTimerRef.current);
        slowTipTimerRef.current = null;
      }
      setExportState('idle');
      setExportProgressMessage(null);
      setExportProgress(null);
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
          {showShare && (
            <DropdownMenuItem onClick={() => setShareOpen(true)}>
              <Share2 className="mr-2" />
              {t('actions.share')}
            </DropdownMenuItem>
          )}
          {showExport && (
            <DropdownMenuItem
              onClick={() => {
                setExportConfirm(true);
              }}
            >
              <Export className="mr-2 size-4" />
              {t('actions.export')}
            </DropdownMenuItem>
          )}
          {showMove && (
            <DropdownMenuItem
              onClick={() => {
                setMoveConfirm(true);
              }}
            >
              <ArrowRight className="mr-2 size-4" />
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

      <Dialog open={exportConfirm} onOpenChange={setExportConfirm}>
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
              <a
                href={exportDownloadUrl || ''}
                download={exportDownloadFileName || undefined}
                className="mt-4"
                onClick={(event) => {
                  if (!exportDownloadUrl || !exportDownloadFileName) return;
                  event.preventDefault();
                  void downloadUrlWithFileName(exportDownloadUrl, exportDownloadFileName);
                }}
              >
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
                {exportState === 'loading' && exportProgressMessage && (
                  <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      <span>{exportProgressMessage}</span>
                    </div>
                    {exportProgress?.processedRows != null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tAny('space:export.phase.rowsProgress', {
                          count: exportProgress.processedRows,
                        })}
                      </p>
                    )}
                  </div>
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
        confirmLoading={checkMoveLoading || moveBaseLoading}
        onConfirm={() => {
          if (base.id && spaceId) {
            checkMoveFn({ baseId: base.id });
          }
        }}
      />

      <ConfirmDialog
        open={crossSpaceConfirm.open}
        onOpenChange={(open) => !open && setCrossSpaceConfirm({ open: false, affectedFields: [] })}
        title={t('space:tip.moveBaseCrossSpaceTitle')}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setCrossSpaceConfirm({ open: false, affectedFields: [] })}
        confirmLoading={moveBaseLoading}
        onConfirm={() => {
          if (base.id && spaceId) {
            moveBaseFn({ baseId: base.id });
          }
        }}
        content={
          <div className="flex flex-col gap-3 text-sm">
            {crossSpaceConfirm.affectedFields.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {t('space:tip.moveBaseCrossSpaceDataLossWarning')}
              </div>
            )}
            {crossSpaceGrouped && (
              <div className="overflow-hidden rounded-md border bg-muted/30">
                <Accordion type="multiple" className="max-h-64 overflow-y-auto">
                  {crossSpaceGrouped.map((group) => (
                    <AccordionItem key={group.key} value={group.key} className="border-b-0">
                      <AccordionTrigger
                        aria-label={t('space:crossSpace.affectedTableSuffix', {
                          count: group.fields.length,
                        })}
                        className="px-3 py-2 text-xs font-normal transition-colors data-[state=open]:bg-muted/70 hover:bg-muted/60 hover:no-underline"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                          <Database className="size-3.5 shrink-0 text-muted-foreground/70" />
                          <span className="truncate font-medium text-foreground">
                            {group.baseName}
                          </span>
                          <span className="shrink-0 text-muted-foreground/40">/</span>
                          <span className="truncate text-muted-foreground">{group.tableName}</span>
                          <span className="ml-1 shrink-0 rounded bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none text-muted-foreground">
                            {group.fields.length}
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent innerClassName="px-3 pb-2.5 pt-0">
                        <div className="flex flex-wrap gap-1 pl-[1.375rem]">
                          {group.fields.map((f) => (
                            <span
                              key={f.fieldId}
                              className="inline-flex items-center rounded border bg-background/80 px-1.5 py-0.5 text-xs text-foreground/85"
                            >
                              {f.fieldName}
                            </span>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            )}
          </div>
        }
      />

      <BaseShareDialog
        baseId={base.id}
        baseName={base.name}
        isBaseShared={!!base.isShared}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </>
  );
};
