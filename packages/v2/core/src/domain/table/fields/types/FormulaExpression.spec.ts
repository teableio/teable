import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { FormulaExpression } from './FormulaExpression';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('FormulaExpression', () => {
  it('validates expression input', () => {
    FormulaExpression.create('1 + 1')._unsafeUnwrap();
    FormulaExpression.create(123)._unsafeUnwrapErr();
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
    refsResult._unsafeUnwrapErr();
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
