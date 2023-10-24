import { fieldVoSchema, type IFieldVo } from '@teable-group/core';
import { fromZodError } from 'zod-validation-error';

const teableHtmlMarker = 'TEABLE_HTML_MARKER';

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
        .map(([key, value]) => `${key}='${JSON.stringify(value)}'`)
        .join(' ');
      return `<td colspan="${index}" ${attrs}>${header.name}</td>`;
    })
    .join('');

  return `<table ${teableHtmlMarker}="1"><thead><tr>${headerContent}</tr></thead><tbody>${bodyContent}</tbody></table>`;
};

export const extractTableHeader = (html: string) => {
  if (!isTeableHTML(html)) {
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
    const id = cell.getAttribute('id')?.replace(/"/g, '');
    const name = cell.getAttribute('name')?.replace(/"/g, '');
    const isPrimary = cell.getAttribute('isPrimary') === 'true' || undefined;
    const columnMeta = JSON.parse(cell.getAttribute('columnMeta') ?? '');
    const dbFieldName = cell.getAttribute('dbFieldName')?.replace(/"/g, '');
    const dbFieldType = cell.getAttribute('dbFieldType')?.replace(/"/g, '');
    const type = cell.getAttribute('type')?.replace(/"/g, '');
    const options = JSON.parse(cell.getAttribute('options') ?? '');
    const cellValueType = cell.getAttribute('cellValueType')?.replace(/"/g, '');
    const fieldVo = {
      id,
      name,
      isPrimary,
      columnMeta,
      dbFieldName,
      dbFieldType,
      type,
      options,
      cellValueType,
    };
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
