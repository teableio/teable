import { BaseId, FieldId, RecordId, TableId } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ComputedUpdatePlanner } from '../ComputedUpdatePlanner';
import type {
  FieldDependencyGraphData,
  FieldDependencyEdge,
  FieldMeta,
} from '../FieldDependencyGraph';

describe('ComputedUpdatePlanner', () => {
  it('updates lookup that depends on title but not lookup that depends on another field', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const componentsTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const bugsTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const nameFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const numberFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
    const lookupNameFieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
    const lookupNumberFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const recordId = RecordId.create(`rec${'i'.repeat(16)}`)._unsafeUnwrap();

    const fields: FieldMeta[] = [
      {
        id: nameFieldId,
        tableId: componentsTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: numberFieldId,
        tableId: componentsTableId,
        type: 'number',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: linkFieldId,
        tableId: bugsTableId,
        type: 'link',
        isComputed: true,
        options: {
          foreignTableId: componentsTableId.toString(),
          lookupFieldId: nameFieldId.toString(),
        },
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: lookupNameFieldId,
        tableId: bugsTableId,
        type: 'lookup',
        isComputed: true,
        options: null,
        lookupOptions: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: componentsTableId.toString(),
          lookupFieldId: nameFieldId.toString(),
        },
        conditionalOptions: null,
      },
      {
        id: lookupNumberFieldId,
        tableId: bugsTableId,
        type: 'lookup',
        isComputed: true,
        options: null,
        lookupOptions: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: componentsTableId.toString(),
          lookupFieldId: numberFieldId.toString(),
        },
        conditionalOptions: null,
      },
    ];

    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: nameFieldId,
        toFieldId: linkFieldId,
        fromTableId: componentsTableId,
        toTableId: bugsTableId,
        kind: 'cross_record',
        linkFieldId,
        semantic: 'link_title',
      },
      {
        fromFieldId: linkFieldId,
        toFieldId: lookupNameFieldId,
        fromTableId: bugsTableId,
        toTableId: bugsTableId,
        kind: 'same_record',
        semantic: 'lookup_link',
      },
      {
        fromFieldId: nameFieldId,
        toFieldId: lookupNameFieldId,
        fromTableId: componentsTableId,
        toTableId: bugsTableId,
        kind: 'cross_record',
        linkFieldId,
        semantic: 'lookup_source',
      },
      {
        fromFieldId: linkFieldId,
        toFieldId: lookupNumberFieldId,
        fromTableId: bugsTableId,
        toTableId: bugsTableId,
        kind: 'same_record',
        semantic: 'lookup_link',
      },
      {
        fromFieldId: numberFieldId,
        toFieldId: lookupNumberFieldId,
        fromTableId: componentsTableId,
        toTableId: bugsTableId,
        kind: 'cross_record',
        linkFieldId,
        semantic: 'lookup_source',
      },
    ];

    const fieldsById = new Map<string, FieldMeta>(
      fields.map((field) => [field.id.toString(), field])
    );
    const graphData: FieldDependencyGraphData = { fieldsById, edges };
    const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
    const planner = new ComputedUpdatePlanner(graph as never);

    const planResult = await planner.planStage({
      baseId,
      seedTableId: componentsTableId,
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      changedFieldIds: [nameFieldId],
      changeType: 'update',
    });

    expect(planResult.isOk()).toBe(true);
    const plan = planResult._unsafeUnwrap();
    const plannedFieldIds = plan.steps.flatMap((step) => step.fieldIds.map((id) => id.toString()));

    expect(plannedFieldIds).toEqual(
      expect.arrayContaining([linkFieldId.toString(), lookupNameFieldId.toString()])
    );
    expect(plannedFieldIds).not.toContain(lookupNumberFieldId.toString());
  });
});
