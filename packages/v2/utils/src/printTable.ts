import type { Table as DomainTable, TableRecord } from '@teable/v2-core';

export type IPrintRowId = 'index' | 'recordId';

export type IPrintTableOptions = {
  verbose?: boolean;
  rowId?: IPrintRowId;
  rowIdLabel?: string;
};

export type IRawPrintTableInput = {
  tableName: string;
  fieldNames: ReadonlyArray<string>;
  records: ReadonlyArray<{ id: string; fields: Record<string, unknown> }>;
  fieldIds?: ReadonlyArray<string>;
  options?: IPrintTableOptions;
};

export type IDomainPrintTableInput = {
  table: DomainTable;
  records: ReadonlyArray<TableRecord>;
  options?: IPrintTableOptions;
};

export type IPrintTableInput = IRawPrintTableInput | IDomainPrintTableInput;

const formatArrayValue = (items: unknown[]): string => {
  if (items.length === 0) return '[]';
  const hasLinkObjects = items.some(
    (item) => typeof item === 'object' && item !== null && 'title' in item
  );
  if (hasLinkObjects) {
    return items
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          return (item as { title?: string }).title ?? '?';
        }
        return String(item);
      })
      .join(', ');
  }
  return `[${items.map((item) => String(item)).join(', ')}]`;
};

const parseJsonArray = (raw: string): unknown[] | null => {
  if (!raw.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const formatObjectValue = (value: object): string => {
  const obj = value as { title?: string; id?: string };
  if (obj.title !== undefined) return obj.title;
  if (obj.id !== undefined) return obj.id;
  try {
    return JSON.stringify(value);
  } catch {
    return '[Object]';
  }
};

const formatStringValue = (value: string): string => {
  const parsedArray = parseJsonArray(value);
  if (parsedArray) return formatArrayValue(parsedArray);
  return value;
};

const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return formatArrayValue(value);
  if (typeof value === 'string') return formatStringValue(value);
  if (typeof value === 'object') return formatObjectValue(value);
  return String(value);
};

const buildHeaderPrefix = (tableName: string): string => `[${tableName}]`;

const buildSeparator = (lineLength: number): string => '-'.repeat(lineLength);

const buildRow = (columns: ReadonlyArray<string>, widths: ReadonlyArray<number>): string =>
  columns.map((value, index) => value.padEnd(widths[index] ?? 0)).join(' | ');

const resolveRowIdLabel = (options?: IPrintTableOptions): string => {
  if (options?.rowIdLabel) return options.rowIdLabel;
  return options?.rowId === 'recordId' ? 'RecordId' : '#';
};

const resolveRowIdValue = (rowId: IPrintRowId | undefined, index: number, id: string): string =>
  rowId === 'recordId' ? id : `R${index}`;

const buildAsciiTable = (
  tableName: string,
  headerColumns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>
): string => {
  const widths = headerColumns.map((column, index) => {
    const rowWidth = Math.max(0, ...rows.map((row) => row[index]?.length ?? 0));
    return Math.max(column.length, rowWidth);
  });

  const headerLine = buildRow(headerColumns, widths).trimEnd();
  const rowLines = rows.map((row) => buildRow(row, widths).trimEnd());
  const maxLineLength = Math.max(headerLine.length, ...rowLines.map((line) => line.length));
  const separator = buildSeparator(maxLineLength);

  return [
    buildHeaderPrefix(tableName),
    separator,
    headerLine,
    separator,
    ...rowLines,
    separator,
  ].join('\n');
};

const printDomainTable = (input: IDomainPrintTableInput): string => {
  const { table, records, options } = input;
  const fields = table.getFields();
  const rowIdLabel = resolveRowIdLabel(options);
  const headerColumns = [rowIdLabel, ...fields.map((field) => field.name().toString())];
  const rows = records.map((record, index) => {
    const rowId = resolveRowIdValue(options?.rowId, index, record.id().toString());
    const values = fields.map((field) => {
      const cellValue = record.fields().get(field.id());
      return formatCellValue(cellValue?.toValue());
    });
    return [rowId, ...values];
  });

  return buildAsciiTable(table.name().toString(), headerColumns, rows);
};

const printRawTable = (input: IRawPrintTableInput): string => {
  const { tableName, fieldNames, records, fieldIds, options } = input;
  const rowIdLabel = resolveRowIdLabel(options);
  const headerColumns = [rowIdLabel, ...fieldNames];
  const rows = records.map((record, index) => {
    const rowId = resolveRowIdValue(options?.rowId, index, record.id);
    const values = fieldNames.map((_, fieldIndex) => {
      const fieldId = fieldIds?.[fieldIndex] ?? fieldNames[fieldIndex] ?? '';
      return formatCellValue(record.fields[fieldId]);
    });
    return [rowId, ...values];
  });

  return buildAsciiTable(tableName, headerColumns, rows);
};

export const printTable = (input: IPrintTableInput): string => {
  if ('table' in input) {
    return printDomainTable(input);
  }
  return printRawTable(input);
};

export const print = printTable;
