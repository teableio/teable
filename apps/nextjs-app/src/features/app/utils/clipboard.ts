import { fieldVoSchema, type IFieldVo } from '@teable-group/core';
import { mapValues } from 'lodash';
import { fromZodError } from 'zod-validation-error';

const teableHtmlMarker = 'data-teable-html-marker';

export const serializerHtml = (data: string, headers: IFieldVo[]) => {
  const records = data.split('\n');
  const bodyContent = records
    .map((record) => {
      const cells = record.split('\t');
      return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
    })
    .join('');
  const headerContent = headers
    .map((header, index) => {
      const attrs = Object.entries(header)
        .map(([key, value]) => `${key}="${encodeURIComponent(JSON.stringify(value))}"`)
        .join(' ');
      return `<td colspan="${index}" ${attrs}>${header.name}</td>`;
    })
    .join('');

  return `<table ${teableHtmlMarker}="1"><thead><tr>${headerContent}</tr></thead><tbody>${bodyContent}</tbody></table>`;
};

export const extractTableHeader = (html?: string) => {
  if (!html || !isTeableHTML(html)) {
    return { result: undefined };
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  const headerRow = table?.querySelector('thead tr');
  const headerCells = headerRow?.querySelectorAll('td') || [];

  const headers = Array.from(headerCells);
  let error = '';
  const result = headers.map((cell) => {
    const id = cell.getAttribute('id');
    const name = cell.getAttribute('name');
    const isPrimary = cell.getAttribute('isPrimary');
    const columnMeta = cell.getAttribute('columnMeta');
    const dbFieldName = cell.getAttribute('dbFieldName');
    const dbFieldType = cell.getAttribute('dbFieldType');
    const type = cell.getAttribute('type');
    const options = cell.getAttribute('options');
    const cellValueType = cell.getAttribute('cellValueType');
    const fieldVo = mapValues(
      {
        id,
        name,
        isPrimary,
        columnMeta,
        dbFieldName,
        dbFieldType,
        type,
        options,
        cellValueType,
      },
      (value) => {
        const encodeValue = value ? decodeURIComponent(value) : undefined;
        return encodeValue ? JSON.parse(encodeValue) : undefined;
      }
    );
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
