import { useMutation } from '@tanstack/react-query';
import type { ITimeZoneString } from '@teable/core';
import type {
  IInplaceImportOptionRo,
  IImportOptionRo,
  IAnalyzeRo,
  IImportSheetItem,
  SUPPORTEDTYPE,
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
} from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useCallback } from 'react';
import { useLocalStorage } from 'react-use';
import { getNodeUrl } from '../base/base-node/hooks';
import { FieldConfigPanel, InplaceFieldConfigPanel } from './field-config-panel';
import { UploadPanel } from './upload-panel';
import { UrlPanel } from './UrlPanel';

interface ITableImportProps {
  open?: boolean;
  tableId?: string;
  folderId?: string;
  children?: React.ReactElement;
  fileType: SUPPORTEDTYPE;
  onOpenChange?: (open: boolean) => void;
}

export type ITableImportOptions = IImportOption & {
  autoSelectType: boolean;
};

enum Step {
  UPLOAD = 'upload',
  CONFIG = 'config',
  RESULT = 'result',
}

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
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden py-1">
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

export const TableImport = (props: ITableImportProps) => {
  const base = useBase();
  const router = useRouter();
  const { t } = useTranslation(['table']);
  const [step, setStep] = useState(Step.UPLOAD);
  const { children, open, onOpenChange, fileType, tableId, folderId } = props;
  const [errorMessage, setErrorMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
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
        setStep(Step.UPLOAD);
      }
      setImportResult(null);
      setImportProgress(null);
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
      onOpenChange?.(false);
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

  const { mutateAsync: analyzeByUrl, isPending: analyzeLoading } = useMutation({
    mutationFn: analyzeFile,
    onSuccess: (data, params) => {
      const { attachmentUrl, fileType } = params;
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
      setStep(Step.CONFIG);
    },
  });

  const fileFinishedHandler = useCallback(
    async (result: INotifyVo) => {
      const { presignedUrl } = result;

      await analyzeByUrl({
        attachmentUrl: presignedUrl,
        fileType,
      });
    },
    [analyzeByUrl, fileType]
  );

  const fileCloseHandler = useCallback(() => {
    setFile(null);
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

  return (
    <>
      <Dialog open={open} onOpenChange={closeDialog}>
        {children && <DialogTrigger>{children}</DialogTrigger>}
        {open && (
          <DialogContent
            className="z-50 flex max-h-[80%] max-w-[800px] flex-col overflow-hidden"
            overlayStyle={{
              pointerEvents: 'none',
            }}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
          >
            {step === Step.RESULT && importResult?.sheets ? (
              <ImportSummaryPanel sheets={importResult.sheets} />
            ) : (
              <Tabs defaultValue="localFile" className="flex-1 overflow-auto">
                {step === Step.UPLOAD && (
                  <TabsList>
                    <TabsTrigger value="localFile">{t('table:import.title.localFile')}</TabsTrigger>
                    <TabsTrigger value="url">{t('table:import.title.linkUrl')}</TabsTrigger>
                  </TabsList>
                )}

                <TabsContent value="localFile">
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
                  {step === Step.CONFIG &&
                    (tableId ? (
                      <InplaceFieldConfigPanel
                        tableId={tableId}
                        workSheets={workSheets}
                        insertConfig={insertConfig}
                        errorMessage={errorMessage}
                        onChange={inplaceFieldChangeHandler}
                      ></InplaceFieldConfigPanel>
                    ) : (
                      <FieldConfigPanel
                        tableId={tableId}
                        workSheets={workSheets}
                        errorMessage={errorMessage}
                        onChange={fieldChangeHandler}
                      ></FieldConfigPanel>
                    ))}
                </TabsContent>
                <TabsContent value="url">
                  {step === Step.UPLOAD && (
                    <UrlPanel
                      analyzeFn={analyzeByUrl}
                      isFinished={analyzeLoading}
                      fileType={fileType}
                    ></UrlPanel>
                  )}
                  {step === Step.CONFIG &&
                    (tableId ? (
                      <InplaceFieldConfigPanel
                        tableId={tableId}
                        workSheets={workSheets}
                        insertConfig={insertConfig}
                        errorMessage={errorMessage}
                        onChange={inplaceFieldChangeHandler}
                      ></InplaceFieldConfigPanel>
                    ) : (
                      <FieldConfigPanel
                        tableId={tableId}
                        workSheets={workSheets}
                        errorMessage={errorMessage}
                        onChange={fieldChangeHandler}
                      ></FieldConfigPanel>
                    ))}
                </TabsContent>
              </Tabs>
            )}
            {step === Step.RESULT && (
              <DialogFooter>
                <Button size="sm" onClick={() => closeDialog(false)}>
                  {t('table:import.tips.importDone')}
                </Button>
              </DialogFooter>
            )}
            {step === Step.CONFIG && (
              <DialogFooter className="flex-col items-stretch sm:flex-col sm:items-stretch">
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
