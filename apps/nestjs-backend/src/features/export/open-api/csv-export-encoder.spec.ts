import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { CsvExportEncoder } from './csv-export-encoder';

const headers = [
  {
    id: 'fldText',
    name: '备注,中文',
    type: FieldType.SingleLineText,
    options: {},
    dbFieldName: 'text_value',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
  },
  {
    id: 'fldAttachment',
    name: '附件"链接"',
    type: FieldType.Attachment,
    options: {},
    dbFieldName: 'attachment_value',
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isMultipleCellValue: true,
  },
] as unknown as IFieldVo[];

describe('CsvExportEncoder', () => {
  it('encodes Unicode header names with commas and quotes in header order', () => {
    const encoder = new CsvExportEncoder(headers);

    expect(encoder.header()).toBe('"备注,中文","附件""链接"""');
  });

  it('formats and escapes text and attachment presigned URLs in column order', () => {
    const encoder = new CsvExportEncoder(headers);

    expect(
      encoder.encode([
        {
          fields: {
            ['附件"链接"']: [
              {
                name: '合同,终稿.pdf',
                presignedUrl: 'https://cdn.example/合同.pdf',
              },
              {
                name: '"封面".png',
                presignedUrl: 'https://cdn.example/cover.png',
              },
            ],
            ['备注,中文']: '你好, "世界"',
          },
        },
      ])
    ).toBe(
      '"你好, ""世界""","合同,终稿.pdf https://cdn.example/合同.pdf,""封面"".png https://cdn.example/cover.png"'
    );
  });
});
