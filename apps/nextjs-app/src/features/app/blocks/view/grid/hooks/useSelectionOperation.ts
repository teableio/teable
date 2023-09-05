import { SelectionSchema } from '@teable-group/openapi';
import { SelectionApi, useTableId, useViewId } from '@teable-group/sdk';
import { useToast } from '@teable-group/ui-lib';
import { useCallback } from 'react';
import { SelectionRegionType } from '../../../grid';
import type { CombinedSelection } from '../../../grid/managers';

const rangeTypes = {
  [SelectionRegionType.Columns]: SelectionSchema.RangeType.Columns,
  [SelectionRegionType.Rows]: SelectionSchema.RangeType.Rows,
  [SelectionRegionType.Cells]: undefined,
  [SelectionRegionType.None]: undefined,
};

export const useSelectionOperation = () => {
  const tableId = useTableId();
  const viewId = useViewId();
  const { toast } = useToast();

  const copyHeaderKey = 'teable_copy_header';

  const copy = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }
      const toaster = toast({
        title: 'Copying...',
      });
      const ranges = JSON.stringify(selection.serialize());

      const type = rangeTypes[selection.type];

      const { data } = await SelectionApi.copy(tableId, viewId, {
        ranges,
        ...(type ? { type } : {}),
      });
      const { content, header } = data;
      await navigator.clipboard.writeText(content);
      sessionStorage.setItem(copyHeaderKey, JSON.stringify(header));
      toaster.update({ id: toaster.id, title: 'Copied success!' });
    },
    [tableId, toast, viewId]
  );

  const paste = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }
      const toaster = toast({
        title: 'Pasting...',
      });
      const headerStr = sessionStorage.getItem(copyHeaderKey);
      const header = headerStr ? JSON.parse(headerStr) : undefined;
      const ranges = selection.ranges;
      const content = await navigator.clipboard.readText();
      await SelectionApi.paste(tableId, viewId, {
        content,
        cell: ranges[0],
        header,
      });
      toaster.update({ id: toaster.id, title: 'Pasted success!' });
    },
    [tableId, toast, viewId]
  );

  const clear = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }
      const toaster = toast({
        title: 'Clearing...',
      });

      const type = rangeTypes[selection.type];

      await SelectionApi.clear(tableId, viewId, {
        ranges: selection.ranges,
        ...(type ? { type } : {}),
      });

      toaster.update({ id: toaster.id, title: 'Clear success!' });
    },
    [tableId, toast, viewId]
  );

  return { copy, paste, clear };
};
