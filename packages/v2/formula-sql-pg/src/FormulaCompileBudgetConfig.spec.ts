import { FormulaField, FieldId, FieldName, FormulaExpression, FormulaMeta } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
} from './FormulaCompileBudget';
import { resolveFormulaCompileBudget } from './FormulaCompileBudgetConfig';

const field = (version?: number) =>
  FormulaField.create({
    id: FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Formula')._unsafeUnwrap(),
    expression: FormulaExpression.create('1')._unsafeUnwrap(),
    meta: FormulaMeta.rehydrate(
      version === undefined ? {} : { formulaSafetyVersion: version }
    )._unsafeUnwrap(),
  })._unsafeUnwrap();

describe('persisted formula budget ownership', () => {
  it('keeps historical roots observable until server admission enables protection', () => {
    const root = field();
    expect(resolveFormulaCompileBudget(root)._unsafeUnwrap().mode).toBe('observe');
    root.enableFormulaSafety(1)._unsafeUnwrap();
    expect(resolveFormulaCompileBudget(root)._unsafeUnwrap().mode).toBe('enforce');
  });

  it('refuses an unsupported persisted version instead of treating it as historical', () => {
    const result = resolveFormulaCompileBudget(field(2));
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.formula_safety_version_unsupported',
      details: { policyVersion: 2 },
    });
  });

  it('uses the same injected policy for observed and enforced roots', () => {
    const policy = createFormulaCompileBudgetPolicy({
      ...defaultFormulaCompileBudgetLimits,
      sqlBytes: 7,
    });
    for (const root of [field(), field(1)]) {
      const resolved = resolveFormulaCompileBudget(root, {
        policy,
        policyVersion: 1,
      })._unsafeUnwrap();
      expect(resolved.policy.check('sqlBytes', 8)).toEqual({
        metric: 'sqlBytes',
        attempted: 8,
        max: 7,
      });
    }
  });
});
