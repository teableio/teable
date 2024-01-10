/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { UseMutateAsyncFunction } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import type { IAttachmentCellValue } from '@teable-group/core';
import { AttachmentFieldCore } from '@teable-group/core';
import type { ClearRo, ICopyRo, ICopyVo, PasteRo } from '@teable-group/openapi';
import { clear, copy, paste, RangeType } from '@teable-group/openapi';
import type { CombinedSelection, IRecordIndexMap } from '@teable-group/sdk';
import { SelectionRegionType, useFields, useTableId, useViewId } from '@teable-group/sdk';
import { useToast } from '@teable-group/ui-lib';
import type { AxiosResponse } from 'axios';
import { useCallback } from 'react';
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
          [ClipboardTypes.text]: new Blob([content], { type: ClipboardTypes.text }),
          [ClipboardTypes.html]: new Blob([serializerHtml(content, header)], {
            type: ClipboardTypes.html,
          }),
        }),
      ]);
    },
    [copyReq]
  );
};

export const useSelectionOperation = () => {
  const tableId = useTableId();
  const viewId = useViewId();
  const fields = useFields();

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
          range: selection.serialize(),
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
    [pasteReq]
  );

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
    async (selection: CombinedSelection, e: React.ClipboardEvent, recordMap: IRecordIndexMap) => {
      if (!viewId || !tableId) {
        return;
      }

      const { files, types } = e.clipboardData;
      const toaster = toast({ title: 'Pasting...' });
      if (files.length > 0 && !types.includes(ClipboardTypes.text)) {
        await handleFilePaste(files, selection, recordMap, toaster);
      } else {
        await handleTextPaste(selection, toaster);
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
