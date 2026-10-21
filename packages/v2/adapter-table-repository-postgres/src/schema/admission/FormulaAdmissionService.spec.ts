import {
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  FormulaMeta,
  Table,
  TableName,
  TableAddFieldSpec,
  TableUpdateFieldNameSpec,
  UpdateFormulaExpressionSpec,
  UpdateFormulaTimeZoneSpec,
  TimeZone,
  createFormulaField,
} from '@teable/v2-core';
import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
  Pg16TypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import { describe, expect, it } from 'vitest';
import { FormulaAdmissionService } from './FormulaAdmissionService';

const createTable = (expression = '1') => {
  const builder = Table.builder()
    .withBaseId(BaseId.generate()._unsafeUnwrap())
    .withName(TableName.create('Admission')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .formula()
    .withName(FieldName.create('Legacy')._unsafeUnwrap())
    .withExpression(FormulaExpression.create(expression)._unsafeUnwrap())
    .withResultType({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    })
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  const field = table
    .getFields()
    .find((field): field is FormulaField => field instanceof FormulaField)!;
  return { table, field };
};
const admission = (limits: Partial<typeof defaultFormulaCompileBudgetLimits> = {}) =>
  new FormulaAdmissionService(new Pg16TypeValidationStrategy(), {
    policyVersion: 1,
    policy: createFormulaCompileBudgetPolicy({ ...defaultFormulaCompileBudgetLimits, ...limits }),
  });

describe('FormulaAdmissionService', () => {
  it('rejects a new dangerous root without marking its accepted sibling', () => {
    const { table, field } = createTable('1');
    const dangerous = createFormulaField({
      id: FieldId.generate()._unsafeUnwrap(),
      name: FieldName.create('Dangerous')._unsafeUnwrap(),
      expression: FormulaExpression.create('ABS(ABS(ABS(1)))')._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();
    const candidate = TableAddFieldSpec.create(dangerous).mutate(table)._unsafeUnwrap();
    const result = admission({ astDepth: 2 }).admitNew(candidate);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
    expect(field.formulaSafetyVersion()._unsafeUnwrap()).toBeUndefined();
    expect(dangerous.formulaSafetyVersion()._unsafeUnwrap()).toBeUndefined();
  });

  it('keeps renamed legacy definitions observing but rejects an actual expression change', () => {
    const { table, field } = createTable('ABS(ABS(ABS(1)))');
    const service = admission({ astDepth: 2 });
    const rename = TableUpdateFieldNameSpec.create(
      field.id(),
      field.name(),
      FieldName.create('Renamed')._unsafeUnwrap()
    );
    expect(service.admitUpdate(table, rename).isOk()).toBe(true);
    expect(field.formulaSafetyVersion()._unsafeUnwrap()).toBeUndefined();
    const change = UpdateFormulaExpressionSpec.create(
      field.id(),
      field.expression(),
      FormulaExpression.create('ABS(ABS(ABS(2)))')._unsafeUnwrap()
    );
    const candidate = change.mutate(table)._unsafeUnwrap();
    expect(service.admitUpdate(candidate, change)._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_compile_depth_max'
    );
    expect(field.expression().toString()).toBe('ABS(ABS(ABS(1)))');
  });

  it('enforces the entire legacy dependency expansion for a new root', () => {
    const { table, field } = createTable('ABS(ABS(ABS(1)))');
    const added = createFormulaField({
      id: FieldId.generate()._unsafeUnwrap(),
      name: FieldName.create('New')._unsafeUnwrap(),
      expression: FormulaExpression.create(`{${field.id().toString()}} + 1`)._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();
    const spec = TableAddFieldSpec.create(added);
    const candidate = spec.mutate(table)._unsafeUnwrap();
    expect(admission({ astDepth: 2 }).admitUpdate(candidate, spec)._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_compile_depth_max'
    );
    expect(added.formulaSafetyVersion()._unsafeUnwrap()).toBeUndefined();
  });

  it('checks affected enforced roots even when legacy dependency metadata is absent', () => {
    const { table, field } = createTable('1');
    const dependent = createFormulaField({
      id: FieldId.generate()._unsafeUnwrap(),
      name: FieldName.create('Protected')._unsafeUnwrap(),
      expression: FormulaExpression.create(`{${field.id().toString()}} + 1`)._unsafeUnwrap(),
      meta: FormulaMeta.rehydrate({ formulaSafetyVersion: 1 })._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();
    const candidate = TableAddFieldSpec.create(dependent).mutate(table)._unsafeUnwrap();
    // New definition stays syntactically shallow but expands the protected root past its SQL ceiling.
    const change = UpdateFormulaExpressionSpec.create(
      field.id(),
      field.expression(),
      FormulaExpression.create('123')._unsafeUnwrap()
    );
    const changed = change.mutate(candidate)._unsafeUnwrap();
    expect(admission({ sqlBytes: 1 }).admitUpdate(changed, change)._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_sql_bytes_max'
    );
  });

  it('admits an effective timezone change and persists supported ownership', () => {
    const { table, field } = createTable();
    const change = UpdateFormulaTimeZoneSpec.create(
      field.id(),
      field.timeZone(),
      TimeZone.create('Asia/Shanghai')._unsafeUnwrap()
    );
    const changed = change.mutate(table)._unsafeUnwrap();
    admission().admitUpdate(changed, change)._unsafeUnwrap();
    const result = changed
      .getField((candidate) => candidate.id().equals(field.id()))
      ._unsafeUnwrap();
    expect(result instanceof FormulaField && result.formulaSafetyVersion()._unsafeUnwrap()).toBe(1);
  });

  it('does not trust copied ownership or unknown future versions', () => {
    const { table, field } = createTable('ABS(ABS(ABS(1)))');
    field.enableFormulaSafety(1)._unsafeUnwrap();
    expect(admission({ astDepth: 2 }).admitNew(table)._unsafeUnwrapErr().code).toBe(
      'validation.limit.formula_compile_depth_max'
    );
    const future = createFormulaField({
      id: FieldId.generate()._unsafeUnwrap(),
      name: FieldName.create('Future')._unsafeUnwrap(),
      expression: FormulaExpression.create('1')._unsafeUnwrap(),
      meta: FormulaMeta.rehydrate({ formulaSafetyVersion: 2 })._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();
    expect(
      admission().admitNew(TableAddFieldSpec.create(future).mutate(table)._unsafeUnwrap()).isErr()
    ).toBe(true);
  });
});
