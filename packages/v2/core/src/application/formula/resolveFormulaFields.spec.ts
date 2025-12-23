import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { FieldValueTypeVisitor } from '../../domain/table/fields/visitors/FieldValueTypeVisitor';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import { resolveFormulaFields } from './resolveFormulaFields';

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

    expect(
      [
        baseIdResult,
        tableNameResult,
        amountIdResult,
        scoreIdResult,
        labelIdResult,
        amountNameResult,
        scoreNameResult,
        labelNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      amountIdResult.isErr() ||
      scoreIdResult.isErr() ||
      labelIdResult.isErr() ||
      amountNameResult.isErr() ||
      scoreNameResult.isErr() ||
      labelNameResult.isErr()
    )
      return;

    const amountId = amountIdResult.value;
    const scoreId = scoreIdResult.value;
    const labelId = labelIdResult.value;

    const scoreExpression = FormulaExpression.create(`{${amountId.toString()}} * 2`);
    const labelExpression = FormulaExpression.create(
      `CONCATENATE("Score: ", {${scoreId.toString()}})`
    );
    expect([scoreExpression, labelExpression].every((r) => r.isOk())).toBe(true);
    if (scoreExpression.isErr() || labelExpression.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().number().withId(amountId).withName(amountNameResult.value).done();
    builder
      .field()
      .formula()
      .withId(scoreId)
      .withName(scoreNameResult.value)
      .withExpression(scoreExpression.value)
      .done();
    builder
      .field()
      .formula()
      .withId(labelId)
      .withName(labelNameResult.value)
      .withExpression(labelExpression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;
    const table = tableResult.value;

    const resolveResult = resolveFormulaFields(table);
    expect(resolveResult.isOk()).toBe(true);
    if (resolveResult.isErr()) return;

    const byId = new Map(table.fields().map((field) => [field.id().toString(), field]));
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
    expect(scoreType.isOk()).toBe(true);
    if (scoreType.isErr()) return;
    expect(scoreType.value.cellValueType.toString()).toBe('number');

    const labelType = labelField.accept(visitor);
    expect(labelType.isOk()).toBe(true);
    if (labelType.isErr()) return;
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

    expect(
      [
        baseIdResult,
        tableNameResult,
        aIdResult,
        bIdResult,
        aNameResult,
        bNameResult,
        primaryNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      aIdResult.isErr() ||
      bIdResult.isErr() ||
      aNameResult.isErr() ||
      bNameResult.isErr() ||
      primaryNameResult.isErr()
    )
      return;

    const aId = aIdResult.value;
    const bId = bIdResult.value;
    const exprA = FormulaExpression.create(`{${bId.toString()}} + 1`);
    const exprB = FormulaExpression.create(`{${aId.toString()}} + 1`);
    expect([exprA, exprB].every((r) => r.isOk())).toBe(true);
    if (exprA.isErr() || exprB.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(primaryNameResult.value).done();
    builder
      .field()
      .formula()
      .withId(aId)
      .withName(aNameResult.value)
      .withExpression(exprA.value)
      .done();
    builder
      .field()
      .formula()
      .withId(bId)
      .withName(bNameResult.value)
      .withExpression(exprB.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;

    const resolveResult = resolveFormulaFields(tableResult.value);
    expect(resolveResult.isErr()).toBe(true);
    if (resolveResult.isErr()) {
      expect(resolveResult.error).toContain('Formula field dependency cycle detected');
    }
  });

  it('returns errors for invalid formula references', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const tableNameResult = TableName.create('Bad refs');
    const formulaIdResult = createFieldId('f');
    const nameFieldResult = FieldName.create('Name');
    const formulaNameResult = FieldName.create('Broken');

    expect(
      [baseIdResult, tableNameResult, formulaIdResult, nameFieldResult, formulaNameResult].every(
        (r) => r.isOk()
      )
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      formulaIdResult.isErr() ||
      nameFieldResult.isErr() ||
      formulaNameResult.isErr()
    )
      return;

    const expression = FormulaExpression.create('{badField} + 1');
    expect(expression.isOk()).toBe(true);
    if (expression.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(nameFieldResult.value).done();
    builder
      .field()
      .formula()
      .withId(formulaIdResult.value)
      .withName(formulaNameResult.value)
      .withExpression(expression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;

    const resolveResult = resolveFormulaFields(tableResult.value);
    expect(resolveResult.isErr()).toBe(true);
    if (resolveResult.isErr()) {
      expect(resolveResult.error).toContain('Formula references not found');
    }
  });

  it('returns errors for missing referenced fields', () => {
    const baseIdResult = BaseId.create(`bse${'d'.repeat(16)}`);
    const tableNameResult = TableName.create('Missing refs');
    const formulaIdResult = createFieldId('g');
    const missingIdResult = createFieldId('h');
    const nameFieldResult = FieldName.create('Name');
    const formulaNameResult = FieldName.create('Depends');

    expect(
      [
        baseIdResult,
        tableNameResult,
        formulaIdResult,
        missingIdResult,
        nameFieldResult,
        formulaNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      formulaIdResult.isErr() ||
      missingIdResult.isErr() ||
      nameFieldResult.isErr() ||
      formulaNameResult.isErr()
    )
      return;

    const missingId = missingIdResult.value;
    const expression = FormulaExpression.create(`{${missingId.toString()}} + 1`);
    expect(expression.isOk()).toBe(true);
    if (expression.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(nameFieldResult.value).done();
    builder
      .field()
      .formula()
      .withId(formulaIdResult.value)
      .withName(formulaNameResult.value)
      .withExpression(expression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;

    const resolveResult = resolveFormulaFields(tableResult.value);
    expect(resolveResult.isErr()).toBe(true);
    if (resolveResult.isErr()) {
      expect(resolveResult.error).toContain(missingId.toString());
    }
  });

  it('returns errors for formula type inference failures', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const tableNameResult = TableName.create('Type errors');
    const formulaIdResult = createFieldId('i');
    const nameFieldResult = FieldName.create('Name');
    const formulaNameResult = FieldName.create('Unknown function');

    expect(
      [baseIdResult, tableNameResult, formulaIdResult, nameFieldResult, formulaNameResult].every(
        (r) => r.isOk()
      )
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableNameResult.isErr() ||
      formulaIdResult.isErr() ||
      nameFieldResult.isErr() ||
      formulaNameResult.isErr()
    )
      return;

    const expression = FormulaExpression.create('UNKNOWN()');
    expect(expression.isOk()).toBe(true);
    if (expression.isErr()) return;

    const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
    builder.field().singleLineText().withName(nameFieldResult.value).done();
    builder
      .field()
      .formula()
      .withId(formulaIdResult.value)
      .withName(formulaNameResult.value)
      .withExpression(expression.value)
      .done();
    builder.view().defaultGrid().done();

    const tableResult = builder.build();
    expect(tableResult.isOk()).toBe(true);
    if (tableResult.isErr()) return;

    const resolveResult = resolveFormulaFields(tableResult.value);
    expect(resolveResult.isErr()).toBe(true);
    if (resolveResult.isErr()) {
      expect(resolveResult.error).toContain('Parse formula expression');
    }
  });
});
