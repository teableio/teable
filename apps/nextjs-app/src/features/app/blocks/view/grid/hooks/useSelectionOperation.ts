/* eslint-disable sonarjs/no-duplicate-string */
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { FieldType, fieldVoSchema, type HttpError } from '@teable/core';
import type {
  ICopyVo,
  IClearSelectionStreamDoneEvent,
  IClearSelectionStreamErrorEvent,
  IClearSelectionStreamProgressEvent,
  IDeleteSelectionStreamDoneEvent,
  IDeleteSelectionStreamErrorEvent,
  IDeleteSelectionStreamProgressEvent,
  IDuplicateSelectionStreamDoneEvent,
  IDuplicateSelectionStreamErrorEvent,
  IDuplicateSelectionStreamProgressEvent,
  IPasteSelectionStreamDoneEvent,
  IPasteSelectionStreamErrorEvent,
  IPasteSelectionStreamProgressEvent,
  IPasteRo,
  IRangesRo,
  ITemporaryPasteRo,
  ITemporaryPasteVo,
} from '@teable/openapi';
import {
  clear,
  clearSelectionStream,
  copy,
  deleteSelection,
  deleteSelectionStream,
  duplicateSelectionStream,
  ensureUndoRedoWindowIdHeader,
  paste,
  pasteSelectionStream,
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
import { useCallback, useMemo, useState } from 'react';
import { isHTTPS, isLocalhost } from '@/features/app/utils';
import { serializerCellValueHtml, serializerHtml } from '@/features/app/utils/clipboard';
import { tableConfig } from '@/features/i18n/table.config';
import {
  getEffectCellCount,
  getEffectRows,
  selectionCoverAttachments,
  shouldUseClearSelectionStream,
  shouldUseDeleteSelectionStream,
  shouldUseDuplicateSelectionStream,
  shouldUsePasteSelectionStream,
} from '../utils';
import {
  ClipboardTypes,
  copyHandler,
  filePasteHandler,
  getCellPasteInfo,
  rangeTypes,
  textPasteHandlerWithData,
} from '../utils/copyAndPaste';
import { getSyncCopyData } from '../utils/getSyncCopyData';
import { buildSelectionViewQuery } from '../utils/selectionViewQuery';
import { useSyncSelectionStore } from './useSelectionStore';

const clearToastId = 'clearToastId';
const deleteToastId = 'deleteToastId';
type StreamDialogStatus = 'running' | 'success' | 'partial' | 'error';
type StreamDialogMode = 'confirm' | 'progress';
type PendingDeleteSelection = {
  deleteRo: IRangesRo;
  totalCount: number;
};
type PendingClearSelection = {
  clearRo: IRangesRo;
  totalCount: number;
};
type PendingDuplicateSelection = {
  duplicateRo: IRangesRo;
  totalCount: number;
};
type PendingPasteSelection = {
  pasteRo: IPasteRo;
  totalCount: number;
};
type PasteSelectionRequestOptions = {
  affectedRows: number;
  updateTemporaryData?: (records: ITemporaryPasteVo) => void;
};

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
  const [clearProgress, setClearProgress] = useState<IClearSelectionStreamProgressEvent | null>(
    null
  );
  const [clearSummary, setClearSummary] = useState<IClearSelectionStreamDoneEvent | null>(null);
  const [clearErrors, setClearErrors] = useState<IClearSelectionStreamErrorEvent[]>([]);
  const [clearProgressStatus, setClearProgressStatus] = useState<StreamDialogStatus | null>(null);
  const [isClearProgressOpen, setIsClearProgressOpen] = useState(false);
  const [clearDialogMode, setClearDialogMode] = useState<StreamDialogMode | null>(null);
  const [pendingClearSelection, setPendingClearSelection] = useState<PendingClearSelection | null>(
    null
  );
  const [deleteProgress, setDeleteProgress] = useState<IDeleteSelectionStreamProgressEvent | null>(
    null
  );
  const [deleteSummary, setDeleteSummary] = useState<IDeleteSelectionStreamDoneEvent | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<IDeleteSelectionStreamErrorEvent[]>([]);
  const [deleteProgressStatus, setDeleteProgressStatus] = useState<StreamDialogStatus | null>(null);
  const [isDeleteProgressOpen, setIsDeleteProgressOpen] = useState(false);
  const [deleteDialogMode, setDeleteDialogMode] = useState<StreamDialogMode | null>(null);
  const [pendingDeleteSelection, setPendingDeleteSelection] =
    useState<PendingDeleteSelection | null>(null);
  const [duplicateProgress, setDuplicateProgress] =
    useState<IDuplicateSelectionStreamProgressEvent | null>(null);
  const [duplicateSummary, setDuplicateSummary] =
    useState<IDuplicateSelectionStreamDoneEvent | null>(null);
  const [duplicateErrors, setDuplicateErrors] = useState<IDuplicateSelectionStreamErrorEvent[]>([]);
  const [duplicateProgressStatus, setDuplicateProgressStatus] = useState<StreamDialogStatus | null>(
    null
  );
  const [isDuplicateProgressOpen, setIsDuplicateProgressOpen] = useState(false);
  const [duplicateDialogMode, setDuplicateDialogMode] = useState<StreamDialogMode | null>(null);
  const [pendingDuplicateSelection, setPendingDuplicateSelection] =
    useState<PendingDuplicateSelection | null>(null);
  const [pasteProgress, setPasteProgress] = useState<IPasteSelectionStreamProgressEvent | null>(
    null
  );
  const [pasteSummary, setPasteSummary] = useState<IPasteSelectionStreamDoneEvent | null>(null);
  const [pasteErrors, setPasteErrors] = useState<IPasteSelectionStreamErrorEvent[]>([]);
  const [pasteProgressStatus, setPasteProgressStatus] = useState<StreamDialogStatus | null>(null);
  const [isPasteProgressOpen, setIsPasteProgressOpen] = useState(false);
  const [pasteDialogMode, setPasteDialogMode] = useState<StreamDialogMode | null>(null);
  const [pendingPasteSelection, setPendingPasteSelection] = useState<PendingPasteSelection | null>(
    null
  );

  const closeDeleteProgressDialog = useCallback(() => {
    setIsDeleteProgressOpen(false);
    setDeleteProgress(null);
    setDeleteSummary(null);
    setDeleteErrors([]);
    setDeleteProgressStatus(null);
    setDeleteDialogMode(null);
    setPendingDeleteSelection(null);
  }, []);

  const closeClearProgressDialog = useCallback(() => {
    setIsClearProgressOpen(false);
    setClearProgress(null);
    setClearSummary(null);
    setClearErrors([]);
    setClearProgressStatus(null);
    setClearDialogMode(null);
    setPendingClearSelection(null);
  }, []);

  const closeDuplicateProgressDialog = useCallback(() => {
    setIsDuplicateProgressOpen(false);
    setDuplicateProgress(null);
    setDuplicateSummary(null);
    setDuplicateErrors([]);
    setDuplicateProgressStatus(null);
    setDuplicateDialogMode(null);
    setPendingDuplicateSelection(null);
  }, []);

  const closePasteProgressDialog = useCallback(() => {
    setIsPasteProgressOpen(false);
    setPasteProgress(null);
    setPasteSummary(null);
    setPasteErrors([]);
    setPasteProgressStatus(null);
    setPasteDialogMode(null);
    setPendingPasteSelection(null);
  }, []);

  const ensureDeleteProgressDialogError = useCallback(
    (message: string) => {
      setDeleteDialogMode('progress');
      setDeleteProgressStatus('error');
      setDeleteErrors((previous) =>
        previous.length
          ? previous
          : [
              {
                id: 'error',
                phase: 'deleting',
                batchIndex: -1,
                totalCount: deleteProgress?.totalCount ?? 0,
                deletedCount: deleteSummary?.deletedCount ?? deleteProgress?.deletedCount ?? 0,
                recordIds: [],
                message,
              },
            ]
      );
      setIsDeleteProgressOpen(true);
    },
    [deleteProgress?.deletedCount, deleteProgress?.totalCount, deleteSummary?.deletedCount]
  );

  const ensureClearProgressDialogError = useCallback(
    (message: string) => {
      setClearDialogMode('progress');
      setClearProgressStatus('error');
      setClearErrors((previous) =>
        previous.length
          ? previous
          : [
              {
                id: 'error',
                phase: 'clearing',
                batchIndex: -1,
                totalCount: clearProgress?.totalCount ?? 0,
                processedCount: clearSummary?.processedCount ?? clearProgress?.processedCount ?? 0,
                clearedCount: clearSummary?.clearedCount ?? clearProgress?.clearedCount ?? 0,
                recordIds: [],
                message,
              },
            ]
      );
      setIsClearProgressOpen(true);
    },
    [
      clearProgress?.clearedCount,
      clearProgress?.processedCount,
      clearProgress?.totalCount,
      clearSummary?.clearedCount,
      clearSummary?.processedCount,
    ]
  );

  const openDeleteConfirmationDialog = useCallback((deleteRo: IRangesRo, totalCount: number) => {
    setDeleteProgress(null);
    setDeleteSummary(null);
    setDeleteErrors([]);
    setDeleteProgressStatus(null);
    setPendingDeleteSelection({ deleteRo, totalCount });
    setDeleteDialogMode('confirm');
    setIsDeleteProgressOpen(true);
  }, []);

  const openClearConfirmationDialog = useCallback((clearRo: IRangesRo, totalCount: number) => {
    setClearProgress(null);
    setClearSummary(null);
    setClearErrors([]);
    setClearProgressStatus(null);
    setPendingClearSelection({ clearRo, totalCount });
    setClearDialogMode('confirm');
    setIsClearProgressOpen(true);
  }, []);

  const ensureDuplicateProgressDialogError = useCallback(
    (message: string) => {
      setDuplicateDialogMode('progress');
      setDuplicateProgressStatus('error');
      setDuplicateErrors((previous) =>
        previous.length
          ? previous
          : [
              {
                id: 'error',
                phase: 'duplicating',
                batchIndex: -1,
                totalCount: duplicateProgress?.totalCount ?? 0,
                duplicatedCount:
                  duplicateSummary?.duplicatedCount ?? duplicateProgress?.duplicatedCount ?? 0,
                recordIds: [],
                message,
              },
            ]
      );
      setIsDuplicateProgressOpen(true);
    },
    [
      duplicateProgress?.duplicatedCount,
      duplicateProgress?.totalCount,
      duplicateSummary?.duplicatedCount,
    ]
  );

  const openDuplicateConfirmationDialog = useCallback(
    (duplicateRo: IRangesRo, totalCount: number) => {
      setDuplicateProgress(null);
      setDuplicateSummary(null);
      setDuplicateErrors([]);
      setDuplicateProgressStatus(null);
      setPendingDuplicateSelection({ duplicateRo, totalCount });
      setDuplicateDialogMode('confirm');
      setIsDuplicateProgressOpen(true);
    },
    []
  );

  const ensurePasteProgressDialogError = useCallback(
    (message: string) => {
      setPasteDialogMode('progress');
      setPasteProgressStatus('error');
      setPasteErrors((previous) =>
        previous.length
          ? previous
          : [
              {
                id: 'error',
                phase: 'pasting',
                batchIndex: -1,
                totalCount: pasteProgress?.totalCount ?? 0,
                processedCount: pasteSummary?.processedCount ?? pasteProgress?.processedCount ?? 0,
                updatedCount: pasteSummary?.updatedCount ?? pasteProgress?.updatedCount ?? 0,
                createdCount: pasteSummary?.createdCount ?? pasteProgress?.createdCount ?? 0,
                recordIds: [],
                message,
              },
            ]
      );
      setIsPasteProgressOpen(true);
    },
    [
      pasteProgress?.createdCount,
      pasteProgress?.processedCount,
      pasteProgress?.totalCount,
      pasteProgress?.updatedCount,
      pasteSummary?.createdCount,
      pasteSummary?.processedCount,
      pasteSummary?.updatedCount,
    ]
  );

  const openPasteConfirmationDialog = useCallback((pasteRo: IPasteRo, totalCount: number) => {
    setPasteProgress(null);
    setPasteSummary(null);
    setPasteErrors([]);
    setPasteProgressStatus(null);
    setPendingPasteSelection({ pasteRo, totalCount });
    setPasteDialogMode('confirm');
    setIsPasteProgressOpen(true);
  }, []);

  const groupBy = view?.group;
  const visibleFieldIds = useMemo(() => fields.map(({ id }) => id), [fields]);
  const selectionViewQuery = useMemo(
    () => buildSelectionViewQuery({ personalViewCommonQuery, visibleFieldIds }),
    [personalViewCommonQuery, visibleFieldIds]
  );

  const buildSelectionRequest = useCallback(
    async (rangesRo: IRangesRo) => {
      const { collapsedGroupIds: _originalCollapsedGroupIds, ...rest } = rangesRo;
      const params = {
        ...rest,
        ...selectionViewQuery,
        viewId,
        groupBy,
        search,
      };

      if (collapsedGroupIds && collapsedGroupIds.length > LARGE_QUERY_THRESHOLD) {
        const { data } = await saveQueryParams({ params: { collapsedGroupIds } });
        return {
          ...params,
          queryId: data.queryId,
        };
      }

      return {
        ...params,
        collapsedGroupIds,
      };
    },
    [collapsedGroupIds, groupBy, search, selectionViewQuery, viewId]
  );

  const { mutateAsync: defaultCopyReq } = useMutation({
    mutationFn: async (copyRo: IRangesRo) => {
      const { collapsedGroupIds: _originalCollapsedGroupIds, ...rest } = copyRo;
      const params = {
        ...rest,
        ...selectionViewQuery,
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
        ...selectionViewQuery,
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
      temporaryPaste(tableId!, { ...temporaryPasteRo, ...selectionViewQuery, viewId }),
  });

  const { mutateAsync: clearReq } = useMutation({
    mutationFn: (clearRo: IRangesRo) =>
      clear(tableId!, {
        ...clearRo,
        ...selectionViewQuery,
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
    mutationFn: async (deleteRo: IRangesRo) =>
      deleteSelection(tableId!, await buildSelectionRequest(deleteRo)),
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

  const executePasteSelectionRequest = useCallback(
    async (
      pasteRo: IPasteRo,
      totalCount: number,
      updateTemporaryData?: (records: ITemporaryPasteVo) => void
    ) => {
      if (updateTemporaryData) {
        const res = await temporaryPasteReq({
          content: pasteRo.content,
          ranges: pasteRo.ranges,
          header: pasteRo.header,
        });
        updateTemporaryData(res.data);
        return { streamed: false as const };
      }

      if (shouldUsePasteSelectionStream(totalCount)) {
        openPasteConfirmationDialog(pasteRo, totalCount);
        return { streamed: true as const };
      }

      await pasteReq(pasteRo);
      return { streamed: false as const };
    },
    [openPasteConfirmationDialog, pasteReq, temporaryPasteReq]
  );

  const handleFilePasteSelection = useCallback(
    async (
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      files: FileList,
      options: PasteSelectionRequestOptions
    ) => {
      const { affectedRows, updateTemporaryData } = options;
      const isSelectionCoverAttachments = selectionCoverAttachments(selection, fields);
      if (!isSelectionCoverAttachments) {
        throw new Error(t('table:table.actionTips.pasteFileFailed'));
      }

      await filePasteHandler({
        files,
        fields,
        selection,
        recordMap,
        baseId,
        requestPaste: async (content, type, ranges) => {
          const header = [fieldVoSchema.parse(fields.find((f) => f.type === FieldType.Attachment))];
          await executePasteSelectionRequest(
            { content, type, ranges, header },
            Array.isArray(content) ? content.length : affectedRows,
            updateTemporaryData
          );
        },
      });
    },
    [baseId, executePasteSelectionRequest, fields, t]
  );

  const handleTextPasteSelection = useCallback(
    async (
      clipboard: { html: string; text: string; hasHtml: boolean },
      selection: CombinedSelection,
      options: PasteSelectionRequestOptions
    ) => {
      const { affectedRows, updateTemporaryData } = options;
      await textPasteHandlerWithData(
        clipboard,
        selection,
        async (content, type, ranges, header) => {
          if (!content) {
            return;
          }
          await executePasteSelectionRequest(
            { content, type, ranges, header },
            Math.max(Array.isArray(content) ? content.length : 0, affectedRows),
            updateTemporaryData
          );
        }
      );
    },
    [executePasteSelectionRequest]
  );

  const confirmPasteSelectionIfNeeded = useCallback(
    async (affectedRows: number, shouldUsePasteStream: boolean) => {
      if (affectedRows < 10 || shouldUsePasteStream) {
        return true;
      }

      return confirm({
        title: t('table:table.actionTips.pasteConfirmTitle'),
        description: t('table:table.actionTips.pasteConfirmDescription', {
          recordCount: affectedRows,
        }),
        confirmText: t('table:table.actionTips.paste'),
        cancelText: t('common:actions.cancel'),
        confirmButtonVariant: 'destructive',
      });
    },
    [confirm, t]
  );

  const performPasteSelection = useCallback(
    async (
      params: {
        hasTextType: boolean;
        html: string;
        text: string;
        hasHtml: boolean;
        files: FileList;
      },
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      options: PasteSelectionRequestOptions
    ) => {
      if (params.files.length > 0 && !params.hasTextType) {
        await handleFilePasteSelection(selection, recordMap, params.files, options);
        return;
      }

      await handleTextPasteSelection(
        { html: params.html, text: params.text, hasHtml: params.hasHtml },
        selection,
        options
      );
    },
    [handleFilePasteSelection, handleTextPasteSelection]
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
      const hasHtml = types.includes(ClipboardTypes.html);
      const html = hasHtml ? e.clipboardData.getData(ClipboardTypes.html) : '';
      const text = types.includes(ClipboardTypes.text)
        ? e.clipboardData.getData(ClipboardTypes.text)
        : '';
      const fileArray = Array.from(files) as unknown as FileList;

      const { cellValues } = getCellPasteInfo(e);

      const pasteRecordLength = cellValues?.length ?? 0;
      const effectRows = getEffectRows(selection, rowCount);
      const affectedRows = Math.max(pasteRecordLength, effectRows);

      const shouldUsePasteStream = shouldUsePasteSelectionStream(affectedRows);

      const confirmed = await confirmPasteSelectionIfNeeded(affectedRows, shouldUsePasteStream);
      if (!confirmed) {
        return;
      }

      const toastId = shouldUsePasteStream
        ? null
        : toast.loading(t('table:table.actionTips.pasting'));

      try {
        await performPasteSelection(
          {
            hasTextType: types.includes(ClipboardTypes.text),
            html,
            text,
            hasHtml,
            files: fileArray,
          },
          selection,
          recordMap,
          {
            affectedRows,
            updateTemporaryData,
          }
        );
        if (toastId) {
          toast.success(t('table:table.actionTips.pasteSuccessful'), { id: toastId });
        }
      } catch (e) {
        const error = e as HttpError;
        const description = getHttpErrorMessage(error, t, 'sdk');
        toast.error(t('table:table.actionTips.pasteFailed'), {
          description,
          ...(toastId ? { id: toastId } : {}),
        });
        console.error('Paste error: ', error);
      }
    },
    [viewId, tableId, rowCount, t, confirmPasteSelectionIfNeeded, performPasteSelection]
  );

  const doFill = useCallback(
    async (args: Pick<IPasteRo, 'content' | 'ranges' | 'header' | 'type'>) => {
      try {
        const totalCount = Array.isArray(args.content) ? args.content.length : 0;
        if (shouldUsePasteSelectionStream(totalCount)) {
          openPasteConfirmationDialog(args, totalCount);
          return;
        }

        const toastId = toast.loading(t('table:table.actionTips.filling'));
        await pasteReq(args);
        toast.success(t('table:table.actionTips.fillSuccessful'), { id: toastId });
      } catch (e) {
        const error = e as HttpError;
        const description = getHttpErrorMessage(error, t, 'sdk');
        toast.error(t('table:table.actionTips.fillFailed'), {
          description,
        });
        console.error('Fill error: ', error);
      }
    },
    [openPasteConfirmationDialog, pasteReq, t]
  );

  const doClear = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;

      const effectRows = getEffectRows(selection, rowCount);
      const effectCells = getEffectCellCount(selection, fields, rowCount);
      const clearRo = {
        ranges: selection.serialize(),
        ...(rangeTypes[selection.type] ? { type: rangeTypes[selection.type] } : {}),
      } satisfies IRangesRo;

      if (shouldUseClearSelectionStream(selection, rowCount)) {
        openClearConfirmationDialog(clearRo, effectRows);
        return;
      }

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
      await clearReq(clearRo);

      toast.success(t('table:table.actionTips.clearSuccessful'), { id: toastId });
    },
    [viewId, tableId, rowCount, fields, openClearConfirmationDialog, t, clearReq, confirm]
  );

  const runDeleteSelectionStream = useCallback(
    async (deleteRo: IRangesRo, totalCount: number) => {
      if (!tableId) {
        return false;
      }

      setDeleteDialogMode('progress');
      setDeleteErrors([]);
      setDeleteSummary(null);
      setDeleteProgressStatus('running');
      setDeleteProgress({
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount,
        deletedCount: 0,
        batchDeletedCount: 0,
      });
      setIsDeleteProgressOpen(true);

      const streamResult = await deleteSelectionStream(
        tableId,
        await buildSelectionRequest(deleteRo),
        {
          headers: {
            'X-Window-Id': ensureUndoRedoWindowIdHeader(),
          },
          onProgress: (progress) => {
            setDeleteProgress(progress);
            setDeleteProgressStatus('running');
            setIsDeleteProgressOpen(true);
          },
          onError: (error) => {
            setDeleteErrors((previous) => [...previous, error]);
            setIsDeleteProgressOpen(true);
          },
        }
      );

      setDeleteSummary(streamResult.done);
      setDeleteProgressStatus(streamResult.errors.length ? 'partial' : 'success');

      if (streamResult.errors.length) {
        return true;
      }

      return false;
    },
    [buildSelectionRequest, tableId]
  );

  const runClearSelectionStream = useCallback(
    async (clearRo: IRangesRo, totalCount: number) => {
      if (!tableId) {
        return false;
      }

      setClearDialogMode('progress');
      setClearErrors([]);
      setClearSummary(null);
      setClearProgressStatus('running');
      setClearProgress({
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount,
        processedCount: 0,
        clearedCount: 0,
        batchProcessedCount: 0,
        batchClearedCount: 0,
      });
      setIsClearProgressOpen(true);

      const streamResult = await clearSelectionStream(
        tableId,
        {
          ...clearRo,
          ...selectionViewQuery,
          viewId,
          groupBy,
          collapsedGroupIds,
          search,
        },
        {
          headers: {
            'X-Window-Id': ensureUndoRedoWindowIdHeader(),
          },
          onProgress: (progress) => {
            setClearProgress(progress);
            setClearProgressStatus('running');
            setIsClearProgressOpen(true);
          },
          onError: (error) => {
            setClearErrors((previous) => [...previous, error]);
            setIsClearProgressOpen(true);
          },
        }
      );

      setClearSummary(streamResult.done);
      setClearProgressStatus(streamResult.errors.length ? 'partial' : 'success');

      return streamResult.errors.length > 0;
    },
    [collapsedGroupIds, groupBy, search, selectionViewQuery, tableId, viewId]
  );

  const confirmDeleteSelection = useCallback(async () => {
    if (!pendingDeleteSelection) {
      return;
    }

    const { deleteRo, totalCount } = pendingDeleteSelection;

    setPendingDeleteSelection(null);

    try {
      const hasPartialErrors = await runDeleteSelectionStream(deleteRo, totalCount);
      if (hasPartialErrors) {
        return;
      }
    } catch (error) {
      const description =
        getHttpErrorMessage(error as HttpError, t, 'sdk') ||
        (error instanceof Error ? error.message : 'Unknown error');
      ensureDeleteProgressDialogError(description);
      console.error('Delete error: ', error);
    }
  }, [ensureDeleteProgressDialogError, pendingDeleteSelection, runDeleteSelectionStream, t]);

  const confirmClearSelection = useCallback(async () => {
    if (!pendingClearSelection) {
      return;
    }

    const { clearRo, totalCount } = pendingClearSelection;
    setPendingClearSelection(null);

    try {
      await runClearSelectionStream(clearRo, totalCount);
    } catch (error) {
      const description =
        getHttpErrorMessage(error as HttpError, t, 'sdk') ||
        (error instanceof Error ? error.message : 'Unknown error');
      ensureClearProgressDialogError(description);
      console.error('Clear error: ', error);
    }
  }, [ensureClearProgressDialogError, pendingClearSelection, runClearSelectionStream, t]);

  const runDuplicateSelectionStream = useCallback(
    async (duplicateRo: IRangesRo, totalCount: number) => {
      if (!tableId) {
        return false;
      }

      setDuplicateDialogMode('progress');
      setDuplicateErrors([]);
      setDuplicateSummary(null);
      setDuplicateProgressStatus('running');
      setDuplicateProgress({
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount,
        duplicatedCount: 0,
        batchDuplicatedCount: 0,
      });
      setIsDuplicateProgressOpen(true);

      const streamResult = await duplicateSelectionStream(
        tableId,
        await buildSelectionRequest(duplicateRo),
        {
          headers: {
            'X-Window-Id': ensureUndoRedoWindowIdHeader(),
          },
          onProgress: (progress) => {
            setDuplicateProgress(progress);
            setDuplicateProgressStatus('running');
            setIsDuplicateProgressOpen(true);
          },
          onError: (error) => {
            setDuplicateErrors((previous) => [...previous, error]);
            setIsDuplicateProgressOpen(true);
          },
        }
      );

      setDuplicateSummary(streamResult.done);
      setDuplicateProgressStatus(streamResult.errors.length ? 'partial' : 'success');

      if (streamResult.errors.length) {
        return true;
      }

      return false;
    },
    [buildSelectionRequest, tableId]
  );

  const runPasteSelectionStream = useCallback(
    async (pasteRo: IPasteRo, totalCount: number) => {
      if (!tableId) {
        return false;
      }

      setPasteDialogMode('progress');
      setPasteErrors([]);
      setPasteSummary(null);
      setPasteProgressStatus('running');
      setPasteProgress({
        id: 'progress',
        phase: 'preparing',
        batchIndex: -1,
        totalCount,
        processedCount: 0,
        updatedCount: 0,
        createdCount: 0,
        batchProcessedCount: 0,
      });
      setIsPasteProgressOpen(true);

      const streamResult = await pasteSelectionStream(
        tableId,
        {
          ...pasteRo,
          ...selectionViewQuery,
          viewId,
          groupBy,
          collapsedGroupIds,
          search,
        },
        {
          headers: {
            'X-Window-Id': ensureUndoRedoWindowIdHeader(),
          },
          onProgress: (progress) => {
            setPasteProgress(progress);
            setPasteProgressStatus('running');
            setIsPasteProgressOpen(true);
          },
          onError: (error) => {
            setPasteErrors((previous) => [...previous, error]);
            setIsPasteProgressOpen(true);
          },
        }
      );

      setPasteSummary(streamResult.done);
      setPasteProgressStatus(streamResult.errors.length ? 'partial' : 'success');

      return streamResult.errors.length > 0;
    },
    [collapsedGroupIds, groupBy, search, selectionViewQuery, tableId, viewId]
  );

  const confirmDuplicateSelection = useCallback(async () => {
    if (!pendingDuplicateSelection) {
      return;
    }

    const { duplicateRo, totalCount } = pendingDuplicateSelection;

    setPendingDuplicateSelection(null);

    try {
      const hasPartialErrors = await runDuplicateSelectionStream(duplicateRo, totalCount);
      if (hasPartialErrors) {
        return;
      }
    } catch (error) {
      const description =
        getHttpErrorMessage(error as HttpError, t, 'sdk') ||
        (error instanceof Error ? error.message : 'Unknown error');
      ensureDuplicateProgressDialogError(description);
      console.error('Duplicate error: ', error);
    }
  }, [
    ensureDuplicateProgressDialogError,
    pendingDuplicateSelection,
    runDuplicateSelectionStream,
    t,
  ]);

  const confirmPasteSelection = useCallback(async () => {
    if (!pendingPasteSelection) {
      return;
    }

    const { pasteRo, totalCount } = pendingPasteSelection;
    setPendingPasteSelection(null);

    try {
      await runPasteSelectionStream(pasteRo, totalCount);
    } catch (error) {
      const description =
        getHttpErrorMessage(error as HttpError, t, 'sdk') ||
        (error instanceof Error ? error.message : 'Unknown error');
      ensurePasteProgressDialogError(description);
      console.error('Paste error: ', error);
    }
  }, [ensurePasteProgressDialogError, pendingPasteSelection, runPasteSelectionStream, t]);

  const doDelete = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;
      const ranges = selection.serialize();
      const type = rangeTypes[selection.type];

      try {
        const deleteRo = {
          ranges,
          ...(type ? { type } : {}),
        } satisfies IRangesRo;

        if (shouldUseDeleteSelectionStream(selection, rowCount)) {
          openDeleteConfirmationDialog(deleteRo, getEffectRows(selection, rowCount));
          return;
        } else {
          const toastId = toast.loading(t('table:table.actionTips.deleting'), {
            id: deleteToastId,
          });
          await deleteReq(deleteRo);
          toast.success(t('table:table.actionTips.deleteSuccessful'), { id: toastId });
        }
      } catch (error) {
        const description =
          getHttpErrorMessage(error as HttpError, t, 'sdk') ||
          (error instanceof Error ? error.message : 'Unknown error');
        toast.error(description, { id: deleteToastId });
        console.error('Delete error: ', error);
      }
    },
    [deleteReq, openDeleteConfirmationDialog, rowCount, tableId, t, viewId]
  );

  const doDuplicate = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) return;

      const duplicateRo = {
        ranges: selection.serialize(),
        ...(rangeTypes[selection.type] ? { type: rangeTypes[selection.type] } : {}),
      } satisfies IRangesRo;
      const totalCount = getEffectRows(selection, rowCount);

      try {
        if (shouldUseDuplicateSelectionStream(selection, rowCount)) {
          openDuplicateConfirmationDialog(duplicateRo, totalCount);
          return;
        }

        const hasPartialErrors = await runDuplicateSelectionStream(duplicateRo, totalCount);
        if (hasPartialErrors) {
          return;
        }
      } catch (error) {
        const description =
          getHttpErrorMessage(error as HttpError, t, 'sdk') ||
          (error instanceof Error ? error.message : 'Unknown error');
        ensureDuplicateProgressDialogError(description);
        console.error('Duplicate error: ', error);
      }
    },
    [
      ensureDuplicateProgressDialogError,
      openDuplicateConfirmationDialog,
      rowCount,
      runDuplicateSelectionStream,
      tableId,
      t,
      viewId,
    ]
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
    duplicateRecords: doDuplicate,
    clearProgress,
    clearSummary,
    clearErrors,
    clearProgressStatus,
    clearDialogMode,
    clearConfirmRecordCount: pendingClearSelection?.totalCount ?? 0,
    isClearProgressOpen,
    closeClearProgressDialog,
    confirmClearSelection,
    deleteProgress,
    deleteSummary,
    deleteErrors,
    deleteProgressStatus,
    deleteDialogMode,
    deleteConfirmRecordCount: pendingDeleteSelection?.totalCount ?? 0,
    isDeleteProgressOpen,
    closeDeleteProgressDialog,
    confirmDeleteSelection,
    duplicateProgress,
    duplicateSummary,
    duplicateErrors,
    duplicateProgressStatus,
    duplicateDialogMode,
    duplicateConfirmRecordCount: pendingDuplicateSelection?.totalCount ?? 0,
    isDuplicateProgressOpen,
    closeDuplicateProgressDialog,
    confirmDuplicateSelection,
    pasteProgress,
    pasteSummary,
    pasteErrors,
    pasteProgressStatus,
    pasteDialogMode,
    pasteConfirmRecordCount: pendingPasteSelection?.totalCount ?? 0,
    isPasteProgressOpen,
    closePasteProgressDialog,
    confirmPasteSelection,
    syncCopy: doSyncCopy,
    fill: doFill,
  };
};
