import type { IAttachmentCellValue } from '@teable/core';
import { AttachmentFieldCore } from '@teable/core';
import type { ICopyVo, IPasteRo } from '@teable/openapi';
import { RangeType } from '@teable/openapi';
import type { CombinedSelection, IRecordIndexMap } from '@teable/sdk/components';
import { SelectionRegionType } from '@teable/sdk/components';
import type { Field } from '@teable/sdk/model';
import { extractTableHeader, serializerHtml } from '@/features/app/utils/clipboard';
import { uploadFiles } from '@/features/app/utils/uploadFile';
import { getSelectionCell } from './selection';

export enum ClipboardTypes {
  'text' = 'text/plain',
  'html' = 'text/html',
  'Files' = 'Files',
}

export const rangeTypes = {
  [SelectionRegionType.Columns]: RangeType.Columns,
  [SelectionRegionType.Rows]: RangeType.Rows,
  [SelectionRegionType.Cells]: undefined,
  [SelectionRegionType.None]: undefined,
};

export const isSafari = () => /^(?:(?!chrome|android).)*safari/i.test(navigator.userAgent);

export const copyHandler = async (getCopyData: () => Promise<ICopyVo>) => {
  const { header, content } = await getCopyData();

  // Can't await asynchronous action before navigator.clipboard.write in safari
  if (!isSafari()) {
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
    return new Blob([content], { type: ClipboardTypes.text });
  };

  const getHtml = async () => {
    return new Blob([serializerHtml(content, header)], { type: ClipboardTypes.html });
  };

  await navigator.clipboard.write([
    new ClipboardItem({
      [ClipboardTypes.text]: getText(),
      [ClipboardTypes.html]: getHtml(),
    }),
  ]);
};

export const filePasteHandler = async ({
  files,
  fields,
  recordMap,
  selection,
  requestPaste,
}: {
  selection: CombinedSelection;
  recordMap: IRecordIndexMap;
  fields: Field[];
  files: FileList;
  requestPaste: (
    content: string,
    type: RangeType | undefined,
    ranges: IPasteRo['ranges']
  ) => Promise<unknown>;
}) => {
  const selectionCell = getSelectionCell(selection);
  const attachments = await uploadFiles(files);

  if (selectionCell) {
    const [fieldIndex, recordIndex] = selectionCell;
    const record = recordMap[recordIndex];
    const field = fields[fieldIndex];
    console.log('selectionCell', selectionCell, record);
    const oldCellValue = (record.getCellValue(field.id) as IAttachmentCellValue) || [];
    await record.updateCell(field.id, [...oldCellValue, ...attachments]);
  } else {
    const attachmentsStrings = attachments
      .map(({ name, token }) => {
        return AttachmentFieldCore.itemString(name, token);
      })
      .join(AttachmentFieldCore.CELL_VALUE_STRING_SPLITTER);
    await requestPaste(attachmentsStrings, rangeTypes[selection.type], selection.serialize());
  }
};

export const textPasteHandler = async (
  selection: CombinedSelection,
  requestPaste: (
    content: string,
    type: RangeType | undefined,
    ranges: IPasteRo['ranges'],
    header: IPasteRo['header']
  ) => Promise<void>
) => {
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
    throw new Error(header.error);
  }

  await requestPaste(
    hasHtml ? text : text.trim(),
    rangeTypes[selection.type],
    selection.serialize(),
    header.result
  );
};
