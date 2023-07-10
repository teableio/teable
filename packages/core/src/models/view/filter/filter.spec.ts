import { filter } from './filter';

describe('Filter Parse', () => {
  it('should parse single filter', async () => {
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
              fieldId: 'fldXPZs9lFMvAIo2E',
              operator: 'contains',
              value: '1',
            },
            {
              fieldId: 'fldXPZs9lFMvAIo2E',
              operator: 'doesNotContain',
              value: '2',
            },
          ],
          conjunction: 'and',
        },
      ],
      conjunction: 'and',
    };

    const parse = filter.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse a group filter', async () => {
    const data = {
      filterSet: [
        {
          filterSet: [
            {
              fieldId: 'fldbbM45OO5VOWuce4r',
              operator: 'contains',
              value: '1',
            },
          ],
          conjunction: 'or',
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
      conjunction: 'or',
    };

    const parse = filter.parse(data);
    expect(parse).toEqual(data);
  });
});
