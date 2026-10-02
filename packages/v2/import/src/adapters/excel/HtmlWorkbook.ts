import { createReadStream } from 'node:fs';

import { Parser } from 'htmlparser2';

import type { PhysicalExcelRow, StreamingWorkbook, TemporaryWorkbook } from './TemporaryWorkbook';
import { assertExcelIndex, workbookTextDecoder } from './XmlStream';

async function* htmlEvents<T>(
  owner: TemporaryWorkbook,
  configure: (emit: (value: T) => void) => Parser
): AsyncGenerator<T> {
  const queue: T[] = [];
  const parser = configure((value) => queue.push(value));
  const stream = createReadStream(owner.path, { highWaterMark: 65536 });
  owner.own(() => {
    stream.destroy();
  });
  let decoder: TextDecoder | undefined;
  try {
    for await (const bytes of stream) {
      decoder ??= workbookTextDecoder(bytes);
      parser.write(decoder.decode(bytes, { stream: true }));
      for (const event of queue) yield event;
      queue.length = 0;
    }
    parser.end(decoder?.decode());
    for (const event of queue) yield event;
  } finally {
    queue.length = 0;
    stream.destroy();
  }
}

/** HTML-table Excel exports retain their displayed text, including number formatting. */
export class HtmlWorkbook implements StreamingWorkbook {
  readonly sheets: Array<{ name: string; index: number }> = [];
  private constructor(private readonly owner: TemporaryWorkbook) {}

  static async open(owner: TemporaryWorkbook): Promise<HtmlWorkbook> {
    const workbook = new HtmlWorkbook(owner);
    let depth = 0;
    for await (const unused of htmlEvents<never>(
      owner,
      () =>
        new Parser({
          onopentag(name) {
            if (name === 'table' && depth++ === 0)
              workbook.sheets.push({
                name: `Sheet${workbook.sheets.length + 1}`,
                index: workbook.sheets.length,
              });
          },
          onclosetag(name) {
            if (name === 'table') depth--;
          },
        })
    ))
      void unused;
    if (!workbook.sheets.length) throw new Error('HTML Excel file has no tables');
    return workbook;
  }

  async *rows(name: string): AsyncGenerator<PhysicalExcelRow> {
    const target = this.sheets.find((sheet) => sheet.name === name)?.index;
    let table = -1;
    let depth = 0;
    let row = -1;
    let column = 0;
    let cellColumn = 0;
    let inCell = false;
    let text = '';
    let values: string[] = [];
    // Only active column spans survive; completed rows are never retained.
    const spans: number[] = [];
    const entities: Record<string, string> = {
      nbsp: ' ',
      middot: '·',
      quot: '"',
      apos: "'",
      gt: '>',
      lt: '<',
      amp: '&',
    };
    const openCell = (attrs: Record<string, string>) => {
      while ((spans[column] ?? -1) >= row) column++;
      const colspan = Math.max(1, Number(attrs.colspan) || 1);
      const rowspan = Math.max(1, Number(attrs.rowspan) || 1);
      assertExcelIndex(column, 16384, 'column');
      assertExcelIndex(column + colspan - 1, 16384, 'merged column');
      assertExcelIndex(row + rowspan - 1, 1048576, 'merged row');
      cellColumn = column;
      if (rowspan > 1) {
        for (let at = column; at < column + colspan; at++) spans[at] = row + rowspan - 1;
      }
      column += colspan;
      inCell = true;
      text = '';
    };
    yield* htmlEvents<PhysicalExcelRow>(
      this.owner,
      (emit) =>
        new Parser(
          {
            onopentag(element, attrs) {
              if (element === 'table') {
                if (depth++ === 0) table++;
                return;
              }
              if (table !== target || depth !== 1) return;
              if (element === 'tr') {
                row++;
                assertExcelIndex(row, 1048576, 'row');
                column = 0;
                values = [];
              } else if (element === 'td' || element === 'th') {
                openCell(attrs);
              } else if (inCell) text += `<${element}>`;
            },
            ontext(part) {
              if (inCell && table === target) text += part;
            },
            onclosetag(element) {
              if (element === 'table') {
                depth--;
                return;
              }
              if (table !== target || depth !== 1) return;
              if (element === 'td' || element === 'th') {
                const value = text
                  .replace(/^[\t\n\r ]+/, '')
                  .replace(/(^|[^\t\n\r ])[\t\n\r ]+$/, '$1')
                  .replace(/>\s+/g, '>')
                  .replace(/\b\s+</g, '<')
                  .replace(/[\t\n\r ]+/g, ' ')
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<[^<>]*>/g, '')
                  .replace(
                    /&(nbsp|middot|quot|apos|gt|lt|amp);/gi,
                    (_, entity: string) => entities[entity.toLowerCase()]
                  );
                if (value.length) values[cellColumn] = value;
                inCell = false;
              } else if (element === 'tr' && values.length) {
                emit({ index: row, values });
                values = [];
              } else if (inCell) text += `</${element}>`;
            },
          },
          { decodeEntities: false }
        )
    );
  }
}
