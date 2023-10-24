import {
  CellValueType,
  DbFieldType,
  FieldType,
} from '../../../../../../packages/core/src/models/field/constant';
import { extractTableHeader, serializerHtml } from './clipboard';

jest.mock('@teable-group/core', () => {
  return {
    __esModule: true,
    IFieldVo: {},
    fieldVoSchema: {
      safeParse: () => ({ success: true }),
    },
  };
});

describe('clipboard', () => {
  const html = `<table TEABLE_HTML_MARKER="1"><thead><tr><td colspan="0" id='"fldziUf9QuQjkbfMuG5"' name='"Name"' isPrimary='true' columnMeta='{"viwE0sl0GqGdWaBqwFi":{"order":0.5}}' dbFieldName='"Name_fldziUf9QuQjkbfMuG5"' dbFieldType='"TEXT"' type='"singleLineText"' options='{}' cellValueType='"string"'>Name</td><td colspan="1" id='"fldpsQvHI4ugP2luizP"' name='"Count"' columnMeta='{"viwE0sl0GqGdWaBqwFi":{"order":1}}' dbFieldName='"Count_fldpsQvHI4ugP2luizP"' dbFieldType='"REAL"' type='"number"' options='{"formatting":{"type":"decimal","precision":0}}' cellValueType='"number"'>Count</td><td colspan="2" id='"fldGTKfZvXNXeMJ6nqu"' name='"Status"' columnMeta='{"viwE0sl0GqGdWaBqwFi":{"order":2}}' dbFieldName='"Status_fldGTKfZvXNXeMJ6nqu"' dbFieldType='"TEXT"' options='{"choices":[{"name":"light","id":"cho2caYhPrI","color":"grayBright"},{"name":"medium","id":"chor2ob8aU7","color":"yellowBright"},{"name":"heavy","id":"choArPr57sO","color":"tealBright"}]}' type='"singleSelect"' cellValueType='"string"'>Status</td></tr></thead><tbody><tr><td>John</td><td>20</td><td>light</td></tr><tr><td>Tom</td><td>30</td><td>medium</td></tr><tr><td>Bob</td><td>40</td><td>heavy</td></tr></tbody></table>`;

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

  it('serializerHtml should serializer table from data and header of table', () => {
    const data = 'John\t20\tlight\nTom\t30\tmedium\nBob\t40\theavy';
    const result = serializerHtml(data, expectedHeader);
    expect(result).toEqual(html);
  });
});
