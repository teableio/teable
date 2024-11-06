import { FieldType, fieldVoSchema, parseClipboardText, type IFieldVo } from '@teable/core';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

const teableHtmlMarker = 'data-teable-html-marker';
const teableHeader = 'data-teable-html-header';

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

  return `<meta charset="utf-8"><table ${teableHtmlMarker}="1" ${teableHeader}="${encodeURIComponent(JSON.stringify(headers))}"><tbody>${bodyContent}</tbody></table>`;
};

export const extractTableHeader = (html?: string) => {
  if (!html || !isTeableHTML(html)) {
    return { result: undefined };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  const headerStr = table?.getAttribute(teableHeader);
  const headers = headerStr ? JSON.parse(decodeURIComponent(headerStr)) : undefined;
  if (!headers) {
    return { result: undefined };
  }
  const validate = z.array(fieldVoSchema).safeParse(headers);
  if (!validate.success) {
    return { result: undefined, error: fromZodError(validate.error).message };
  }
  return { result: validate.data };
};

export const isTeableHTML = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  return Boolean(table?.getAttribute(teableHtmlMarker));
};
