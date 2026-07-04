import {
  CellValueMultiplicity,
  CellValueType,
  createFormulaField,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaMeta,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { isPersistedAsGeneratedColumn } from './isPersistedAsGeneratedColumn';

const createFormula = (persistedAsGeneratedColumn?: boolean) => {
  const meta =
    persistedAsGeneratedColumn === undefined
      ? undefined
      : FormulaMeta.rehydrate({ persistedAsGeneratedColumn })._unsafeUnwrap();

  return createFormulaField({
    id: FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Formula')._unsafeUnwrap(),
    expression: FormulaExpression.create('1 + 1')._unsafeUnwrap(),
    ...(meta ? { meta } : {}),
    resultType: {
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    },
  })._unsafeUnwrap();
};

describe('isPersistedAsGeneratedColumn', () => {
  it('respects formula generated-column metadata', () => {
    expect(isPersistedAsGeneratedColumn(createFormula(true))._unsafeUnwrap()).toBe(true);
    expect(isPersistedAsGeneratedColumn(createFormula(false))._unsafeUnwrap()).toBe(false);
    expect(isPersistedAsGeneratedColumn(createFormula())._unsafeUnwrap()).toBe(false);
  });
});
