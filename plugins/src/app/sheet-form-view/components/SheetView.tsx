'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { Share2 } from '@teable/icons';
import { getViewInstallPlugin, updateViewPluginStorage } from '@teable/openapi';

import type { IFieldInstance } from '@teable/sdk';
import { useView, useFields, useFieldStaticGetter, useTableId, useBaseId } from '@teable/sdk';
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
import type { IWorkbookData, IWorksheetData } from '@univerjs/core';
import { cloneDeep, get, isEqual } from 'lodash';
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SharePopover } from './SharePopover';
import { DefaultWorkBookData, DefaultSheetId, UnSupportFieldType } from './sheet/constant';
import { DesignPanel } from './sheet/DesignPanel';
import { PreviewPanel } from './sheet/PreviewPanel';
import type { IUniverSheetRef } from './sheet/UniverSheet';
import { getRecordRangesMap, clearChangedTemplateValue } from './sheet/utils';

enum SheetMode {
  Design = 'design',
  Preview = 'preview',
}

export const SheetView = () => {
  const fields = useFields({ withHidden: true, withDenied: true });
  const view = useView();
  const viewId = view?.id;
  const tableId = useTableId();
  const baseId = useBaseId();
  const fieldStaticGetter = useFieldStaticGetter();
  const selectedField = useRef<IFieldInstance>();
  const [innerCellData, setInnerCellData] = useState<IWorksheetData['cellData']>();
  const [insertedFields, setInsertedFields] = useState<string[]>([]);
  const univerRef = useRef<IUniverSheetRef>(null);
  const { t } = useTranslation();
  const [mode, setMode] = useState<SheetMode>(SheetMode.Design);

  const {
    data: pluginInstall,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['view_plugin', tableId, viewId],
    queryFn: () => getViewInstallPlugin(tableId!, viewId!).then((res) => res.data),
    enabled: Boolean(tableId && viewId),
    staleTime: Infinity,
  });

  useEffect(() => {
    const cellData = get(pluginInstall?.storage, ['sheets', DefaultSheetId, 'cellData']);
    setInnerCellData(cellData);
  }, [pluginInstall?.storage]);

  const workBookData = useMemo<IWorkbookData>(() => {
    return cloneDeep(pluginInstall?.storage || DefaultWorkBookData) as IWorkbookData;
  }, [pluginInstall?.storage]);

  useEffect(() => {
    const rangeMap = getRecordRangesMap(innerCellData);

    setInsertedFields((pre) => {
      if (!isEqual(pre, Object.keys(rangeMap))) {
        return Object.keys(rangeMap);
      }
      return pre;
    });
  }, [pluginInstall?.storage, innerCellData]);

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
    async (storage?: IWorkbookData) => {
      if (tableId && viewId && pluginInstall?.pluginInstallId && workBookData) {
        const { cellData } = clearChangedTemplateValue(storage?.sheets?.['sheet1']?.cellData);
        setInnerCellData(cellData);
        await updateStorageFn({
          tableId,
          viewId,
          pluginInstallId: pluginInstall?.pluginInstallId,
          storage: {
            ...storage,
            sheets: {
              sheet1: {
                ...workBookData.sheets.sheet1,
                cellData: cellData,
              },
            },
          } as Record<string, unknown>,
        });
      }
    },
    [pluginInstall?.pluginInstallId, tableId, updateStorageFn, viewId, workBookData]
  );

  const onDragDrop = useCallback((range: [number, number, number, number]) => {
    const { name, id } = selectedField?.current || {};
    id &&
      name &&
      univerRef?.current?.insertCellByRange(range, {
        name: name,
        id: id,
      });
  }, []);

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
                size={'sm'}
                variant={'outline'}
                className={cn('px-6 text-sm', { 'bg-secondary': SheetMode.Design === mode })}
                onClick={() => {
                  setMode(SheetMode.Design);
                }}
              >
                {t('toolbar.design')}
              </Button>
              <Button
                size={'sm'}
                variant={'outline'}
                className={cn('px-6 text-sm', { 'bg-secondary': SheetMode.Preview === mode })}
                onClick={async () => {
                  const workBookData = getActiveWorkBookData();
                  await updateStorage(workBookData);
                  setMode(SheetMode.Preview);
                  refetch();
                }}
              >
                {t('toolbar.preview')}
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
                                  draggable={true}
                                  onDragStart={() => {
                                    selectedField.current = fields.find((f) => f.id === field.id);
                                  }}
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
              </div>
            )}
            <div className="m-2 flex flex-1 items-start justify-center overflow-hidden rounded-sm">
              {mode === 'design' ? (
                <DesignPanel
                  workBookData={workBookData}
                  ref={univerRef}
                  onChange={updateStorage}
                  onDragDrop={onDragDrop}
                />
              ) : (
                <PreviewPanel workBookData={workBookData} baseId={baseId} />
              )}
            </div>
          </div>
        </>
      }
    </div>
  );
};
