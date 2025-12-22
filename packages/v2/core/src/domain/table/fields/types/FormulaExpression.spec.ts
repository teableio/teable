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
    expect(idResult.isOk()).toBe(true);
    if (idResult.isErr()) return;

    const expression = FormulaExpression.create(`{${idResult.value.toString()}} + 1`);
    expect(expression.isOk()).toBe(true);
    if (expression.isErr()) return;

    const refsResult = expression.value.getReferencedFieldIds();
    expect(refsResult.isOk()).toBe(true);
    if (refsResult.isErr()) return;
    expect(refsResult.value.map((id) => id.toString())).toEqual([idResult.value.toString()]);
  });

  it('rejects invalid referenced field ids', () => {
    const expression = FormulaExpression.create('{badField} + 1');
    expect(expression.isOk()).toBe(true);
    if (expression.isErr()) return;

    const refsResult = expression.value.getReferencedFieldIds();
    expect(refsResult.isErr()).toBe(true);
  });

  it('infers value types from dependencies', () => {
    const idResult = createFieldId('b');
    expect(idResult.isOk()).toBe(true);
    if (idResult.isErr()) return;
    const fieldId = idResult.value;

    const numberExpression = FormulaExpression.create(`{${fieldId.toString()}} + 1`);
    expect(numberExpression.isOk()).toBe(true);
    if (numberExpression.isErr()) return;

    const numberResult = numberExpression.value.getParsedValueType([
      {
        id: fieldId,
        valueType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      },
    ]);
    expect(numberResult.isOk()).toBe(true);
    if (numberResult.isErr()) return;
    expect(numberResult.value.cellValueType.equals(CellValueType.number())).toBe(true);
    expect(numberResult.value.isMultipleCellValue.equals(CellValueMultiplicity.single())).toBe(
      true
    );

    const stringExpression = FormulaExpression.create(
      `CONCATENATE("Score: ", {${fieldId.toString()}})`
    );
    expect(stringExpression.isOk()).toBe(true);
    if (stringExpression.isErr()) return;

    const stringResult = stringExpression.value.getParsedValueType([
      {
        id: fieldId,
        valueType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      },
    ]);
    expect(stringResult.isOk()).toBe(true);
    if (stringResult.isErr()) return;
    expect(stringResult.value.cellValueType.equals(CellValueType.string())).toBe(true);
    expect(stringResult.value.isMultipleCellValue.equals(CellValueMultiplicity.single())).toBe(
      true
    );
  });
});
