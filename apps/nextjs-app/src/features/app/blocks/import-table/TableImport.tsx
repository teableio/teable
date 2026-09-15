import { useMutation } from '@tanstack/react-query';
import type { ITimeZoneString } from '@teable/core';
import type {
  IInplaceImportOptionRo,
  IImportOptionRo,
  IAnalyzeRo,
  IImportSheetItem,
  IAnalyzeVo,
  IImportOption,
  INotifyVo,
  IImportStreamProgressEvent,
  IImportSheetSummary,
  ITableFullVo,
} from '@teable/openapi';
import {
  importTypeMap,
  analyzeFile,
  importTableFromFileStream,
  inplaceImportTableFromFileStream,
  BaseNodeResourceType,
  SUPPORTEDTYPE,
} from '@teable/openapi';
import { useBase, LocalStorageKeys } from '@teable/sdk';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Spin,
  Progress,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Checkbox,
  cn,
  DialogTitle,
} from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocalStorage } from 'react-use';
import { getNodeUrl } from '../base/base-node/hooks';
import { FieldConfigPanel, InplaceFieldConfigPanel } from './field-config-panel';
import { UploadPanel } from './upload-panel';
import { UrlPanel } from './UrlPanel';

export type ITableImportAiSource = { type: 'file'; file: File } | { type: 'url'; url: string };

type IAnalyzeImportSource = IAnalyzeRo & { sourceType: ITableImportAiSource['type'] };

export interface ITableImportAiGuideProps {
  source: ITableImportAiSource;
  onCloseImport: () => void;
  onContinueManual: () => void;
  onPreparingChange: (isPreparing: boolean) => void;
}

export type TableImportAiGuideStatus = 'loading' | 'enabled' | 'disabled';

export interface ITableImportProps {
  open?: boolean;
  tableId?: string;
  folderId?: string;
  children?: React.ReactElement;
  fileType: SUPPORTEDTYPE;
  onOpenChange?: (open: boolean) => void;
  aiImportGuideStatus?: TableImportAiGuideStatus;
  renderAiImportGuide?: (props: ITableImportAiGuideProps) => React.ReactNode;
}

export type ITableImportOptions = IImportOption & {
  autoSelectType: boolean;
};

enum Step {
  UPLOAD = 'upload',
  GUIDE = 'guide',
  CONFIG = 'config',
  RESULT = 'result',
}

const getDialogTitleKey = (step: Step, tableId: string | undefined, fileType: SUPPORTEDTYPE) => {
  if ((step === Step.GUIDE || step === Step.CONFIG) && !tableId) {
    return 'table:import.title.createTable' as const;
  }
  if (fileType === SUPPORTEDTYPE.EXCEL) {
    return 'table:import.title.importFromExcel' as const;
  }
  return 'table:import.title.importFromCsv' as const;
};

const getTabsContentClassName = (step: Step, tableId?: string) =>
  cn(
    'min-h-0 flex-1 flex-col data-[state=active]:flex data-[state=inactive]:hidden',
    step === Step.CONFIG && !tableId ? 'overflow-hidden' : 'overflow-y-auto',
    step !== Step.UPLOAD && 'mt-0'
  );

const getDialogLayout = (step: Step, tableId: string | undefined) => {
  const isInplaceConfig = step === Step.CONFIG && Boolean(tableId);
  const hasFixedHeight = step === Step.CONFIG && !tableId;

  return {
    dialogClassName: cn(
      'z-50 grid min-h-0 w-[calc(100%_-_2rem)] max-w-[800px] overflow-hidden rounded-lg',
      isInplaceConfig ? 'grid-rows-[minmax(0,1fr)_auto]' : 'grid-rows-[auto_minmax(0,1fr)_auto]',
      hasFixedHeight ? 'h-[min(80vh,720px)] max-h-[calc(100vh-2rem)]' : 'max-h-[calc(100vh-2rem)]'
    ),
    contentRowClassName: isInplaceConfig ? 'row-start-1' : 'row-start-2',
    footerRowClassName: isInplaceConfig ? 'row-start-2' : 'row-start-3',
  };
};

type IImportResult = {
  tableId: string;
  viewId?: string;
  sheets?: IImportSheetSummary[];
};

const ImportProgressPanel = ({ progress }: { progress: IImportStreamProgressEvent | null }) => {
  const { t } = useTranslation(['table']);
  const progressPercent =
    progress && progress.totalCount > 0
      ? Math.min(100, Math.round((progress.processedCount / progress.totalCount) * 100))
      : 0;
  let progressLabel = t('table:import.tips.importing');
  if (progress && progress.totalCount > 0) {
    progressLabel = t('table:import.tips.importingRows', {
      processed: progress.processedCount.toLocaleString(),
      total: progress.totalCount.toLocaleString(),
    });
  } else if (progress && (progress.phase === 'preparing' || progress.phase === 'parsing')) {
    progressLabel = t('table:import.tips.preparingImport');
  } else if (progress) {
    progressLabel = t('table:import.tips.importingRowsUnknown', {
      processed: progress.processedCount.toLocaleString(),
    });
  }

  return (
    <div className="mb-3 w-full space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{progressLabel}</span>
        {progress && progress.totalCount > 0 && (
          <span className="tabular-nums">{progressPercent}%</span>
        )}
      </div>
      {progress && progress.sheetCount > 1 && progress.sheetName && (
        <div className="text-xs text-muted-foreground">
          {t('table:import.tips.importingSheet', {
            current: String(progress.sheetIndex + 1),
            total: String(progress.sheetCount),
            name: progress.sheetName,
          })}
        </div>
      )}
      <Progress value={progress?.totalCount ? progressPercent : undefined} />
    </div>
  );
};

const ImportSummaryPanel = ({ sheets }: { sheets: IImportSheetSummary[] }) => {
  const { t } = useTranslation(['table']);
  const hasIssue = sheets.some((sheet) => sheet.truncated || Boolean(sheet.error));

  return (
    <div className="row-start-2 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-1">
      <div>
        <h3 className="text-base font-medium">
          {hasIssue
            ? t('table:import.tips.importFinishedPartial')
            : t('table:import.tips.importFinished')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('table:import.tips.importSummaryHint')}
        </p>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pe-1">
        {sheets.map((sheet) => {
          const isError = Boolean(sheet.error);
          const isTruncated = Boolean(sheet.truncated) && !isError;
          return (
            <li
              key={sheet.name}
              className={`rounded-md border px-3 py-2 text-sm ${
                isError
                  ? 'border-destructive/40 bg-destructive/5'
                  : isTruncated
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-border'
              }`}
            >
              <div className="break-all font-medium">{sheet.name}</div>
              <div
                className={`mt-0.5 ${
                  isError
                    ? 'text-destructive'
                    : isTruncated
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-muted-foreground'
                }`}
              >
                {isError
                  ? t('table:import.tips.importSheetFailed', { error: sheet.error ?? '' })
                  : isTruncated
                    ? t('table:import.tips.importSheetTruncated', {
                        rowCount: sheet.importedCount,
                      })
                    : t('table:import.tips.importSheetImported', {
                        rowCount: sheet.importedCount,
                      })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

interface IImportConfigContentProps {
  step: Step;
  tableId?: string;
  workSheets: IImportOptionRo['worksheets'];
  insertConfig: IInplaceImportOptionRo['insertConfig'];
  errorMessage: string;
  aiImportSource: ITableImportAiSource | null;
  aiImportGuideStatus: TableImportAiGuideStatus;
  renderAiImportGuide?: ITableImportProps['renderAiImportGuide'];
  onCloseAiImport: () => void;
  onContinueManual: () => void;
  onBackToGuide: () => void;
  onPreparingChange: (isPreparing: boolean) => void;
  onFieldChange: (value: IImportOptionRo['worksheets']) => void;
  onInplaceFieldChange: (value: IInplaceImportOptionRo['insertConfig']) => void;
}

const ImportConfigContent = ({
  step,
  tableId,
  workSheets,
  insertConfig,
  errorMessage,
  aiImportSource,
  aiImportGuideStatus,
  renderAiImportGuide,
  onCloseAiImport,
  onContinueManual,
  onBackToGuide,
  onPreparingChange,
  onFieldChange,
  onInplaceFieldChange,
}: IImportConfigContentProps) => {
  if (step !== Step.GUIDE && step !== Step.CONFIG) return null;

  if (tableId) {
    return (
      <InplaceFieldConfigPanel
        tableId={tableId}
        workSheets={workSheets}
        insertConfig={insertConfig}
        errorMessage={errorMessage}
        onChange={onInplaceFieldChange}
      />
    );
  }

  return (
    <>
      {step === Step.GUIDE && aiImportGuideStatus === 'loading' && (
        <div className="flex min-h-[360px] flex-1 items-center justify-center sm:min-h-[400px]">
          <Spin className="size-5" />
        </div>
      )}
      {step === Step.GUIDE &&
        aiImportGuideStatus === 'enabled' &&
        aiImportSource &&
        renderAiImportGuide?.({
          source: aiImportSource,
          onCloseImport: onCloseAiImport,
          onContinueManual,
          onPreparingChange,
        })}
      <FieldConfigPanel
        className={step === Step.CONFIG ? undefined : 'hidden'}
        workSheets={workSheets}
        errorMessage={errorMessage}
        onBack={
          aiImportGuideStatus === 'enabled' && renderAiImportGuide ? onBackToGuide : undefined
        }
        onChange={onFieldChange}
      />
    </>
  );
};

export const TableImport = (props: ITableImportProps) => {
  const base = useBase();
  const router = useRouter();
  const { t } = useTranslation(['table']);
  const [step, setStep] = useState(Step.UPLOAD);
  const {
    children,
    open,
    onOpenChange,
    fileType,
    tableId,
    folderId,
    aiImportGuideStatus,
    renderAiImportGuide,
  } = props;
  const resolvedAiImportGuideStatus =
    aiImportGuideStatus ?? (renderAiImportGuide ? 'enabled' : 'disabled');
  const [errorMessage, setErrorMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<IAnalyzeRo>({} as IAnalyzeRo);
  const primitiveWorkSheets = useRef<IAnalyzeVo['worksheets']>({});
  const [workSheets, setWorkSheets] = useState<IImportOptionRo['worksheets']>({});
  const [insertConfig, setInsertConfig] = useState<IInplaceImportOptionRo['insertConfig']>({
    excludeFirstRow: true,
    sourceWorkSheetKey: '',
    sourceColumnMap: {},
  });
  const [shouldAlert, setShouldAlert] = useLocalStorage(LocalStorageKeys.ImportAlert, true);
  const [shouldTips, setShouldTips] = useState(false);
  const [importProgress, setImportProgress] = useState<IImportStreamProgressEvent | null>(null);
  const [importResult, setImportResult] = useState<IImportResult | null>(null);
  const [isAiImportPreparing, setIsAiImportPreparing] = useState(false);
  const aiImportSource: ITableImportAiSource | null = file
    ? { type: 'file', file }
    : sourceUrl
      ? { type: 'url', url: sourceUrl }
      : null;

  const navigateToImportedTable = (result: { tableId: string; viewId?: string }) => {
    const url = getNodeUrl({
      baseId: base.id,
      resourceType: BaseNodeResourceType.Table,
      resourceId: result.tableId,
      viewId: result.viewId,
    });
    if (url) {
      router.push(url, undefined, { shallow: true });
    }
  };

  const closeDialog = (nextOpen: boolean, result?: IImportResult | null) => {
    if (!nextOpen) {
      const target = result ?? importResult;
      if (target?.tableId) {
        navigateToImportedTable(target);
      }
      setStep(Step.UPLOAD);
      setFile(null);
      setSourceUrl(null);
      setFileInfo({} as IAnalyzeRo);
      setWorkSheets({});
      setInsertConfig({
        excludeFirstRow: true,
        sourceWorkSheetKey: '',
        sourceColumnMap: {},
      });
      primitiveWorkSheets.current = {};
      setErrorMessage('');
      setShouldTips(false);
      setImportResult(null);
      setImportProgress(null);
      setIsAiImportPreparing(false);
    }
    onOpenChange?.(nextOpen);
  };

  const { mutateAsync: importNewTableFn, isPending: isLoading } = useMutation({
    mutationFn: async ({ baseId, importRo }: { baseId: string; importRo: IImportOptionRo }) => {
      setImportProgress(null);
      const result = await importTableFromFileStream(
        baseId,
        { ...importRo, folderId },
        {
          onProgress: setImportProgress,
        }
      );
      const tables = result.done.data.tables as ITableFullVo[] | undefined;
      if (!tables?.length) {
        throw new Error('Import stream ended without tables');
      }
      return {
        tableId: tables[0].id,
        viewId: tables[0].defaultViewId,
        sheets: result.done.data.sheets,
      };
    },
    onSuccess: ({ tableId, viewId, sheets }) => {
      if (sheets?.length) {
        setImportResult({ tableId, viewId, sheets });
        setStep(Step.RESULT);
        return;
      }
      closeDialog(false, { tableId, viewId });
    },
  });

  const { mutateAsync: inplaceImportFn, isPending: inplaceLoading } = useMutation({
    mutationFn: (args: Parameters<typeof inplaceImportTableFromFileStream>) => {
      setImportProgress(null);
      return inplaceImportTableFromFileStream(args[0], args[1], args[2], {
        onProgress: setImportProgress,
      });
    },
    onSuccess: () => {
      closeDialog(false);
      const { tableId: routerTableId } = router.query;
      routerTableId !== tableId && router.push(`/base/${base.id}/table/${tableId}`);
    },
  });

  const importTable = async () => {
    const importNewTable = () => {
      for (const [, value] of Object.entries(workSheets)) {
        const { columns } = value;

        if (columns.some((col) => !col.name)) {
          setErrorMessage(t('table:import.form.error.fieldNameEmpty'));
          return;
        }
        if (new Set(columns.map((col) => col.name.trim())).size !== columns.length) {
          setErrorMessage(t('table:import.form.error.uniqueFieldName'));
          return;
        }
      }

      // errors (e.g. 402 plan limits) are surfaced by the global mutation
      // error handler; swallow the rejection to avoid an unhandled promise
      importNewTableFn({
        baseId: base.id,
        importRo: {
          worksheets: workSheets,
          ...fileInfo,
          notification: true,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
        },
      }).catch(() => undefined);
    };

    const inplaceImportTable = () => {
      const { sourceColumnMap } = insertConfig;
      if (Object.values(sourceColumnMap).every((col) => col === null)) {
        setErrorMessage(t('table:import.form.error.atLeastAImportField'));
        return;
      }
      const preInsertConfig = {
        ...insertConfig,
        sourceColumnMap: Object.fromEntries(
          Object.entries(sourceColumnMap).filter(([, value]) => value !== null)
        ),
      };
      // errors are surfaced by the global mutation error handler; swallow the
      // rejection to avoid an unhandled promise
      inplaceImportFn([
        base.id,
        tableId as string,
        {
          ...fileInfo,
          insertConfig: preInsertConfig,
          notification: true,
        },
      ]).catch(() => undefined);
    };

    tableId ? inplaceImportTable() : importNewTable();
  };

  const { mutateAsync: analyzeImportSource, isPending: analyzeLoading } = useMutation({
    mutationFn: (params: IAnalyzeImportSource) =>
      analyzeFile({ attachmentUrl: params.attachmentUrl, fileType: params.fileType }),
    onSuccess: (data, params) => {
      const { attachmentUrl, fileType, sourceType } = params;
      if (sourceType === 'url') setFile(null);
      setSourceUrl(sourceType === 'url' ? attachmentUrl : null);
      setFileInfo({
        attachmentUrl,
        fileType,
      });
      const {
        data: { worksheets },
      } = data;

      const workSheetsWithIndex: IImportOptionRo['worksheets'] = {};
      for (const [key, value] of Object.entries(worksheets)) {
        const item = { ...value, importData: true, useFirstRowAsHeader: true } as IImportSheetItem;
        item.columns = item.columns.map((col, index) => ({
          ...col,
          sourceColumnIndex: index,
        }));

        workSheetsWithIndex[key] = item;
      }
      setInsertConfig({ ...insertConfig, ['sourceWorkSheetKey']: Object.keys(worksheets)[0] });
      setWorkSheets(workSheetsWithIndex);
      primitiveWorkSheets.current = worksheets;
      const hasAiImportSource = sourceType === 'url' || Boolean(file);
      const shouldShowAiGuide =
        !tableId &&
        hasAiImportSource &&
        renderAiImportGuide &&
        resolvedAiImportGuideStatus !== 'disabled';
      setStep(shouldShowAiGuide ? Step.GUIDE : Step.CONFIG);
    },
  });

  const analyzeByUrl = useCallback(
    (params: IAnalyzeRo) => analyzeImportSource({ ...params, sourceType: 'url' }),
    [analyzeImportSource]
  );

  const fileFinishedHandler = useCallback(
    async (result: INotifyVo) => {
      const { presignedUrl } = result;

      await analyzeImportSource({
        attachmentUrl: presignedUrl,
        fileType,
        sourceType: 'file',
      });
    },
    [analyzeImportSource, fileType]
  );

  const fileCloseHandler = useCallback(() => {
    setFile(null);
    setSourceUrl(null);
  }, []);

  const fileChangeHandler = useCallback(
    (file: File | null) => {
      const { exceedSize, accept } = importTypeMap[fileType];

      const acceptGroup = accept.split(',');

      if (file && !acceptGroup.includes(file.type)) {
        toast.error(t('table:import.form.error.errorFileFormat'));
        return;
      }

      if (exceedSize && file && file.size > exceedSize * 1024 * 1024) {
        toast.error(`${t('table:import.tips.fileExceedSizeTip')} ${exceedSize}MB`);
        return;
      }

      setSourceUrl(null);
      setFile(file);
    },
    [fileType, t]
  );

  const fieldChangeHandler = (value: IImportOptionRo['worksheets']) => {
    setWorkSheets(value);
  };

  const inplaceFieldChangeHandler = (value: IInplaceImportOptionRo['insertConfig']) => {
    setInsertConfig(value);
  };

  const isImporting = tableId ? inplaceLoading : isLoading;
  const closeAiImport = () => {
    closeDialog(false);
  };

  useEffect(() => {
    if (step === Step.GUIDE && resolvedAiImportGuideStatus === 'disabled' && !isAiImportPreparing) {
      setStep(Step.CONFIG);
    }
  }, [isAiImportPreparing, resolvedAiImportGuideStatus, step]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isAiImportPreparing) return;
    closeDialog(nextOpen);
  };

  const dialogTitle = t(getDialogTitleKey(step, tableId, fileType));
  const showDialogTitle = step === Step.UPLOAD || (!tableId && step !== Step.RESULT);
  const { dialogClassName, contentRowClassName, footerRowClassName } = getDialogLayout(
    step,
    tableId
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {children && <DialogTrigger>{children}</DialogTrigger>}
        {open && (
          <DialogContent
            className={dialogClassName}
            closeable={!isAiImportPreparing}
            overlayStyle={{
              pointerEvents: 'none',
            }}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
          >
            <DialogTitle className={showDialogTitle ? undefined : 'sr-only'}>
              {dialogTitle}
            </DialogTitle>
            {step === Step.RESULT && importResult?.sheets ? (
              <ImportSummaryPanel sheets={importResult.sheets} />
            ) : (
              <Tabs
                defaultValue="localFile"
                className={cn('flex h-full min-h-0 flex-col overflow-hidden', contentRowClassName)}
              >
                {step === Step.UPLOAD && (
                  <TabsList className="self-start">
                    <TabsTrigger value="localFile">{t('table:import.title.localFile')}</TabsTrigger>
                    <TabsTrigger value="url">{t('table:import.title.linkUrl')}</TabsTrigger>
                  </TabsList>
                )}

                <TabsContent value="localFile" className={getTabsContentClassName(step, tableId)}>
                  {step === Step.UPLOAD && (
                    <UploadPanel
                      fileType={fileType}
                      file={file}
                      onChange={fileChangeHandler}
                      onClose={fileCloseHandler}
                      analyzeLoading={analyzeLoading}
                      onFinished={fileFinishedHandler}
                    />
                  )}
                  <ImportConfigContent
                    step={step}
                    tableId={tableId}
                    workSheets={workSheets}
                    insertConfig={insertConfig}
                    errorMessage={errorMessage}
                    aiImportSource={aiImportSource}
                    aiImportGuideStatus={resolvedAiImportGuideStatus}
                    renderAiImportGuide={renderAiImportGuide}
                    onCloseAiImport={closeAiImport}
                    onContinueManual={() => setStep(Step.CONFIG)}
                    onBackToGuide={() => setStep(Step.GUIDE)}
                    onPreparingChange={setIsAiImportPreparing}
                    onFieldChange={fieldChangeHandler}
                    onInplaceFieldChange={inplaceFieldChangeHandler}
                  />
                </TabsContent>
                <TabsContent value="url" className={getTabsContentClassName(step, tableId)}>
                  {step === Step.UPLOAD && (
                    <UrlPanel
                      analyzeFn={analyzeByUrl}
                      isFinished={analyzeLoading}
                      fileType={fileType}
                    ></UrlPanel>
                  )}
                  <ImportConfigContent
                    step={step}
                    tableId={tableId}
                    workSheets={workSheets}
                    insertConfig={insertConfig}
                    errorMessage={errorMessage}
                    aiImportSource={aiImportSource}
                    aiImportGuideStatus={resolvedAiImportGuideStatus}
                    renderAiImportGuide={renderAiImportGuide}
                    onCloseAiImport={closeAiImport}
                    onContinueManual={() => setStep(Step.CONFIG)}
                    onBackToGuide={() => setStep(Step.GUIDE)}
                    onPreparingChange={setIsAiImportPreparing}
                    onFieldChange={fieldChangeHandler}
                    onInplaceFieldChange={inplaceFieldChangeHandler}
                  />
                </TabsContent>
              </Tabs>
            )}
            {step === Step.RESULT && (
              <DialogFooter className="row-start-3 min-h-8">
                <Button size="sm" onClick={() => closeDialog(false)}>
                  {t('table:import.tips.importDone')}
                </Button>
              </DialogFooter>
            )}
            {step === Step.CONFIG && (
              <DialogFooter
                className={cn(
                  'min-h-8 flex-col items-stretch sm:flex-col sm:items-stretch',
                  footerRowClassName
                )}
              >
                {isImporting && <ImportProgressPanel progress={importProgress} />}
                <footer className="mt-1 flex items-center justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isImporting}
                    onClick={() => closeDialog(false)}
                  >
                    {t('table:import.menu.cancel')}
                  </Button>
                  <AlertDialog>
                    {shouldAlert ? (
                      <AlertDialogTrigger asChild>
                        <Button size="sm" className="ms-1" disabled={isImporting}>
                          {isImporting && <Spin className="me-1 size-4" />}
                          {t('table:import.title.import')}
                        </Button>
                      </AlertDialogTrigger>
                    ) : (
                      <Button
                        size="sm"
                        className="ms-1"
                        onClick={() => importTable()}
                        disabled={isImporting}
                      >
                        {isImporting && <Spin className="me-1 size-4" />}
                        {t('table:import.title.import')}
                      </Button>
                    )}
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('table:import.title.tipsTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('table:import.tips.importAlert')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="flex items-center">
                        <Checkbox
                          id="noTips"
                          checked={shouldTips}
                          onCheckedChange={(res: boolean) => {
                            setShouldTips(res);
                          }}
                        />
                        <label
                          htmlFor="noTips"
                          className="ps-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {t('table:import.tips.noTips')}
                        </label>
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('table:import.menu.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            importTable();
                            if (shouldTips) {
                              setShouldAlert(false);
                            }
                          }}
                        >
                          {t('table:import.title.confirm')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </footer>
              </DialogFooter>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
};
