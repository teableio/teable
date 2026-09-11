import { BaseId, FieldId, FieldName, FormulaExpression, Table, TableName } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FormulaExpressionNode } from './FormulaExpressionGraph';
import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';

const createTranslator = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Graph')._unsafeUnwrap());
  const ids = new Map<string, string>();
  for (const [index, name] of ['Input', 'Other', 'Shared', 'Left', 'Right'].entries()) {
    ids.set(name, `fld${String.fromCharCode(97 + index).repeat(16)}`);
  }
  for (const name of ['Input', 'Other']) {
    builder
      .field()
      .singleLineText()
      .withId(FieldId.create(ids.get(name)!)._unsafeUnwrap())
      .withName(FieldName.create(name)._unsafeUnwrap())
      .done();
  }
  const formulas = [
    ['Shared', `LEN({${ids.get('Input')}})`],
    ['Left', `{${ids.get('Shared')}} + 1`],
    ['Right', `{${ids.get('Shared')}} * 2`],
  ];
  for (const [name, expression] of formulas) {
    builder
      .field()
      .formula()
      .withId(FieldId.create(ids.get(name)!)._unsafeUnwrap())
      .withName(FieldName.create(name)._unsafeUnwrap())
      .withExpression(FormulaExpression.create(expression)._unsafeUnwrap())
      .done();
  }
  builder.view().defaultGrid().done();
  return new FormulaSqlPgTranslator({
    table: builder.build()._unsafeUnwrap(),
    tableAlias: 't',
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    resolveFieldSql: (field) =>
      ok(makeExpr(`"t"."${field.id().toString()}"`, 'string', false, undefined, undefined, field)),
  });
};

const requireBinary = (node: FormulaExpressionNode) => {
  if (node.kind !== 'binary') throw new Error(`Expected binary, got ${node.kind}`);
  return node;
};
const requireCall = (node: FormulaExpressionNode) => {
  if (node.kind !== 'call') throw new Error(`Expected call, got ${node.kind}`);
  return node;
};
const requireField = (node: FormulaExpressionNode) => {
  if (node.kind !== 'field') throw new Error(`Expected field, got ${node.kind}`);
  return node;
};

describe('formula expression graph', () => {
  it('interns repeated function calls as the same node object', () => {
    const root = requireBinary(
      createTranslator().buildExpressionGraph('LEN({Input}) + LEN({Input})')._unsafeUnwrap()
    );
    expect(root.left).toBe(root.right);
    expect(root.left.kind).toBe('call');
  });

  it('preserves one shared formula dependency across diamond branches', () => {
    const root = requireBinary(
      createTranslator().buildExpressionGraph('{Left} + {Right}')._unsafeUnwrap()
    );
    const left = requireBinary(requireField(root.left).value);
    const right = requireBinary(requireField(root.right).value);
    expect(left.left).toBe(right.left);
    expect(requireField(left.left).field.name().toString()).toBe('Shared');
    expect(requireField(root.left).field.name().toString()).toBe('Left');
    expect(requireField(root.right).field.name().toString()).toBe('Right');
  });

  it('does not merge the same function applied to different fields', () => {
    const root = requireBinary(
      createTranslator().buildExpressionGraph('LEN({Input}) + LEN({Other})')._unsafeUnwrap()
    );
    expect(root.left).not.toBe(root.right);
    expect(requireCall(root.left).args[0]).not.toBe(requireCall(root.right).args[0]);
  });

  it('retains conditional branches while sharing their dependencies', () => {
    const root = requireCall(
      createTranslator()
        .buildExpressionGraph('IF(LEN({Input})>0, LEN({Input})+1, LEN({Input})*2)')
        ._unsafeUnwrap()
    );
    expect(root.name).toBe('IF');
    expect(root.args).toHaveLength(3);
    const condition = requireBinary(root.args[0]);
    const thenBranch = requireBinary(root.args[1]);
    const elseBranch = requireBinary(root.args[2]);
    expect(thenBranch).not.toBe(elseBranch);
    expect(condition.left).toBe(thenBranch.left);
    expect(thenBranch.left).toBe(elseBranch.left);
  });

  it('isolates graph objects between compilations on the same translator', () => {
    const translator = createTranslator();
    const first = requireBinary(
      translator.buildExpressionGraph('{Left} + {Right}')._unsafeUnwrap()
    );
    const second = requireBinary(
      translator.buildExpressionGraph('{Left} + {Right}')._unsafeUnwrap()
    );
    expect(first).not.toBe(second);
    expect(first.left).not.toBe(second.left);
    expect(requireField(first.left).value).not.toBe(requireField(second.left).value);
  });
});
