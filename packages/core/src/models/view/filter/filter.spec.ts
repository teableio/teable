import type { IFilter } from './filter';
import { filterSchema } from './filter';

describe('Filter Parse', () => {
  it('should parse single filter', async () => {
    const data: IFilter = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'contains',
          value: '1',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse a nested filter', async () => {
    const data: IFilter = {
      filterSet: [
        {
          filterSet: [
            {
              fieldId: 'fldbbM45OO5VOWuce4r',
              operator: 'contains',
              value: '2',
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'or',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse a multi nested filter', async () => {
    const data: IFilter = {
      filterSet: [
        {
          filterSet: [
            {
              filterSet: [
                {
                  fieldId: 'fldbbM45OO5VOWuce4r',
                  operator: 'contains',
                  value: '2',
                },
              ],
              conjunction: 'and',
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse a mix filter', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'contains',
          value: '1',
        },
        {
          filterSet: [
            {
              fieldId: 'fldbbM45OO5VOWuce4r',
              operator: 'contains',
              value: '2',
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });
});
