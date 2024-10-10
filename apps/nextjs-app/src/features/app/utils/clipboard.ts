import { FieldType, fieldVoSchema, parseClipboardText, type IFieldVo } from '@teable/core';
import { fromZodError } from 'zod-validation-error';

const teableHtmlMarker = 'data-teable-html-marker';

export const serializerHtml = (data: string, headers: IFieldVo[]) => {
  const tableData = parseClipboardText(data);
  const bodyContent = tableData
    .map((row) => {
      return `<tr>${row
        .map((cell, index) => {
          const header = headers[index];
          if (header.type === FieldType.LongText) {
            return `<td>${cell.replaceAll('\n', '<br style="mso-data-placement:same-cell;"/>')}</td>`;
          }
          return `<td>${cell}</td>`;
        })
        .join('')}</tr>`;
    })
    .join('');
  const headerContent = headers
    .map((header) => {
      return `<th id="${header.id}" data-field="${encodeURIComponent(JSON.stringify(header))}">${header.name}</th>`;
    })
    .join('');

  return `<meta charset="utf-8"><table ${teableHtmlMarker}="1"><thead><tr>${headerContent}</tr></thead><tbody>${bodyContent}</tbody></table>`;
};

export const extractTableHeader = (html?: string) => {
  if (!html || !isTeableHTML(html)) {
    return { result: undefined };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  const headerRow = table?.querySelector('thead tr');
  const headerCells = headerRow?.querySelectorAll('th') || [];

  const headers = Array.from(headerCells);
  let error = '';
  const result = headers.map((cell) => {
    const fieldVoStr = cell.getAttribute('data-field');
    const fieldVo = fieldVoStr ? JSON.parse(decodeURIComponent(fieldVoStr)) : undefined;

    const validate = fieldVoSchema.safeParse(fieldVo);
    if (validate.success) {
      return fieldVo;
    }
    error = fromZodError(validate.error).message;
    return undefined;
  }) as IFieldVo[];
  return error ? { result: undefined, error } : { result };
};

export const isTeableHTML = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  return Boolean(table?.getAttribute(teableHtmlMarker));
};
