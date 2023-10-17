/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { useMutation } from '@tanstack/react-query';
import type { ClearRo, ICopyRo, PasteRo } from '@teable-group/openapi';
import { clear, copy, paste, RangeType } from '@teable-group/openapi';
import { useTableId, useViewId } from '@teable-group/sdk';
import { useToast } from '@teable-group/ui-lib';
import { useCallback } from 'react';
import { SelectionRegionType } from '../../../grid';
import type { CombinedSelection } from '../../../grid/managers';

const rangeTypes = {
  [SelectionRegionType.Columns]: RangeType.Columns,
  [SelectionRegionType.Rows]: RangeType.Rows,
  [SelectionRegionType.Cells]: undefined,
  [SelectionRegionType.None]: undefined,
};

const copyMark = 'TeableCopyContent:';

export const useSelectionOperation = () => {
  const tableId = useTableId();
  const viewId = useViewId();

  const { mutateAsync: copyReq } = useMutation({
    mutationFn: (copyRo: ICopyRo) => copy(tableId!, viewId!, copyRo),
  });

  const { mutateAsync: pasteReq } = useMutation({
    mutationFn: (pasteRo: PasteRo) => paste(tableId!, viewId!, pasteRo),
  });

  const { mutateAsync: clearReq } = useMutation({
    mutationFn: (clearRo: ClearRo) => clear(tableId!, viewId!, clearRo),
  });

  const { toast } = useToast();

  const copyHeaderKey = 'teable_copy_header';

  const doCopy = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }

      const toaster = toast({
        title: 'Copying...',
      });
      const ranges = JSON.stringify(selection.serialize());

      const type = rangeTypes[selection.type];

      const { data } = await copyReq({
        ranges,
        ...(type ? { type } : {}),
      });
      const { content, header } = data;

      await navigator.clipboard.writeText(`${copyMark}${content}`);
      sessionStorage.setItem(copyHeaderKey, JSON.stringify(header));
      toaster.update({ id: toaster.id, title: 'Copied success!' });
    },
    [tableId, toast, viewId, copyReq]
  );

  const doPaste = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }
      const toaster = toast({
        title: 'Pasting...',
      });
      const ranges = selection.ranges;
      const content = await navigator.clipboard.readText();
      const usingHeader = content.startsWith(copyMark);
      const headerStr = sessionStorage.getItem(copyHeaderKey);
      const header = headerStr && usingHeader ? JSON.parse(headerStr) : undefined;
      await pasteReq({
        content: usingHeader ? content.split(copyMark)[1] : content,
        cell: ranges[0],
        header,
      });
      toaster.update({ id: toaster.id, title: 'Pasted success!' });
    },
    [tableId, toast, viewId, pasteReq]
  );

  const doClear = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }
      const toaster = toast({
        title: 'Clearing...',
      });

      const type = rangeTypes[selection.type];

      await clearReq({
        ranges: selection.ranges,
        ...(type ? { type } : {}),
      });

      toaster.update({ id: toaster.id, title: 'Clear success!' });
    },
    [tableId, toast, viewId, clearReq]
  );

  return { copy: doCopy, paste: doPaste, clear: doClear };
};
