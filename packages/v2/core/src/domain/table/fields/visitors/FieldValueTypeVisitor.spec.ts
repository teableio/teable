import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import { FieldName } from '../FieldName';
import { CellValueMultiplicity } from '../types/CellValueMultiplicity';
import { CellValueType } from '../types/CellValueType';
import { FormulaExpression } from '../types/FormulaExpression';
import type { FormulaField } from '../types/FormulaField';
import { UserMultiplicity } from '../types/UserMultiplicity';
import { FieldValueTypeVisitor } from './FieldValueTypeVisitor';

describe('FieldValueTypeVisitor', () => {
  it('infers cell value types for all field kinds', () => {
    const baseIdResult = BaseId.create(`bse${'f'.repeat(16)}`);
    const tableNameResult = TableName.create('Visitor fields');
    const expressionResult = FormulaExpression.create('1 + 1');
    const names = [
      'Single',
      'Long',
      'Number',
      'Rating',
      'Formula',
      'SingleSelect',
      'MultipleSelect',
      'Checkbox',
      'Attachment',
      'Date',
      'User',
      'Button',
    ];
    const nameResults = names.map((name) => FieldName.create(name));

    expect(
      [baseIdResult, tableNameResult, expressionResult, ...nameResults].every((r) => r.isOk())
    ).toBe(true);
    if (baseIdResult.isErr() || tableNameResult.isErr() || expressionResult.isErr()) return;

    const nameValues: FieldName[] = [];
    for (const result of nameResults) {
      if (result.isErr()) return;
      nameValues.push(result.value);
    }

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);

    builder.field().singleLineText().withName(nameValues[0]).done();
    builder.field().longText().withName(nameValues[1]).done();
    builder.field().number().withName(nameValues[2]).done();
    builder.field().rating().withName(nameValues[3]).done();
    builder.field().formula().withName(nameValues[4]).withExpression(expressionResult.value).done();
    builder.field().singleSelect().withName(nameValues[5]).done();
    builder.field().multipleSelect().withName(nameValues[6]).done();
    builder.field().checkbox().withName(nameValues[7]).done();
    builder.field().attachment().withName(nameValues[8]).done();
    builder.field().date().withName(nameValues[9]).done();
    builder
      .field()
      .user()
      .withName(nameValues[10])
      .withMultiplicity(UserMultiplicity.multiple())
      .done();
    builder.field().button().withName(nameValues[11]).done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;

    const visitor = new FieldValueTypeVisitor();
    const byName = new Map(
      tableResult.value.fields().map((field) => [field.name().toString(), field])
    );
    const formulaField = byName.get('Formula') as FormulaField | undefined;
    if (formulaField) {
      const formulaResult = formulaField.setResultType(
        CellValueType.number(),
        CellValueMultiplicity.single()
      );
      expect(formulaResult.isOk()).toBe(true);
    }
    const expectations = [
      {
        name: 'Single',
        type: CellValueType.string(),
        multiplicity: CellValueMultiplicity.single(),
      },
      { name: 'Long', type: CellValueType.string(), multiplicity: CellValueMultiplicity.single() },
      {
        name: 'Number',
        type: CellValueType.number(),
        multiplicity: CellValueMultiplicity.single(),
      },
      {
        name: 'Rating',
        type: CellValueType.number(),
        multiplicity: CellValueMultiplicity.single(),
      },
      {
        name: 'Formula',
        type: CellValueType.number(),
        multiplicity: CellValueMultiplicity.single(),
      },
      {
        name: 'SingleSelect',
        type: CellValueType.string(),
        multiplicity: CellValueMultiplicity.single(),
      },
      {
        name: 'MultipleSelect',
        type: CellValueType.string(),
        multiplicity: CellValueMultiplicity.multiple(),
      },
      {
        name: 'Checkbox',
        type: CellValueType.boolean(),
        multiplicity: CellValueMultiplicity.single(),
      },
      {
        name: 'Attachment',
        type: CellValueType.string(),
        multiplicity: CellValueMultiplicity.multiple(),
      },
      {
        name: 'Date',
        type: CellValueType.dateTime(),
        multiplicity: CellValueMultiplicity.single(),
      },
      {
        name: 'User',
        type: CellValueType.string(),
        multiplicity: CellValueMultiplicity.multiple(),
      },
      {
        name: 'Button',
        type: CellValueType.string(),
        multiplicity: CellValueMultiplicity.single(),
      },
    ];

    for (const { name, type, multiplicity } of expectations) {
      const field = byName.get(name);
      expect(field).toBeTruthy();
      if (!field) continue;
      const result = field.accept(visitor);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) continue;
      expect(result.value.cellValueType.equals(type)).toBe(true);
      expect(result.value.isMultipleCellValue.equals(multiplicity)).toBe(true);
    }
  });
});
