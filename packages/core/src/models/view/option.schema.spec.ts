import { ViewType } from './constant';
import { validateOptionsType, viewOptionsSchema, type IViewOptions } from './option.schema';

describe('view option Parse', () => {
  it('should parse view option', async () => {
    const option: IViewOptions = {
      coverUrl: 'https://www.xxx.com',
    };

    const parse = viewOptionsSchema.parse(option);

    expect(parse).toEqual(option);
  });
});

describe('view option validate', () => {
  test('should throw a error when pass form option to grid view', async () => {
    const formOption: IViewOptions = {
      coverUrl: 'https://www.xxx.com',
    };

    expect(() => validateOptionsType(ViewType.Grid, formOption)).toThrow();
  });

  test('should parse grid style options', () => {
    const gridOption: IViewOptions = {
      style: {
        stripedRows: true,
        rowColor: {
          mode: 'selectField',
          selectField: {
            fieldId: 'fldStatus',
            enabledChoiceIds: ['choOpen'],
            strategy: 'firstMatched',
          },
        },
      },
    };

    expect(validateOptionsType(ViewType.Grid, gridOption)).toBeUndefined();
    expect(viewOptionsSchema.parse(gridOption)).toEqual(gridOption);
  });

  test('should reject unknown grid style options', () => {
    expect(() =>
      validateOptionsType(ViewType.Grid, {
        style: {
          stripedRows: true,
          unknown: true,
        },
      } as IViewOptions)
    ).toThrow();
  });

  test('should parse ordered row color rules', () => {
    const gridOption: IViewOptions = {
      style: {
        rowColor: {
          mode: 'rules',
          rules: [
            {
              id: 'rule-blocked',
              enabled: true,
              color: 'redBright',
              target: 'row',
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: 'fldStatus', operator: 'is', value: 'Blocked' }],
              },
            },
          ],
        },
      },
    };

    expect(validateOptionsType(ViewType.Grid, gridOption)).toBeUndefined();
    expect(viewOptionsSchema.parse(gridOption)).toEqual(gridOption);
  });

  test('should limit row color rules to 20', () => {
    expect(() =>
      validateOptionsType(ViewType.Grid, {
        style: {
          rowColor: {
            mode: 'rules',
            rules: Array.from({ length: 21 }, (_, index) => ({
              id: `rule-${index}`,
              color: 'redBright',
              filter: null,
            })),
          },
        },
      })
    ).toThrow();
  });
});
