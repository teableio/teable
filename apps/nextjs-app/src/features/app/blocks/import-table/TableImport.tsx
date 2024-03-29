import { useMutation } from '@tanstack/react-query';
import { importTypeMap } from '@teable/core';
import type {
  IImportOptionRo,
  IAnalyzeRo,
  IImportSheetItem,
  SUPPORTEDTYPE,
  IAnalyzeVo,
  IImportOption,
} from '@teable/core';

import { analyzeFile, importTableFromFile } from '@teable/openapi';
import type { INotifyVo } from '@teable/openapi';
import { useBase } from '@teable/sdk';
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
} from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useCallback } from 'react';
import { FieldConfigPanel } from './field-config-panel';
import { UploadPanel } from './upload-panel';
import { UrlPanel } from './UrlPanel';

interface ITableImportProps {
  open?: boolean;
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
  const { children, open, onOpenChange, fileType } = props;
  const [errorMessage, setErrorMessage] = useState('');
  const [alterDialogVisible, setAlterDialogVisible] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInfo, setFileInfo] = useState<IAnalyzeRo>({} as IAnalyzeRo);
  const primitiveWorkSheets = useRef<IAnalyzeVo['worksheets']>({});
  const [workSheets, setWorkSheets] = useState<IImportOptionRo['worksheets']>({});

  const closeDialog = () => {
    dialogOpenProxy(false);
  };

  const { mutateAsync, isLoading } = useMutation({
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

  const importTable = async () => {
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

    mutateAsync({
      baseId: base.id,
      importRo: {
        worksheets: workSheets,
        ...fileInfo,
      },
    });
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

  const dialogOpenProxy = (open: boolean) => {
    if (!open && Step.CONFIG && isLoading) {
      setAlterDialogVisible(true);
      return;
    }
    onOpenChange?.(open);
  };

  const fieldChangeHandler = (value: IImportOptionRo['worksheets']) => {
    setWorkSheets(value);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={dialogOpenProxy}>
        {children && <DialogTrigger>{children}</DialogTrigger>}
        {open && (
          <DialogContent className="flex max-h-[80%] max-w-[800px] flex-col overflow-hidden">
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
                    onChange={(file) => {
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
                    }}
                    onClose={() => setFile(null)}
                    analyzeLoading={analyzeLoading}
                    onFinished={fileFinishedHandler}
                  ></UploadPanel>
                )}
                {step === Step.CONFIG && (
                  <FieldConfigPanel
                    workSheets={workSheets}
                    errorMessage={errorMessage}
                    onChange={fieldChangeHandler}
                  ></FieldConfigPanel>
                )}
              </TabsContent>
              <TabsContent value="url">
                {step === Step.UPLOAD && (
                  <UrlPanel
                    analyzeFn={analyzeByUrl}
                    isFinished={analyzeLoading}
                    fileType={fileType}
                  ></UrlPanel>
                )}
                {step === Step.CONFIG && (
                  <FieldConfigPanel
                    workSheets={workSheets}
                    errorMessage={errorMessage}
                    onChange={fieldChangeHandler}
                  ></FieldConfigPanel>
                )}
              </TabsContent>
            </Tabs>
            {step === Step.CONFIG && (
              <DialogFooter>
                <footer className="mt-1 flex items-center justify-end">
                  <Button size="sm" variant="secondary" onClick={() => closeDialog()}>
                    {t('table:import.menu.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    className="ml-1"
                    onClick={() => importTable()}
                    disabled={isLoading}
                  >
                    {isLoading && <Spin className="mr-1 size-4" />}
                    {t('table:import.title.import')}
                  </Button>
                </footer>
              </DialogFooter>
            )}
          </DialogContent>
        )}
      </Dialog>

      <AlertDialog
        open={alterDialogVisible}
        onOpenChange={(open: boolean) => setAlterDialogVisible(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table:import.title.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('table:import.tips.leaveTip')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('table:import.menu.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onOpenChange?.(false);
              }}
            >
              {t('table:import.menu.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
