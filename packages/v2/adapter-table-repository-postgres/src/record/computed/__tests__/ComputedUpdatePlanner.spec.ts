import { BaseId, FieldId, RecordId, TableId } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ComputedUpdatePlanner } from '../ComputedUpdatePlanner';
import type { ComputedDependencyEdge } from '../ComputedUpdatePlanner';
import type {
  FieldDependencyGraphData,
  FieldDependencyEdge,
  FieldMeta,
} from '../FieldDependencyGraph';

const edgeTargetsField = (
  edge: Pick<ComputedDependencyEdge, 'toFieldId' | 'propagationTargetFieldIds'>,
  fieldId: FieldId
): boolean =>
  edge.toFieldId.equals(fieldId) ||
  edge.propagationTargetFieldIds?.some((targetFieldId) => targetFieldId.equals(fieldId)) === true;

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

  it('plans symmetric link updates from impact link fields when changed fields are empty', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(15)}1`)._unsafeUnwrap();
    const hostTableId = TableId.create(`tbl${'b'.repeat(15)}1`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'c'.repeat(15)}1`)._unsafeUnwrap();
    const hostPrimaryFieldId = FieldId.create(`fld${'d'.repeat(15)}1`)._unsafeUnwrap();
    const foreignPrimaryFieldId = FieldId.create(`fld${'e'.repeat(15)}1`)._unsafeUnwrap();
    const hostLinkFieldId = FieldId.create(`fld${'f'.repeat(15)}1`)._unsafeUnwrap();
    const symmetricLinkFieldId = FieldId.create(`fld${'g'.repeat(15)}1`)._unsafeUnwrap();
    const recordId = RecordId.create(`rec${'h'.repeat(15)}1`)._unsafeUnwrap();

    const fields: FieldMeta[] = [
      {
        id: hostPrimaryFieldId,
        tableId: hostTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: foreignPrimaryFieldId,
        tableId: foreignTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: hostLinkFieldId,
        tableId: hostTableId,
        type: 'link',
        isComputed: true,
        options: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryFieldId.toString(),
          symmetricFieldId: symmetricLinkFieldId.toString(),
          relationship: 'manyMany',
        },
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: symmetricLinkFieldId,
        tableId: foreignTableId,
        type: 'link',
        isComputed: true,
        options: {
          foreignTableId: hostTableId.toString(),
          lookupFieldId: hostPrimaryFieldId.toString(),
          symmetricFieldId: hostLinkFieldId.toString(),
          relationship: 'manyMany',
        },
        lookupOptions: null,
        conditionalOptions: null,
      },
    ];

    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: foreignPrimaryFieldId,
        toFieldId: hostLinkFieldId,
        fromTableId: foreignTableId,
        toTableId: hostTableId,
        kind: 'cross_record',
        linkFieldId: hostLinkFieldId,
        semantic: 'link_title',
      },
      {
        fromFieldId: hostPrimaryFieldId,
        toFieldId: symmetricLinkFieldId,
        fromTableId: hostTableId,
        toTableId: foreignTableId,
        kind: 'cross_record',
        linkFieldId: symmetricLinkFieldId,
        semantic: 'link_title',
      },
    ];

    const graphData: FieldDependencyGraphData = {
      fieldsById: new Map<string, FieldMeta>(fields.map((field) => [field.id.toString(), field])),
      edges,
    };
    const graph = {
      load: vi
        .fn()
        .mockImplementation(
          (
            _baseId: BaseId,
            _executionContext: unknown,
            options?: { requiredFieldIds?: ReadonlyArray<FieldId> }
          ) => {
            const requiredFieldIds = options?.requiredFieldIds ?? [];
            if (!requiredFieldIds.some((fieldId) => fieldId.equals(hostLinkFieldId))) {
              return Promise.resolve(ok({ fieldsById: new Map<string, FieldMeta>(), edges: [] }));
            }
            return Promise.resolve(ok(graphData));
          }
        ),
    };
    const planner = new ComputedUpdatePlanner(graph as never);

    const planResult = await planner.planStage({
      baseId,
      seedTableId: hostTableId,
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      changedFieldIds: [],
      changeType: 'update',
      impact: {
        valueFieldIds: [],
        linkFieldIds: [hostLinkFieldId],
      },
    });

    expect(planResult.isOk()).toBe(true);
    expect(graph.load).toHaveBeenCalledWith(baseId, undefined, {
      requiredFieldIds: [hostLinkFieldId],
    });
    const plan = planResult._unsafeUnwrap();
    const plannedFieldIds = plan.steps.flatMap((step) => step.fieldIds.map((id) => id.toString()));

    expect(plannedFieldIds).toEqual(
      expect.arrayContaining([hostLinkFieldId.toString(), symmetricLinkFieldId.toString()])
    );

    const symmetricEdge = plan.edges.find(
      (edge) =>
        edgeTargetsField(edge, symmetricLinkFieldId) &&
        edge.fromTableId.equals(hostTableId) &&
        edge.toTableId.equals(foreignTableId)
    );
    expect(symmetricEdge?.linkFieldId?.equals(symmetricLinkFieldId)).toBe(true);
  });

  it('skips cycle fields for delete while keeping ordered updates', async () => {
    const baseId = BaseId.create(`bse${'j'.repeat(16)}`)._unsafeUnwrap();
    const seedTableId = TableId.create(`tbl${'k'.repeat(16)}`)._unsafeUnwrap();
    const computedTableId = TableId.create(`tbl${'r'.repeat(16)}`)._unsafeUnwrap();
    const seedFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const fieldAId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
    const fieldBId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const fieldCId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
    const fieldDId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
    const recordId = RecordId.create(`rec${'q'.repeat(16)}`)._unsafeUnwrap();

    const fields: FieldMeta[] = [
      {
        id: seedFieldId,
        tableId: seedTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: fieldAId,
        tableId: computedTableId,
        type: 'formula',
        isComputed: true,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: fieldBId,
        tableId: computedTableId,
        type: 'formula',
        isComputed: true,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: fieldCId,
        tableId: computedTableId,
        type: 'formula',
        isComputed: true,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: fieldDId,
        tableId: computedTableId,
        type: 'formula',
        isComputed: true,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
    ];

    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: seedFieldId,
        toFieldId: fieldAId,
        fromTableId: seedTableId,
        toTableId: computedTableId,
        kind: 'cross_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: fieldAId,
        toFieldId: fieldBId,
        fromTableId: computedTableId,
        toTableId: computedTableId,
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: fieldBId,
        toFieldId: fieldCId,
        fromTableId: computedTableId,
        toTableId: computedTableId,
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: fieldCId,
        toFieldId: fieldDId,
        fromTableId: computedTableId,
        toTableId: computedTableId,
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: fieldDId,
        toFieldId: fieldBId,
        fromTableId: computedTableId,
        toTableId: computedTableId,
        kind: 'same_record',
        semantic: 'formula_ref',
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
      seedTableId,
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      changedFieldIds: [seedFieldId],
      changeType: 'delete',
      cyclePolicy: 'skip',
    });

    expect(planResult.isOk()).toBe(true);
    const plan = planResult._unsafeUnwrap();
    const plannedFieldIds = plan.steps.flatMap((step) => step.fieldIds.map((id) => id.toString()));

    expect(plannedFieldIds).toEqual([fieldAId.toString()]);
    expect(plan.cycleInfo?.unsortedFieldIds).toEqual(
      expect.arrayContaining([fieldBId.toString(), fieldCId.toString(), fieldDId.toString()])
    );
  });

  it.each(['update', 'insert'] as const)(
    'skips cycle fields for %s while keeping ordered updates',
    async (changeType) => {
      const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
      const seedTableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
      const computedTableId = TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap();
      const seedFieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();
      const fieldAId = FieldId.create(`fld${'w'.repeat(16)}`)._unsafeUnwrap();
      const fieldBId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
      const fieldCId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();
      const fieldDId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();
      const recordId = RecordId.create(`rec${'s'.repeat(16)}`)._unsafeUnwrap();

      const fields: FieldMeta[] = [
        {
          id: seedFieldId,
          tableId: seedTableId,
          type: 'singleLineText',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: fieldAId,
          tableId: computedTableId,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: fieldBId,
          tableId: computedTableId,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: fieldCId,
          tableId: computedTableId,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: fieldDId,
          tableId: computedTableId,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ];

      const edges: FieldDependencyEdge[] = [
        {
          fromFieldId: seedFieldId,
          toFieldId: fieldAId,
          fromTableId: seedTableId,
          toTableId: computedTableId,
          kind: 'cross_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: fieldAId,
          toFieldId: fieldBId,
          fromTableId: computedTableId,
          toTableId: computedTableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: fieldBId,
          toFieldId: fieldCId,
          fromTableId: computedTableId,
          toTableId: computedTableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: fieldCId,
          toFieldId: fieldDId,
          fromTableId: computedTableId,
          toTableId: computedTableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: fieldDId,
          toFieldId: fieldBId,
          fromTableId: computedTableId,
          toTableId: computedTableId,
          kind: 'same_record',
          semantic: 'formula_ref',
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
        seedTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [seedFieldId],
        changeType,
        cyclePolicy: 'skip',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();
      const plannedFieldIds = plan.steps.flatMap((step) =>
        step.fieldIds.map((id) => id.toString())
      );

      expect(plannedFieldIds).toEqual([fieldAId.toString()]);
      expect(plan.cycleInfo?.unsortedFieldIds).toEqual(
        expect.arrayContaining([fieldBId.toString(), fieldCId.toString(), fieldDId.toString()])
      );
    }
  );

  it('keeps non-cycle downstream fields when cyclePolicy is skip', async () => {
    const baseId = BaseId.create(`bse${'1'.repeat(16)}`)._unsafeUnwrap();
    const seedTableId = TableId.create(`tbl${'2'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'3'.repeat(16)}`)._unsafeUnwrap();
    const sourceValueFieldId = FieldId.create(`fld${'4'.repeat(16)}`)._unsafeUnwrap();
    const cycleAFieldId = FieldId.create(`fld${'5'.repeat(16)}`)._unsafeUnwrap();
    const cycleBFieldId = FieldId.create(`fld${'6'.repeat(16)}`)._unsafeUnwrap();
    const downstreamFieldId = FieldId.create(`fld${'7'.repeat(16)}`)._unsafeUnwrap();
    const recordId = RecordId.create(`rec${'8'.repeat(16)}`)._unsafeUnwrap();

    const fields: FieldMeta[] = [
      {
        id: sourceValueFieldId,
        tableId: foreignTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: cycleAFieldId,
        tableId: seedTableId,
        type: 'link',
        isComputed: true,
        options: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: sourceValueFieldId.toString(),
        },
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: cycleBFieldId,
        tableId: foreignTableId,
        type: 'formula',
        isComputed: true,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: downstreamFieldId,
        tableId: seedTableId,
        type: 'lookup',
        isComputed: true,
        options: null,
        lookupOptions: {
          linkFieldId: cycleAFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: sourceValueFieldId.toString(),
        },
        conditionalOptions: null,
      },
    ];

    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: cycleBFieldId,
        toFieldId: cycleAFieldId,
        fromTableId: foreignTableId,
        toTableId: seedTableId,
        kind: 'cross_record',
        semantic: 'link_title',
      },
      {
        fromFieldId: cycleAFieldId,
        toFieldId: cycleBFieldId,
        fromTableId: seedTableId,
        toTableId: foreignTableId,
        kind: 'same_record',
        semantic: 'formula_ref',
      },
      {
        fromFieldId: cycleAFieldId,
        toFieldId: downstreamFieldId,
        fromTableId: seedTableId,
        toTableId: seedTableId,
        kind: 'same_record',
        semantic: 'lookup_link',
      },
      {
        fromFieldId: sourceValueFieldId,
        toFieldId: downstreamFieldId,
        fromTableId: foreignTableId,
        toTableId: seedTableId,
        kind: 'cross_record',
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
      seedTableId,
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      changedFieldIds: [cycleAFieldId],
      changeType: 'update',
      cyclePolicy: 'skip',
      impact: {
        valueFieldIds: [cycleAFieldId],
        linkFieldIds: [cycleAFieldId],
      },
    });

    expect(planResult.isOk()).toBe(true);
    const plan = planResult._unsafeUnwrap();
    const plannedFieldIds = new Set(
      plan.steps.flatMap((step) => step.fieldIds.map((id) => id.toString()))
    );

    expect(plannedFieldIds.has(cycleAFieldId.toString())).toBe(false);
    expect(plannedFieldIds.has(cycleBFieldId.toString())).toBe(false);
    expect(plannedFieldIds.has(downstreamFieldId.toString())).toBe(true);
    expect(plan.cycleInfo?.unsortedFieldIds).toEqual(
      expect.arrayContaining([cycleAFieldId.toString(), cycleBFieldId.toString()])
    );
  });

  describe('conditionalFiltered propagation mode', () => {
    /**
     * Setup:
     * - Products table: Name (primary), Category (singleSelect), Price (number)
     * - Reports table: Report (primary), ConditionalRollup (sum of Products.Price where Category = 'Electronics')
     *
     * The conditionalRollup filter references Category field (conditionFieldIds).
     * When we update:
     * - Price field: should use conditionalFiltered mode (filter fields unchanged)
     * - Category field: should use allTargetRecords mode (filter field changed)
     */

    const baseId = BaseId.create(`bse${'x'.repeat(16)}`)._unsafeUnwrap();
    const productsTableId = TableId.create(`tbl${'p'.repeat(16)}`)._unsafeUnwrap();
    const reportsTableId = TableId.create(`tbl${'r'.repeat(16)}`)._unsafeUnwrap();
    const productNameFieldId = FieldId.create(`fld${'1'.repeat(16)}`)._unsafeUnwrap();
    const categoryFieldId = FieldId.create(`fld${'2'.repeat(16)}`)._unsafeUnwrap();
    const priceFieldId = FieldId.create(`fld${'3'.repeat(16)}`)._unsafeUnwrap();
    const reportNameFieldId = FieldId.create(`fld${'4'.repeat(16)}`)._unsafeUnwrap();
    const conditionalRollupFieldId = FieldId.create(`fld${'5'.repeat(16)}`)._unsafeUnwrap();
    const recordId = RecordId.create(`rec${'z'.repeat(16)}`)._unsafeUnwrap();

    // Filter DTO representing: WHERE Category = 'Electronics'
    const filterDto = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: categoryFieldId.toString(),
          operator: 'is',
          value: 'electronics-choice-id',
        },
      ],
    };

    const fields: FieldMeta[] = [
      {
        id: productNameFieldId,
        tableId: productsTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: categoryFieldId,
        tableId: productsTableId,
        type: 'singleSelect',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: priceFieldId,
        tableId: productsTableId,
        type: 'number',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: reportNameFieldId,
        tableId: reportsTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: conditionalRollupFieldId,
        tableId: reportsTableId,
        type: 'conditionalRollup',
        isComputed: true,
        options: null,
        lookupOptions: null,
        conditionalOptions: {
          foreignTableId: productsTableId.toString(),
          lookupFieldId: priceFieldId.toString(),
          conditionFieldIds: [categoryFieldId.toString()],
          filterDto,
        },
      },
    ];

    // Edge from Price field to conditionalRollup (cross_record, conditional_rollup_source)
    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: priceFieldId,
        toFieldId: conditionalRollupFieldId,
        fromTableId: productsTableId,
        toTableId: reportsTableId,
        kind: 'cross_record',
        semantic: 'conditional_rollup_source',
      },
      // Edge from Category field to conditionalRollup (for filter dependencies)
      {
        fromFieldId: categoryFieldId,
        toFieldId: conditionalRollupFieldId,
        fromTableId: productsTableId,
        toTableId: reportsTableId,
        kind: 'cross_record',
        semantic: 'conditional_rollup_source',
      },
    ];

    const createPlanner = () => {
      const fieldsById = new Map<string, FieldMeta>(
        fields.map((field) => [field.id.toString(), field])
      );
      const graphData: FieldDependencyGraphData = { fieldsById, edges };
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      return new ComputedUpdatePlanner(graph as never);
    };

    it('uses conditionalFiltered mode when updating non-filter field (Price)', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [priceFieldId], // Price is NOT a filter field
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Should have step for conditionalRollup
      const rollupStep = plan.steps.find((step) =>
        step.fieldIds.some((id) => id.equals(conditionalRollupFieldId))
      );
      expect(rollupStep).toBeDefined();

      // Should have edge with conditionalFiltered mode
      const conditionalEdge = plan.edges.find(
        (edge) =>
          edgeTargetsField(edge, conditionalRollupFieldId) &&
          edge.propagationMode === 'conditionalFiltered'
      );
      expect(conditionalEdge).toBeDefined();
      expect(conditionalEdge?.filterCondition).toBeDefined();
      expect(conditionalEdge?.filterCondition?.filterDto).toEqual(filterDto);
    });

    it('derives before-image requirements only for source-side filter fields', async () => {
      const planner = createPlanner();

      const requirementResult = await planner.resolveBeforeImageRequirements({
        baseId,
        seedTableId: productsTableId,
        changedFieldIds: [categoryFieldId],
        changeType: 'update',
      });

      expect(requirementResult.isOk()).toBe(true);
      expect(requirementResult._unsafeUnwrap()).toEqual({
        needsBeforeImage: true,
        requiredFieldIds: [categoryFieldId],
      });
    });

    it('skips before-image requirements when only non-filter source fields change', async () => {
      const planner = createPlanner();

      const requirementResult = await planner.resolveBeforeImageRequirements({
        baseId,
        seedTableId: productsTableId,
        changedFieldIds: [priceFieldId],
        changeType: 'update',
      });

      expect(requirementResult.isOk()).toBe(true);
      expect(requirementResult._unsafeUnwrap()).toEqual({
        needsBeforeImage: false,
        requiredFieldIds: [],
      });
    });

    it('uses allTargetRecords mode when updating filter field (Category)', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [categoryFieldId], // Category IS a filter field
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Should have step for conditionalRollup
      const rollupStep = plan.steps.find((step) =>
        step.fieldIds.some((id) => id.equals(conditionalRollupFieldId))
      );
      expect(rollupStep).toBeDefined();

      // Should have edge with allTargetRecords mode (conservative fallback)
      const allTargetEdge = plan.edges.find(
        (edge) =>
          edgeTargetsField(edge, conditionalRollupFieldId) &&
          edge.propagationMode === 'allTargetRecords'
      );
      expect(allTargetEdge).toBeDefined();
      // No filterCondition when using allTargetRecords
      expect(allTargetEdge?.filterCondition).toBeUndefined();
    });

    it('uses conditionalFiltered with before-image when updating filter field and old values are available', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        beforeImageRecords: [
          {
            recordId,
            fieldValuesByDbName: {
              col_category: 'electronics-choice-id',
            },
          },
        ],
        changedFieldIds: [categoryFieldId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const conditionalEdge = plan.edges.find(
        (edge) =>
          edgeTargetsField(edge, conditionalRollupFieldId) &&
          edge.propagationMode === 'conditionalFiltered'
      );
      expect(conditionalEdge?.filterCondition?.includeBeforeImage).toBe(true);
      expect(conditionalEdge?.filterCondition?.filterDto).toEqual(filterDto);
      expect(conditionalEdge?.allTargetRecordsReasons).toBeUndefined();
    });

    it('annotates conditional allTargetRecords edges with explicit reasons', async () => {
      const planner = createPlanner();

      const updatePlanResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [categoryFieldId],
        changeType: 'update',
      });
      expect(updatePlanResult.isOk()).toBe(true);
      const updatePlan = updatePlanResult._unsafeUnwrap();
      const updateEdge = updatePlan.edges.find((edge) =>
        edgeTargetsField(edge, conditionalRollupFieldId)
      );
      expect(updateEdge?.allTargetRecordsReasons).toEqual(['conditional_filter_field_changed']);

      const deletePlanResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [priceFieldId],
        changeType: 'delete',
      });
      expect(deletePlanResult.isOk()).toBe(true);
      const deletePlan = deletePlanResult._unsafeUnwrap();
      const deleteEdge = deletePlan.edges.find((edge) =>
        edgeTargetsField(edge, conditionalRollupFieldId)
      );
      expect(deleteEdge?.allTargetRecordsReasons).toEqual(['conditional_delete']);
    });

    it('uses allTargetRecords mode for DELETE operations', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [priceFieldId], // Even non-filter field
        changeType: 'delete', // DELETE always uses allTargetRecords
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // For DELETE, steps targeting the seed table should be filtered out
      // But edges for dirty propagation should still exist
      const conditionalEdge = plan.edges.find((edge) =>
        edgeTargetsField(edge, conditionalRollupFieldId)
      );
      // Should use allTargetRecords for DELETE
      expect(conditionalEdge?.propagationMode).toBe('allTargetRecords');
    });

    it('uses conditionalFiltered with before-image when deleting conditional sources and old values are available', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        beforeImageRecords: [
          {
            recordId,
            fieldValuesByDbName: {
              col_category: 'electronics-choice-id',
              col_price: 42,
            },
          },
        ],
        changedFieldIds: [priceFieldId],
        changeType: 'delete',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const conditionalEdge = plan.edges.find(
        (edge) =>
          edgeTargetsField(edge, conditionalRollupFieldId) &&
          edge.propagationMode === 'conditionalFiltered'
      );
      expect(conditionalEdge?.filterCondition?.includeBeforeImage).toBe(true);
      expect(conditionalEdge?.allTargetRecordsReasons).toBeUndefined();
    });

    it('keeps seed-table steps for same-table conditionalRollup on DELETE', async () => {
      const sameTableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
      const samePriceFieldId = FieldId.create(`fld${'6'.repeat(16)}`)._unsafeUnwrap();
      const sameCategoryFieldId = FieldId.create(`fld${'7'.repeat(16)}`)._unsafeUnwrap();
      const sameConditionalRollupFieldId = FieldId.create(`fld${'8'.repeat(16)}`)._unsafeUnwrap();
      const sameFormulaFieldId = FieldId.create(`fld${'9'.repeat(16)}`)._unsafeUnwrap();
      const sameRecordId = RecordId.create(`rec${'t'.repeat(16)}`)._unsafeUnwrap();

      const sameFilterDto = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: sameCategoryFieldId.toString(),
            operator: 'is',
            value: 'electronics-choice-id',
          },
        ],
      };

      const sameTableFields: FieldMeta[] = [
        {
          id: sameCategoryFieldId,
          tableId: sameTableId,
          type: 'singleSelect',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: samePriceFieldId,
          tableId: sameTableId,
          type: 'number',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: sameConditionalRollupFieldId,
          tableId: sameTableId,
          type: 'conditionalRollup',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: {
            foreignTableId: sameTableId.toString(),
            lookupFieldId: samePriceFieldId.toString(),
            conditionFieldIds: [sameCategoryFieldId.toString()],
            filterDto: sameFilterDto,
          },
        },
        {
          id: sameFormulaFieldId,
          tableId: sameTableId,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ];

      const sameTableEdges: FieldDependencyEdge[] = [
        {
          fromFieldId: samePriceFieldId,
          toFieldId: sameConditionalRollupFieldId,
          fromTableId: sameTableId,
          toTableId: sameTableId,
          kind: 'cross_record',
          semantic: 'conditional_rollup_source',
        },
        {
          fromFieldId: sameCategoryFieldId,
          toFieldId: sameConditionalRollupFieldId,
          fromTableId: sameTableId,
          toTableId: sameTableId,
          kind: 'cross_record',
          semantic: 'conditional_rollup_source',
        },
        {
          fromFieldId: samePriceFieldId,
          toFieldId: sameFormulaFieldId,
          fromTableId: sameTableId,
          toTableId: sameTableId,
          kind: 'same_record',
          semantic: 'formula_ref',
        },
      ];

      const sameFieldsById = new Map<string, FieldMeta>(
        sameTableFields.map((field) => [field.id.toString(), field])
      );
      const graphData: FieldDependencyGraphData = {
        fieldsById: sameFieldsById,
        edges: sameTableEdges,
      };
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      const planner = new ComputedUpdatePlanner(graph as never);

      const planResult = await planner.planStage({
        baseId,
        seedTableId: sameTableId,
        seedRecordIds: [sameRecordId],
        extraSeedRecords: [],
        changedFieldIds: [samePriceFieldId],
        changeType: 'delete',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const sameTableStep = plan.steps.find((step) => step.tableId.equals(sameTableId));
      expect(sameTableStep).toBeDefined();
      expect(
        sameTableStep?.fieldIds.some((fieldId) => fieldId.equals(sameConditionalRollupFieldId))
      ).toBe(true);
      expect(sameTableStep?.fieldIds.some((fieldId) => fieldId.equals(sameFormulaFieldId))).toBe(
        false
      );

      const sameTableEdge = plan.edges.find((edge) =>
        edgeTargetsField(edge, sameConditionalRollupFieldId)
      );
      expect(sameTableEdge?.toTableId.equals(sameTableId)).toBe(true);
      expect(sameTableEdge?.propagationMode).toBe('allTargetRecords');
    });

    it('uses allTargetRecords mode when filter field and value field are both changed', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: productsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [priceFieldId, categoryFieldId], // Both changed
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // When filter field is changed, should use allTargetRecords
      const edge = plan.edges.find((edge) => edgeTargetsField(edge, conditionalRollupFieldId));
      expect(edge?.propagationMode).toBe('allTargetRecords');
    });
  });

  describe('conditionalLookup propagation mode', () => {
    const baseId = BaseId.create(`bse${'y'.repeat(16)}`)._unsafeUnwrap();
    const itemsTableId = TableId.create(`tbl${'i'.repeat(16)}`)._unsafeUnwrap();
    const dashboardTableId = TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap();
    const itemNameFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const statusFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const labelFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const dashboardNameFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const conditionalLookupFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
    const recordId = RecordId.create(`rec${'w'.repeat(16)}`)._unsafeUnwrap();

    // Filter DTO representing: WHERE Status = 'Active'
    const filterDto = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: statusFieldId.toString(),
          operator: 'is',
          value: 'active-choice-id',
        },
      ],
    };

    const fields: FieldMeta[] = [
      {
        id: itemNameFieldId,
        tableId: itemsTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: statusFieldId,
        tableId: itemsTableId,
        type: 'singleSelect',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: labelFieldId,
        tableId: itemsTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: dashboardNameFieldId,
        tableId: dashboardTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: conditionalLookupFieldId,
        tableId: dashboardTableId,
        type: 'conditionalLookup',
        isComputed: true,
        options: null,
        lookupOptions: null,
        conditionalOptions: {
          foreignTableId: itemsTableId.toString(),
          lookupFieldId: labelFieldId.toString(),
          conditionFieldIds: [statusFieldId.toString()],
          filterDto,
        },
      },
    ];

    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: labelFieldId,
        toFieldId: conditionalLookupFieldId,
        fromTableId: itemsTableId,
        toTableId: dashboardTableId,
        kind: 'cross_record',
        semantic: 'conditional_lookup_source',
      },
      {
        fromFieldId: statusFieldId,
        toFieldId: conditionalLookupFieldId,
        fromTableId: itemsTableId,
        toTableId: dashboardTableId,
        kind: 'cross_record',
        semantic: 'conditional_lookup_source',
      },
    ];

    const createPlanner = () => {
      const fieldsById = new Map<string, FieldMeta>(
        fields.map((field) => [field.id.toString(), field])
      );
      const graphData: FieldDependencyGraphData = { fieldsById, edges };
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      return new ComputedUpdatePlanner(graph as never);
    };

    it('uses conditionalFiltered mode when updating lookup source field (Label)', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: itemsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [labelFieldId], // Label is NOT a filter field
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const conditionalEdge = plan.edges.find(
        (edge) =>
          edgeTargetsField(edge, conditionalLookupFieldId) &&
          edge.propagationMode === 'conditionalFiltered'
      );
      expect(conditionalEdge).toBeDefined();
      expect(conditionalEdge?.filterCondition?.filterDto).toEqual(filterDto);
    });

    it('uses allTargetRecords mode when updating filter field (Status)', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: itemsTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [statusFieldId], // Status IS a filter field
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const allTargetEdge = plan.edges.find(
        (edge) =>
          edgeTargetsField(edge, conditionalLookupFieldId) &&
          edge.propagationMode === 'allTargetRecords'
      );
      expect(allTargetEdge).toBeDefined();
    });
  });

  describe('filtered lookup/rollup propagation mode', () => {
    const baseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
    const sourceTableId = TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap();
    const hostTableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
    const statusFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
    const labelFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const amountFieldId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
    const filteredLookupFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
    const filteredRollupFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
    const recordId = RecordId.create(`rec${'s'.repeat(16)}`)._unsafeUnwrap();

    const filterDto = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: statusFieldId.toString(),
          operator: 'is',
          value: 'Active',
        },
      ],
    };

    const fields: FieldMeta[] = [
      {
        id: statusFieldId,
        tableId: sourceTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: labelFieldId,
        tableId: sourceTableId,
        type: 'singleLineText',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: amountFieldId,
        tableId: sourceTableId,
        type: 'number',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: linkFieldId,
        tableId: hostTableId,
        type: 'link',
        isComputed: true,
        options: {
          foreignTableId: sourceTableId.toString(),
          lookupFieldId: labelFieldId.toString(),
        },
        lookupOptions: null,
        conditionalOptions: null,
      },
      {
        id: filteredLookupFieldId,
        tableId: hostTableId,
        type: 'lookup',
        isComputed: true,
        options: null,
        lookupOptions: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: sourceTableId.toString(),
          lookupFieldId: labelFieldId.toString(),
          filterFieldIds: [statusFieldId.toString()],
          filterDto,
        },
        conditionalOptions: null,
      },
      {
        id: filteredRollupFieldId,
        tableId: hostTableId,
        type: 'rollup',
        isComputed: true,
        options: null,
        lookupOptions: {
          linkFieldId: linkFieldId.toString(),
          foreignTableId: sourceTableId.toString(),
          lookupFieldId: amountFieldId.toString(),
          filterFieldIds: [statusFieldId.toString()],
          filterDto,
        },
        conditionalOptions: null,
      },
    ];

    const edges: FieldDependencyEdge[] = [
      {
        fromFieldId: labelFieldId,
        toFieldId: filteredLookupFieldId,
        fromTableId: sourceTableId,
        toTableId: hostTableId,
        kind: 'cross_record',
        linkFieldId,
        semantic: 'lookup_source',
      },
      {
        fromFieldId: statusFieldId,
        toFieldId: filteredLookupFieldId,
        fromTableId: sourceTableId,
        toTableId: hostTableId,
        kind: 'cross_record',
        linkFieldId,
        semantic: 'lookup_source',
      },
      {
        fromFieldId: amountFieldId,
        toFieldId: filteredRollupFieldId,
        fromTableId: sourceTableId,
        toTableId: hostTableId,
        kind: 'cross_record',
        linkFieldId,
        semantic: 'rollup_source',
      },
      {
        fromFieldId: statusFieldId,
        toFieldId: filteredRollupFieldId,
        fromTableId: sourceTableId,
        toTableId: hostTableId,
        kind: 'cross_record',
        linkFieldId,
        semantic: 'rollup_source',
      },
    ];

    const createPlanner = () => {
      const fieldsById = new Map<string, FieldMeta>(
        fields.map((field) => [field.id.toString(), field])
      );
      const graphData: FieldDependencyGraphData = { fieldsById, edges };
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      return new ComputedUpdatePlanner(graph as never);
    };

    it('uses linkTraversal mode when updating a lookup filter field', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: sourceTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [statusFieldId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const lookupEdge = plan.edges.find((edge) => edgeTargetsField(edge, filteredLookupFieldId));
      expect(lookupEdge?.propagationMode).toBe('linkTraversal');
      expect(lookupEdge?.linkFieldId?.equals(linkFieldId)).toBe(true);
    });

    it('deduplicates propagation edges that share the same traversal path', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: sourceTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [labelFieldId, amountFieldId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      expect(plan.edges).toHaveLength(1);
      expect(plan.edges[0]?.propagationMode).toBe('linkTraversal');
      expect(plan.edges[0]?.linkFieldId?.equals(linkFieldId)).toBe(true);
      expect(
        plan.edges[0]?.propagationTargetFieldIds?.map((fieldId) => fieldId.toString())
      ).toEqual([filteredLookupFieldId.toString(), filteredRollupFieldId.toString()]);
    });

    it('keeps delete on filtered rollup as allTargetRecords', async () => {
      const planner = createPlanner();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: sourceTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [statusFieldId],
        changeType: 'delete',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const rollupEdge = plan.edges.find((edge) => edgeTargetsField(edge, filteredRollupFieldId));
      expect(rollupEdge?.propagationMode).toBe('allTargetRecords');
    });

    it('uses linkTraversal when deleting a filtered rollup over a junction-backed link', async () => {
      const fieldsById = new Map<string, FieldMeta>(
        fields.map((field) => [
          field.id.toString(),
          field.id.equals(linkFieldId)
            ? {
                ...field,
                options: {
                  foreignTableId: sourceTableId.toString(),
                  lookupFieldId: labelFieldId.toString(),
                  relationship: 'manyMany',
                },
              }
            : field,
        ])
      );
      const graphData: FieldDependencyGraphData = { fieldsById, edges };
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      const planner = new ComputedUpdatePlanner(graph as never);

      const planResult = await planner.planStage({
        baseId,
        seedTableId: sourceTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [statusFieldId],
        changeType: 'delete',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      const rollupEdge = plan.edges.find((edge) => edgeTargetsField(edge, filteredRollupFieldId));
      expect(rollupEdge?.propagationMode).toBe('linkTraversal');
      expect(rollupEdge?.linkFieldId?.equals(linkFieldId)).toBe(true);
    });

    it.each(['manyOne', 'oneOne'] as const)(
      'uses linkTraversal when deleting a filtered rollup over an fk-hosted %s link',
      async (relationship) => {
        const fieldsById = new Map<string, FieldMeta>(
          fields.map((field) => [
            field.id.toString(),
            field.id.equals(linkFieldId)
              ? {
                  ...field,
                  options: {
                    foreignTableId: sourceTableId.toString(),
                    lookupFieldId: labelFieldId.toString(),
                    relationship,
                  },
                }
              : field,
          ])
        );
        const graphData: FieldDependencyGraphData = { fieldsById, edges };
        const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
        const planner = new ComputedUpdatePlanner(graph as never);

        const planResult = await planner.planStage({
          baseId,
          seedTableId: sourceTableId,
          seedRecordIds: [recordId],
          extraSeedRecords: [],
          changedFieldIds: [statusFieldId],
          changeType: 'delete',
        });

        expect(planResult.isOk()).toBe(true);
        const plan = planResult._unsafeUnwrap();

        const rollupEdge = plan.edges.find((edge) => edgeTargetsField(edge, filteredRollupFieldId));
        expect(rollupEdge?.propagationMode).toBe('linkTraversal');
        expect(rollupEdge?.linkFieldId?.equals(linkFieldId)).toBe(true);
      }
    );

    it('skips delete propagation when the target table is already extra-seeded', async () => {
      const planner = createPlanner();
      const hostRecordId = RecordId.create(`rec${'t'.repeat(16)}`)._unsafeUnwrap();

      const planResult = await planner.planStage({
        baseId,
        seedTableId: sourceTableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [{ tableId: hostTableId, recordIds: [hostRecordId] }],
        changedFieldIds: [statusFieldId],
        changeType: 'delete',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      expect(plan.edges).toHaveLength(0);
      expect(
        plan.steps.some((step) =>
          step.fieldIds.some((fieldId) => fieldId.equals(filteredLookupFieldId))
        )
      ).toBe(true);
      expect(
        plan.steps.some((step) =>
          step.fieldIds.some((fieldId) => fieldId.equals(filteredRollupFieldId))
        )
      ).toBe(true);
    });
  });

  describe('no-seed schema update propagation', () => {
    it('keeps same-table recomputation steps without adding a redundant self allTargetRecords edge', async () => {
      const baseId = BaseId.create(`bse${'n'.repeat(16)}`)._unsafeUnwrap();
      const tableId = TableId.create(`tbl${'w'.repeat(16)}`)._unsafeUnwrap();
      const foreignTableId = TableId.create(`tbl${'x'.repeat(16)}`)._unsafeUnwrap();
      const foreignNameFieldId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();
      const linkFieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();
      const lookupFieldId = FieldId.create(`fld${'0'.repeat(16)}`)._unsafeUnwrap();

      const fields: FieldMeta[] = [
        {
          id: foreignNameFieldId,
          tableId: foreignTableId,
          type: 'singleLineText',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: linkFieldId,
          tableId,
          type: 'link',
          isComputed: true,
          options: {
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: foreignNameFieldId.toString(),
          },
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: lookupFieldId,
          tableId,
          type: 'lookup',
          isComputed: true,
          options: null,
          lookupOptions: {
            linkFieldId: linkFieldId.toString(),
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: foreignNameFieldId.toString(),
          },
          conditionalOptions: null,
        },
      ];

      const edges: FieldDependencyEdge[] = [
        {
          fromFieldId: linkFieldId,
          toFieldId: lookupFieldId,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'lookup_link',
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
        seedTableId: tableId,
        seedRecordIds: [],
        extraSeedRecords: [],
        changedFieldIds: [linkFieldId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      expect(
        plan.steps.some(
          (step) =>
            step.tableId.equals(tableId) &&
            step.fieldIds.some((fieldId) => fieldId.equals(linkFieldId))
        )
      ).toBe(true);
      expect(
        plan.steps.some(
          (step) =>
            step.tableId.equals(tableId) &&
            step.fieldIds.some((fieldId) => fieldId.equals(lookupFieldId))
        )
      ).toBe(true);
      expect(plan.edges).toHaveLength(0);
    });
  });

  describe('symmetric propagation pruning', () => {
    it('skips symmetric propagation when the foreign table is already extra-seeded', async () => {
      const baseId = BaseId.create(`bse${'q'.repeat(16)}`)._unsafeUnwrap();
      const hostTableId = TableId.create(`tbl${'1'.repeat(16)}`)._unsafeUnwrap();
      const foreignTableId = TableId.create(`tbl${'2'.repeat(16)}`)._unsafeUnwrap();
      const hostLinkFieldId = FieldId.create(`fld${'3'.repeat(16)}`)._unsafeUnwrap();
      const foreignLinkFieldId = FieldId.create(`fld${'4'.repeat(16)}`)._unsafeUnwrap();
      const hostRecordId = RecordId.create(`rec${'5'.repeat(16)}`)._unsafeUnwrap();
      const foreignRecordId = RecordId.create(`rec${'6'.repeat(16)}`)._unsafeUnwrap();

      const fields: FieldMeta[] = [
        {
          id: hostLinkFieldId,
          tableId: hostTableId,
          type: 'link',
          isComputed: true,
          options: {
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: hostLinkFieldId.toString(),
            symmetricFieldId: foreignLinkFieldId.toString(),
            relationship: 'manyMany',
          },
          lookupOptions: null,
          conditionalOptions: null,
        },
      ];

      const graphData: FieldDependencyGraphData = {
        fieldsById: new Map(fields.map((field) => [field.id.toString(), field])),
        edges: [],
      };
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      const planner = new ComputedUpdatePlanner(graph as never);

      const planResult = await planner.planStage({
        baseId,
        seedTableId: hostTableId,
        seedRecordIds: [hostRecordId],
        extraSeedRecords: [{ tableId: foreignTableId, recordIds: [foreignRecordId] }],
        changedFieldIds: [hostLinkFieldId],
        changeType: 'update',
        impact: {
          valueFieldIds: [],
          linkFieldIds: [hostLinkFieldId],
        },
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      expect(plan.edges).toHaveLength(0);
      expect(
        plan.steps.some((step) =>
          step.fieldIds.some((fieldId) => fieldId.equals(foreignLinkFieldId))
        )
      ).toBe(true);
    });
  });

  describe('delete seed-table retention', () => {
    it('keeps self-referential cross-record dependents when same-table allTargetRecords refresh is retained', async () => {
      const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
      const tableId = TableId.create(`tbl${'n'.repeat(16)}`)._unsafeUnwrap();
      const recordId = RecordId.create(`rec${'o'.repeat(16)}`)._unsafeUnwrap();
      const statusFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
      const selfLinkFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
      const conditionalFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
      const selfLookupFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();

      const fields: FieldMeta[] = [
        {
          id: statusFieldId,
          tableId,
          type: 'singleSelect',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: selfLinkFieldId,
          tableId,
          type: 'link',
          isComputed: true,
          options: {
            foreignTableId: tableId.toString(),
            lookupFieldId: statusFieldId.toString(),
            relationship: 'manyMany',
          },
          lookupOptions: null,
          conditionalOptions: null,
        },
        {
          id: conditionalFieldId,
          tableId,
          type: 'conditionalRollup',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: {
            foreignTableId: tableId.toString(),
            lookupFieldId: statusFieldId.toString(),
            linkFieldId: selfLinkFieldId.toString(),
            conditionFieldIds: [statusFieldId.toString()],
            filterDto: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusFieldId.toString(),
                  operator: 'is',
                  value: 'active',
                },
              ],
            },
          },
        },
        {
          id: selfLookupFieldId,
          tableId,
          type: 'lookup',
          isComputed: true,
          options: null,
          lookupOptions: {
            linkFieldId: selfLinkFieldId.toString(),
            foreignTableId: tableId.toString(),
            lookupFieldId: conditionalFieldId.toString(),
          },
          conditionalOptions: null,
        },
      ];

      const edges: FieldDependencyEdge[] = [
        {
          fromFieldId: selfLinkFieldId,
          toFieldId: conditionalFieldId,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'conditional_rollup_link',
        },
        {
          fromFieldId: statusFieldId,
          toFieldId: conditionalFieldId,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'cross_record',
          linkFieldId: selfLinkFieldId,
          semantic: 'conditional_rollup_source',
        },
        {
          fromFieldId: selfLinkFieldId,
          toFieldId: selfLookupFieldId,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'same_record',
          semantic: 'lookup_link',
        },
        {
          fromFieldId: conditionalFieldId,
          toFieldId: selfLookupFieldId,
          fromTableId: tableId,
          toTableId: tableId,
          kind: 'cross_record',
          linkFieldId: selfLinkFieldId,
          semantic: 'lookup_source',
        },
      ];

      const graphData: FieldDependencyGraphData = {
        fieldsById: new Map(fields.map((field) => [field.id.toString(), field])),
        edges,
      };
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      const planner = new ComputedUpdatePlanner(graph as never);

      const planResult = await planner.planStage({
        baseId,
        seedTableId: tableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        changedFieldIds: [statusFieldId],
        changeType: 'delete',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      expect(
        plan.edges.find((edge) => edgeTargetsField(edge, conditionalFieldId))?.propagationMode
      ).toBe('allTargetRecords');
      expect(
        plan.steps.some((step) =>
          step.fieldIds.some((fieldId) => fieldId.equals(conditionalFieldId))
        )
      ).toBe(true);
      expect(
        plan.steps.some((step) =>
          step.fieldIds.some((fieldId) => fieldId.equals(selfLookupFieldId))
        )
      ).toBe(true);
    });
  });
});
