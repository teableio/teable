import type { IAttachmentCellValue } from '@teable/core';
import type { ICopyVo, IPasteRo } from '@teable/openapi';
import { RangeType, UploadType } from '@teable/openapi';
import type { CombinedSelection, IRecordIndexMap } from '@teable/sdk/components';
import { SelectionRegionType } from '@teable/sdk/components';
import type { Field } from '@teable/sdk/model';
import {
  extractTableContent,
  extractHtmlHeader,
  serializerHtml,
  isTeableHTML,
  parseNormalHtml,
} from '@/features/app/utils/clipboard';
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
  // Can't await asynchronous action before navigator.clipboard.write in safari
  if (!isSafari()) {
    const { header, content } = await getCopyData();
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
    const { content } = await getCopyData();

    return new Blob([content], { type: ClipboardTypes.text });
  };

  const getHtml = async () => {
    const { header, content } = await getCopyData();
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
  baseId,
  requestPaste,
}: {
  selection: CombinedSelection;
  recordMap: IRecordIndexMap;
  fields: Field[];
  files: FileList;
  baseId?: string;
  requestPaste: (
    content: unknown[][],
    type: RangeType | undefined,
    ranges: IPasteRo['ranges']
  ) => Promise<unknown>;
}) => {
  const selectionCell = getSelectionCell(selection);
  const attachments = await uploadFiles(files, UploadType.Table, baseId);

  if (selectionCell) {
    const [fieldIndex, recordIndex] = selectionCell;
    const record = recordMap[recordIndex];
    const field = fields[fieldIndex];
    const oldCellValue = (record.getCellValue(field.id) as IAttachmentCellValue) || [];
    await record.updateCell(field.id, [...oldCellValue, ...attachments]);
  } else {
    await requestPaste([[attachments]], rangeTypes[selection.type], selection.serialize());
  }
};

export const textPasteHandler = async (
  e: React.ClipboardEvent,
  selection: CombinedSelection,
  requestPaste: (
    content: string | unknown[][] | undefined,
    type: RangeType | undefined,
    ranges: IPasteRo['ranges'],
    header: IPasteRo['header']
  ) => Promise<void>
) => {
  const hasHtml = e.clipboardData.types.includes(ClipboardTypes.html);
  const html = hasHtml ? e.clipboardData.getData(ClipboardTypes.html) : '';
  const header = extractHtmlHeader(html);
  const text = e.clipboardData.types.includes(ClipboardTypes.text)
    ? e.clipboardData.getData(ClipboardTypes.text)
    : '';

  const cellValues = hasHtml
    ? isTeableHTML(html)
      ? extractTableContent(html)
      : parseNormalHtml(html)
    : [];

  if (header.error) {
    throw new Error(header.error);
  }

  await requestPaste(
    hasHtml ? cellValues : text,
    rangeTypes[selection.type],
    selection.serialize(),
    header.result
  );
};

export const getCellPasteInfo = (e: React.ClipboardEvent) => {
  const hasHtml = e.clipboardData.types.includes(ClipboardTypes.html);
  const html = hasHtml ? e.clipboardData.getData(ClipboardTypes.html) : '';
  const header = extractHtmlHeader(html);

  return {
    cellValues: hasHtml
      ? isTeableHTML(html)
        ? extractTableContent(html)
        : parseNormalHtml(html)
      : [],
    header,
  };
};

export const getExpandInfo = (
  rowCount: number | null,
  startRow: number,
  startCol: number,
  fields: Field[],
  computedFieldIndexes: number[],
  cellValues?: unknown[][]
) => {
  if (!rowCount || !cellValues) {
    return {
      isExpand: false,
      expandRowCount: 0,
      expandColCount: 0,
    };
  }

  const pasteRecordLength = cellValues?.length ?? 0;
  const pasteFieldsLength = cellValues?.[0]?.length ?? 0;
  const additionRecordsLength = rowCount ? pasteRecordLength - (rowCount - startRow) : 0;
  const additionFieldsLength =
    pasteFieldsLength - (fields.length - startCol - computedFieldIndexes.length);

  const isExpand = additionRecordsLength > 0 || additionFieldsLength > 0;

  return {
    isExpand,
    expandRowCount: additionRecordsLength,
    expandColCount: additionFieldsLength,
  };
};
