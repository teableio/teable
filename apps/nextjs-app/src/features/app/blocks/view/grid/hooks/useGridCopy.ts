import type { ICopyVo } from '@teable/openapi';
import {
  SelectionRegionType,
  type CombinedSelection,
  type Field,
  type IRecordIndexMap,
} from '@teable/sdk';
import type { ILoadedRecordFields } from '@teable/sdk/utils/column-projection';
import { useConfirm } from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import type { ClipboardEvent } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import {
  downgradeCrossBaseHeaders,
  downgradeCrossBaseRawContent,
  isCrossBaseField,
} from '../utils/crossBaseLink';
import { getSingleRowCopyData, getSyncCopyData } from '../utils/getSyncCopyData';
import { useIsSelectionLoaded } from './useIsSelectionLoaded';

interface IGridCopyOptions {
  fields: Field[];
  baseId?: string;
  shareId?: string;
  canCopy: boolean | undefined;
  recordMap: IRecordIndexMap;
  rowCount: number;
  loadedFieldsByRecordId?: ReadonlyMap<string, ILoadedRecordFields>;
  snapshotFieldIds?: ReadonlySet<string>;
  copy: (
    selection: CombinedSelection,
    getCopyData?: () => Promise<ICopyVo>,
    recordMap?: IRecordIndexMap
  ) => Promise<void>;
  syncCopy: (
    e: ClipboardEvent,
    params:
      | { selection: CombinedSelection; recordMap: IRecordIndexMap; rowCount: number }
      | { getCopyData: () => ICopyVo }
  ) => void;
  captureSelection: (selection: CombinedSelection) => void;
}

export const useGridCopy = ({
  fields,
  baseId,
  shareId,
  canCopy,
  recordMap,
  rowCount,
  loadedFieldsByRecordId,
  snapshotFieldIds,
  copy,
  syncCopy,
  captureSelection,
}: IGridCopyOptions) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { confirm } = useConfirm();
  const isSelectionLoaded = useIsSelectionLoaded();
  const selectionIncludesCrossBaseField = (selection: CombinedSelection) => {
    switch (selection.type) {
      case SelectionRegionType.Cells: {
        const [[startCol], [endCol]] = selection.serialize();
        return fields.slice(startCol, endCol + 1).some((f) => isCrossBaseField(f, baseId));
      }
      case SelectionRegionType.Columns:
        return selection
          .serialize()
          .some(([s, e]) => fields.slice(s, e + 1).some((f) => isCrossBaseField(f, baseId)));
      case SelectionRegionType.Rows:
        return fields.some((f) => isCrossBaseField(f, baseId));
      default:
        return false;
    }
  };
  const isLoaded = (selection: CombinedSelection) =>
    isSelectionLoaded({
      selection,
      recordMap,
      rowCount,
      loadedFieldsByRecordId,
      snapshotFieldIds,
      fields,
    });

  // Context-menu copy has no clipboard event and uses navigator.clipboard.
  const onCopy = async (
    selection: CombinedSelection,
    e?: ClipboardEvent,
    singleRowValues?: { [fieldId: string]: unknown }
  ) => {
    if (!canCopy) {
      e?.preventDefault();
      toast.warning(t('table:table.actionTips.copyError.noPermission'));
      return;
    }
    const getCopyData = () => {
      if (singleRowValues != null) {
        return getSingleRowCopyData({ fields, selection, fieldValueMap: singleRowValues });
      }
      const { headers, ...data } = getSyncCopyData({ recordMap, fields, selection, rowCount });
      return { ...data, header: headers };
    };
    // Both viewport and presort/prefilling copies share this policy. Single-row
    // values are supplied by their row container, independently of the viewport cache.
    if (shareId && selectionIncludesCrossBaseField(selection)) {
      e?.preventDefault();
      if (singleRowValues == null && !isLoaded(selection)) {
        toast.warning(t('table:table.actionTips.crossBaseCopyLoadFirst'));
        return;
      }
      const confirmed = await confirm({
        title: t('table:table.actionTips.crossBaseCopyTitle'),
        description: t('table:table.actionTips.crossBaseCopyDescription'),
        confirmText: t('table:table.actionTips.crossBaseCopyConfirm'),
        cancelText: t('common:actions.cancel'),
      });
      if (!confirmed) return;
      await copy(selection, async () => {
        const { content, displayContent, header, rawContent } = getCopyData();
        const { headers: downgradedHeaders, downgradedIndices } = downgradeCrossBaseHeaders(
          header,
          baseId
        );
        return {
          content,
          header: downgradedHeaders,
          rawContent: downgradeCrossBaseRawContent(rawContent, displayContent, downgradedIndices),
        };
      });
      return;
    }
    if (e && singleRowValues != null) {
      syncCopy(e, { getCopyData });
      return;
    }
    if (baseId) captureSelection(selection);
    if (e && isLoaded(selection)) {
      syncCopy(e, { selection, recordMap, rowCount });
      return;
    }
    copy(selection, undefined, recordMap);
  };

  const onCopyForSingleRow = async (
    e: ClipboardEvent,
    selection: CombinedSelection,
    fieldValueMap?: { [fieldId: string]: unknown }
  ) => {
    if (selection.type !== SelectionRegionType.Cells || fieldValueMap == null) return;
    await onCopy(selection, e, fieldValueMap);
  };

  return { onCopy, onCopyForSingleRow };
};
