import {
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  createFormulaField,
  createNumberField,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  FormulaMeta,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { makeBackfillFusionTable } from './__tests__/backfillFusionFixture';
import type { ComputedDependencyEdge, ComputedUpdatePlan } from './ComputedUpdatePlanner';
import {
  fieldChangeActuallyChanged,
  isStructurallyPrunableLinkEdge,
  isValueGatedLinkEdge,
  recordIdsChangedForFields,
} from './ComputedValueGatedPropagation';

const source = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
const target = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
const rounded = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
const output = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
const link = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
const extra = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();

const ordinaryEdge = (): ComputedDependencyEdge => ({
  fromTableId: source,
  toTableId: target,
  fromFieldId: rounded,
  toFieldId: output,
  propagationSourceFieldIds: [rounded],
  propagationMode: 'linkTraversal',
  linkFieldId: link,
  order: 0,
});

describe('isStructurallyPrunableLinkEdge', () => {
  it('is false for self-edges, conditional filters, and missing provenance', () => {
    const edge = ordinaryEdge();
    expect(isStructurallyPrunableLinkEdge(edge)).toBe(true);
    expect(isStructurallyPrunableLinkEdge({ ...edge, toTableId: source })).toBe(false);
    expect(
      isStructurallyPrunableLinkEdge({
        ...edge,
        filterCondition: { foreignTableId: source, filterDto: {} },
      })
    ).toBe(false);
    expect(isStructurallyPrunableLinkEdge({ ...edge, propagationSourceFieldIds: undefined })).toBe(
      false
    );
    expect(isStructurallyPrunableLinkEdge({ ...edge, propagationMode: 'allTargetRecords' })).toBe(
      false
    );
  });
});

describe('isValueGatedLinkEdge', () => {
  const roundTable = makeBackfillFusionTable(['ROUND({fldaaaaaaaaaaaaaaaa}, 0)']);
  const roundFormula = roundTable.getFields()[1];
  if (!(roundFormula instanceof FormulaField)) throw new Error('Expected formula');
  roundFormula
    .setResultType(CellValueType.number(), CellValueMultiplicity.single())
    ._unsafeUnwrap();

  const nowTable = makeBackfillFusionTable(['NOW()']);
  const nowFormula = nowTable.getFields()[1];

  const generatedNumberId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
  const generatedFormulaId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
  const generatedTable = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Generated')._unsafeUnwrap())
    .addFieldFromResult(
      createNumberField({
        id: generatedNumberId,
        name: FieldName.create('X')._unsafeUnwrap(),
      })
    )
    .addFieldFromResult(
      createFormulaField({
        id: generatedFormulaId,
        name: FieldName.create('Rounded')._unsafeUnwrap(),
        expression: FormulaExpression.create(
          `ROUND({${generatedNumberId.toString()}}, 0)`
        )._unsafeUnwrap(),
        meta: FormulaMeta.rehydrate({ persistedAsGeneratedColumn: true })._unsafeUnwrap(),
        resultType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      })
    )
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();
  const generated = generatedTable.getFields()[1];

  const edgeFor = (fromTableId: TableId, sourceFieldId: FieldId): ComputedDependencyEdge => ({
    ...ordinaryEdge(),
    fromTableId,
    fromFieldId: sourceFieldId,
    propagationSourceFieldIds: [sourceFieldId],
  });

  it('is false when the source table is missing', () => {
    const edge = edgeFor(roundTable.id(), roundFormula.id());
    const plan = {
      steps: [{ tableId: roundTable.id(), fieldIds: [roundFormula.id()], level: 0 }],
    } as Pick<ComputedUpdatePlan, 'steps'>;
    expect(isValueGatedLinkEdge(edge, plan, new Map())).toBe(false);
  });

  it('is false for NOW() and generated-column sources', () => {
    const nowEdge = edgeFor(nowTable.id(), nowFormula.id());
    const nowPlan = {
      steps: [{ tableId: nowTable.id(), fieldIds: [nowFormula.id()], level: 0 }],
    } as Pick<ComputedUpdatePlan, 'steps'>;
    expect(
      isValueGatedLinkEdge(nowEdge, nowPlan, new Map([[nowTable.id().toString(), nowTable]]))
    ).toBe(false);

    const generatedEdge = edgeFor(generatedTable.id(), generated.id());
    const generatedPlan = {
      steps: [{ tableId: generatedTable.id(), fieldIds: [generated.id()], level: 0 }],
    } as Pick<ComputedUpdatePlan, 'steps'>;
    expect(
      isValueGatedLinkEdge(
        generatedEdge,
        generatedPlan,
        new Map([[generatedTable.id().toString(), generatedTable]])
      )
    ).toBe(false);
  });

  it('is true for an ordinary link whose stored ROUND source is in plan.steps', () => {
    const edge = edgeFor(roundTable.id(), roundFormula.id());
    const plan = {
      steps: [
        { tableId: roundTable.id(), fieldIds: [roundFormula.id()], level: 0 },
        { tableId: roundTable.id(), fieldIds: [extra], level: 1 },
      ],
    } as Pick<ComputedUpdatePlan, 'steps'>;
    expect(
      isValueGatedLinkEdge(edge, plan, new Map([[roundTable.id().toString(), roundTable]]))
    ).toBe(true);
  });
});

describe('fieldChangeActuallyChanged', () => {
  it('treats missing oldValue as changed and Object.is equal values as unchanged', () => {
    expect(fieldChangeActuallyChanged({ newValue: 1 })).toBe(true);
    expect(fieldChangeActuallyChanged({ oldValue: 0, newValue: 0 })).toBe(false);
    expect(fieldChangeActuallyChanged({ oldValue: 1, newValue: 2 })).toBe(true);
  });
});

describe('recordIdsChangedForFields', () => {
  it('returns sorted ids whose selected fields actually changed', () => {
    expect(recordIdsChangedForFields([], new Set(['a']))).toEqual([]);
    expect(recordIdsChangedForFields([{ tableId: 't', recordChanges: [] }], new Set())).toEqual([]);
    expect(
      recordIdsChangedForFields(
        [
          {
            tableId: 't',
            recordChanges: [
              {
                recordId: 'recb',
                oldVersion: 1,
                changes: [{ fieldId: 'a', oldValue: 1, newValue: 1 }],
              },
              {
                recordId: 'reca',
                oldVersion: 1,
                changes: [{ fieldId: 'a', oldValue: 1, newValue: 2 }],
              },
            ],
          },
        ],
        new Set(['a'])
      )
    ).toEqual(['reca']);
  });
});
