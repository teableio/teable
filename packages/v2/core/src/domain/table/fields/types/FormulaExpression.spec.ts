import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { FormulaExpression } from './FormulaExpression';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('FormulaExpression', () => {
  it('validates expression input', () => {
    expect(FormulaExpression.create('1 + 1').isOk()).toBe(true);
    expect(FormulaExpression.create(123).isErr()).toBe(true);
  });

  it('extracts referenced field ids', () => {
    const idResult = createFieldId('a');
    idResult._unsafeUnwrap();

    const expression = FormulaExpression.create(`{${idResult._unsafeUnwrap().toString()}} + 1`);
    const expressionValue = expression._unsafeUnwrap();
    const refsResult = expressionValue.getReferencedFieldIds();
    refsResult._unsafeUnwrap();

    expect(refsResult._unsafeUnwrap().map((id) => id.toString())).toEqual([
      idResult._unsafeUnwrap().toString(),
    ]);
  });

  it('rejects invalid referenced field ids', () => {
    const expression = FormulaExpression.create('{badField} + 1');
    const expressionValue = expression._unsafeUnwrap();
    const refsResult = expressionValue.getReferencedFieldIds();
    expect(refsResult.isErr()).toBe(true);
  });

  it('extracts exact alias identifiers in first-occurrence order without field-id validation', () => {
    const expression = FormulaExpression.create(
      'CONCATENATE({ Score }, {score}, {Score}, "{notAReference}")'
    )._unsafeUnwrap();

    expect(expression.getReferencedIdentifiers()._unsafeUnwrap()).toEqual(['Score', 'score']);
    expect(expression.getReferencedFieldIds()._unsafeUnwrapErr().message).toContain(
      'Formula references not found: Score, score.'
    );
  });

  it('preserves stored field-id formats when extracting validated references', () => {
    const expression = FormulaExpression.create('{fldA_2} + {fldA_2}')._unsafeUnwrap();

    expect(expression.getReferencedIdentifiers()._unsafeUnwrap()).toEqual(['fldA_2']);
    expect(expression.getReferencedFieldIds()._unsafeUnwrap().map(String)).toEqual(['fldA_2']);
  });

  it.each(['1 + @ 2', '{score} + @ 1', '"unterminated', '1 +'])(
    'rejects lexical and syntax errors through every parser consumer: %s',
    (source) => {
      const expression = FormulaExpression.create(source)._unsafeUnwrap();

      expect(expression.getReferencedIdentifiers().isErr()).toBe(true);
      expect(expression.getReferencedFieldIds().isErr()).toBe(true);
      expect(expression.hasLastModifiedTimeParams().isErr()).toBe(true);
      expect(expression.getParsedValueType([]).isErr()).toBe(true);
    }
  );

  it.each([
    CellValueType.string(),
    CellValueType.number(),
    CellValueType.boolean(),
    CellValueType.dateTime(),
  ])('retains domain type and multiplicity for an alias dependency', (cellValueType) => {
    const expression = FormulaExpression.create('{value}')._unsafeUnwrap();
    const isMultipleCellValue = CellValueMultiplicity.multiple();
    const inferred = expression
      .getParsedValueType([{ id: 'value', valueType: { cellValueType, isMultipleCellValue } }])
      ._unsafeUnwrap();

    expect(inferred.cellValueType.equals(cellValueType)).toBe(true);
    expect(inferred.isMultipleCellValue.equals(isMultipleCellValue)).toBe(true);
  });

  it('infers mixed alias and stored field-id dependencies through the same visitor', () => {
    const id = createFieldId('c')._unsafeUnwrap();
    const expression = FormulaExpression.create(`{${id.toString()}} > {threshold}`)._unsafeUnwrap();
    const valueType = {
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    };
    const inferred = expression
      .getParsedValueType([
        { id, valueType },
        { id: 'threshold', valueType },
      ])
      ._unsafeUnwrap();

    expect(inferred.cellValueType.equals(CellValueType.boolean())).toBe(true);
    expect(inferred.isMultipleCellValue.equals(CellValueMultiplicity.single())).toBe(true);
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'requires explicit dependency metadata even for object property names: %s',
    (id) => {
      const expression = FormulaExpression.create(`{${id}}`)._unsafeUnwrap();
      expect(expression.getParsedValueType([]).isErr()).toBe(true);

      const inferred = expression
        .getParsedValueType([
          {
            id,
            valueType: {
              cellValueType: CellValueType.number(),
              isMultipleCellValue: CellValueMultiplicity.single(),
            },
          },
        ])
        ._unsafeUnwrap();
      expect(inferred.cellValueType.equals(CellValueType.number())).toBe(true);
    }
  );

  it.each([
    ['ARRAYJOIN', 'ARRAY_JOIN'],
    ['ARRAYUNIQUE', 'ARRAY_UNIQUE'],
    ['ARRAYFLATTEN', 'ARRAY_FLATTEN'],
    ['ARRAYCOMPACT', 'ARRAY_COMPACT'],
  ])('shares canonical type inference for %s and %s', (alias, canonical) => {
    const dependencies = [
      {
        id: 'values',
        valueType: {
          cellValueType: CellValueType.string(),
          isMultipleCellValue: CellValueMultiplicity.multiple(),
        },
      },
    ];
    const infer = (name: string) =>
      FormulaExpression.create(`${name}({values})`)
        ._unsafeUnwrap()
        .getParsedValueType(dependencies)
        ._unsafeUnwrap();
    const aliasType = infer(alias);
    const canonicalType = infer(canonical);

    expect(aliasType.cellValueType.equals(canonicalType.cellValueType)).toBe(true);
    expect(aliasType.isMultipleCellValue.equals(canonicalType.isMultipleCellValue)).toBe(true);
  });

  it('infers value types from dependencies', () => {
    const idResult = createFieldId('b');
    idResult._unsafeUnwrap();

    const fieldId = idResult._unsafeUnwrap();

    const numberExpression = FormulaExpression.create(`{${fieldId.toString()}} + 1`);
    const numberExpressionValue = numberExpression._unsafeUnwrap();
    const numberResult = numberExpressionValue.getParsedValueType([
      {
        id: fieldId,
        valueType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      },
    ]);
    numberResult._unsafeUnwrap();

    expect(numberResult._unsafeUnwrap().cellValueType.equals(CellValueType.number())).toBe(true);
    expect(
      numberResult._unsafeUnwrap().isMultipleCellValue.equals(CellValueMultiplicity.single())
    ).toBe(true);

    const stringExpression = FormulaExpression.create(
      `CONCATENATE("Score: ", {${fieldId.toString()}})`
    );
    const stringExpressionValue = stringExpression._unsafeUnwrap();
    const stringResult = stringExpressionValue.getParsedValueType([
      {
        id: fieldId,
        valueType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      },
    ]);
    stringResult._unsafeUnwrap();

    expect(stringResult._unsafeUnwrap().cellValueType.equals(CellValueType.string())).toBe(true);
    expect(
      stringResult._unsafeUnwrap().isMultipleCellValue.equals(CellValueMultiplicity.single())
    ).toBe(true);
  });
});
