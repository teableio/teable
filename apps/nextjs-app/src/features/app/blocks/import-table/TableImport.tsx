import { useMutation } from '@tanstack/react-query';
import type {
  IAnalyzeColumn,
  IImportOptionRo,
  IAnalyzeRo,
  IImportColumn,
  IImportOption,
} from '@teable/core';
import { FieldType } from '@teable/core';
import { SUPPORTEDTYPE } from '@teable/core/src/import/types';
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
  Input,
} from '@teable/ui-lib';
import { uniqBy } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useCallback } from 'react';
import { z } from 'zod';
import { CollapsePanel } from './CollapsePanel';
import { FileItem } from './FileItem';
import { PreviewColumn } from './PreviewColumn';
import { Upload } from './Upload';

interface ITableImportProps {
  open?: boolean;
  children?: React.ReactElement;
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
  const { children, open, onOpenChange } = props;
  const [errorMessage, setErrorMessage] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [alterDialogVisible, setAlterDialogVisible] = useState(false);
  const [files, setFiles] = useState<File[] | null>(null);
  const [fileInfo, setFileInfo] = useState<IAnalyzeRo>({} as IAnalyzeRo);
  const initCaculatedColumns = useRef<IAnalyzeColumn[]>([]);
  const [caculatedColumns, setCalculateColumns] = useState<IImportColumn[]>([]);
  const [importOptions, setImportOptions] = useState<ITableImportOptions>({
    autoSelectType: true,
    useFirstRowAsHeader: true,
    importData: true,
  });

  const closeDialog = () => {
    dialogOpenProxy(false);
  };

  const columnsChangeHandler = (newColumns: IImportColumn[]) => {
    const uniqueData = uniqBy(newColumns, 'name');
    if (newColumns.length !== uniqueData.length) {
      setErrorMessage('field name should be unique');
    } else {
      setErrorMessage('');
    }
    setCalculateColumns(newColumns);
  };

  const optionChangeHandler = (options: ITableImportOptions, propertyName: string) => {
    setImportOptions(options);
    if (propertyName === 'autoSelectType') {
      if (!options.autoSelectType) {
        const newColumns = caculatedColumns?.map((item) => ({
          ...item,
          type: FieldType.LongText,
        }));
        setCalculateColumns(newColumns);
      } else {
        const newColumns = caculatedColumns?.map((item) => ({
          ...item,
          type: initCaculatedColumns.current[item.sourceColumnIndex].type,
        }));
        setCalculateColumns(newColumns);
      }
    }

    if (propertyName === 'useFirstRowAsHeader') {
      if (!options.useFirstRowAsHeader) {
        const newColumns = caculatedColumns?.map((item, index) => ({
          ...item,
          name: `${t('table:import.form.defaultFieldName')} ${index + 1}`,
        }));
        setCalculateColumns(newColumns);
      } else {
        const newColumns = caculatedColumns?.map((item) => ({
          ...item,
          name: initCaculatedColumns.current[item.sourceColumnIndex].name,
        }));
        setCalculateColumns(newColumns);
      }
    }
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
    mutateAsync({
      baseId: base.id,
      importRo: {
        worksheets: [
          {
            name: 'import table',
            columns: caculatedColumns,
            options: {
              importData: importOptions.importData,
              useFirstRowAsHeader: importOptions.useFirstRowAsHeader,
            },
          },
        ],
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

      // TODO support groups
      const calculatedColumnHeaders = worksheets?.[0].columns || [];
      const columnHeaderWithIndex = calculatedColumnHeaders.map((col, index) => ({
        ...col,
        sourceColumnIndex: index,
      }));
      setCalculateColumns(columnHeaderWithIndex);
      setStep(Step.CONFIG);
      initCaculatedColumns.current = calculatedColumnHeaders;
      setErrorMessage('');
    },
  });

  const fileFinishedHandler = useCallback(
    async (result: INotifyVo) => {
      const { presignedUrl } = result;

      await analyzeByUrl({
        attachmentUrl: presignedUrl,
        fileType: SUPPORTEDTYPE.CSV,
      });
    },
    [analyzeByUrl]
  );

  const dialogOpenProxy = (open: boolean) => {
    if (!open && Step.CONFIG && isLoading) {
      setAlterDialogVisible(true);
      return;
    }
    onOpenChange?.(open);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={dialogOpenProxy}>
        {children && <DialogTrigger>{children}</DialogTrigger>}
        {open && (
          <DialogContent className="flex max-h-[80%] w-[800px] min-w-[800px] max-w-fit flex-col overflow-hidden">
            <Tabs defaultValue="upload" className="flex-1 overflow-auto">
              {step === Step.UPLOAD && (
                <TabsList>
                  <TabsTrigger value="upload">{t('table:import.title.localFile')}</TabsTrigger>
                  <TabsTrigger value="url">{t('table:import.title.linkUrl')}</TabsTrigger>
                </TabsList>
              )}

              <TabsContent value="upload">
                {step === Step.UPLOAD && (
                  <div className="relative flex h-96 items-center justify-center">
                    {!files?.length && (
                      <Upload
                        accept="text/csv"
                        onChange={(files) => {
                          setFiles(files);
                        }}
                      >
                        <div className="flex h-full cursor-pointer items-center justify-center rounded-sm border-2 border-dashed hover:border-secondary">
                          <Button variant="ghost">{t('table:import.tips.importWayTip')}</Button>
                        </div>
                      </Upload>
                    )}
                    {files?.length &&
                      Array.from(files).map((file) => (
                        <FileItem
                          key={file.name}
                          file={file}
                          onClose={() => setFiles(null)}
                          onFinished={fileFinishedHandler}
                        />
                      ))}
                  </div>
                )}
                {step === Step.CONFIG && (
                  <div className="flex flex-col">
                    <div>
                      <p className="text-base font-bold">{t('table:import.title.importTitle')}</p>
                    </div>

                    <div className="my-2 h-[400px] overflow-y-auto rounded-sm border border-secondary">
                      <PreviewColumn
                        columns={caculatedColumns}
                        onChange={columnsChangeHandler}
                      ></PreviewColumn>
                    </div>

                    {errorMessage && <p className="pl-2 text-sm text-red-500">{errorMessage}</p>}

                    <CollapsePanel
                      onChange={optionChangeHandler}
                      options={importOptions}
                    ></CollapsePanel>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="url">
                {step === Step.UPLOAD && (
                  <div className="flex h-32 w-full flex-col items-start px-2">
                    <h4 className="m-2 text-sm">{t('table:import.title.linkUrlInputTitle')}</h4>
                    <div className="flex w-full">
                      <Input
                        type="url"
                        placeholder="https://www.example.com/file.png"
                        className="mr-2 w-full"
                        value={linkUrl}
                        onChange={(e) => {
                          const { value } = e.target;
                          setLinkUrl(value);
                        }}
                      />
                      <Button
                        variant="outline"
                        disabled={analyzeLoading || !linkUrl}
                        onClick={() => {
                          if (!linkUrl) {
                            setErrorMessage(t('table:import.form.error.urlEmptyTip'));
                            return;
                          }
                          if (!z.string().url().safeParse(linkUrl).success) {
                            setErrorMessage(t('table:import.form.error.urlValidateTip'));
                            return;
                          }
                          analyzeByUrl({
                            attachmentUrl: linkUrl,
                            fileType: SUPPORTEDTYPE.CSV,
                          });
                        }}
                      >
                        {analyzeLoading && <Spin className="mr-1 size-4" />}
                        Upload
                      </Button>
                    </div>
                    {errorMessage && <p className="p-2 text-sm text-red-500">{errorMessage}</p>}
                  </div>
                )}
                {step === Step.CONFIG && (
                  <div className="flex flex-col">
                    <div>
                      <p className="text-base font-bold">{t('table:import.title.importTitle')}</p>
                    </div>

                    <div className="my-2 h-[400px] overflow-y-auto rounded-sm border border-secondary">
                      <PreviewColumn
                        columns={caculatedColumns}
                        onChange={columnsChangeHandler}
                      ></PreviewColumn>
                    </div>

                    {errorMessage && <p className="pl-2 text-sm text-red-500">{errorMessage}</p>}

                    <CollapsePanel
                      onChange={optionChangeHandler}
                      options={importOptions}
                    ></CollapsePanel>
                  </div>
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
                    disabled={!!errorMessage || isLoading}
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
