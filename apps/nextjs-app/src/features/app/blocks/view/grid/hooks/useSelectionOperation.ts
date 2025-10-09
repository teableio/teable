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
  useRowCount,
} from '@teable/sdk';
import { useConfirm } from '@teable/ui-lib/base';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import type { AxiosResponse } from 'axios';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { isHTTPS, isLocalhost } from '@/features/app/utils';
import { serializerCellValueHtml, serializerHtml } from '@/features/app/utils/clipboard';
import { tableConfig } from '@/features/i18n/table.config';
import { getEffectCellCount, getEffectRows, selectionCoverAttachments } from '../utils';
import {
  ClipboardTypes,
  copyHandler,
  filePasteHandler,
  getCellPasteInfo,
  rangeTypes,
  textPasteHandlerWithData,
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
  const rowCount = useRowCount();

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

  const { confirm } = useConfirm();

  const doPaste = useCallback(
    async (
      e: React.ClipboardEvent,
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      updateTemporaryData?: (records: ITemporaryPasteVo) => void
    ) => {
      if (!viewId || !tableId) return;

      const { files, types } = e.clipboardData;
      const hasHtml = types.includes(ClipboardTypes.html);
      const html = hasHtml ? e.clipboardData.getData(ClipboardTypes.html) : '';
      const text = types.includes(ClipboardTypes.text)
        ? e.clipboardData.getData(ClipboardTypes.text)
        : '';
      const fileArray = Array.from(files) as unknown as FileList;

      const { cellValues } = getCellPasteInfo(e);

      const pasteRecordLength = cellValues?.length ?? 0;

      if (pasteRecordLength >= 10) {
        const confirmed = await confirm({
          title: t('table:table.actionTips.pasteConfirmTitle'),
          description: t('table:table.actionTips.pasteConfirmDescription', {
            recordCount: pasteRecordLength,
          }),
          confirmText: t('table:table.actionTips.paste'),
          cancelText: t('common:actions.cancel'),
          confirmButtonVariant: 'destructive',
        });
        if (!confirmed) return;
      }

      const toastId = toast.loading(t('table:table.actionTips.pasting'));

      try {
        if (fileArray.length > 0 && !types.includes(ClipboardTypes.text)) {
          const isSelectionCoverAttachments = selectionCoverAttachments(selection, fields);
          if (!isSelectionCoverAttachments) {
            toast.error(t('table:table.actionTips.pasteFileFailed'), { id: toastId });
            return;
          }
          await filePasteHandler({
            files: fileArray,
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
          await textPasteHandlerWithData(
            { html, text, hasHtml },
            selection,
            async (content, type, ranges, header) => {
              if (!content) {
                return;
              }
              if (updateTemporaryData) {
                const res = await temporaryPasteReq({ content, ranges, header });
                updateTemporaryData(res.data);
              } else {
                await pasteReq({ content, type, ranges, header });
              }
            }
          );
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
    [viewId, tableId, fields, t, confirm, baseId, temporaryPasteReq, pasteReq]
  );

  const doClear = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;

      const effectRows = getEffectRows(selection);
      const effectCells = getEffectCellCount(selection, fields, rowCount);

      if (effectRows >= 10 && effectCells) {
        const confirmed = await confirm({
          title: t('table:table.actionTips.clearConfirmTitle'),
          description: t('table:table.actionTips.clearConfirmDescription', {
            cellCount: effectCells,
            rowCount: effectRows,
          }),
          confirmText: t('table:table.actionTips.clear'),
          cancelText: t('common:actions.cancel'),
          confirmButtonVariant: 'destructive',
        });
        if (!confirmed) return;
      }

      const toastId = toast.loading(t('table:table.actionTips.clearing'), { id: clearToastId });
      const ranges = selection.serialize();
      const type = rangeTypes[selection.type];

      await clearReq({
        ranges,
        ...(type ? { type } : {}),
      });

      toast.success(t('table:table.actionTips.clearSuccessful'), { id: toastId });
    },
    [viewId, tableId, fields, rowCount, t, clearReq, confirm]
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
