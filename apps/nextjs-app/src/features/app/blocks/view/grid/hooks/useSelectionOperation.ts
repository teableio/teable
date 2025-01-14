/* eslint-disable sonarjs/no-duplicate-string */
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type { IFieldVo } from '@teable/core';
import type {
  ICopyVo,
  IPasteRo,
  IRangesRo,
  ITemporaryPasteRo,
  ITemporaryPasteVo,
} from '@teable/openapi';
import { clear, copy, deleteSelection, paste, temporaryPaste } from '@teable/openapi';
import type { CombinedSelection, IRecordIndexMap } from '@teable/sdk';
import { useBaseId, useFields, useSearch, useTableId, useView, useViewId } from '@teable/sdk';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import type { AxiosResponse } from 'axios';
import { useTranslation } from 'next-i18next';
import { useCallback } from 'react';
import { isHTTPS, isLocalhost } from '@/features/app/utils';
import { serializerHtml } from '@/features/app/utils/clipboard';
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

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const groupBy = view?.group;

  const { mutateAsync: defaultCopyReq } = useMutation({
    mutationFn: (copyRo: IRangesRo) =>
      copy(tableId!, { ...copyRo, viewId, groupBy, collapsedGroupIds, search }),
  });

  const { mutateAsync: pasteReq } = useMutation({
    mutationFn: (pasteRo: IPasteRo) =>
      paste(tableId!, { ...pasteRo, viewId, groupBy, collapsedGroupIds, search }),
  });

  const { mutateAsync: temporaryPasteReq } = useMutation({
    mutationFn: (temporaryPasteRo: ITemporaryPasteRo) =>
      temporaryPaste(tableId!, { ...temporaryPasteRo, viewId }),
  });

  const { mutateAsync: clearReq } = useMutation({
    mutationFn: (clearRo: IRangesRo) =>
      clear(tableId!, { ...clearRo, viewId, groupBy, collapsedGroupIds, search }),
  });

  const { mutateAsync: deleteReq } = useMutation({
    mutationFn: (deleteRo: IRangesRo) =>
      deleteSelection(tableId!, { ...deleteRo, viewId, groupBy, collapsedGroupIds, search }),
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

  const doPaste = useCallback(
    async (
      e: React.ClipboardEvent,
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      updateTemporaryData?: (records: ITemporaryPasteVo) => void
    ) => {
      if (!viewId || !tableId) return;

      const { files, types } = e.clipboardData;
      const toastId = toast.loading(t('table:table.actionTips.pasting'));

      try {
        if (files.length > 0 && !types.includes(ClipboardTypes.text)) {
          const isSelectionCoverAttachments = selectionCoverAttachments(selection, fields);
          if (!isSelectionCoverAttachments) {
            toast.error(t('table:table.actionTips.pasteFileFailed'), { id: toastId });
          }
          await filePasteHandler({
            files,
            fields,
            selection,
            recordMap,
            baseId,
            requestPaste: async (content, type, ranges) => {
              if (updateTemporaryData) {
                const res = await temporaryPasteReq({ content, ranges });
                updateTemporaryData(res.data);
              } else {
                await pasteReq({ content, type, ranges });
              }
            },
          });
        } else {
          await textPasteHandler(e, selection, async (content, type, ranges, header) => {
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
        const error = e as Error;
        toast.error(t('table:table.actionTips.pasteFailed'), {
          description: error.message,
          id: toastId,
        });
        console.error('Paste error: ', error);
      }
    },
    [baseId, viewId, tableId, fields, temporaryPasteReq, pasteReq, t]
  );

  const doClear = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;

      const toastId = toast.loading(t('table:table.actionTips.clearing'));
      const ranges = selection.serialize();
      const type = rangeTypes[selection.type];

      await clearReq({
        ranges,
        ...(type ? { type } : {}),
      });

      toast.success(t('table:table.actionTips.clearSuccessful'), { id: toastId });
    },
    [tableId, viewId, clearReq, t]
  );

  const doDelete = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;

      const toastId = toast.loading(t('table:table.actionTips.deleting'));
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
        let content: string;
        let header: IFieldVo[];
        if ('getCopyData' in params) {
          const data = params.getCopyData();
          content = data.content;
          header = data.header;
        } else if ('recordMap' in params && 'selection' in params) {
          const recordMap = params.recordMap;
          const selection = params.selection;
          const res = getSyncCopyData({ recordMap, fields, selection });
          content = res.content;
          header = res.header;
        } else {
          toast.error(t('table:table.actionTips.copyFailed'), {
            description: 'Unsupported selection type',
            id: toastId,
          });
          return;
        }
        e.clipboardData.setData(ClipboardTypes.text, content);
        e.clipboardData.setData(ClipboardTypes.html, serializerHtml(content, header));
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
