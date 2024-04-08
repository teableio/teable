/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type { IAttachmentCellValue, IFilter } from '@teable/core';
import { AttachmentFieldCore } from '@teable/core';
import type { ICopyVo, IPasteRo, IRangesRo } from '@teable/openapi';
import { clear, copy, paste, RangeType } from '@teable/openapi';
import type { CombinedSelection, IRecordIndexMap } from '@teable/sdk';
import {
  SelectionRegionType,
  useFields,
  useSearch,
  useTableId,
  useView,
  useViewId,
} from '@teable/sdk';
import { useToast } from '@teable/ui-lib';
import type { AxiosResponse } from 'axios';
import { useCallback } from 'react';
import { isHTTPS, isLocalhost } from '@/features/app/utils';
import { extractTableHeader, serializerHtml } from '../../../../utils/clipboard';
import { getSelectionCell, selectionCoverAttachments, uploadFiles } from '../utils';

const rangeTypes = {
  [SelectionRegionType.Columns]: RangeType.Columns,
  [SelectionRegionType.Rows]: RangeType.Rows,
  [SelectionRegionType.Cells]: undefined,
  [SelectionRegionType.None]: undefined,
};

enum ClipboardTypes {
  'text' = 'text/plain',
  'html' = 'text/html',
  'Files' = 'Files',
}

export const useCopy = (props: {
  copyReq: UseMutateAsyncFunction<AxiosResponse<ICopyVo>, unknown, IRangesRo, unknown>;
}) => {
  const { copyReq } = props;

  return useCallback(
    async (selection: CombinedSelection) => {
      const getData = async () => {
        const ranges = selection.serialize();
        const type = rangeTypes[selection.type];
        const { data } = await copyReq({
          ranges,
          ...(type ? { type } : {}),
        });
        const { content, header } = data;
        return { content, header };
      };

      // Can't await asynchronous action before navigator.clipboard.write in safari
      if (!/^(?:(?!chrome|android).)*safari/i.test(navigator.userAgent)) {
        const { header, content } = await getData();
        await navigator.clipboard.write([
          new ClipboardItem({
            [ClipboardTypes.text]: new Blob([content], { type: ClipboardTypes.text }),
            [ClipboardTypes.html]: new Blob([serializerHtml(content, header)], {
              type: ClipboardTypes.html,
            }),
          }),
        ]);
        return;
      }

      const getText = async () => {
        const { content } = await getData();
        return new Blob([content], { type: ClipboardTypes.text });
      };

      const getHtml = async () => {
        const { header, content } = await getData();
        return new Blob([serializerHtml(content, header)], { type: ClipboardTypes.html });
      };

      await navigator.clipboard.write([
        new ClipboardItem({
          [ClipboardTypes.text]: getText(),
          [ClipboardTypes.html]: getHtml(),
        }),
      ]);
    },
    [copyReq]
  );
};

export const useSelectionOperation = (filter?: IFilter) => {
  const tableId = useTableId();
  const viewId = useViewId();
  const fields = useFields();
  const view = useView();
  const { searchQuery: search } = useSearch();
  const groupBy = view?.group;

  const { mutateAsync: copyReq } = useMutation({
    mutationFn: (copyRo: IRangesRo) =>
      copy(tableId!, { ...copyRo, viewId, groupBy, filter, search }),
  });

  const { mutateAsync: pasteReq } = useMutation({
    mutationFn: (pasteRo: IPasteRo) =>
      paste(tableId!, { ...pasteRo, viewId, groupBy, filter, search }),
  });

  const { mutateAsync: clearReq } = useMutation({
    mutationFn: (clearRo: IRangesRo) =>
      clear(tableId!, { ...clearRo, viewId, groupBy, filter, search }),
  });

  const { toast } = useToast();
  const copyMethod = useCopy({ copyReq });

  const handleFilePaste = useCallback(
    async (
      files: FileList,
      selection: CombinedSelection,
      recordMap: IRecordIndexMap,
      toaster: ReturnType<typeof toast>
    ) => {
      const isSelectionCoverAttachments = selectionCoverAttachments(selection, fields);
      if (!isSelectionCoverAttachments) {
        toaster.update({
          id: toaster.id,
          title: 'Files can only be pasted into an attachment field',
        });
        return;
      }

      const selectionCell = getSelectionCell(selection);
      if (selectionCell) {
        const attachments = await uploadFiles(files);
        const [fieldIndex, recordIndex] = selectionCell;
        const record = recordMap[recordIndex];
        const field = fields[fieldIndex];
        const oldCellValue = (record.getCellValue(field.id) as IAttachmentCellValue) || [];
        await record.updateCell(field.id, [...oldCellValue, ...attachments]);
      } else {
        const attachments = await uploadFiles(files);
        const attachmentsStrings = attachments
          .map(({ name, token }) => {
            return AttachmentFieldCore.itemString(name, token);
          })
          .join(AttachmentFieldCore.CELL_VALUE_STRING_SPLITTER);
        await pasteReq({
          content: attachmentsStrings,
          ranges: selection.serialize(),
          type: rangeTypes[selection.type],
        });
      }
      toaster.update({ id: toaster.id, title: 'Pasted success!' });
    },
    [fields, pasteReq]
  );
  const handleTextPaste = useCallback(
    async (selection: CombinedSelection, toaster: ReturnType<typeof toast>) => {
      const clipboardContent = await navigator.clipboard.read();
      const hasHtml = clipboardContent[0].types.includes(ClipboardTypes.html);
      const text = clipboardContent[0].types.includes(ClipboardTypes.text)
        ? await (await clipboardContent[0].getType(ClipboardTypes.text)).text()
        : '';
      const html = hasHtml
        ? await (await clipboardContent[0].getType(ClipboardTypes.html)).text()
        : undefined;
      const header = extractTableHeader(html);

      if (header.error) {
        toaster.update({ id: toaster.id, title: header.error });
        return;
      }

      await pasteReq({
        content: hasHtml ? text : text.trim(),
        ranges: selection.serialize(),
        type: rangeTypes[selection.type],
        header: header.result,
      });
      toaster.update({ id: toaster.id, title: 'Pasted success!' });
    },
    [pasteReq]
  );

  const doCopy = useCallback(
    async (selection: CombinedSelection) => {
      // not support http
      if (!isLocalhost() && !isHTTPS()) {
        toast({
          variant: 'destructive',
          description: 'Copy and paste only works in HTTPS or localhost.',
        });
        return;
      }
      if (!viewId || !tableId) {
        return;
      }

      const toaster = toast({
        title: 'Copying...',
      });
      try {
        await copyMethod(selection);
        toaster.update({ id: toaster.id, title: 'Copied success!' });
      } catch (e) {
        const error = e as Error;
        toaster.update({
          id: toaster.id,
          variant: 'destructive',
          title: 'Copy error',
          description: error.message,
        });
        console.error('Copy error: ', error);
      }
    },
    [tableId, toast, viewId, copyMethod]
  );

  const doPaste = useCallback(
    async (selection: CombinedSelection, e: React.ClipboardEvent, recordMap: IRecordIndexMap) => {
      // not support http
      if (!isLocalhost() && !isHTTPS()) {
        toast({
          variant: 'destructive',
          description: 'Copy and paste only works in HTTPS or localhost.',
        });
        return;
      }
      if (!viewId || !tableId) {
        return;
      }

      const { files, types } = e.clipboardData;
      const toaster = toast({ title: 'Pasting...' });
      try {
        if (files.length > 0 && !types.includes(ClipboardTypes.text)) {
          await handleFilePaste(files, selection, recordMap, toaster);
        } else {
          await handleTextPaste(selection, toaster);
        }
      } catch (e) {
        const error = e as Error;
        toaster.update({
          id: toaster.id,
          variant: 'destructive',
          title: 'Past error',
          description: error.message,
        });
        console.error('Past error: ', error);
      }
    },
    [viewId, tableId, toast, handleFilePaste, handleTextPaste]
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
