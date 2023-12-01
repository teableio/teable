/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type { ClearRo, ICopyRo, ICopyVo, PasteRo } from '@teable-group/openapi';
import { clear, copy, paste, RangeType } from '@teable-group/openapi';
import type { CombinedSelection } from '@teable-group/sdk';
import { SelectionRegionType, useTableId, useViewId } from '@teable-group/sdk';
import { useToast } from '@teable-group/ui-lib';
import type { AxiosResponse } from 'axios';
import { useCallback } from 'react';
import { extractTableHeader, serializerHtml } from '../../../../utils/clipboard';

const rangeTypes = {
  [SelectionRegionType.Columns]: RangeType.Columns,
  [SelectionRegionType.Rows]: RangeType.Rows,
  [SelectionRegionType.Cells]: undefined,
  [SelectionRegionType.None]: undefined,
};

export const useCopy = (props: {
  copyReq: UseMutateAsyncFunction<AxiosResponse<ICopyVo>, unknown, ICopyRo, unknown>;
}) => {
  const { copyReq } = props;

  return useCallback(
    async (selection: CombinedSelection) => {
      const ranges = JSON.stringify(selection.serialize());

      const type = rangeTypes[selection.type];

      const { data } = await copyReq({
        ranges,
        ...(type ? { type } : {}),
      });
      const { content, header } = data;

      await navigator.clipboard.write([
        new ClipboardItem({
          ['text/plain']: new Blob([content], { type: 'text/plain' }),
          ['text/html']: new Blob([serializerHtml(content, header)], { type: 'text/html' }),
        }),
      ]);
    },
    [copyReq]
  );
};

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
  const copyMethod = useCopy({ copyReq });

  const doCopy = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }

      const toaster = toast({
        title: 'Copying...',
      });
      await copyMethod(selection);
      toaster.update({ id: toaster.id, title: 'Copied success!' });
    },
    [tableId, toast, viewId, copyMethod]
  );

  const doPaste = useCallback(
    async (selection: CombinedSelection) => {
      if (!viewId || !tableId) {
        return;
      }
      const toaster = toast({
        title: 'Pasting...',
      });
      const clipboardContent = await navigator.clipboard.read();
      const hasHtml = clipboardContent[0].types.includes('text/html');
      const text = await (await clipboardContent[0].getType('text/plain')).text();
      const html = hasHtml
        ? await (await clipboardContent[0].getType('text/html')).text()
        : undefined;
      const header = extractTableHeader(html);
      if (header.error) {
        toaster.update({ id: toaster.id, title: header.error });
        return;
      }
      await pasteReq({
        content: text,
        range: selection.serialize(),
        type: rangeTypes[selection.type],
        header: header.result,
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
      const ranges = selection.serialize();
      const type = rangeTypes[selection.type];

      await clearReq({
        ranges,
        ...(type ? { type } : {}),
      });

      toaster.update({ id: toaster.id, title: 'Clear success!' });
    },
    [tableId, toast, viewId, clearReq]
  );

  return { copy: doCopy, paste: doPaste, clear: doClear };
};
