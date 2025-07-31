import { FieldType, fieldVoSchema, parseClipboardText, type IFieldVo } from '@teable/core';
import { createFieldInstance } from '@teable/sdk/model';
import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

const teableHtmlMarker = 'data-teable-html-marker';
const teableHeader = 'data-teable-html-header';

const lineTag = '<br data-teable-line-tag="1" style="mso-data-placement:same-cell;">';

export const serializerHtml = (data: string, headers: IFieldVo[]) => {
  const tableData = parseClipboardText(data);
  const bodyContent = tableData
    .map((row) => {
      return `<tr>${row
        .map((cell, index) => {
          const header = headers[index];
          if (header.type === FieldType.LongText) {
            return `<td>${cell.replaceAll('\n', lineTag)}</td>`;
          }
          return `<td>${cell}</td>`;
        })
        .join('')}</tr>`;
    })
    .join('');

  return `<meta charset="utf-8"><table ${teableHtmlMarker}="1" ${teableHeader}="${encodeURIComponent(JSON.stringify(headers))}"><tbody>${bodyContent}</tbody></table>`;
};

export const serializerCellValueHtml = (data: unknown[][], headers: IFieldVo[]) => {
  const fields = headers.map((header) => createFieldInstance(header));
  const bodyContent = data
    .map((row) => {
      return `<tr>${row
        .map((cell, index) => {
          const field = fields[index];
          if (field.type === FieldType.LongText) {
            return `<td data-teable-cell-value="${encodeURIComponent(JSON.stringify(cell == null ? null : cell))}">${field.cellValue2String(cell).replaceAll('\n', lineTag)}</td>`;
          }
          if (field.type != FieldType.SingleLineText && field.type != FieldType.SingleSelect) {
            return `<td data-teable-cell-value="${encodeURIComponent(JSON.stringify(cell == null ? null : cell))}">${field.cellValue2String(cell)}</td>`;
          }
          return `<td>${field.cellValue2String(cell)}</td>`;
        })
        .join('')}</tr>`;
    })
    .join('');

  return `<meta charset="utf-8"><table ${teableHtmlMarker}="1" ${teableHeader}="${encodeURIComponent(JSON.stringify(headers))}"><tbody>${bodyContent}</tbody></table>`;
};

export const extractHtmlHeader = (html?: string) => {
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

export const extractTableContent = (html: string) => {
  if (!html || !isTeableHTML(html)) {
    return undefined;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');

  if (!table) {
    return undefined;
  }

  const rows = table.querySelectorAll('tr');
  const content: unknown[][] = [];

  rows.forEach((row) => {
    const rowData: unknown[] = [];
    const cells = row.querySelectorAll('td');
    cells.forEach((cell) => {
      const cellText = cell.textContent || '';
      const cellValue = cell.getAttribute('data-teable-cell-value');
      if (!cellValue) {
        rowData.push(cellText);
        return;
      }

      const cellValueObj = JSON.parse(decodeURIComponent(cellValue));
      rowData.push(cellValueObj);
    });

    if (rowData.length > 0) {
      content.push(rowData);
    }
  });
  return content;
};

export const parseNormalHtml = (html: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) {
    return [[doc.body.textContent || '']];
  }
  const rows = Array.from(table.rows);
  return rows.map((row) => {
    const cells = Array.from(row.cells);
    return cells.map((cell) => cell.textContent || '');
  });
};
