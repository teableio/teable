import { createReadStream } from 'node:fs';

import { DiskStringMap } from './DiskStringTable';
import type { PhysicalExcelRow, StreamingWorkbook, TemporaryWorkbook } from './TemporaryWorkbook';
import {
  assertExcelIndex,
  attribute,
  excelDateSerial,
  formatCellValue,
  localName,
  parseXml,
} from './XmlStream';

const formatAliases: Record<string, string> = {
  ['General Number']: 'General',
  ['General Date']: 'm/d/yy h:mm',
  ['Short Date']: 'm/d/yy',
  ['Long Date']: 'dddd, mmmm dd, yyyy',
  ['Medium Date']: 'dd-mmm-yy',
  ['Short Time']: 'h:mm',
  ['Long Time']: 'h:mm:ss AM/PM',
  ['Medium Time']: 'h:mm AM/PM',
  Currency: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  Fixed: '0.00',
  Standard: '#,##0.00',
  Percent: '0.00%',
  Scientific: '0.00E+00',
  ['Yes/No']: '"Yes";"Yes";"No";@',
  ['True/False']: '"True";"True";"False";@',
  ['On/Off']: '"Yes";"Yes";"No";@',
};

/** Excel 2003 XML is commonly delivered with an .xls extension. */
export class XmlWorkbook implements StreamingWorkbook {
  readonly sheets: Array<{ name: string; index: number }> = [];
  private readonly styles: DiskStringMap;
  private styleCount = 0;
  private date1904 = false;

  private constructor(private readonly owner: TemporaryWorkbook) {
    this.styles = new DiskStringMap(owner, 'xml-styles');
  }

  static async open(owner: TemporaryWorkbook): Promise<XmlWorkbook> {
    const workbook = new XmlWorkbook(owner);
    let styleId: string | undefined;
    let format: string | undefined;
    let parent: string | undefined;
    let isWorkbook = false;
    const stream = createReadStream(owner.path, { highWaterMark: 65536 });
    owner.own(() => {
      stream.destroy();
    });
    for await (const unused of parseXml<never>(stream, (parser) => {
      parser.on('opentag', (tag) => {
        const name = localName(tag.name);
        if (name === 'Workbook') isWorkbook = true;
        else if (name === 'Worksheet')
          workbook.sheets.push({
            name: attribute(tag, 'Name') ?? `Sheet${workbook.sheets.length + 1}`,
            index: workbook.sheets.length,
          });
        else if (name === 'Style') {
          styleId = attribute(tag, 'ID');
          format = undefined;
          parent = attribute(tag, 'Parent');
        } else if (name === 'NumberFormat' && styleId)
          format = attribute(tag, 'Format') ?? 'General';
        else if (name === 'Date1904') workbook.date1904 = true;
      });
      parser.on('closetag', (tag) => {
        if (localName(tag.name) !== 'Style' || !styleId) return;
        workbook.styles.set(styleId, JSON.stringify({ format, parent }));
        workbook.styleCount++;
        styleId = undefined;
      });
    }))
      void unused;
    if (!isWorkbook) throw new Error('Unrecognized XML Excel workbook');
    return workbook;
  }

  private styleFormat(id: string | undefined): string {
    let format = 'General';
    let traversed = 0;
    while (id) {
      const raw = this.styles.get(id);
      if (!raw) break;
      if (++traversed > this.styleCount) throw new Error('Cyclic SpreadsheetML style inheritance');
      const style: { format?: string; parent?: string } = JSON.parse(raw);
      if (style.format) format = style.format;
      id = style.parent;
    }
    return format;
  }

  private formattedCell(type: string, data: string, style: string | undefined): string {
    const rawFormat = this.styleFormat(style);
    const format = formatAliases[rawFormat] ?? rawFormat;
    switch (type) {
      case 'Number':
        return formatCellValue(Number(data), format, this.date1904);
      case 'Boolean':
        return data === '1' || data === 'true' ? 'TRUE' : 'FALSE';
      case 'DateTime': {
        const timestamp = Date.parse(data.endsWith('Z') ? data : `${data}Z`);
        if (Number.isNaN(timestamp)) return data;
        return formatCellValue(
          excelDateSerial(timestamp, this.date1904),
          format === 'General' ? 'yyyy-mm-dd' : format,
          this.date1904
        );
      }
      case 'String':
        return formatCellValue(data, format, this.date1904);
      default:
        return data;
    }
  }

  async *rows(name: string): AsyncGenerator<PhysicalExcelRow> {
    const stream = createReadStream(this.owner.path, { highWaterMark: 65536 });
    this.owner.own(() => {
      stream.destroy();
    });
    let selected = false;
    let row = -1;
    let column = 0;
    let nextColumn = 0;
    let values: string[] = [];
    let data = '';
    let type = '';
    let style: string | undefined;
    let rowStyle: string | undefined;
    let inData = false;
    const elements: string[] = [];
    const columnStyles: Array<string | undefined> = [];
    let nextStyleColumn = 0;
    const applyColumnStyle = (tag: Parameters<typeof attribute>[0]) => {
      const start = Number(attribute(tag, 'Index') ?? nextStyleColumn + 1) - 1;
      const end = start + Number(attribute(tag, 'Span') ?? 0);
      assertExcelIndex(start, 256, 'column style');
      assertExcelIndex(end, 256, 'column style span');
      const columnStyle = attribute(tag, 'StyleID');
      for (let index = start; index <= end; index++) columnStyles[index] = columnStyle;
      nextStyleColumn = end + 1;
    };
    yield* parseXml<PhysicalExcelRow>(stream, (parser, emit) => {
      parser.on('opentag', (tag) => {
        const element = localName(tag.name);
        const parent = elements.at(-1);
        elements.push(element);
        if (element === 'Worksheet') selected = attribute(tag, 'Name') === name;
        if (!selected) return;
        if (element === 'Column' && parent === 'Table') {
          applyColumnStyle(tag);
        } else if (element === 'Row' && parent === 'Table') {
          row = Number(attribute(tag, 'Index') ?? row + 2) - 1;
          assertExcelIndex(row, 65536, 'row');
          rowStyle = attribute(tag, 'StyleID');
          values = [];
          nextColumn = 0;
        } else if (element === 'Cell' && parent === 'Row') {
          column = Number(attribute(tag, 'Index') ?? nextColumn + 1) - 1;
          assertExcelIndex(column, 256, 'column');
          nextColumn = column + 1 + Number(attribute(tag, 'MergeAcross') ?? 0);
          assertExcelIndex(nextColumn - 1, 256, 'merged column');
          style = attribute(tag, 'StyleID') ?? rowStyle ?? columnStyles[column] ?? 'Default';
        } else if (element === 'Data' && parent === 'Cell') {
          inData = true;
          data = '';
          type = attribute(tag, 'Type') ?? 'String';
        }
      });
      const text = (part: string) => {
        if (selected && inData) data += part;
      };
      parser.on('text', text);
      parser.on('cdata', text);
      parser.on('closetag', (tag) => {
        elements.pop();
        if (!selected) return;
        const element = localName(tag.name);
        if (element === 'Data' && inData) {
          values[column] = this.formattedCell(type, data, style);
          inData = false;
        } else if (element === 'Row' && values.length) {
          emit({ index: row, values });
          values = [];
        } else if (element === 'Worksheet') selected = false;
      });
    });
  }
}
