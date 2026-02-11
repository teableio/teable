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

  it('should parse isNotEmpty without explicit value', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'isNotEmpty',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'isNotEmpty',
          value: null,
        },
      ],
    });
  });

  it('should parse is with null value for backward compatibility', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'is',
          value: null,
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse isNot with null value for backward compatibility', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'isNot',
          value: null,
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should reject non-unary operators without value', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'is',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.safeParse(data);
    expect(parse.success).toBe(false);
  });

  it('should reject null value for non-null operators', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'contains',
          value: null,
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.safeParse(data);
    expect(parse.success).toBe(false);
  });
});
