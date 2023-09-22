/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseTQL } from './json.visitor';

describe('JsonVisitor', () => {
  const mockFilterData = (value: any = null, operator = '=') => {
    return {
      isSymbol: true,
      fieldId: 'field',
      operator: operator,
      value: value,
    };
  };
  const mockData = (
    value: {
      s?: string;
      sArray?: string[];
      n?: number;
      nArray?: number[];
      b?: boolean;
      bArray?: boolean[];
    }[],
    operator = '=',
    conjunction = 'and'
  ) => {
    const filterSet: any[] = [];

    value.forEach((value1) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const [_, v] of Object.entries(value1)) {
        filterSet.push(mockFilterData(v, operator));
      }
    });

    return {
      filterSet: filterSet,
      conjunction: conjunction,
    };
  };

  describe('{field} [operators] value', () => {
    it('should operator `=`', () => {
      expect(parseTQL(`{field} = '1'`)).toStrictEqual(
        expect.objectContaining({
          filterSet: [
            expect.objectContaining({
              isSymbol: true,
              operator: '=',
              value: '1',
            }),
          ],
          conjunction: 'and',
        })
      );
    });

    it('should operator `!=`', () => {
      expect(parseTQL(`{field} != '1'`)).toStrictEqual(
        expect.objectContaining({
          filterSet: [
            expect.objectContaining({
              operator: '!=',
              value: '1',
            }),
          ],
          conjunction: 'and',
        })
      );
      expect(parseTQL(`{field} <> '1'`)).toStrictEqual(
        expect.objectContaining({
          filterSet: [
            expect.objectContaining({
              isSymbol: true,
              operator: '!=',
              value: '1',
            }),
          ],
          conjunction: 'and',
        })
      );
    });

    it('should operator `>`', () => {
      expect(parseTQL(`{field} > 1`)).toStrictEqual(
        expect.objectContaining({
          filterSet: [
            expect.objectContaining({
              isSymbol: true,
              operator: '>',
              value: 1,
            }),
          ],
          conjunction: 'and',
        })
      );
    });

    it('should operator `>=`', () => {
      expect(parseTQL(`{field} >= 1`)).toStrictEqual(
        expect.objectContaining({
          filterSet: [
            expect.objectContaining({
              isSymbol: true,
              operator: '>=',
              value: 1,
            }),
          ],
          conjunction: 'and',
        })
      );
    });

    it('should operator `<`', () => {
      expect(parseTQL(`{field} < 1`)).toStrictEqual(
        expect.objectContaining({
          filterSet: [
            expect.objectContaining({
              isSymbol: true,
              operator: '<',
              value: 1,
            }),
          ],
          conjunction: 'and',
        })
      );
    });

    it('should operator `<=`', () => {
      expect(parseTQL(`{field} <= 1`)).toStrictEqual(
        expect.objectContaining({
          filterSet: [
            expect.objectContaining({
              isSymbol: true,
              operator: '<=',
              value: 1,
            }),
          ],
          conjunction: 'and',
        })
      );
    });

    it('should operator `LIKE`', () => {
      const expected = expect.objectContaining({
        filterSet: [
          expect.objectContaining({
            isSymbol: true,
            operator: 'LIKE',
            value: '1%',
          }),
        ],
        conjunction: 'and',
      });

      expect(parseTQL(`{field} LIKE '1%'`)).toStrictEqual(expected);
      expect(parseTQL(`{field} like '1%'`)).toStrictEqual(expected);
    });

    it('should operator `NOT LIKE`', () => {
      const expected = expect.objectContaining({
        filterSet: [
          expect.objectContaining({
            isSymbol: true,
            operator: 'NOT LIKE',
            value: '1%',
          }),
        ],
        conjunction: 'and',
      });

      expect(parseTQL(`{field} NOT LIKE '1%'`)).toStrictEqual(expected);
      expect(parseTQL(`{field} not like '1%'`)).toStrictEqual(expected);
    });

    it('should operator `IN`', () => {
      const expected = expect.objectContaining({
        filterSet: [
          expect.objectContaining({
            isSymbol: true,
            operator: 'IN',
            value: [1, 'a', 3.6, true, null],
          }),
        ],
        conjunction: 'and',
      });

      expect(parseTQL(`{field} IN (1,'a', 3.6, true,null)`)).toStrictEqual(expected);
      expect(parseTQL(`{field} in (1, 'a', 3.6, true, null)`)).toStrictEqual(expected);
    });

    it('should operator `NOT IN`', () => {
      const expected = expect.objectContaining({
        filterSet: [
          expect.objectContaining({
            isSymbol: true,
            operator: 'NOT IN',
            value: [1],
          }),
        ],
        conjunction: 'and',
      });

      expect(parseTQL(`{field} NOT IN (1)`)).toStrictEqual(expected);
      expect(parseTQL(`{field} not In (1)`)).toStrictEqual(expected);
    });

    it('should operator `HAS`', () => {
      const expected = expect.objectContaining({
        filterSet: [
          expect.objectContaining({
            isSymbol: true,
            operator: 'HAS',
            value: [2],
          }),
        ],
        conjunction: 'and',
      });

      expect(parseTQL(`{field} HAS (2)`)).toStrictEqual(expected);
      expect(parseTQL(`{field} has (2)`)).toStrictEqual(expected);
    });

    it('should operator `IS NULL`', () => {
      const expected = expect.objectContaining({
        filterSet: [
          expect.objectContaining({
            isSymbol: true,
            operator: 'IS NULL',
          }),
        ],
        conjunction: 'and',
      });

      expect(parseTQL(`{field} IS NULL`)).toStrictEqual(expected);
      expect(parseTQL(`{field} is null`)).toStrictEqual(expected);
    });

    it('should operator `IS NOT NULL`', () => {
      const expected = expect.objectContaining({
        filterSet: [
          expect.objectContaining({
            isSymbol: true,
            operator: 'IS NOT NULL',
          }),
        ],
        conjunction: 'and',
      });

      expect(parseTQL(`{field} IS NOT NULL`)).toStrictEqual(expected);
      expect(parseTQL(`{field} is not NUll`)).toStrictEqual(expected);
    });
  });

  it('{field} = string', () => {
    expect(parseTQL(`{field} = '1'`)).toStrictEqual(mockData([{ s: '1' }]));
    expect(parseTQL(`{field} = 'abc'`)).toStrictEqual(mockData([{ s: 'abc' }]));

    expect(parseTQL(`{field} IN ('a','b', 'c')`)).toStrictEqual(
      mockData([{ sArray: ['a', 'b', 'c'] }], 'IN')
    );

    expect(parseTQL(`{field} NOT IN ('a','b', 'c')`)).toStrictEqual(
      mockData([{ sArray: ['a', 'b', 'c'] }], 'NOT IN')
    );
  });

  it('{field} = number', () => {
    expect(parseTQL(`{field} = 1`)).toStrictEqual(mockData([{ n: 1 }]));
    expect(parseTQL(`{field} = 1.1`)).toStrictEqual(mockData([{ n: 1.1 }]));

    expect(parseTQL(`{field} IN (2)`)).toStrictEqual(mockData([{ nArray: [2] }], 'IN'));
    expect(parseTQL(`{field} IN (2.2)`)).toStrictEqual(mockData([{ nArray: [2.2] }], 'IN'));

    expect(parseTQL(`{field} NOT IN (3,4)`)).toStrictEqual(
      mockData([{ nArray: [3, 4] }], 'NOT IN')
    );
    expect(parseTQL(`{field} NOT IN (3.3, 4.4)`)).toStrictEqual(
      mockData([{ nArray: [3.3, 4.4] }], 'NOT IN')
    );
  });

  it('{field} = boolean', () => {
    expect(parseTQL(`{field} = true`)).toStrictEqual(mockData([{ b: true }]));
    expect(parseTQL(`{field} = false`)).toStrictEqual(mockData([{ b: false }]));

    expect(parseTQL(`{field} IN (true, false)`)).toStrictEqual(
      mockData([{ bArray: [true, false] }], 'IN')
    );
  });

  it('{field} = any AND {field} = any', () => {
    expect(parseTQL(`{field} = '1' AND {field} = '2'`)).toStrictEqual(
      mockData([{ s: '1' }, { s: '2' }])
    );

    expect(parseTQL(`{field} = 3 AND {field} = '4'`)).toStrictEqual(
      mockData([{ n: 3 }, { s: '4' }])
    );

    expect(parseTQL(`{field} = 5.5 AND {field} = true`)).toStrictEqual(
      mockData([{ n: 5.5 }, { b: true }])
    );

    expect(parseTQL(`{field} IN ('a','b') AND {field} IN (1, 2.2)`)).toStrictEqual(
      mockData([{ sArray: ['a', 'b'] }, { nArray: [1, 2.2] }], 'IN')
    );
  });

  it('{field} = any AND {field} = any OR {field} = any', () => {
    const data = {
      filterSet: [
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 1,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 2,
            },
          ],
          conjunction: 'and',
        },
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 3,
        },
      ],
      conjunction: 'or',
    };

    expect(parseTQL('{field} = 1 AND {field} = 2 OR {field} = 3')).toStrictEqual(data);

    expect(parseTQL('({field} = 1 AND {field} = 2) OR {field} = 3')).toStrictEqual(data);

    expect(parseTQL('({field} = 1 AND {field} = 2) OR ({field} = 3)')).toStrictEqual(data);
  });

  it('({field} = any AND {field} = any) OR ({field} = any AND {field} = any)', () => {
    const data = {
      filterSet: [
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 1,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 2,
            },
          ],
          conjunction: 'and',
        },
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 3,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 4,
            },
          ],
          conjunction: 'and',
        },
      ],
      conjunction: 'or',
    };

    expect(
      parseTQL('({field} = 1 AND {field} = 2) OR ({field} = 3 AND {field} = 4)')
    ).toStrictEqual(data);
  });

  it('({field} = any AND {field} = any) OR ({field} = any OR {field} = any)', () => {
    const data = {
      filterSet: [
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 1,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 2,
            },
          ],
          conjunction: 'and',
        },
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 3,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 4,
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'or',
    };

    expect(parseTQL('({field} = 1 AND {field} = 2) OR ({field} = 3 OR {field} = 4)')).toStrictEqual(
      data
    );
  });

  it('({field} = any OR {field} = any) OR ({field} = any OR {field} = any)', () => {
    const data = {
      filterSet: [
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 1,
        },
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 2,
        },
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 3,
        },
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 4,
        },
      ],
      conjunction: 'or',
    };

    expect(parseTQL('({field} = 1 OR {field} = 2) OR ({field} = 3 OR {field} = 4)')).toStrictEqual(
      data
    );
  });

  it('({field} = any OR {field} = any) AND ({field} = any OR {field} = any)', () => {
    const data = {
      filterSet: [
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 1,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 2,
            },
          ],
          conjunction: 'or',
        },
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 3,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 4,
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'and',
    };

    expect(parseTQL('({field} = 1 OR {field} = 2) AND ({field} = 3 OR {field} = 4)')).toStrictEqual(
      data
    );
  });

  it('({field} = any OR {field} = any) AND ({field} = any AND {field} = any)', () => {
    const data = {
      filterSet: [
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 1,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 2,
            },
          ],
          conjunction: 'or',
        },
        {
          filterSet: [
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 3,
            },
            {
              isSymbol: true,
              fieldId: 'field',
              operator: '=',
              value: 4,
            },
          ],
          conjunction: 'and',
        },
      ],
      conjunction: 'and',
    };

    expect(
      parseTQL('({field} = 1 OR {field} = 2) AND ({field} = 3 AND {field} = 4)')
    ).toStrictEqual(data);
  });

  it('({field} = any AND {field} = any) AND ({field} = any AND {field} = any)', () => {
    const data = {
      filterSet: [
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 1,
        },
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 2,
        },
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 3,
        },
        {
          isSymbol: true,
          fieldId: 'field',
          operator: '=',
          value: 4,
        },
      ],
      conjunction: 'and',
    };

    expect(
      parseTQL('({field} = 1 AND {field} = 2) AND ({field} = 3 AND {field} = 4)')
    ).toStrictEqual(data);
  });
});
