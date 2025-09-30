/* eslint-disable sonarjs/no-duplicate-string */
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { FieldType, fieldVoSchema, type HttpError } from '@teable/core';
import type {
  ICopyVo,
  IPasteRo,
  IRangesRo,
  ITemporaryPasteRo,
  ITemporaryPasteVo,
} from '@teable/openapi';
import {
  clear,
  copy,
  deleteSelection,
  paste,
  saveQueryParams,
  temporaryPaste,
} from '@teable/openapi';
import type { CombinedSelection, IRecordIndexMap } from '@teable/sdk';
import {
  useBaseId,
  useFields,
  useSearch,
  useTableId,
  useView,
  useViewId,
  usePersonalView,
  getHttpErrorMessage,
  LARGE_QUERY_THRESHOLD,
} from '@teable/sdk';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import type { AxiosResponse } from 'axios';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { isHTTPS, isLocalhost } from '@/features/app/utils';
import { serializerCellValueHtml, serializerHtml } from '@/features/app/utils/clipboard';
import { tableConfig } from '@/features/i18n/table.config';
import { selectionCoverAttachments } from '../utils';
import {
  ClipboardTypes,
  copyHandler,
  filePasteHandler,
  rangeTypes,
  textPasteHandler,
} from '../utils/copyAndPaste';
import { getSyncCopyData } from '../utils/getSyncCopyData';
import { useSyncSelectionStore } from './useSelectionStore';

const clearToastId = 'clearToastId';
const deleteToastId = 'deleteToastId';

export const useSelectionOperation = (props?: {
  collapsedGroupIds?: string[];
  copyReq?: UseMutateAsyncFunction<AxiosResponse<ICopyVo>, unknown, IRangesRo, unknown>;
}) => {
  const { collapsedGroupIds, copyReq } = props || {};
  const baseId = useBaseId();
  const tableId = useTableId();
  const viewId = useViewId();
  const fields = useFields();
  const view = useView();
  const { searchQuery: search } = useSearch();
  const { personalViewCommonQuery } = usePersonalView();

  // Parameters for retrieving selected records in plugins
  useSyncSelectionStore({
    groupBy: view?.group,
    personalViewCommonQuery,
    collapsedGroupIds,
    search,
    fields,
  });

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const groupBy = view?.group;

  const { mutateAsync: defaultCopyReq } = useMutation({
    mutationFn: async (copyRo: IRangesRo) => {
      const { collapsedGroupIds: _originalCollapsedGroupIds, ...rest } = copyRo;
      const params = {
        ...rest,
        ...personalViewCommonQuery,
        viewId,
        groupBy,
        search,
      };
      if (collapsedGroupIds && collapsedGroupIds.length > LARGE_QUERY_THRESHOLD) {
        const { data } = await saveQueryParams({ params: { collapsedGroupIds } });
        return copy(tableId!, { ...params, queryId: data.queryId });
      }
      return copy(tableId!, { ...params, collapsedGroupIds });
    },
    meta: {
      preventGlobalError: true,
    },
  });

  const { mutateAsync: pasteReq } = useMutation({
    mutationFn: (pasteRo: IPasteRo) =>
      paste(tableId!, {
        ...pasteRo,
        ...personalViewCommonQuery,
        viewId,
        groupBy,
        collapsedGroupIds,
        search,
      }),
    meta: {
      preventGlobalError: true,
    },
  });

  const { mutateAsync: temporaryPasteReq } = useMutation({
    mutationFn: (temporaryPasteRo: ITemporaryPasteRo) =>
      temporaryPaste(tableId!, { ...temporaryPasteRo, ...personalViewCommonQuery, viewId }),
  });

  const { mutateAsync: clearReq } = useMutation({
    mutationFn: (clearRo: IRangesRo) =>
      clear(tableId!, {
        ...clearRo,
        ...personalViewCommonQuery,
        viewId,
        groupBy,
        collapsedGroupIds,
        search,
      }),
    onError: () => {
      toast.dismiss(clearToastId);
    },
  });

  const { mutateAsync: deleteReq } = useMutation({
    mutationFn: async (deleteRo: IRangesRo) => {
      const { collapsedGroupIds: _originalCollapsedGroupIds, ...rest } = deleteRo;
      const params = {
        ...rest,
        ...personalViewCommonQuery,
        viewId,
        groupBy,
        search,
      };
      if (collapsedGroupIds && collapsedGroupIds.length > LARGE_QUERY_THRESHOLD) {
        const { data } = await saveQueryParams({ params: { collapsedGroupIds } });
        return deleteSelection(tableId!, { ...params, queryId: data.queryId });
      }
      return deleteSelection(tableId!, { ...params, collapsedGroupIds });
    },
    onError: () => {
      toast.dismiss(deleteToastId);
    },
  });

  const copyRequest = copyReq || defaultCopyReq;

  const checkCopyAndPasteEnvironment = useCallback(() => {
    // not support http
    if (!isLocalhost() && !isHTTPS()) {
      toast.error(t('table:table.actionTips.copyAndPasteEnvironment'));
      return false;
    }
    // browser not support clipboard
    if (
      !navigator.clipboard ||
      !navigator.clipboard.write ||
      typeof ClipboardItem === 'undefined'
    ) {
      toast.error(t('table:table.actionTips.copyAndPasteBrowser'));
      return false;
    }
    return true;
  }, [t]);

  const doCopy = useCallback(
    async (selection: CombinedSelection, getCopyData?: () => Promise<ICopyVo>) => {
      if (!checkCopyAndPasteEnvironment()) return;
      if (!viewId || !tableId) return;

      const id = toast.loading(t('table:table.actionTips.copying'));

      const getCopyDataDefault = async () => {
        const ranges = selection.serialize();
        const type = rangeTypes[selection.type];
        const { data } = await copyRequest({
          ranges,
          ...(type ? { type } : {}),
        });
        const { content, header } = data;
        return { content, header };
      };

      const getCopyDataInner = getCopyData ?? getCopyDataDefault;

      try {
        await copyHandler(getCopyDataInner);
        toast.success(t('table:table.actionTips.copySuccessful'), { id });
      } catch (e) {
        const error = e as Error;
        const hasFocus = document.hasFocus();
        let errorMessage = error.message;
        if (!hasFocus) {
          errorMessage = t('table:table.actionTips.copyError.noFocus');
        }
        toast.error(t('table:table.actionTips.copyFailed'), {
          description: errorMessage,
          id,
        });
        console.error('Copy error: ', error);
      }
    },
    [checkCopyAndPasteEnvironment, viewId, tableId, copyRequest, t]
  );

  // const getPasteDescription = useCallback(
  //   (cellCount: number, selectionRows: number, expandRowCount: number, expandColCount: number) => {
  //     const isExpandRow = expandRowCount > 0;
  //     const isExpandCol = expandColCount > 0;
  //     const isExpand = isExpandRow || isExpandCol;
  //     return isExpand
  //       ? `${t('table:table.actionTips.expandCommonDescription')} ${isExpandRow ? t('table:table.actionTips.expandRowDescription', { count: expandRowCount }) : ''} ${isExpandRow && isExpandCol ? t('table:table.actionTips.conjunction') : ''} ${isExpandCol ? t('table:table.actionTips.expandColDescription', { count: expandColCount }) : ''}`
  //       : `
  //       ${t('table:table.actionTips.pasteConfirmDescription', {
  //         cellCount: cellCount,
  //         recordCount: selectionRows,
  //       })}`;
  //   },
  //   [t]
  // );

  const doPaste = useCallback(
    async (
      e: React.ClipboardEvent,
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      updateTemporaryData?: (records: ITemporaryPasteVo) => void
    ) => {
      if (!viewId || !tableId) return;

      // const [startRange, endRange] = selection.ranges;
      // const [startCol, startRow] = startRange;
      // const [, endRow] = endRange;
      // const selectionRows = endRow - startRow + 1;
      // const cellCount = getEffectCellCount(selection, fields);
      // const { cellValues } = getCellPasteInfo(e);

      // const computedFieldIndexes = [] as number[];
      // fields.forEach((field, index) => {
      //   if (field.isComputed && index >= startCol) {
      //     computedFieldIndexes.push(index);
      //   }
      // });

      // const pasteRecordLength = cellValues?.length ?? 0;

      // const { isExpand, expandRowCount, expandColCount } = getExpandInfo(
      //   rowCount,
      //   startRow,
      //   startCol,
      //   fields,
      //   computedFieldIndexes,
      //   cellValues
      // );

      // if (isExpand || pasteRecordLength >= 10) {
      //   const description = getPasteDescription(
      //     cellCount,
      //     selectionRows,
      //     expandRowCount,
      //     expandColCount
      //   );
      //   const confirmed = await confirm({
      //     title: t('table:table.actionTips.pasteConfirmTitle'),
      //     description,
      //     confirmText: t('table:table.actionTips.paste'),
      //     cancelText: t('common:actions.cancel'),
      //     confirmButtonVariant: 'destructive',
      //   });
      //   if (!confirmed) return;
      // }

      const { files, types } = e.clipboardData;
      const toastId = toast.loading(t('table:table.actionTips.pasting'));

      try {
        if (files.length > 0 && !types.includes(ClipboardTypes.text)) {
          const isSelectionCoverAttachments = selectionCoverAttachments(selection, fields);
          if (!isSelectionCoverAttachments) {
            toast.error(t('table:table.actionTips.pasteFileFailed'), { id: toastId });
            return;
          }
          await filePasteHandler({
            files,
            fields,
            selection,
            recordMap,
            baseId,
            requestPaste: async (content, type, ranges) => {
              const header = [
                fieldVoSchema.parse(fields.find((f) => f.type === FieldType.Attachment)),
              ];
              if (updateTemporaryData) {
                const res = await temporaryPasteReq({
                  content,
                  ranges,
                  header,
                });
                updateTemporaryData(res.data);
              } else {
                await pasteReq({ content, type, ranges, header });
              }
            },
          });
        } else {
          await textPasteHandler(e, selection, async (content, type, ranges, header) => {
            if (!content) {
              return;
            }
            if (updateTemporaryData) {
              const res = await temporaryPasteReq({ content, ranges, header });
              updateTemporaryData(res.data);
            } else {
              await pasteReq({ content, type, ranges, header });
            }
          });
        }
        toast.success(t('table:table.actionTips.pasteSuccessful'), { id: toastId });
      } catch (e) {
        const error = e as HttpError;
        const description = getHttpErrorMessage(error, t, 'sdk');
        toast.error(t('table:table.actionTips.pasteFailed'), {
          description,
          id: toastId,
        });
        console.error('Paste error: ', error);
      }
    },
    [viewId, tableId, fields, t, baseId, temporaryPasteReq, pasteReq]
  );

  const doClear = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;
      // const calFieldsIndex = [] as number[];
      // fields.forEach((field, index) => {
      //   if (field.isComputed) {
      //     calFieldsIndex.push(index);
      //   }
      // });
      // const [startRange, endRange] = selection.ranges;

      // if (startRange && endRange) {
      //   const [, startRow] = startRange;
      //   const [, endRow] = endRange;
      //   const deleteRows = endRow - startRow + 1;

      //   const cellCount = getEffectCellCount(selection, fields);

      //   if (deleteRows >= 10 && cellCount) {
      //     const confirmed = await confirm({
      //       title: t('table:table.actionTips.clearConfirmTitle'),
      //       description: t('table:table.actionTips.clearConfirmDescription', {
      //         cellCount: cellCount,
      //         rowCount: deleteRows,
      //       }),
      //       confirmText: t('table:table.actionTips.clear'),
      //       cancelText: t('common:actions.cancel'),
      //       confirmButtonVariant: 'destructive',
      //     });
      //     if (!confirmed) return;
      //   }
      // }

      const toastId = toast.loading(t('table:table.actionTips.clearing'), { id: clearToastId });
      const ranges = selection.serialize();
      const type = rangeTypes[selection.type];

      await clearReq({
        ranges,
        ...(type ? { type } : {}),
      });

      toast.success(t('table:table.actionTips.clearSuccessful'), { id: toastId });
    },
    [viewId, tableId, t, clearReq]
  );

  const doDelete = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;

      const toastId = toast.loading(t('table:table.actionTips.deleting'), { id: deleteToastId });
      const ranges = selection.serialize();
      const type = rangeTypes[selection.type];

      await deleteReq({
        ranges,
        ...(type ? { type } : {}),
      });

      toast.success(t('table:table.actionTips.deleteSuccessful'), { id: toastId });
    },
    [deleteReq, tableId, viewId, t]
  );

  const doSyncCopy = useCallback(
    (
      e: React.ClipboardEvent,
      params:
        | {
            selection: CombinedSelection;
            recordMap: IRecordIndexMap;
          }
        | { getCopyData: () => ICopyVo }
    ) => {
      const toastId = toast.loading(t('table:table.actionTips.copying'));
      try {
        if ('getCopyData' in params) {
          const data = params.getCopyData();
          const content = data.content;
          const header = data.header;
          e.clipboardData.setData(ClipboardTypes.text, content);
          e.clipboardData.setData(ClipboardTypes.html, serializerHtml(content, header));
        } else if ('recordMap' in params && 'selection' in params) {
          const recordMap = params.recordMap;
          const selection = params.selection;
          const res = getSyncCopyData({ recordMap, fields, selection });
          e.clipboardData.setData(ClipboardTypes.text, res.content);
          e.clipboardData.setData(
            ClipboardTypes.html,
            serializerCellValueHtml(res.rawContent, res.headers)
          );
        } else {
          toast.error(t('table:table.actionTips.copyFailed'), {
            description: 'Unsupported selection type',
            id: toastId,
          });
          return;
        }
        e.preventDefault();
        toast.success(t('table:table.actionTips.copySuccessful'), { id: toastId });
      } catch (e) {
        const error = e as Error;
        toast.error(t('table:table.actionTips.copyFailed'), {
          description: error.message,
          id: toastId,
        });
        console.error('Sync copy error: ', error);
      }
    },
    [fields, t]
  );

  return {
    copy: doCopy,
    paste: doPaste,
    clear: doClear,
    deleteRecords: doDelete,
    syncCopy: doSyncCopy,
  };
};
