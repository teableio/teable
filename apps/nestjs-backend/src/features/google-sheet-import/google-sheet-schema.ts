import { DateFormattingPreset, FieldType, getUniqName, TimeFormatting } from '@teable/core';
import type { IFieldRo } from '@teable/core';
import type { IGoogleGridCell, IGoogleSheetCellValue } from './google-sheet.types';

/** Google Sheets day-serial epoch (serial 0 = 1899-12-30, no Lotus leap bug). */
const googleSheetsEpochMs = Date.UTC(1899, 11, 30);
const msPerDay = 86_400_000;

const dateNumberFormats = new Set(['DATE', 'DATE_TIME']);

export interface IGoogleSheetColumnPlan {
  /** 0-based column index in the grid. */
  index: number;
  name: string;
  type:
    | FieldType.SingleLineText
    | FieldType.LongText
    | FieldType.Number
    | FieldType.Checkbox
    | FieldType.Date;
  /**
   * TIME-formatted number column: cells hold day fractions and are imported
   * as "HH:mm:ss" text (a Teable date of 1899-12-30 would be nonsense).
   */
  timeOnly?: boolean;
  /** Date column where the sampled cells carry a DATE_TIME number format. */
  hasTime?: boolean;
}

const cellText = (cell: IGoogleGridCell | undefined): string => {
  if (!cell) return '';
  if (cell.formattedValue !== undefined) return cell.formattedValue;
  const value = cell.effectiveValue;
  if (!value) return '';
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.numberValue !== undefined) return String(value.numberValue);
  if (value.boolValue !== undefined) return String(value.boolValue);
  return '';
};

const isCellEmpty = (cell: IGoogleGridCell | undefined): boolean =>
  !cell || (cell.effectiveValue === undefined && !cell.formattedValue);

/**
 * Infer one Teable column per used grid column from a format-carrying sample
 * (first row = header). A column gets a concrete type only when every sampled
 * non-empty cell agrees on it; anything mixed degrades to text, mirroring the
 * CSV/Excel importer's philosophy.
 */
export interface IInferredColumns {
  plans: IGoogleSheetColumnPlan[];
  /** 0-based offset of the header row inside the sample (leading blank rows skipped). */
  headerOffset: number;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export const inferColumnPlans = (sampleRows: IGoogleGridCell[][]): IInferredColumns => {
  // A sheet often starts with one or more fully blank rows; treating such a
  // row as the header would name every column "Field N" and demote the real
  // header into the first record. Skip to the first row with any content.
  let headerOffset = 0;
  while (
    headerOffset < sampleRows.length &&
    (sampleRows[headerOffset] ?? []).every((cell) => isCellEmpty(cell))
  ) {
    headerOffset++;
  }
  const headerRow = sampleRows[headerOffset] ?? [];
  const dataRows = sampleRows.slice(headerOffset + 1);

  // The used width: the widest of header and any sampled data row. Sheets
  // omits trailing empty cells per row, so row lengths already end at data.
  let columnCount = headerRow.length;
  for (const row of dataRows) {
    columnCount = Math.max(columnCount, row.length);
  }

  const existNames: string[] = [];
  const plans: IGoogleSheetColumnPlan[] = [];
  for (let index = 0; index < columnCount; index++) {
    let total = 0;
    let booleans = 0;
    let numbers = 0;
    let dateFormatted = 0;
    let timeFormatted = 0;
    let multiline = 0;

    let dateTimeFormatted = 0;
    for (const row of dataRows) {
      const cell = row[index];
      if (isCellEmpty(cell)) continue;
      total++;
      const value = cell!.effectiveValue;
      if (value?.boolValue !== undefined) {
        booleans++;
      } else if (value?.numberValue !== undefined) {
        numbers++;
        const format = cell!.effectiveFormat?.numberFormat?.type;
        if (format && dateNumberFormats.has(format)) dateFormatted++;
        if (format === 'DATE_TIME') dateTimeFormatted++;
        if (format === 'TIME') timeFormatted++;
      } else if (/\n/.test(value?.stringValue ?? cellText(cell))) {
        // Strings and error cells alike degrade the column to text.
        multiline++;
      }
    }

    let type: IGoogleSheetColumnPlan['type'] = FieldType.SingleLineText;
    let timeOnly: boolean | undefined;
    let hasTime: boolean | undefined;
    if (total > 0 && booleans === total) {
      type = FieldType.Checkbox;
    } else if (total > 0 && numbers === total) {
      if (dateFormatted === total) {
        type = FieldType.Date;
        if (dateTimeFormatted > 0) hasTime = true;
      } else if (timeFormatted === total) {
        timeOnly = true;
      } else {
        type = FieldType.Number;
      }
    } else if (multiline > 0) {
      // Any multiline cell forces LongText so no newline is flattened, even
      // when the column also carries numbers (they stringify losslessly).
      type = FieldType.LongText;
    }

    // v2 rejects field names over 100 chars (Google Forms question headers
    // routinely exceed it, aborting the whole createTable); truncate before
    // uniquifying and leave room for the uniqueness suffix.
    const rawName = (cellText(headerRow[index]).trim() || `Field ${index + 1}`).slice(0, 95);
    const name = getUniqName(rawName, existNames);
    existNames.push(name);
    plans.push({
      index,
      name,
      type,
      ...(timeOnly ? { timeOnly } : {}),
      ...(hasTime ? { hasTime } : {}),
    });
  }

  // Drop trailing columns that have neither a header nor any sampled data —
  // sheets routinely declare a 26-column grid with 3 used columns. The sample
  // is only a window, so interior empties are kept (rows below may fill them).
  let lastUsed = -1;
  for (let index = 0; index < columnCount; index++) {
    const hasHeader = !isCellEmpty(headerRow[index]);
    const hasData = dataRows.some((row) => !isCellEmpty(row[index]));
    if (hasHeader || hasData) lastUsed = index;
  }
  const used = plans.slice(0, lastUsed + 1);
  // v2 rejects Checkbox as the primary (first) field and the whole createTable
  // would abort; degrade it to text (TRUE/FALSE snapshots), mirroring the
  // Airtable importer's primary-compat fallback.
  if (used[0]?.type === FieldType.Checkbox) {
    used[0] = { ...used[0], type: FieldType.SingleLineText };
  }
  return { plans: used, headerOffset };
};

export const buildFieldRos = (columns: IGoogleSheetColumnPlan[]): IFieldRo[] =>
  columns.map((column) => ({
    name: column.name,
    type: column.timeOnly ? FieldType.SingleLineText : column.type,
    // Serials are stored as midnight-UTC instants; without an explicit zone the
    // field would render in the SERVER's default timezone and show every date
    // one day early west of UTC. Pin display to UTC so the sheet's wall-clock
    // dates/times survive on any host.
    ...(column.type === FieldType.Date && !column.timeOnly
      ? {
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: column.hasTime ? TimeFormatting.Hour24 : TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        }
      : {}),
  }));

/** JS Date range: ±8.64e15 ms. Out-of-range serials must drop, not throw. */
const maxDateMs = 8.64e15;

const serialToIsoString = (serial: number): string | undefined => {
  const ms = Math.round(googleSheetsEpochMs + serial * msPerDay);
  if (!Number.isFinite(ms) || Math.abs(ms) > maxDateMs) return undefined;
  return new Date(ms).toISOString();
};

const serialToTimeString = (serial: number): string => {
  // No 24h wrap: Google reports duration-formatted cells ([h]:mm:ss) as TIME
  // too, and 30:00:00 must not silently become 06:00:00.
  const negative = serial < 0;
  const seconds = Math.abs(Math.round(serial * 86_400));
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${negative ? '-' : ''}${hh}:${mm}:${ss}`;
};

export interface IConvertedCell {
  /** Undefined means "leave the cell empty" (empty source cell or false checkbox). */
  value?: unknown;
  /** True when a non-empty cell could not be represented in the column type. */
  dropped?: boolean;
}

const convertCheckboxCell = (raw: IGoogleSheetCellValue): IConvertedCell => {
  if (typeof raw === 'boolean') return raw ? { value: true } : {};
  if (typeof raw === 'string') {
    const lowered = raw.trim().toLowerCase();
    if (lowered === 'true') return { value: true };
    if (lowered === 'false') return {};
  }
  return { dropped: true };
};

// Date-looking strings only: Date.parse alone is far too lax ('5' parses as
// 2001-05-01), so require an explicit date shape before letting typecast try.
const dateLikeString =
  /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})([ T].*)?$/;

const convertDateCell = (raw: IGoogleSheetCellValue): IConvertedCell => {
  if (typeof raw === 'number') {
    const iso = serialToIsoString(raw);
    // One absurd number (e.g. an epoch-ms value in a date column) must count
    // as a dropped value, not abort the entire import with a RangeError.
    return iso === undefined ? { dropped: true } : { value: iso };
  }
  if (typeof raw === 'string') {
    return dateLikeString.test(raw) && !Number.isNaN(Date.parse(raw))
      ? { value: raw }
      : { dropped: true };
  }
  return { dropped: true };
};

const convertNumberCell = (raw: IGoogleSheetCellValue): IConvertedCell => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : { dropped: true };
  if (typeof raw === 'string') {
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? { value: parsed } : { dropped: true };
  }
  return { dropped: true };
};

/**
 * Convert one UNFORMATTED_VALUE/SERIAL_NUMBER cell to the planned column's
 * Teable cell value. Records are created with typecast, so strings that later
 * turn out date-like or numeric still get a second chance server-side.
 */
export const convertCellValue = (
  raw: IGoogleSheetCellValue | undefined,
  column: IGoogleSheetColumnPlan
): IConvertedCell => {
  // Whitespace-only strings are visually blank cells — without this guard a
  // lone space in a Number column would import as 0 (Number(' ') === 0).
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return {};
  }

  if (column.timeOnly) {
    return { value: typeof raw === 'number' ? serialToTimeString(raw) : String(raw) };
  }

  switch (column.type) {
    case FieldType.Checkbox:
      return convertCheckboxCell(raw);
    case FieldType.Date:
      return convertDateCell(raw);
    case FieldType.Number:
      return convertNumberCell(raw);
    default:
      return { value: String(raw) };
  }
};
