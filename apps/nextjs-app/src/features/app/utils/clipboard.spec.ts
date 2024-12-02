import { vi } from 'vitest';
import {
  CellValueType,
  DbFieldType,
  FieldType,
} from '../../../../../../packages/core/src/models/field/constant';
import { extractTableHeader, isTeableHTML, serializerHtml } from './clipboard';

const stringData = 'John\t20\tlight\nTom\t30\tmedium\nBob\t40\theavy';
const parseData = [
  ['John', '20', 'light'],
  ['Tom', '30', 'medium'],
  ['Bob', '40', 'heavy'],
];

vi.mock('@teable/core', () => {
  return {
    __esModule: true,
    IFieldVo: {},
    FieldType: FieldType,
    parseClipboardText: () => parseData,
    fieldVoSchema: {
      safeParse: () => ({ success: true }),
    },
  };
});

vi.mock('zod', () => {
  return {
    z: {
      array: () => ({
        safeParse: (data: string) => ({ success: true, data }),
      }),
    },
  };
});

describe('clipboard', () => {
  const html = `<meta charset="utf-8"><table data-teable-html-marker="1" data-teable-html-header="%5B%7B%22id%22%3A%22fldziUf9QuQjkbfMuG5%22%2C%22name%22%3A%22Name%22%2C%22isPrimary%22%3Atrue%2C%22columnMeta%22%3A%7B%22viwE0sl0GqGdWaBqwFi%22%3A%7B%22order%22%3A0.5%7D%7D%2C%22dbFieldName%22%3A%22Name_fldziUf9QuQjkbfMuG5%22%2C%22dbFieldType%22%3A%22TEXT%22%2C%22type%22%3A%22singleLineText%22%2C%22options%22%3A%7B%7D%2C%22cellValueType%22%3A%22string%22%7D%2C%7B%22id%22%3A%22fldpsQvHI4ugP2luizP%22%2C%22name%22%3A%22Count%22%2C%22columnMeta%22%3A%7B%22viwE0sl0GqGdWaBqwFi%22%3A%7B%22order%22%3A1%7D%7D%2C%22dbFieldName%22%3A%22Count_fldpsQvHI4ugP2luizP%22%2C%22dbFieldType%22%3A%22REAL%22%2C%22type%22%3A%22number%22%2C%22options%22%3A%7B%22formatting%22%3A%7B%22type%22%3A%22decimal%22%2C%22precision%22%3A0%7D%7D%2C%22cellValueType%22%3A%22number%22%7D%2C%7B%22id%22%3A%22fldGTKfZvXNXeMJ6nqu%22%2C%22name%22%3A%22Status%22%2C%22columnMeta%22%3A%7B%22viwE0sl0GqGdWaBqwFi%22%3A%7B%22order%22%3A2%7D%7D%2C%22dbFieldName%22%3A%22Status_fldGTKfZvXNXeMJ6nqu%22%2C%22dbFieldType%22%3A%22TEXT%22%2C%22options%22%3A%7B%22choices%22%3A%5B%7B%22name%22%3A%22light%22%2C%22id%22%3A%22cho2caYhPrI%22%2C%22color%22%3A%22grayBright%22%7D%2C%7B%22name%22%3A%22medium%22%2C%22id%22%3A%22chor2ob8aU7%22%2C%22color%22%3A%22yellowBright%22%7D%2C%7B%22name%22%3A%22heavy%22%2C%22id%22%3A%22choArPr57sO%22%2C%22color%22%3A%22tealBright%22%7D%5D%7D%2C%22type%22%3A%22singleSelect%22%2C%22cellValueType%22%3A%22string%22%7D%5D"><tbody><tr><td>John</td><td>20</td><td>light</td></tr><tr><td>Tom</td><td>30</td><td>medium</td></tr><tr><td>Bob</td><td>40</td><td>heavy</td></tr></tbody></table>`;

  const expectedHeader = [
    {
      id: 'fldziUf9QuQjkbfMuG5',
      name: 'Name',
      isPrimary: true,
      columnMeta: {
        viwE0sl0GqGdWaBqwFi: {
          order: 0.5,
        },
      },
      dbFieldName: 'Name_fldziUf9QuQjkbfMuG5',
      dbFieldType: DbFieldType.Text,
      type: FieldType.SingleLineText,
      options: {},
      cellValueType: CellValueType.String,
    },
    {
      id: 'fldpsQvHI4ugP2luizP',
      name: 'Count',
      columnMeta: {
        viwE0sl0GqGdWaBqwFi: {
          order: 1,
        },
      },
      dbFieldName: 'Count_fldpsQvHI4ugP2luizP',
      dbFieldType: DbFieldType.Real,
      type: FieldType.Number,
      options: {
        formatting: {
          type: 'decimal',
          precision: 0,
        },
      },
      cellValueType: CellValueType.Number,
    },
    {
      id: 'fldGTKfZvXNXeMJ6nqu',
      name: 'Status',
      columnMeta: {
        viwE0sl0GqGdWaBqwFi: {
          order: 2,
        },
      },
      dbFieldName: 'Status_fldGTKfZvXNXeMJ6nqu',
      dbFieldType: DbFieldType.Text,
      options: {
        choices: [
          {
            name: 'light',
            id: 'cho2caYhPrI',
            color: 'grayBright',
          },
          {
            name: 'medium',
            id: 'chor2ob8aU7',
            color: 'yellowBright',
          },
          {
            name: 'heavy',
            id: 'choArPr57sO',
            color: 'tealBright',
          },
        ],
      },
      type: FieldType.SingleSelect,
      cellValueType: CellValueType.String,
    },
  ];
  it('extractTableHeader should extract table header from HTML', () => {
    const { result } = extractTableHeader(html);
    expect(result).toEqual(expectedHeader);
  });

  it('extractTableHeader should return undefined from non-teable HTML', () => {
    const { result } = extractTableHeader('<table></table>');
    expect(result).toEqual(undefined);
  });

  it('serializerHtml should serializer table from data and header of table', () => {
    const result = serializerHtml(stringData, expectedHeader);
    expect(result).toEqual(html);
  });

  describe('isTeableHtml', () => {
    it('returns true for HTML with table tagged as teable', () => {
      const html = `
        <meta charset="utf-8"><table data-teable-html-marker="true">
          <tr><td>Hello</td></tr>  
        </table>
      `;
      expect(isTeableHTML(html)).toBe(true);
    });

    it('returns false for HTML without table', () => {
      const html = `
        <div>No Table</div>
      `;
      expect(isTeableHTML(html)).toBe(false);
    });

    it('returns false if table lacks marker attribute', () => {
      const html = `
        <meta charset="utf-8"><table>
          <tr><td>Hello</td></tr>
        </table>
      `;
      expect(isTeableHTML(html)).toBe(false);
    });

    it('handles invalid HTML gracefully', () => {
      const html = `<div>`;
      expect(isTeableHTML(html)).toBe(false);
    });
  });
});
