'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { Share2 } from '@teable/icons';
import { getViewInstallPlugin, updateViewPluginStorage } from '@teable/openapi';

import { useView, useFields, useFieldStaticGetter, useTableId } from '@teable/sdk';
import {
  Button,
  ToggleGroup,
  ToggleGroupItem,
  Spin,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib';
import type { IWorkbookData } from '@univerjs/core';
import { get, isEqual } from 'lodash';
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SharePopover } from './SharePopover';
import { DefaultWorkBookData, DefaultSheetId, UnSupportFieldType } from './sheet/constant';
import { DesignPanel } from './sheet/DesignPanel';
import { PreviewPanel } from './sheet/PreviewPanel';
import type { IUniverSheetRef } from './sheet/UniverSheet';
import { getRecordRangesMap } from './sheet/utils';

enum SheetMode {
  Design = 'design',
  Preview = 'preview',
}

export const SheetView = () => {
  const fields = useFields({ withHidden: true, withDenied: true });
  const view = useView();
  const viewId = view?.id;
  const tableId = useTableId();
  const fieldStaticGetter = useFieldStaticGetter();
  const [selectedField, setSelectedField] = useState('');
  const [insertedFields, setInsertedFields] = useState<string[]>([]);
  const univerRef = useRef<IUniverSheetRef>(null);
  const { t } = useTranslation();
  const [mode, setMode] = useState<SheetMode>(SheetMode.Design);

  const { data: pluginInstall, isLoading } = useQuery({
    queryKey: ['view_plugin', tableId, viewId],
    queryFn: () => getViewInstallPlugin(tableId!, viewId!).then((res) => res.data),
    enabled: Boolean(tableId && viewId),
    staleTime: Infinity,
  });

  const workBookData = useMemo<IWorkbookData>(() => {
    return (pluginInstall?.storage || DefaultWorkBookData) as IWorkbookData;
  }, [pluginInstall?.storage]);

  const cellData = get(pluginInstall?.storage, ['sheets', DefaultSheetId, 'cellData']);
  const rangeMap = getRecordRangesMap(cellData);

  useEffect(() => {
    setInsertedFields((pre) => {
      if (!isEqual(pre, Object.keys(rangeMap))) {
        return Object.keys(rangeMap);
      }
      return pre;
    });
  }, [rangeMap, selectedField]);

  const insertActiveCell = () => {
    const field = fields.find((f) => f.id === selectedField);
    univerRef?.current?.insertActiveCell(`{{${field?.name}:${field?.id}}}`);
  };

  const getActiveWorkBookData = () => {
    return univerRef?.current?.getActiveWorkBookData();
  };

  const { mutateAsync: updateStorageFn } = useMutation({
    mutationFn: ({
      tableId,
      viewId,
      pluginInstallId,
      storage,
    }: {
      tableId: string;
      viewId: string;
      pluginInstallId: string;
      storage: Record<string, unknown>;
    }) => updateViewPluginStorage(tableId, viewId, pluginInstallId, storage),
  });

  const updateStorage = useCallback(
    async (storage: unknown) => {
      if (tableId && viewId && pluginInstall?.pluginInstallId && workBookData) {
        await updateStorageFn({
          tableId,
          viewId,
          pluginInstallId: pluginInstall?.pluginInstallId,
          storage: storage as Record<string, unknown>,
        });
      }
    },
    [pluginInstall?.pluginInstallId, tableId, updateStorageFn, viewId, workBookData]
  );

  if (isLoading) {
    return (
      <div className="flex size-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <div className="flex size-full flex-1 flex-col overflow-hidden">
      {
        <>
          <div className="flex h-12 items-center justify-between border-y py-2 pl-8 pr-4">
            <div className="flex gap-2">
              <Button
                size={'xs'}
                variant={'outline'}
                className={cn({ 'bg-secondary': SheetMode.Design === mode })}
                onClick={() => {
                  setMode(SheetMode.Design);
                }}
              >
                {t('toolbar.design')}
              </Button>
              <Button
                size={'xs'}
                variant={'outline'}
                className={cn({ 'bg-secondary': SheetMode.Preview === mode })}
                onClick={async () => {
                  const workBookData = getActiveWorkBookData();
                  await updateStorage(workBookData);
                  setMode(SheetMode.Preview);
                }}
              >
                {t('toolbar.previewAndSave')}
              </Button>
            </div>
            <SharePopover>
              {() => {
                return (
                  <Button size={'xs'} variant={'ghost'}>
                    <Share2 />
                    {t('toolbar.share')}
                  </Button>
                );
              }}
            </SharePopover>
          </div>
          <div className="flex flex-1 overflow-hidden rounded-sm">
            {mode === 'design' && (
              <div className="flex w-56 flex-col border-r p-2">
                <div className="my-1 flex flex-1 overflow-auto ">
                  <ToggleGroup
                    type="single"
                    className="flex size-full flex-col items-start justify-start"
                    onValueChange={(fieldId: string) => {
                      setSelectedField(fieldId);
                    }}
                  >
                    {fields.map((field) => {
                      const Icon = fieldStaticGetter(field.type, false).Icon;
                      return (
                        <TooltipProvider key={field.id}>
                          <Tooltip>
                            <TooltipTrigger asChild key={field.id}>
                              <div className="w-full">
                                <ToggleGroupItem
                                  className="flex h-8 w-full shrink-0 items-center gap-1"
                                  value={field.id}
                                  key={field.id}
                                  variant={'outline'}
                                  disabled={
                                    field.isComputed ||
                                    insertedFields.includes(field.id) ||
                                    UnSupportFieldType.includes(field.type)
                                  }
                                >
                                  <Icon className="shrink-0" />
                                  <span className="truncate" title={field.name}>
                                    {field.name}
                                  </span>
                                </ToggleGroupItem>
                              </div>
                            </TooltipTrigger>
                            {(field.isComputed ||
                              UnSupportFieldType.includes(field.type) ||
                              insertedFields.includes(field.id)) && (
                              <TooltipContent>
                                <>
                                  {field.isComputed ||
                                    (UnSupportFieldType.includes(field.type) && (
                                      <p>{t('tooltips.unSupportFieldType')}</p>
                                    ))}
                                  {insertedFields.includes(field.id) && (
                                    <p>{t('tooltips.selected')}</p>
                                  )}
                                </>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </ToggleGroup>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex w-full shrink-0 items-center justify-center">
                        <Button
                          size={'lg'}
                          variant={'outline'}
                          className="w-4/5"
                          onClick={() => {
                            insertActiveCell();
                            setSelectedField('');
                          }}
                          disabled={!selectedField}
                        >
                          {t('toolbar.insertCell')}
                        </Button>
                      </div>
                    </TooltipTrigger>
                    {!selectedField && (
                      <TooltipContent>
                        <p>{t('tooltips.insertCellTips')}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
            <div className="m-2 flex flex-1 items-start justify-center overflow-hidden rounded-sm">
              {mode === 'design' ? (
                <DesignPanel workBookData={workBookData} ref={univerRef} onChange={updateStorage} />
              ) : (
                <PreviewPanel workBookData={workBookData} />
              )}
            </div>
          </div>
        </>
      }
    </div>
  );
};
