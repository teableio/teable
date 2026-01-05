import type { Table as DomainTable, TableRecord } from '@teable/v2-core';
import CliTable from 'cli-table3';

export type IPrintTableOptions = {
  verbose?: boolean;
};

const formatCellValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => formatCellValue(item)).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
};

const buildVerboseHeader = (
  table: DomainTable,
  recordCount: number,
  fieldSummaries: ReadonlyArray<string>
): string => {
  const headerLines = [
    `Table: ${table.name().toString()} (${table.id().toString()})`,
    `Base: ${table.baseId().toString()} | Fields: ${fieldSummaries.length} | Records: ${recordCount}`,
  ];

  if (fieldSummaries.length > 0) {
    headerLines.push(`Field Details: ${fieldSummaries.join(', ')}`);
  }

  return headerLines.join('\n');
};

export const printTable = (
  table: DomainTable,
  records: ReadonlyArray<TableRecord>,
  options: IPrintTableOptions = {}
): string => {
  const fields = table.getFields();
  const columns = ['RecordId', ...fields.map((field) => field.name().toString())];
  const fieldSummaries = fields.map(
    (field) => `${field.name().toString()}:${field.type().toString()}`
  );

  const cliTable = new CliTable({
    head: columns,
    wordWrap: true,
    style: {
      head: [],
      border: [],
    },
  });

  for (const record of records) {
    const rowValues = fields.map((field) => {
      const cellValue = record.fields().get(field.id());
      return formatCellValue(cellValue?.toValue());
    });

    cliTable.push([record.id().toString(), ...rowValues]);
  }

  const rendered = cliTable.toString();
  if (!options.verbose) return rendered;

  return `${buildVerboseHeader(table, records.length, fieldSummaries)}\n${rendered}`;
};

export const print = printTable;
