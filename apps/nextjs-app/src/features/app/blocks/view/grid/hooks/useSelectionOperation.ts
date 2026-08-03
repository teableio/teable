/* eslint-disable sonarjs/no-duplicate-string */
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { FieldType, fieldVoSchema, parseClipboardText, type HttpError } from '@teable/core';
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
  IClearByIdRo,
  IPasteByIdRo,
  IDeleteByIdRo,
  ICopyByIdRo,
  IPasteByIdStreamRo,
  IPasteSelectionStreamDoneEvent,
  IPasteSelectionStreamErrorEvent,
  IPasteSelectionStreamProgressEvent,
  IPasteRo,
  IRangesRo,
  ISelectionIdsRo,
  ITemporaryPasteRo,
  ITemporaryPasteVo,
} from '@teable/openapi';
import {
  clearById,
  clearSelectionByIdStream,
  copy,
  copyById,
  deleteById,
  deleteSelectionByIdStream,
  duplicateSelectionStream,
  ensureUndoRedoWindowIdHeader,
  getIdsFromRanges,
  IdReturnType,
  pasteById,
  pasteSelectionByIdStream,
  RangeType,
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
  SelectionRegionType,
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
  selectionIncludesEditableField,
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
import { buildSelectionViewQuery, getSelectionGroupBy } from '../utils/selectionViewQuery';
import { useSyncSelectionStore } from './useSelectionStore';

const clearToastId = 'clearToastId';
const deleteToastId = 'deleteToastId';
const getPasteContentColumnCount = (content: IPasteByIdRo['content']) => {
  if (Array.isArray(content)) {
    return content.reduce((max, row) => Math.max(max, row.length), 0);
  }

  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce((max, row) => Math.max(max, row.length ? row.split('\t').length : 0), 0);
};

const getPasteContentRowCount = (content: IPasteByIdRo['content']) => {
  if (Array.isArray(content)) {
    return content.length;
  }

  return parseClipboardText(content).length;
};

type StreamDialogStatus = 'running' | 'success' | 'partial' | 'error';
type StreamDialogMode = 'confirm' | 'progress';
type PendingDeleteSelection = {
  deleteRo: IDeleteByIdRo;
  totalCount: number;
};
type PendingClearSelection = {
  clearRo: IClearByIdRo;
  totalCount: number;
};
type PendingDuplicateSelection = {
  duplicateRo: IRangesRo;
  totalCount: number;
};
type PendingPasteSelection = {
  pasteRo: IPasteByIdRo;
  totalCount: number;
};
type PasteSelectionRequestOptions = {
  affectedRows: number;
  updateTemporaryData?: (records: ITemporaryPasteVo) => void;
};

const toSelectionIdsRo = (selectionRo: IClearByIdRo | IDeleteByIdRo): ISelectionIdsRo => {
  const { selection, ...query } = selectionRo;
  return {
    ...query,
    selection: {
      ...(selection.recordIds != null ? { recordIds: selection.recordIds } : { allRecords: true }),
      ...(selection.excludeRecordIds?.length
        ? { excludedRecordIds: selection.excludeRecordIds }
        : {}),
      ...('fieldIds' in selection && selection.fieldIds?.length
        ? { fieldIds: selection.fieldIds }
        : {}),
    },
  };
};

const toPasteByIdStreamRo = (pasteRo: IPasteByIdRo): IPasteByIdStreamRo => {
  const { content, header, ...selectionRo } = pasteRo;
  return {
    ...toSelectionIdsRo(selectionRo),
    content,
    header,
  };
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

  const openDeleteConfirmationDialog = useCallback(
    (deleteRo: IDeleteByIdRo, totalCount: number) => {
      setDeleteProgress(null);
      setDeleteSummary(null);
      setDeleteErrors([]);
      setDeleteProgressStatus(null);
      setPendingDeleteSelection({ deleteRo, totalCount });
      setDeleteDialogMode('confirm');
      setIsDeleteProgressOpen(true);
    },
    []
  );

  const openClearConfirmationDialog = useCallback((clearRo: IClearByIdRo, totalCount: number) => {
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

  const openPasteConfirmationDialog = useCallback((pasteRo: IPasteByIdRo, totalCount: number) => {
    setPasteProgress(null);
    setPasteSummary(null);
    setPasteErrors([]);
    setPasteProgressStatus(null);
    setPendingPasteSelection({ pasteRo, totalCount });
    setPasteDialogMode('confirm');
    setIsPasteProgressOpen(true);
  }, []);

  const viewGroup = view?.group;
  const visibleFieldIds = useMemo(() => fields.map(({ id }) => id), [fields]);
  const selectionViewQuery = useMemo(
    () => buildSelectionViewQuery({ personalViewCommonQuery, visibleFieldIds }),
    [personalViewCommonQuery, visibleFieldIds]
  );
  const groupBy = useMemo(
    () => getSelectionGroupBy({ selectionViewQuery, viewGroup }),
    [selectionViewQuery, viewGroup]
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

  const buildSelectionQueryRequest = useCallback(async () => {
    const params = {
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
  }, [collapsedGroupIds, groupBy, search, selectionViewQuery, viewId]);

  const getSelectedFieldIds = useCallback(
    (selection: CombinedSelection) => {
      const selectFieldIdsByColumnRanges = (ranges: [number, number][]) =>
        ranges.flatMap(([startCol, endCol]) =>
          fields.slice(startCol, endCol + 1).map((field) => field.id)
        );

      if (selection.type === SelectionRegionType.Columns) {
        return selectFieldIdsByColumnRanges(selection.serialize() as [number, number][]);
      }

      if (selection.type === SelectionRegionType.Cells) {
        const [[startCol], [endCol]] = selection.serialize();
        return fields.slice(startCol, endCol + 1).map((field) => field.id);
      }

      return fields.map((field) => field.id);
    },
    [fields]
  );

  const getPasteTargetFieldIds = useCallback(
    (selection: CombinedSelection, content: IPasteByIdRo['content']) => {
      if (selection.type === SelectionRegionType.Rows) {
        return fields.map((field) => field.id);
      }

      const contentColumnCount = getPasteContentColumnCount(content);
      const getFieldsFromStartColumn = (startCol: number, selectedColumnCount: number) => {
        const targetColumnCount = Math.max(selectedColumnCount, contentColumnCount);
        return fields.slice(startCol, startCol + targetColumnCount).map((field) => field.id);
      };

      if (selection.type === SelectionRegionType.Columns) {
        const [[startCol, endCol]] = selection.serialize() as [number, number][];
        return getFieldsFromStartColumn(startCol, endCol - startCol + 1);
      }

      if (selection.type === SelectionRegionType.Cells) {
        const [[startCol], [endCol]] = selection.serialize();
        return getFieldsFromStartColumn(startCol, endCol - startCol + 1);
      }

      return fields.map((field) => field.id);
    },
    [fields]
  );

  const areAllFieldsSelected = useCallback(
    (fieldIds: string[]) => {
      if (!fields.length || fieldIds.length < fields.length) {
        return false;
      }

      const selectedFieldIds = new Set(fieldIds);
      return fields.every((field) => selectedFieldIds.has(field.id));
    },
    [fields]
  );

  const getRecordIdsFromLoadedRows = useCallback(
    (ranges: [number, number][], recordMap: IRecordIndexMap) => {
      const recordIds: string[] = [];
      for (const [startRow, endRow] of ranges) {
        for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
          const recordId = recordMap[rowIndex]?.id;
          if (!recordId && rowCount != null && rowIndex >= rowCount) {
            continue;
          }
          if (!recordId) {
            return;
          }
          recordIds.push(recordId);
        }
      }
      return recordIds;
    },
    [rowCount]
  );

  const getExcludeRecordIdsForAllRowsSelection = useCallback(
    (ranges: [number, number][], recordMap: IRecordIndexMap) => {
      if (rowCount == null || rowCount <= 0) {
        return;
      }

      let nextSelectedRow = 0;
      const excludeRecordIds: string[] = [];
      for (const [startRow, endRow] of ranges) {
        for (let rowIndex = nextSelectedRow; rowIndex < startRow; rowIndex++) {
          const recordId = recordMap[rowIndex]?.id;
          if (!recordId) {
            return;
          }
          excludeRecordIds.push(recordId);
        }
        nextSelectedRow = endRow + 1;
      }

      for (let rowIndex = nextSelectedRow; rowIndex < rowCount; rowIndex++) {
        const recordId = recordMap[rowIndex]?.id;
        if (!recordId) {
          return;
        }
        excludeRecordIds.push(recordId);
      }

      return excludeRecordIds;
    },
    [rowCount]
  );

  const buildSelectionFieldIds = useCallback(
    (selection: CombinedSelection, fieldIds: string[], includeFieldSelection: boolean) => {
      if (
        !includeFieldSelection ||
        selection.type === SelectionRegionType.Rows ||
        areAllFieldsSelected(fieldIds)
      ) {
        return {};
      }

      return {
        fieldIds,
      };
    },
    [areAllFieldsSelected]
  );

  const getSelectionRowRanges = useCallback(
    (selection: CombinedSelection, ranges: IRangesRo['ranges']) => {
      if (selection.type === SelectionRegionType.Rows) {
        return ranges as [number, number][];
      }

      return [[ranges[0][1], ranges[1][1]]] as [number, number][];
    },
    []
  );

  const getPasteSelectionRowRanges = useCallback(
    (selection: CombinedSelection, targetRowCount: number) => {
      if (selection.type !== SelectionRegionType.Cells) {
        return;
      }

      const ranges = selection.serialize();
      const startRow = ranges[0][1];

      return [[startRow, startRow + Math.max(targetRowCount, 1) - 1]] as [number, number][];
    },
    []
  );

  const buildSelectionRecordIds = useCallback(
    async (
      selection: CombinedSelection,
      ranges: IRangesRo['ranges'],
      recordMap: IRecordIndexMap,
      options?: { rowRanges?: [number, number][]; allowQueryScope?: boolean }
    ) => {
      const rowRanges = options?.rowRanges ?? getSelectionRowRanges(selection, ranges);
      const selectedRowCount = rowRanges.reduce(
        (acc, [startRow, endRow]) => acc + endRow - startRow + 1,
        0
      );
      const allowQueryScope = options?.allowQueryScope ?? true;
      const isRowsSelectionWithExclusions =
        allowQueryScope &&
        rowCount != null &&
        selectedRowCount < rowCount &&
        selectedRowCount > rowCount / 2;

      if (isRowsSelectionWithExclusions) {
        const excludeRecordIds = getExcludeRecordIdsForAllRowsSelection(rowRanges, recordMap);
        if (excludeRecordIds) {
          return {
            excludeRecordIds,
          };
        }
      }

      if (allowQueryScope && rowCount != null && selectedRowCount >= rowCount) {
        return {};
      }

      const loadedRecordIds = getRecordIdsFromLoadedRows(rowRanges, recordMap);
      if (loadedRecordIds) {
        return {
          recordIds: loadedRecordIds,
        };
      }

      if (!tableId) {
        throw new Error('Selected record ids are not loaded yet');
      }

      const type = rangeTypes[selection.type];
      const rangesRo = await buildSelectionRequest(
        options?.rowRanges
          ? {
              ranges: options.rowRanges,
              type: RangeType.Rows,
            }
          : {
              ranges,
              ...(type ? { type } : {}),
            }
      );
      const { data } = await getIdsFromRanges(tableId, {
        ...rangesRo,
        returnType: IdReturnType.RecordId,
      });

      return {
        recordIds: data.recordIds ?? [],
      };
    },
    [
      buildSelectionRequest,
      getExcludeRecordIdsForAllRowsSelection,
      getRecordIdsFromLoadedRows,
      getSelectionRowRanges,
      rowCount,
      tableId,
    ]
  );

  const buildSelectionIdRequest = useCallback(
    async (
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      options?: {
        fieldIds?: string[];
        includeFieldSelection?: boolean;
        rowRanges?: [number, number][];
        allowQueryScope?: boolean;
      }
    ) => {
      const ranges = selection.serialize();
      const selectionQueryRequest = await buildSelectionQueryRequest();
      const fieldIds = options?.fieldIds ?? getSelectedFieldIds(selection);
      const includeFieldSelection = options?.includeFieldSelection ?? true;
      const selectionFieldIds = buildSelectionFieldIds(selection, fieldIds, includeFieldSelection);

      if (selection.type === SelectionRegionType.Columns) {
        return {
          ...selectionQueryRequest,
          selection: selectionFieldIds,
        };
      }

      const selectionRecordIds = await buildSelectionRecordIds(selection, ranges, recordMap, {
        rowRanges: options?.rowRanges,
        allowQueryScope: options?.allowQueryScope,
      });

      return {
        ...selectionQueryRequest,
        selection: {
          ...selectionRecordIds,
          ...selectionFieldIds,
        },
      };
    },
    [
      buildSelectionFieldIds,
      buildSelectionQueryRequest,
      buildSelectionRecordIds,
      getSelectedFieldIds,
    ]
  );

  const buildPasteSelectionIdRequest = useCallback(
    async (
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      content: IPasteByIdRo['content'],
      fieldIds: string[],
      affectedRows: number
    ) => {
      const rowRanges = getPasteSelectionRowRanges(
        selection,
        Math.max(getPasteContentRowCount(content), affectedRows)
      );

      return buildSelectionIdRequest(selection, recordMap, {
        fieldIds,
        rowRanges,
        allowQueryScope: !rowRanges,
      });
    },
    [buildSelectionIdRequest, getPasteSelectionRowRanges]
  );

  const buildCopySelectionIdRequest = useCallback(
    async (selection: CombinedSelection, recordMap: IRecordIndexMap): Promise<ICopyByIdRo> => {
      try {
        return (await buildSelectionIdRequest(selection, recordMap, {
          includeFieldSelection: true,
        })) as ICopyByIdRo;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'Selected record ids are not loaded yet'
        ) {
          throw error;
        }
        const ranges = selection.serialize();
        const type = rangeTypes[selection.type];
        const rangesRo = await buildSelectionRequest({
          ranges,
          ...(type ? { type } : {}),
        });
        const { data } = await getIdsFromRanges(tableId!, {
          ...rangesRo,
          returnType: IdReturnType.RecordId,
        });
        const { ranges: _ranges, type: _type, ...selectionQueryRequest } = rangesRo;
        const fieldIds = getSelectedFieldIds(selection);
        const selectionFieldIds = buildSelectionFieldIds(selection, fieldIds, true);

        return {
          ...selectionQueryRequest,
          selection: {
            recordIds: data.recordIds ?? [],
            ...selectionFieldIds,
          },
        };
      }
    },
    [
      buildSelectionFieldIds,
      buildSelectionIdRequest,
      buildSelectionRequest,
      getSelectedFieldIds,
      tableId,
    ]
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

  const { mutateAsync: defaultCopyByIdReq } = useMutation({
    mutationFn: async (copyRo: ICopyByIdRo) => copyById(tableId!, copyRo),
    meta: {
      preventGlobalError: true,
    },
  });

  const { mutateAsync: pasteReq } = useMutation({
    mutationFn: (pasteRo: IPasteByIdRo) => pasteById(tableId!, pasteRo),
    meta: {
      preventGlobalError: true,
    },
  });

  const { mutateAsync: temporaryPasteReq } = useMutation({
    mutationFn: (temporaryPasteRo: ITemporaryPasteRo) =>
      temporaryPaste(tableId!, { ...temporaryPasteRo, ...selectionViewQuery, viewId }),
  });

  const { mutateAsync: clearReq } = useMutation({
    mutationFn: (clearRo: IClearByIdRo) => clearById(tableId!, clearRo),
    onError: () => {
      toast.dismiss(clearToastId);
    },
  });

  const { mutateAsync: deleteReq } = useMutation({
    mutationFn: async (deleteRo: IDeleteByIdRo) => deleteById(tableId!, deleteRo),
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
    async (
      selection: CombinedSelection,
      getCopyData?: () => Promise<ICopyVo>,
      recordMap?: IRecordIndexMap
    ) => {
      if (!checkCopyAndPasteEnvironment()) return;
      if (!viewId || !tableId) return;

      const id = toast.loading(t('table:table.actionTips.copying'));

      const getCopyDataDefault = async () => {
        const ranges = selection.serialize();
        const type = rangeTypes[selection.type];
        const { data } = copyReq
          ? await copyRequest({
              ranges,
              ...(type ? { type } : {}),
            })
          : await defaultCopyByIdReq(await buildCopySelectionIdRequest(selection, recordMap ?? {}));
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
    [
      buildCopySelectionIdRequest,
      checkCopyAndPasteEnvironment,
      copyReq,
      copyRequest,
      defaultCopyByIdReq,
      tableId,
      t,
      viewId,
    ]
  );

  const { confirm } = useConfirm();

  const executePasteSelectionRequest = useCallback(
    async (
      pasteRo: IPasteByIdRo,
      totalCount: number,
      updateTemporaryData?: (records: ITemporaryPasteVo) => void,
      temporaryRanges?: IPasteRo['ranges']
    ) => {
      if (updateTemporaryData) {
        const res = await temporaryPasteReq({
          content: pasteRo.content,
          ranges: temporaryRanges ?? [
            [0, 0],
            [0, 0],
          ],
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
          const pasteRo = {
            ...(await buildPasteSelectionIdRequest(
              selection,
              recordMap,
              content,
              [header[0].id],
              affectedRows
            )),
            content,
            header,
          } as IPasteByIdRo;
          await executePasteSelectionRequest(
            pasteRo,
            Math.max(getPasteContentRowCount(content), affectedRows),
            updateTemporaryData,
            ranges
          );
        },
      });
    },
    [baseId, buildPasteSelectionIdRequest, executePasteSelectionRequest, fields, t]
  );

  const handleTextPasteSelection = useCallback(
    async (
      clipboard: { html: string; text: string; hasHtml: boolean },
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
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
          const fieldIds = getPasteTargetFieldIds(selection, content);
          const pasteRo = {
            ...(await buildPasteSelectionIdRequest(
              selection,
              recordMap,
              content,
              fieldIds,
              affectedRows
            )),
            content,
            header,
          } as IPasteByIdRo;
          await executePasteSelectionRequest(
            pasteRo,
            Math.max(getPasteContentRowCount(content), affectedRows),
            updateTemporaryData,
            ranges
          );
        }
      );
    },
    [buildPasteSelectionIdRequest, executePasteSelectionRequest, getPasteTargetFieldIds]
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
        recordMap,
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

      if (!selectionIncludesEditableField(selection, fields)) {
        toast.error(t('table:table.actionTips.pasteFailed'), {
          description: t('table:table.actionTips.pasteNoEditableFields', {
            defaultValue: 'The selected fields are read-only and cannot be pasted into.',
          }),
        });
        return;
      }

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
    [viewId, tableId, fields, rowCount, t, confirmPasteSelectionIfNeeded, performPasteSelection]
  );

  const doFill = useCallback(
    async (args: Pick<IPasteByIdStreamRo, 'content' | 'header' | 'selection'>) => {
      try {
        if (!tableId || !viewId) return;
        const toastId = toast.loading(t('table:table.actionTips.filling'));
        await pasteSelectionByIdStream(
          tableId,
          {
            ...args,
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
          }
        );
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
    [collapsedGroupIds, groupBy, search, selectionViewQuery, tableId, t, viewId]
  );

  const doClear = useCallback(
    async (selection: CombinedSelection, recordMap?: IRecordIndexMap) => {
      if (!viewId || !tableId) return;

      const effectRows = getEffectRows(selection, rowCount);
      const effectCells = getEffectCellCount(selection, fields, rowCount);
      const clearRo = (await buildSelectionIdRequest(selection, recordMap ?? {}, {
        includeFieldSelection: true,
      })) as IClearByIdRo;

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
    [
      viewId,
      tableId,
      rowCount,
      fields,
      buildSelectionIdRequest,
      openClearConfirmationDialog,
      t,
      clearReq,
      confirm,
    ]
  );

  const runDeleteSelectionStream = useCallback(
    async (deleteRo: IDeleteByIdRo, totalCount: number) => {
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

      const streamResult = await deleteSelectionByIdStream(tableId, toSelectionIdsRo(deleteRo), {
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
      });

      setDeleteSummary(streamResult.done);
      setDeleteProgressStatus(streamResult.errors.length ? 'partial' : 'success');

      if (streamResult.errors.length) {
        return true;
      }

      return false;
    },
    [tableId]
  );

  const runClearSelectionStream = useCallback(
    async (clearRo: IClearByIdRo, totalCount: number) => {
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

      const streamResult = await clearSelectionByIdStream(tableId, toSelectionIdsRo(clearRo), {
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
      });

      setClearSummary(streamResult.done);
      setClearProgressStatus(streamResult.errors.length ? 'partial' : 'success');

      return streamResult.errors.length > 0;
    },
    [tableId]
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
    async (pasteRo: IPasteByIdRo, totalCount: number) => {
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

      const streamResult = await pasteSelectionByIdStream(tableId, toPasteByIdStreamRo(pasteRo), {
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
      });

      setPasteSummary(streamResult.done);
      setPasteProgressStatus(streamResult.errors.length ? 'partial' : 'success');

      return streamResult.errors.length > 0;
    },
    [tableId]
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
    async (selection: CombinedSelection, recordMap?: IRecordIndexMap) => {
      if (!viewId || !tableId) return;
      try {
        const deleteRo = (await buildSelectionIdRequest(selection, recordMap ?? {}, {
          includeFieldSelection: false,
        })) as IDeleteByIdRo;

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
    [buildSelectionIdRequest, deleteReq, openDeleteConfirmationDialog, rowCount, tableId, t, viewId]
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
            rowCount: number;
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
          const { recordMap, selection, rowCount } = params;
          const res = getSyncCopyData({ recordMap, fields, selection, rowCount });
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
