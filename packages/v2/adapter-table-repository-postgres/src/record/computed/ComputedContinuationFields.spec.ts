import { FieldId } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import {
  collectContinuationFieldIds,
  collectContinuationFieldIdsFromExecutedSteps,
} from './ComputedContinuationFields';
import type { ComputedUpdatePlan } from './ComputedUpdatePlanner';

const fieldId = (suffix: string) => FieldId.create(`fld${suffix.repeat(16)}`)._unsafeUnwrap();

describe('collectContinuationFieldIds', () => {
  it('continues only from fields whose values actually changed', () => {
    const changed = fieldId('a');
    const unchanged = fieldId('b');
    const plan = {
      steps: [{ tableId: {} as never, fieldIds: [changed, unchanged], level: 0 }],
      edges: [],
    } as unknown as ComputedUpdatePlan;

    expect(
      collectContinuationFieldIds(plan, [
        {
          tableId: 'tblxxxxxxxxxxxxxxxx',
          recordChanges: [
            {
              recordId: 'recxxxxxxxxxxxxxxxx',
              oldVersion: 1,
              changes: [{ fieldId: changed.toString(), newValue: 'changed' }],
            },
          ],
        },
      ]).map((id) => id.toString())
    ).toEqual([changed.toString()]);
  });

  it('stops after a step that produced no actual changes', () => {
    const plan = {
      steps: [{ tableId: {} as never, fieldIds: [fieldId('a')], level: 0 }],
      edges: [],
    } as unknown as ComputedUpdatePlan;

    expect(collectContinuationFieldIds(plan, [])).toEqual([]);
  });

  it('uses propagation targets for an edge-only stage', () => {
    const target = fieldId('c');
    const plan = {
      steps: [],
      edges: [{ toFieldId: target, propagationTargetFieldIds: [target] }],
    } as unknown as ComputedUpdatePlan;

    expect(collectContinuationFieldIds(plan, []).map((id) => id.toString())).toEqual([
      target.toString(),
    ]);
  });
});

describe('collectContinuationFieldIdsFromExecutedSteps', () => {
  it('keeps every changed field when the stage stayed on one level', () => {
    const lookup = fieldId('a');
    const formula = fieldId('b');
    const plan = {
      steps: [
        { tableId: {} as never, fieldIds: [lookup], level: 0 },
        { tableId: {} as never, fieldIds: [formula], level: 1 },
      ],
      edges: [],
    } as unknown as ComputedUpdatePlan;

    expect(
      collectContinuationFieldIdsFromExecutedSteps(
        plan,
        [{ tableId: {} as never, fieldIds: [lookup], level: 0 }],
        [
          {
            tableId: 'tblxxxxxxxxxxxxxxxx',
            recordChanges: [
              {
                recordId: 'recxxxxxxxxxxxxxxxx',
                oldVersion: 1,
                changes: [{ fieldId: lookup.toString(), newValue: 'paid' }],
              },
            ],
          },
        ]
      ).map((id) => id.toString())
    ).toEqual([lookup.toString()]);
  });

  it('continues only from the terminal executed level after a multi-level stage', () => {
    const lookup = fieldId('a');
    const formula = fieldId('b');
    const plan = {
      steps: [
        { tableId: {} as never, fieldIds: [lookup], level: 0 },
        { tableId: {} as never, fieldIds: [formula], level: 1 },
      ],
      edges: [],
    } as unknown as ComputedUpdatePlan;

    expect(
      collectContinuationFieldIdsFromExecutedSteps(plan, plan.steps, [
        {
          tableId: 'tblxxxxxxxxxxxxxxxx',
          recordChanges: [
            {
              recordId: 'recxxxxxxxxxxxxxxxx',
              oldVersion: 1,
              changes: [
                { fieldId: lookup.toString(), newValue: 'paid' },
                { fieldId: formula.toString(), newValue: 'paid-L1' },
              ],
            },
          ],
        },
      ]).map((id) => id.toString())
    ).toEqual([formula.toString()]);
  });

  it('uses edge targets when a leftover-step plan executed no steps this stage', () => {
    const lookup = fieldId('c');
    const formula = fieldId('d');
    const plan = {
      steps: [{ tableId: {} as never, fieldIds: [formula], level: 1 }],
      edges: [{ toFieldId: lookup, propagationTargetFieldIds: [lookup] }],
    } as unknown as ComputedUpdatePlan;

    expect(
      collectContinuationFieldIdsFromExecutedSteps(
        plan,
        [],
        [
          {
            tableId: 'tblxxxxxxxxxxxxxxxx',
            recordChanges: [
              {
                recordId: 'recxxxxxxxxxxxxxxxx',
                oldVersion: 2,
                changes: [{ fieldId: lookup.toString(), newValue: ['Widget'] }],
              },
            ],
          },
        ]
      ).map((id) => id.toString())
    ).toEqual([lookup.toString()]);
  });

  it('continues from a changed lookup edge when the formula step wrote nothing', () => {
    const lookup = fieldId('e');
    const formula = fieldId('f');
    const plan = {
      steps: [{ tableId: {} as never, fieldIds: [formula], level: 1 }],
      edges: [{ toFieldId: lookup, propagationTargetFieldIds: [lookup] }],
    } as unknown as ComputedUpdatePlan;

    expect(
      collectContinuationFieldIdsFromExecutedSteps(
        plan,
        [{ tableId: {} as never, fieldIds: [formula], level: 1 }],
        [
          {
            tableId: 'tblxxxxxxxxxxxxxxxx',
            recordChanges: [
              {
                recordId: 'recxxxxxxxxxxxxxxxx',
                oldVersion: 2,
                changes: [{ fieldId: lookup.toString(), newValue: ['Widget'] }],
              },
            ],
          },
        ]
      ).map((id) => id.toString())
    ).toEqual([lookup.toString()]);
  });
});
