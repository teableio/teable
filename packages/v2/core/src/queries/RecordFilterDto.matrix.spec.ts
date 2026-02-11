import { describe, expect, it } from 'vitest';

import {
  recordFilterConditionSchema,
  recordFilterOperatorSchema,
  recordFilterOperatorsExpectingArray,
  recordFilterOperatorsExpectingNull,
  type RecordFilterOperator,
} from './RecordFilterDto';

type MatrixValueCaseName =
  | 'missing'
  | 'null'
  | 'literalString'
  | 'literalNumber'
  | 'literalBoolean'
  | 'literalList'
  | 'dateValue'
  | 'fieldReference';

type MatrixValueCase = {
  name: MatrixValueCaseName;
  build: (operator: RecordFilterOperator) => Record<string, unknown>;
};

const valueCases: ReadonlyArray<MatrixValueCase> = [
  {
    name: 'missing',
    build: (operator) => ({ fieldId: 'fld123', operator }),
  },
  {
    name: 'null',
    build: (operator) => ({ fieldId: 'fld123', operator, value: null }),
  },
  {
    name: 'literalString',
    build: (operator) => ({ fieldId: 'fld123', operator, value: 'open' }),
  },
  {
    name: 'literalNumber',
    build: (operator) => ({ fieldId: 'fld123', operator, value: 42 }),
  },
  {
    name: 'literalBoolean',
    build: (operator) => ({ fieldId: 'fld123', operator, value: true }),
  },
  {
    name: 'literalList',
    build: (operator) => ({ fieldId: 'fld123', operator, value: ['open', 'closed'] }),
  },
  {
    name: 'dateValue',
    build: (operator) => ({
      fieldId: 'fld123',
      operator,
      value: {
        mode: 'exactDate',
        exactDate: '2025-01-01T00:00:00.000Z',
        timeZone: 'utc',
      },
    }),
  },
  {
    name: 'fieldReference',
    build: (operator) => ({
      fieldId: 'fld123',
      operator,
      value: { type: 'field', fieldId: 'fld456' },
    }),
  },
];

describe('RecordFilterDto matrix', () => {
  const allOperators = recordFilterOperatorSchema.options;
  const nullOperators = new Set(recordFilterOperatorsExpectingNull);
  const arrayOperators = new Set(recordFilterOperatorsExpectingArray);
  const noValueCases = new Set<MatrixValueCaseName>(['missing', 'null']);

  const expectedResult = (operator: RecordFilterOperator, valueCaseName: MatrixValueCaseName) => {
    const hasValue = !noValueCases.has(valueCaseName);

    if (nullOperators.has(operator)) {
      return !hasValue;
    }

    if (!hasValue) {
      return false;
    }

    if (arrayOperators.has(operator)) {
      return valueCaseName === 'literalList' || valueCaseName === 'fieldReference';
    }

    return valueCaseName !== 'literalList';
  };

  const matrix = allOperators.flatMap((operator) =>
    valueCases.map((valueCase) => ({
      operator,
      valueCase,
    }))
  );

  it.each(matrix)('operator=$operator value=$valueCase.name', ({ operator, valueCase }) => {
    const input = valueCase.build(operator);
    const parsed = recordFilterConditionSchema.safeParse(input);
    const expected = expectedResult(operator, valueCase.name);

    expect(parsed.success).toBe(expected);

    if (parsed.success && nullOperators.has(operator) && valueCase.name === 'missing') {
      expect(parsed.data.value).toBeNull();
    }
  });

  it('matches operator-value matrix snapshot', () => {
    const report = allOperators.map((operator) => {
      const mask = valueCases
        .map((valueCase) => {
          const parsed = recordFilterConditionSchema.safeParse(valueCase.build(operator));
          return parsed.success ? 'Y' : 'N';
        })
        .join('');

      return `${operator}:${mask}`;
    });

    expect({
      legend: valueCases.map((valueCase) => valueCase.name),
      report,
    }).toMatchSnapshot();
  });
});
