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
} from '@teable/openapi';
import {
  importTypeMap,
  analyzeFile,
  importTableFromFile,
  inplaceImportTableFromFile,
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
import { FieldConfigPanel, InplaceFieldConfigPanel } from './field-config-panel';
import { UploadPanel } from './upload-panel';
import { UrlPanel } from './UrlPanel';

interface ITableImportProps {
  open?: boolean;
  tableId?: string;
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
}

export const TableImport = (props: ITableImportProps) => {
  const base = useBase();
  const router = useRouter();
  const { t } = useTranslation(['table']);
  const [step, setStep] = useState(Step.UPLOAD);
  const { children, open, onOpenChange, fileType, tableId } = props;
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

  const { mutateAsync: importNewTableFn, isLoading } = useMutation({
    mutationFn: async ({ baseId, importRo }: { baseId: string; importRo: IImportOptionRo }) => {
      return (await importTableFromFile(baseId, importRo)).data;
    },
    onSuccess: (data) => {
      const { defaultViewId: viewId, id: tableId } = data[0];
      onOpenChange?.(false);
      router.push(
        {
          pathname: '/base/[baseId]/[tableId]/[viewId]',
          query: { baseId: base.id, tableId, viewId },
        },
        undefined,
        {
          shallow: true,
        }
      );
    },
  });

  const { mutateAsync: inplaceImportFn, isLoading: inplaceLoading } = useMutation({
    mutationFn: (args: Parameters<typeof inplaceImportTableFromFile>) => {
      return inplaceImportTableFromFile(...args);
    },
    onSuccess: () => {
      onOpenChange?.(false);
      const { tableId: routerTableId } = router.query;
      routerTableId !== tableId &&
        router.push(
          {
            pathname: '/base/[baseId]/[tableId]',
            query: { baseId: base.id, tableId },
          },
          undefined,
          {
            shallow: true,
          }
        );
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

      importNewTableFn({
        baseId: base.id,
        importRo: {
          worksheets: workSheets,
          ...fileInfo,
          notification: true,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone as ITimeZoneString,
        },
      });
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
      inplaceImportFn([
        base.id,
        tableId as string,
        {
          ...fileInfo,
          insertConfig: preInsertConfig,
          notification: true,
        },
      ]);
    };

    tableId ? inplaceImportTable() : importNewTable();
  };

  const { mutateAsync: analyzeByUrl, isLoading: analyzeLoading } = useMutation({
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

  return (
    <>
      <Dialog open={open} onOpenChange={(open) => onOpenChange?.(open)}>
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
            {step === Step.CONFIG && (
              <DialogFooter>
                <footer className="mt-1 flex items-center justify-end">
                  <Button size="sm" variant="secondary" onClick={() => onOpenChange?.(false)}>
                    {t('table:import.menu.cancel')}
                  </Button>
                  <AlertDialog>
                    {shouldAlert ? (
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          className="ml-1"
                          disabled={tableId ? inplaceLoading : isLoading}
                        >
                          {(tableId ? inplaceLoading : isLoading) && (
                            <Spin className="mr-1 size-4" />
                          )}
                          {t('table:import.title.import')}
                        </Button>
                      </AlertDialogTrigger>
                    ) : (
                      <Button
                        size="sm"
                        className="ml-1"
                        onClick={() => importTable()}
                        disabled={tableId ? inplaceLoading : isLoading}
                      >
                        {(tableId ? inplaceLoading : isLoading) && <Spin className="mr-1 size-4" />}
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
                          className="pl-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
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
