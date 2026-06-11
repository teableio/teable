import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CliTable } from '../services/ComputedTaskInspector';

const UTF8_BOM = '\uFEFF';
type CsvRow = Record<string, unknown>;
type CsvTableLike = {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<unknown>;
};

export const asCsvTable = (table: CsvTableLike): CliTable<CsvRow> =>
  table as unknown as CliTable<CsvRow>;

const stringifyCsvValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
};

const escapeCsvValue = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const tableToCsv = (table: CliTable<CsvRow>): string => {
  const header = table.columns.map(escapeCsvValue).join(',');
  const lines = table.rows.map((row) =>
    table.columns.map((column) => escapeCsvValue(stringifyCsvValue(row[column]))).join(',')
  );

  return `${UTF8_BOM}${[header, ...lines].join('\n')}`;
};

export const writeTableCsv = async (path: string, table: CliTable<CsvRow>) => {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, tableToCsv(table), 'utf8');

  return {
    path: absolutePath,
    rowCount: table.rows.length,
    columnCount: table.columns.length,
  };
};
