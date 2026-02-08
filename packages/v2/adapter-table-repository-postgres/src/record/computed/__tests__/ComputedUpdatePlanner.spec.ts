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
          edge.toFieldId.equals(conditionalRollupFieldId) &&
          edge.propagationMode === 'conditionalFiltered'
      );
      expect(conditionalEdge).toBeDefined();
      expect(conditionalEdge?.filterCondition).toBeDefined();
      expect(conditionalEdge?.filterCondition?.filterDto).toEqual(filterDto);
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
          edge.toFieldId.equals(conditionalRollupFieldId) &&
          edge.propagationMode === 'allTargetRecords'
      );
      expect(allTargetEdge).toBeDefined();
      // No filterCondition when using allTargetRecords
      expect(allTargetEdge?.filterCondition).toBeUndefined();
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
        edge.toFieldId.equals(conditionalRollupFieldId)
      );
      // Should use allTargetRecords for DELETE
      expect(conditionalEdge?.propagationMode).toBe('allTargetRecords');
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
      const edge = plan.edges.find((edge) => edge.toFieldId.equals(conditionalRollupFieldId));
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
          edge.toFieldId.equals(conditionalLookupFieldId) &&
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
          edge.toFieldId.equals(conditionalLookupFieldId) &&
          edge.propagationMode === 'allTargetRecords'
      );
      expect(allTargetEdge).toBeDefined();
    });
  });
});
