import { FieldId, TableId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';
import type { ComputedDependencyEdge } from '../ComputedUpdatePlanner';
import { deferredValueFrontierFields, stageValueFrontierTableIds } from './ComputedUpdateWorker';

const source = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
const target = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
const rounded = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
const directX = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
const output = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
const link = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
const edge: ComputedDependencyEdge = {
  fromTableId: source,
  toTableId: target,
  fromFieldId: rounded,
  toFieldId: output,
  propagationSourceFieldIds: [rounded],
  propagationMode: 'linkTraversal',
  linkFieldId: link,
  order: 0,
};
const deferred = {
  steps: [{ tableId: target, fieldIds: [output], level: 1 }],
  edges: [edge],
  sameTableBatches: [],
};

describe('deferred value-frontier proof', () => {
  it('requests exactly the complete source provenance of ordinary links', () => {
    expect(deferredValueFrontierFields(deferred)).toEqual([
      { tableId: source.toString(), fieldIds: [rounded.toString()] },
    ]);
  });
  it('preserves a merged direct X source so missing coverage forces fallback', () => {
    expect(
      deferredValueFrontierFields({
        ...deferred,
        edges: [{ ...edge, propagationSourceFieldIds: [rounded, directX] }],
      })
    ).toEqual([{ tableId: source.toString(), fieldIds: [rounded.toString(), directX.toString()] }]);
  });
  it('does not gate same-table deferred B=A+X by unchanged A', () => {
    expect(
      deferredValueFrontierFields({
        ...deferred,
        steps: [...deferred.steps, { tableId: source, fieldIds: [directX], level: 1 }],
      })
    ).toEqual([]);
  });
  it('falls back for legacy, conditional, all-target and self-recursive edges', () => {
    for (const candidate of [
      { ...edge, propagationSourceFieldIds: undefined },
      { ...edge, propagationMode: 'allTargetRecords' as const },
      { ...edge, filterCondition: { foreignTableId: source, filterDto: {} } },
      { ...edge, toTableId: source },
    ])
      expect(deferredValueFrontierFields({ ...deferred, edges: [candidate] })).toEqual([]);
  });
});

describe('value-frontier tracking eligibility', () => {
  const stagePlan = { steps: [{ tableId: source, fieldIds: [rounded], level: 0 }] };
  it('records only executed sources with proven deferred consumers', () => {
    expect(stageValueFrontierTableIds({ stagePlan, deferred })).toEqual([source.toString()]);
  });
  it('skips terminal and unsupported propagation without evidence writes', () => {
    expect(stageValueFrontierTableIds({ stagePlan, deferred: null })).toEqual([]);
    expect(
      stageValueFrontierTableIds({
        stagePlan,
        deferred: { ...deferred, edges: [{ ...edge, propagationSourceFieldIds: undefined }] },
      })
    ).toEqual([]);
  });
  it('skips paths carrying direct or already-computed source fields', () => {
    expect(
      stageValueFrontierTableIds({
        stagePlan,
        deferred: {
          ...deferred,
          edges: [{ ...edge, propagationSourceFieldIds: [rounded, directX] }],
        },
      })
    ).toEqual([]);
    expect(stageValueFrontierTableIds({ stagePlan: { steps: [] }, deferred })).toEqual([]);
  });
});
