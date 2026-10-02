import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Deliberately runs in a separate process. SheetJS is a fixture encoder only;
// its eager workbook cannot contribute to the import server's measured heap.
const [path, format, count, width = '3'] = process.argv.slice(2);
const rows = Number(count);
const columnCount = Number(width);
if (
  !path ||
  !['csv', 'tsv', 'txt', 'xlsx', 'xls'].includes(format) ||
  !Number.isInteger(rows) ||
  !Number.isInteger(columnCount) ||
  columnCount < 3
) {
  throw new Error('Usage: importMemoryFixture.mjs PATH FORMAT ROWS [COLUMN_COUNT>=3]');
}
const headers = [
  'Name',
  'Payload',
  'Amount',
  ...Array.from({ length: columnCount - 3 }, (_, index) => `Field_${index + 3}`),
];
const values = (index) => [
  `row-${String(index).padStart(8, '0')}`,
  `${String(index).padStart(8, '0')}${'x'.repeat(2040)}`,
  index,
  ...Array.from(
    { length: columnCount - 3 },
    (_, column) =>
      `r${String(index).padStart(8, '0')}-c${String(column + 3).padStart(3, '0')}${'y'.repeat(18)}`
  ),
];

if (format === 'xlsx' || format === 'xls') {
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  for (let index = 1; index <= rows; index++) {
    XLSX.utils.sheet_add_aoa(sheet, [values(index)], { origin: -1 });
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
  // Every string is unique. bookSST forces a high-cardinality shared-string table
  // so an implementation caching all shared strings cannot pass this regression.
  await writeFile(path, XLSX.write(workbook, { type: 'buffer', bookType: format, bookSST: true }));
} else {
  const delimiter = format === 'tsv' ? '\t' : ',';
  const chunks = async function* () {
    yield headers.join(delimiter) + '\n';
    for (let index = 1; index <= rows; index++) yield values(index).join(delimiter) + '\n';
  };
  await pipeline(Readable.from(chunks()), createWriteStream(path));
}
