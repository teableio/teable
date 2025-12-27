import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { FormulaExpression } from './fields/types/FormulaExpression';
import { FieldValueTypeVisitor } from './fields/visitors/FieldValueTypeVisitor';
import { Table } from './Table';
import { TableName } from './TableName';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('resolveFormulaFields', () => {
  it('resolves dependencies and infers formula types', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const tableNameResult = TableName.create('Metrics');
    const amountIdResult = createFieldId('a');
    const scoreIdResult = createFieldId('b');
    const labelIdResult = createFieldId('c');
    const amountNameResult = FieldName.create('Amount');
    const scoreNameResult = FieldName.create('Score');
    const labelNameResult = FieldName.create('Score Label');

    [
      baseIdResult,
      tableNameResult,
      amountIdResult,
      scoreIdResult,
      labelIdResult,
      amountNameResult,
      scoreNameResult,
      labelNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    amountIdResult._unsafeUnwrap();
    scoreIdResult._unsafeUnwrap();
    labelIdResult._unsafeUnwrap();
    amountNameResult._unsafeUnwrap();
    scoreNameResult._unsafeUnwrap();
    labelNameResult._unsafeUnwrap();

    const amountId = amountIdResult._unsafeUnwrap();
    const scoreId = scoreIdResult._unsafeUnwrap();
    const labelId = labelIdResult._unsafeUnwrap();

    const scoreExpression = FormulaExpression.create(`{${amountId.toString()}} * 2`);
    const labelExpression = FormulaExpression.create(
      `CONCATENATE("Score: ", {${scoreId.toString()}})`
    );
    [scoreExpression, labelExpression].forEach((r) => r._unsafeUnwrap());
    scoreExpression._unsafeUnwrap();
    labelExpression._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().number().withId(amountId).withName(amountNameResult._unsafeUnwrap()).done();
    builder
      .field()
      .formula()
      .withId(scoreId)
      .withName(scoreNameResult._unsafeUnwrap())
      .withExpression(scoreExpression.value)
      .done();
    builder
      .field()
      .formula()
      .withId(labelId)
      .withName(labelNameResult._unsafeUnwrap())
      .withExpression(labelExpression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    tableResult._unsafeUnwrap();

    const table = tableResult._unsafeUnwrap();

    const byId = new Map(table.fields().map((field) => [field.id().toString(), field] as const));
    const amountField = byId.get(amountId.toString());
    const scoreField = byId.get(scoreId.toString());
    const labelField = byId.get(labelId.toString());
    expect(amountField).toBeTruthy();
    expect(scoreField).toBeTruthy();
    expect(labelField).toBeTruthy();
    if (!amountField || !scoreField || !labelField) return;

    expect(scoreField.dependencies().map((id) => id.toString())).toEqual([amountId.toString()]);
    expect(labelField.dependencies().map((id) => id.toString())).toEqual([scoreId.toString()]);
    expect(amountField.dependents().map((id) => id.toString())).toEqual([scoreId.toString()]);
    expect(scoreField.dependents().map((id) => id.toString())).toEqual([labelId.toString()]);

    const visitor = new FieldValueTypeVisitor();
    const scoreType = scoreField.accept(visitor);
    scoreType._unsafeUnwrap();

    expect(scoreType.value.cellValueType.toString()).toBe('number');

    const labelType = labelField.accept(visitor);
    labelType._unsafeUnwrap();

    expect(labelType.value.cellValueType.toString()).toBe('string');
  });

  it('detects dependency cycles', () => {
    const baseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const tableNameResult = TableName.create('Cycles');
    const aIdResult = createFieldId('d');
    const bIdResult = createFieldId('e');
    const aNameResult = FieldName.create('A');
    const bNameResult = FieldName.create('B');
    const primaryNameResult = FieldName.create('Name');

    [
      baseIdResult,
      tableNameResult,
      aIdResult,
      bIdResult,
      aNameResult,
      bNameResult,
      primaryNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    aIdResult._unsafeUnwrap();
    bIdResult._unsafeUnwrap();
    aNameResult._unsafeUnwrap();
    bNameResult._unsafeUnwrap();
    primaryNameResult._unsafeUnwrap();

    const aId = aIdResult._unsafeUnwrap();
    const bId = bIdResult._unsafeUnwrap();
    const exprA = FormulaExpression.create(`{${bId.toString()}} + 1`);
    const exprB = FormulaExpression.create(`{${aId.toString()}} + 1`);
    [exprA, exprB].forEach((r) => r._unsafeUnwrap());
    exprA._unsafeUnwrap();
    exprB._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(primaryNameResult._unsafeUnwrap()).done();
    builder
      .field()
      .formula()
      .withId(aId)
      .withName(aNameResult._unsafeUnwrap())
      .withExpression(exprA.value)
      .done();
    builder
      .field()
      .formula()
      .withId(bId)
      .withName(bNameResult._unsafeUnwrap())
      .withExpression(exprB.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    tableResult._unsafeUnwrapErr();
    expect(tableResult._unsafeUnwrapErr()).toContain('Formula field dependency cycle detected');
  });

  it('returns errors for invalid formula references', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const tableNameResult = TableName.create('Bad refs');
    const formulaIdResult = createFieldId('f');
    const nameFieldResult = FieldName.create('Name');
    const formulaNameResult = FieldName.create('Broken');

    [baseIdResult, tableNameResult, formulaIdResult, nameFieldResult, formulaNameResult].forEach(
      (r) => r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    formulaIdResult._unsafeUnwrap();
    nameFieldResult._unsafeUnwrap();
    formulaNameResult._unsafeUnwrap();

    const expression = FormulaExpression.create('{badField} + 1');
    expression._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(nameFieldResult._unsafeUnwrap()).done();
    builder
      .field()
      .formula()
      .withId(formulaIdResult._unsafeUnwrap())
      .withName(formulaNameResult._unsafeUnwrap())
      .withExpression(expression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    tableResult._unsafeUnwrapErr();
    expect(tableResult._unsafeUnwrapErr()).toContain('Formula references not found');
  });

  it('returns errors for missing referenced fields', () => {
    const baseIdResult = BaseId.create(`bse${'d'.repeat(16)}`);
    const tableNameResult = TableName.create('Missing refs');
    const formulaIdResult = createFieldId('g');
    const missingIdResult = createFieldId('h');
    const nameFieldResult = FieldName.create('Name');
    const formulaNameResult = FieldName.create('Depends');

    [
      baseIdResult,
      tableNameResult,
      formulaIdResult,
      missingIdResult,
      nameFieldResult,
      formulaNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    formulaIdResult._unsafeUnwrap();
    missingIdResult._unsafeUnwrap();
    nameFieldResult._unsafeUnwrap();
    formulaNameResult._unsafeUnwrap();

    const missingId = missingIdResult._unsafeUnwrap();
    const expression = FormulaExpression.create(`{${missingId.toString()}} + 1`);
    expression._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(nameFieldResult._unsafeUnwrap()).done();
    builder
      .field()
      .formula()
      .withId(formulaIdResult._unsafeUnwrap())
      .withName(formulaNameResult._unsafeUnwrap())
      .withExpression(expression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    tableResult._unsafeUnwrapErr();
    expect(tableResult._unsafeUnwrapErr()).toContain(missingId.toString());
  });

  it('returns errors for formula type inference failures', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const tableNameResult = TableName.create('Type errors');
    const formulaIdResult = createFieldId('i');
    const nameFieldResult = FieldName.create('Name');
    const formulaNameResult = FieldName.create('Unknown function');

    [baseIdResult, tableNameResult, formulaIdResult, nameFieldResult, formulaNameResult].forEach(
      (r) => r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    formulaIdResult._unsafeUnwrap();
    nameFieldResult._unsafeUnwrap();
    formulaNameResult._unsafeUnwrap();

    const expression = FormulaExpression.create('UNKNOWN()');
    expression._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(nameFieldResult._unsafeUnwrap()).done();
    builder
      .field()
      .formula()
      .withId(formulaIdResult._unsafeUnwrap())
      .withName(formulaNameResult._unsafeUnwrap())
      .withExpression(expression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    tableResult._unsafeUnwrapErr();
    expect(tableResult._unsafeUnwrapErr()).toContain('Parse formula expression');
  });
});
