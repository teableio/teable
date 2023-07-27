import { CopyAndPasteApi, CopyAndPasteSchema } from '@teable-group/openapi';
import { useTableId, useViewId } from '@teable-group/sdk';
import { useToast } from '@teable-group/ui-lib';
import { useCallback } from 'react';
import { SelectionRegionType, type ISelection } from '../../../grid';

export const useCopyAndPaste = () => {
  const tableId = useTableId();
  const viewId = useViewId();
  const { toast } = useToast();

  const copyHeaderKey = 'teable_copy_header';

  const copy = useCallback(
    async (selection: ISelection) => {
      if (!viewId || !tableId) {
        return;
      }
      const toaster = toast({
        title: 'Copying...',
      });
      const ranges = JSON.stringify(selection.ranges);

      const rangeTypes = {
        [SelectionRegionType.Columns]: CopyAndPasteSchema.RangeType.Column,
        [SelectionRegionType.Rows]: CopyAndPasteSchema.RangeType.Row,
        [SelectionRegionType.Cells]: undefined,
        [SelectionRegionType.None]: undefined,
      };

      const type = rangeTypes[selection.type];

      const { data } = await CopyAndPasteApi.copy(tableId, viewId, {
        ranges,
        ...(type ? { type } : {}),
      });
      if (!data.success) {
        return;
      }
      const { content, header } = data.data;
      await navigator.clipboard.writeText(content);
      localStorage.setItem(copyHeaderKey, JSON.stringify(header));
      toaster.update({ id: toaster.id, title: 'Copied success!' });
    },
    [tableId, toast, viewId]
  );

  const paste = useCallback(
    async (selection: ISelection) => {
      if (!viewId || !tableId) {
        return;
      }

      const toaster = toast({
        title: 'Pasting...',
      });
      const headerStr = localStorage.getItem(copyHeaderKey);
      const header = headerStr ? JSON.parse(headerStr) : undefined;
      const ranges = selection.ranges;
      const content = await navigator.clipboard.readText();
      await CopyAndPasteApi.paste(tableId, viewId, {
        content,
        cell: ranges[0],
        header,
      });
      toaster.update({ id: toaster.id, title: 'Pasted success!' });
    },
    [tableId, toast, viewId]
  );

  return { copy, paste };
};
