import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { setSafeFetch } from '@teable/v2-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { prepareExcelImportSource } from './excel/TemporaryWorkbook';
import { ExcelImportAdapter } from './ExcelImportAdapter';

const workbookBytes = (bookType: 'xlsx' | 'xls', large = false) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['Other'], ['Ignored']]),
    'Other'
  );
  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(
    sheet,
    [
      ['Export report'],
      [],
      ['Name', 'Amount', 'Date', 'Enabled', 'Formula'],
      ['Alice', 1234.5, 45293, true, 42],
      [],
      ['跨记录字符串'.repeat(400), 0, 0, false, 'Cached formula text'],
    ],
    { origin: 'A2' }
  );
  sheet.B5.z = '#,##0.00';
  sheet.C5.z = 'yyyy-mm-dd';
  sheet.E5.f = '21*2';
  sheet.E7.f = '"Cached formula text"';
  if (large) {
    for (let row = 8; row < 40008; row++) {
      XLSX.utils.sheet_add_aoa(
        sheet,
        [[`${row}:${'high-cardinality-value'.repeat(10)}`, row, row, true, row]],
        { origin: { r: row, c: 0 } }
      );
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType, bookSST: true }));
};

async function* chunks(bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length; offset += 65536) {
    yield bytes.subarray(offset, offset + 65536);
  }
}

const collect = async (rows: AsyncIterable<ReadonlyArray<unknown>>) => {
  const result: ReadonlyArray<unknown>[] = [];
  for await (const row of rows) result.push(row);
  return result;
};

const spreadsheetMlFooter = '</Table></Worksheet></Workbook>';

const xmlWorkbookBytes = (
  rows: string,
  styles: string,
  date1904 = false,
  sharedStrings?: string
) => {
  const archive = XLSX.CFB.utils.cfb_new();
  const entries: Record<string, string> = {
    ['xl/workbook.xml']: `<workbook><workbookPr date1904="${Number(date1904)}"/><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>`,
    ['xl/_rels/workbook.xml.rels']:
      '<Relationships><Relationship Id="r1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      (sharedStrings
        ? '<Relationship Id="r3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        : '') +
      '</Relationships>',
    ['xl/worksheets/sheet1.xml']: `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    ['xl/styles.xml']: styles,
  };
  if (sharedStrings) entries['xl/sharedStrings.xml'] = sharedStrings;
  for (const [path, xml] of Object.entries(entries)) {
    XLSX.CFB.utils.cfb_add(archive, path, Buffer.from(xml));
  }
  return new Uint8Array(XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip' }));
};

const biffRecord = (id: number, data = Buffer.alloc(0)) => {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
};

it.each([
  { codepage: 0x8001, text: Buffer.from([0x80, 0xe9]), expected: '€é' },
  { codepage: 0x8000, text: Buffer.from([0x80, 0x8e]), expected: 'Äé' },
  { codepage: 0x5212, text: Buffer.from('中文', 'utf16le'), expected: '中文' },
])(
  'decodes legacy BIFF codepage alias $codepage before reading labels',
  async ({ codepage, text, expected }) => {
    const bof = Buffer.alloc(8);
    bof.writeUInt16LE(0x500);
    bof.writeUInt16LE(0x10, 2);
    const codepageBytes = Buffer.alloc(2);
    codepageBytes.writeUInt16LE(codepage);
    const encoding = codepage === 0x5212 ? 'utf16le' : 'latin1';
    const label = (row: number, value: Buffer) => {
      const header = Buffer.alloc(8);
      header.writeUInt16LE(row);
      header.writeUInt16LE(value.length, 6);
      return biffRecord(0x204, Buffer.concat([header, value]));
    };
    const data = Buffer.concat([
      biffRecord(0x809, bof),
      biffRecord(0x42, codepageBytes),
      label(0, Buffer.from('Name', encoding)),
      label(1, Buffer.from('Alice', encoding)),
      label(2, text),
      biffRecord(0xa),
    ]);
    const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
    expect(parsed.headers).toEqual(['Name']);
    expect(await collect(parsed.rowsAsync!)).toEqual([['Name'], ['Alice'], [expected]]);
  }
);

it('formats BIFF shared strings, labels and cached formula strings using each cell style', async () => {
  const bof = Buffer.alloc(16);
  bof.writeUInt16LE(0x600);
  bof.writeUInt16LE(0x10, 2);
  const unicode = (value: string) => {
    const header = Buffer.alloc(3);
    header.writeUInt16LE(value.length);
    return Buffer.concat([header, Buffer.from(value, 'latin1')]);
  };
  const counts = Buffer.alloc(8);
  counts.writeUInt32LE(1);
  counts.writeUInt32LE(1, 4);
  const style = Buffer.alloc(20);
  style.writeUInt16LE(164, 2);
  const formatId = Buffer.alloc(2);
  formatId.writeUInt16LE(164);
  const cellHeader = (row: number, column: number, styleIndex: number) => {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(row);
    header.writeUInt16LE(column, 2);
    header.writeUInt16LE(styleIndex, 4);
    return header;
  };
  const formula = Buffer.alloc(16);
  formula.writeUInt16LE(0xffff, 6);
  const data = Buffer.concat([
    biffRecord(0x809, bof),
    biffRecord(0xe0, Buffer.alloc(20)),
    biffRecord(0xe0, style),
    biffRecord(0x41e, Buffer.concat([formatId, unicode('"ID-"@')])),
    biffRecord(0xfc, Buffer.concat([counts, unicode('ABC')])),
    ...['Shared', 'Label', 'Formula'].map((name, column) =>
      biffRecord(0x204, Buffer.concat([cellHeader(0, column, 0), unicode(name)]))
    ),
    biffRecord(0xfd, Buffer.concat([cellHeader(1, 0, 1), Buffer.alloc(4)])),
    biffRecord(0x204, Buffer.concat([cellHeader(1, 1, 1), unicode('ABC')])),
    biffRecord(6, Buffer.concat([cellHeader(1, 2, 1), formula])),
    biffRecord(0x207, unicode('ABC')),
    biffRecord(0xa),
  ]);
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
  expect(await collect(parsed.rowsAsync!)).toEqual([
    ['Shared', 'Label', 'Formula'],
    ['ID-ABC', 'ID-ABC', 'ID-ABC'],
  ]);
});

it('formats shared, inline and cached formula XLSX text without formatting errors as text', async () => {
  const data = xmlWorkbookBytes(
    '<row r="1"><c r="A1" t="str"><v>Shared</v></c><c r="B1" t="str"><v>Inline</v></c><c r="C1" t="str"><v>Formula</v></c><c r="D1" t="str"><v>Error</v></c></row>' +
      '<row r="2"><c r="A2" t="s" s="1"><v>0</v></c><c r="B2" t="inlineStr" s="1"><is><t>ABC</t></is></c>' +
      '<c r="C2" t="str" s="1"><f>"ABC"</f><v>ABC</v></c><c r="D2" t="e" s="1"><v>#DIV/0!</v></c></row>',
    '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="&quot;ID-&quot;@"/></numFmts>' +
      '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    false,
    '<sst><si><t>ABC</t></si></sst>'
  );
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xlsx', data }))._unsafeUnwrap();
  expect(await collect(parsed.rowsAsync!)).toEqual([
    ['Shared', 'Inline', 'Formula', 'Error'],
    ['ID-ABC', 'ID-ABC', 'ID-ABC', '#DIV/0!'],
  ]);
});

it('preserves SpreadsheetML named currency and boolean formats and text sections', async () => {
  const formats = ['Currency', 'Yes/No', 'True/False', 'On/Off', '&quot;ID-&quot;@'];
  const headers = [...formats.slice(0, 4), 'Text'];
  const data = Buffer.from(
    '<Workbook xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles>' +
      formats
        .map(
          (format, index) =>
            `<Style ss:ID="s${index}"><NumberFormat ss:Format="${format}"/></Style>`
        )
        .join('') +
      '</Styles><Worksheet ss:Name="Data"><Table><Row>' +
      headers.map((name) => `<Cell><Data ss:Type="String">${name}</Data></Cell>`).join('') +
      '</Row>' +
      [12.3, -12.3, 0]
        .map(
          (value) =>
            '<Row>' +
            formats
              .map(
                (_, index) =>
                  `<Cell ss:StyleID="s${index}"><Data ss:Type="${index === 4 ? 'String' : 'Number'}">${index === 4 ? 'ABC' : value}</Data></Cell>`
              )
              .join('') +
            '</Row>'
        )
        .join('') +
      spreadsheetMlFooter
  );
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
  expect(await collect(parsed.rowsAsync!)).toEqual([
    headers,
    ['$12.30 ', 'Yes', 'True', 'Yes', 'ID-ABC'],
    ['($12.30)', 'Yes', 'True', 'Yes', 'ID-ABC'],
    ['$0.00 ', 'No', 'False', 'No', 'ID-ABC'],
  ]);
});

it('treats unzoned XLSX ISO dates as UTC while preserving explicit zones and cell formats', async () => {
  const dates = [
    '2020-01-15T00:00:00',
    '2020-01-15T00:00:00Z',
    '2020-01-15T08:00:00+08:00',
    '2020-01-14T19:00:00-05:00',
  ];
  const data = xmlWorkbookBytes(
    '<row r="1"><c r="A1" t="str"><v>Serial</v></c><c r="B1" t="str"><v>Date</v></c></row>' +
      dates
        .map(
          (date, index) =>
            `<row r="${index + 2}"><c r="A${index + 2}" t="d"><v>${date}</v></c><c r="B${index + 2}" t="d" s="1"><v>${date}</v></c></row>`
        )
        .join(''),
    '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>' +
      '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'
  );
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xlsx', data }))._unsafeUnwrap();
  const utcDisplay = '2020-01-15 00:00';
  expect(await collect(parsed.rowsAsync!)).toEqual([
    ['Serial', 'Date'],
    ['43845', utcDisplay],
    ['43845', utcDisplay],
    ['43845', utcDisplay],
    ['43845', utcDisplay],
  ]);
});

describe.each(['xlsx', 'xlml'] as const)('%s ISO date compatibility', (format) => {
  it.each([false, true])(
    'uses the correct leap-day boundary with date1904=%s',
    async (date1904) => {
      const dates = date1904
        ? [
            '1904-01-01T00:00:00',
            '1904-02-28T12:00:00',
            '1904-02-29T00:00:00',
            '1904-03-01T00:00:00',
          ]
        : [
            '1900-01-01T00:00:00',
            '1900-02-28T00:00:00',
            '1900-02-28T12:00:00',
            '1900-03-01T00:00:00',
          ];
      const data =
        format === 'xlsx'
          ? xmlWorkbookBytes(
              '<row r="1"><c r="A1" t="str"><v>Date</v></c><c r="B1" t="str"><v>Serial</v></c></row>' +
                dates
                  .map(
                    (date, index) =>
                      `<row r="${index + 2}"><c r="A${index + 2}" t="d" s="1"><v>${date}Z</v></c><c r="B${index + 2}" t="d" s="2"><v>${date}Z</v></c></row>`
                  )
                  .join(''),
              '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>' +
                '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
              date1904
            )
          : Buffer.from(
              '<Workbook xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
                (date1904 ? '<ExcelWorkbook><Date1904/></ExcelWorkbook>' : '') +
                '<Styles><Style ss:ID="date"><NumberFormat ss:Format="yyyy-mm-dd hh:mm"/></Style><Style ss:ID="serial"><NumberFormat ss:Format="0.0"/></Style></Styles>' +
                '<Worksheet ss:Name="Data"><Table><Row><Cell><Data ss:Type="String">Date</Data></Cell><Cell><Data ss:Type="String">Serial</Data></Cell></Row>' +
                dates
                  .map(
                    (date) =>
                      `<Row><Cell ss:StyleID="date"><Data ss:Type="DateTime">${date}</Data></Cell><Cell ss:StyleID="serial"><Data ss:Type="DateTime">${date}</Data></Cell></Row>`
                  )
                  .join('') +
                spreadsheetMlFooter
            );
      const parsed = (
        await new ExcelImportAdapter().parse({ type: format === 'xlsx' ? 'xlsx' : 'xls', data })
      )._unsafeUnwrap();
      expect(await collect(parsed.rowsAsync!)).toEqual([
        ['Date', 'Serial'],
        ...(date1904
          ? [
              ['1904-01-01 00:00', '0.0'],
              ['1904-02-28 12:00', '58.5'],
              ['1904-02-29 00:00', '59.0'],
              ['1904-03-01 00:00', '60.0'],
            ]
          : [
              ['1900-01-01 00:00', '1.0'],
              ['1900-02-28 00:00', '59.0'],
              ['1900-02-28 12:00', '59.5'],
              ['1900-03-01 00:00', '61.0'],
            ]),
      ]);
    }
  );
});

afterEach(() => setSafeFetch(undefined));

describe.each(['xlsx', 'xls'] as const)('Excel %s bounded stream', (type) => {
  it('preserves physical header selection, sheets, sparse rows, formats and cached formulas', async () => {
    const result = await new ExcelImportAdapter().parse(
      { type, stream: chunks(workbookBytes(type)) },
      { sheetName: 'Data' }
    );
    const parsed = result._unsafeUnwrap();
    expect(parsed.sheets).toEqual([
      { name: 'Other', index: 0 },
      { name: 'Data', index: 1 },
    ]);
    expect(parsed.headers).toEqual(['Name', 'Amount', 'Date', 'Enabled', 'Formula']);
    expect(parsed.rowsAsync).toBeDefined();
    expect(await collect(parsed.rowsAsync!)).toEqual([
      ['Name', 'Amount', 'Date', 'Enabled', 'Formula'],
      ['Alice', '1,234.50', '2024-01-02', 'TRUE', '42'],
      ['', '', '', '', ''],
      ['跨记录字符串'.repeat(400), '0', '0', 'FALSE', 'Cached formula text'],
    ]);
  });

  it('analyzes only the requested preview and can parse the source again after an early return', async () => {
    const data = workbookBytes(type);
    const adapter = new ExcelImportAdapter();
    const preview = await adapter.analyze({ type, data }, { sheetName: 'Data' }, 1);
    expect(preview._unsafeUnwrap().sampleRows).toEqual([
      ['Alice', '1,234.50', '2024-01-02', 'TRUE', '42'],
    ]);
    const parsed = (await adapter.parse({ type, data }, { sheetName: 'Data' }))._unsafeUnwrap();
    expect(parsed.rowsAsync).toBeDefined();
    for await (const row of parsed.rowsAsync!) {
      expect(row).toEqual(['Name', 'Amount', 'Date', 'Enabled', 'Formula']);
      break;
    }
  });

  it('downloads via safeFetch without materializing a response arrayBuffer', async () => {
    const response = new Response(workbookBytes(type));
    const arrayBuffer = vi
      .spyOn(response, 'arrayBuffer')
      .mockRejectedValue(new Error('full buffering'));
    setSafeFetch(vi.fn().mockResolvedValue(response));
    const parsed = (
      await new ExcelImportAdapter().parse(
        { type, url: 'https://example.com/workbook' },
        { sheetName: 'Data' }
      )
    )._unsafeUnwrap();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(parsed.rowsAsync).toBeDefined();
    await collect(parsed.rowsAsync!);
  });

  it.runIf(Boolean(global.gc))(
    'does not retain a high-cardinality workbook on the JS heap',
    async () => {
      const data = workbookBytes(type, true);
      global.gc!();
      await setImmediate();
      global.gc!();
      const baseline = process.memoryUsage().heapUsed;
      const parsed = (
        await new ExcelImportAdapter().parse({ type, stream: chunks(data) }, { sheetName: 'Data' })
      )._unsafeUnwrap();
      global.gc!();
      expect(process.memoryUsage().heapUsed - baseline).toBeLessThan(24 * 1024 * 1024);
      let count = 0;
      for await (const row of parsed.rowsAsync ?? parsed.rows ?? []) {
        if (++count % 10000 === 0) {
          await setImmediate();
          global.gc!();
          expect(process.memoryUsage().heapUsed - baseline).toBeLessThan(24 * 1024 * 1024);
        }
        expect(row).toHaveLength(5);
      }
      expect(count).toBe(40005);
    },
    120000
  );
});

it('reads BIFF SST strings continued across records with changing character widths', async () => {
  const bof = (type: number) => {
    const data = Buffer.alloc(16);
    data.writeUInt16LE(0x600);
    data.writeUInt16LE(type, 2);
    return biffRecord(0x809, data);
  };
  const boundsheet = Buffer.alloc(12);
  boundsheet[6] = 4;
  boundsheet.write('Data', 8, 'latin1');
  const counts = Buffer.alloc(8);
  counts.writeUInt32LE(2);
  counts.writeUInt32LE(2, 4);
  const length = Buffer.alloc(3);
  length.writeUInt16LE(9000);
  length[2] = 1;
  const globalRecords = [
    bof(5),
    biffRecord(0x85, boundsheet),
    biffRecord(
      0xfc,
      Buffer.concat([
        counts,
        Buffer.from([4, 0, 0]),
        Buffer.from('Name'),
        length,
        Buffer.from('头'.repeat(4000), 'utf16le'),
      ])
    ),
    biffRecord(0x3c, Buffer.concat([Buffer.from([0]), Buffer.from('a'.repeat(4000))])),
    biffRecord(0x3c, Buffer.concat([Buffer.from([1]), Buffer.from('尾'.repeat(1000), 'utf16le')])),
    biffRecord(0xa),
  ];
  globalRecords[1].writeUInt32LE(
    globalRecords.reduce((size, item) => size + item.length, 0),
    4
  );
  const cell = (row: number, index: number) => {
    const data = Buffer.alloc(10);
    data.writeUInt16LE(row);
    data.writeUInt32LE(index, 6);
    return biffRecord(0xfd, data);
  };
  const data = Buffer.concat([
    ...globalRecords,
    bof(0x10),
    cell(0, 0),
    cell(1, 1),
    biffRecord(0xa),
  ]);
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
  expect(parsed.rowsAsync).toBeDefined();
  expect(await collect(parsed.rowsAsync!)).toEqual([
    ['Name'],
    ['头'.repeat(4000) + 'a'.repeat(4000) + '尾'.repeat(1000)],
  ]);
});

describe.each(['biff2', 'biff3', 'biff4', 'biff5', 'xlml'] as const)(
  'legacy %s Excel compatibility',
  (bookType) => {
    it('continues to import genuine legacy Excel sources without a full workbook fallback', async () => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['Name', 'Amount', 'Enabled'],
          ['Alice', 1234.5, true],
          [],
          ['Bob', 0, false],
        ]),
        'Data'
      );
      // SheetJS supports these legacy writers at runtime but omits BIFF3/4
      // from its BookType declaration. Keep that boundary checked and narrow.
      const output: unknown = Reflect.apply(XLSX.write, XLSX, [
        workbook,
        { type: 'array', bookType },
      ]);
      if (!(output instanceof ArrayBuffer)) throw new Error('Expected binary Excel fixture');
      const data = new Uint8Array(output);
      const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
      expect(parsed.rowsAsync).toBeDefined();
      expect(await collect(parsed.rowsAsync!)).toEqual([
        ['Name', 'Amount', 'Enabled'],
        ['Alice', '1234.5', 'TRUE'],
        ['', '', ''],
        ['Bob', '0', 'FALSE'],
      ]);
    });
  }
);

it('removes temporary files after completion, early return and malformed input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'excel-cleanup-test-'));
  vi.stubEnv('TMPDIR', directory);
  try {
    const adapter = new ExcelImportAdapter();
    for (const type of ['xlsx', 'xls'] as const) {
      const data = workbookBytes(type);
      const completed = (await adapter.parse({ type, data }))._unsafeUnwrap();
      await collect(completed.rowsAsync!);
      expect(await readdir(directory)).toEqual([]);
      const stopped = (await adapter.parse({ type, data }))._unsafeUnwrap();
      const iterator = stopped.rowsAsync![Symbol.asyncIterator]();
      await iterator.return?.();
      expect(await readdir(directory)).toEqual([]);
      const failed = await adapter.parse({ type, data: data.subarray(0, 64) });
      expect(failed.isErr()).toBe(true);
      expect(await readdir(directory)).toEqual([]);
    }
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it('uses one source snapshot across analysis, sheets and retries, then disposes it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'excel-snapshot-test-'));
  vi.stubEnv('TMPDIR', directory);
  const fetch = vi.fn().mockImplementation(async () => new Response(workbookBytes('xlsx')));
  setSafeFetch(fetch);
  try {
    const prepared = (
      await prepareExcelImportSource({ type: 'excel', url: 'https://example.com/changing.xlsx' })
    )._unsafeUnwrap();
    try {
      const adapter = new ExcelImportAdapter();
      const preview = (
        await adapter.analyze(prepared.source, { sheetName: 'Data' }, 1)
      )._unsafeUnwrap();
      expect(preview.sampleRows[0][0]).toBe('Alice');
      const other = (await adapter.parse(prepared.source, { sheetName: 'Other' }))._unsafeUnwrap();
      expect(await collect(other.rowsAsync!)).toEqual([['Other'], ['Ignored']]);
      const retried = (await adapter.parse(prepared.source, { sheetName: 'Data' }))._unsafeUnwrap();
      await retried.rowsAsync![Symbol.asyncIterator]().return?.();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(await readdir(directory)).toHaveLength(1);
    } finally {
      await prepared.dispose();
    }
    expect(await readdir(directory)).toEqual([]);
    expect((await new ExcelImportAdapter().parse(prepared.source)).isErr()).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it('matches legacy HTML .xls table, entity and merged-cell semantics without a DOM', async () => {
  const data = Buffer.from(
    '<html><body><table>' +
      '<tr><th>Item</th><th>Amount</th><th>Note</th></tr>' +
      '<tr><td rowspan="2">A</td><td>1,234.50</td><td>x&nbsp;&amp; y<br>line</td></tr>' +
      '<tr><td colspan="2">B</td></tr><tr></tr><tr><td>C</td><td>0</td><td>FALSE</td></tr>' +
      '</table><table><tr><th>K</th></tr><tr><td>V</td></tr></table></body></html>'
  );
  const legacy = XLSX.read(data, { type: 'array', dense: true });
  const adapter = new ExcelImportAdapter();
  for (const name of legacy.SheetNames) {
    const parsed = (
      await adapter.parse({ type: 'xls', data }, { sheetName: name })
    )._unsafeUnwrap();
    expect(parsed.sheets?.map((sheet) => sheet.name)).toEqual(legacy.SheetNames);
    const legacyRows = XLSX.utils.sheet_to_json<unknown[]>(legacy.Sheets[name], {
      header: 1,
      raw: false,
      blankrows: true,
      defval: '',
    });
    // The old adapter pads every physical row to the detected header width,
    // whereas sheet_to_json represents a completely empty physical row as [].
    const width = legacyRows[0].length;
    expect(await collect(parsed.rowsAsync!)).toEqual(
      legacyRows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? ''))
    );
  }
});

it('does not promote rows beyond the first 30 physical rows into headers', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(
    sheet,
    [
      ['Late', 'Header'],
      ['Not', 'Imported'],
    ],
    { origin: 'A31' }
  );
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
  const data = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  const parsed = (await new ExcelImportAdapter().parse({ type: 'excel', data }))._unsafeUnwrap();
  expect(parsed.headers).toEqual([]);
  expect(await collect(parsed.rowsAsync!)).toEqual([]);
});

it('preserves UTF-16BE SpreadsheetML, a harmless DTD and forward style inheritance', async () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE Workbook>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Styles><Style ss:ID="child" ss:Parent="parent"/><Style ss:ID="parent"><NumberFormat ss:Format="0.00"/></Style></Styles>' +
    '<Worksheet ss:Name="Data"><Table><Row><Cell><Data ss:Type="String">名称</Data></Cell><Cell><Data ss:Type="String">Amount</Data></Cell></Row>' +
    '<Row><Cell><Data ss:Type="String">中文</Data></Cell><Cell ss:StyleID="child"><Data ss:Type="Number">12.3</Data></Cell></Row>' +
    spreadsheetMlFooter;
  const data = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]).swap16();
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
  expect(await collect(parsed.rowsAsync!)).toEqual([
    ['名称', 'Amount'],
    ['中文', '12.30'],
  ]);
});

it('keeps SpreadsheetML comments separate from imported cell values', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Name'], ['Alice']]);
  sheet.A2.c = [{ a: 'Reviewer', t: 'review later' }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Data');
  const data = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlml' }));
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
  expect(await collect(parsed.rowsAsync!)).toEqual([['Name'], ['Alice']]);
});

it('inherits SpreadsheetML column spans while keeping row and cell style precedence', async () => {
  const data = Buffer.from(
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Styles><Style ss:ID="date"><NumberFormat ss:Format="yyyy-mm-dd"/></Style>' +
      '<Style ss:ID="fixed"><NumberFormat ss:Format="0.00"/></Style>' +
      '<Style ss:ID="plain"><NumberFormat ss:Format="General"/></Style></Styles>' +
      '<Worksheet ss:Name="Data"><Table><Column ss:Index="2" ss:Span="1" ss:StyleID="date"/>' +
      '<Row><Cell><Data ss:Type="String">Name</Data></Cell><Cell><Data ss:Type="String">Date</Data></Cell><Cell><Data ss:Type="String">Spanned date</Data></Cell></Row>' +
      '<Row><Cell><Data ss:Type="String">Alice</Data></Cell><Cell><Data ss:Type="Number">45295</Data></Cell><Cell><Data ss:Type="Number">45296</Data></Cell></Row>' +
      '<Row ss:StyleID="fixed"><Cell><Data ss:Type="String">Bob</Data></Cell><Cell><Data ss:Type="Number">1.25</Data></Cell><Cell ss:StyleID="plain"><Data ss:Type="Number">3</Data></Cell></Row>' +
      spreadsheetMlFooter
  );
  const parsed = (await new ExcelImportAdapter().parse({ type: 'xls', data }))._unsafeUnwrap();
  expect(await collect(parsed.rowsAsync!)).toEqual([
    ['Name', 'Date', 'Spanned date'],
    ['Alice', '2024-01-04', '2024-01-05'],
    ['Bob', '1.25', '3'],
  ]);
});

it.each([
  ['row', '<row r="1048577"><c r="A1048577"><v>1</v></c></row>'],
  ['column', '<row r="1"><c r="XFE1"><v>1</v></c></row>'],
  ['negative row', '<row r="-1"><c r="A1"><v>1</v></c></row>'],
  ['shared string', '<row r="1"><c r="A1" t="s"><v>4294967295</v></c></row>'],
])(
  'rejects an out-of-range %s before allocating a row or synthesizing gaps',
  async (_kind, row) => {
    const archive = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(
      archive,
      'xl/workbook.xml',
      Buffer.from('<workbook><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>')
    );
    XLSX.CFB.utils.cfb_add(
      archive,
      'xl/_rels/workbook.xml.rels',
      Buffer.from(
        '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'
      )
    );
    XLSX.CFB.utils.cfb_add(
      archive,
      'xl/worksheets/sheet1.xml',
      Buffer.from(`<worksheet><sheetData>${row}</sheetData></worksheet>`)
    );
    const data = new Uint8Array(XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip' }));
    const result = await new ExcelImportAdapter().parse({ type: 'xlsx', data });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toMatch(/Invalid Excel/);
  }
);
