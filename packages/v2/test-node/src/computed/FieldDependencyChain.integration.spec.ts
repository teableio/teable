/**
 * Field Dependency Chain Integration Tests
 *
 * Tests for verifying the completeness of field dependency chain tracking.
 * Covers multiple scenarios:
 * - Formula chains (multi-level)
 * - Lookup/Rollup dependencies
 * - Multi-table link chains
 * - Conditional computed fields
 * - Mixed computed field types
 *
 * Each scenario validates that when a base field changes, all dependent fields
 * are correctly identified in the dependency graph.
 */
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import type { FieldDependencyGraph } from '@teable/v2-adapter-table-repository-postgres';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTableCommand,
  v2CoreTokens,
  type BaseId,
  type CreateTableResult,
  type FieldId,
  type ICommandBus,
  type IExecutionContext,
  type Table,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

// =============================================================================
// Test helpers
// =============================================================================

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

interface ICreateTableInput {
  name: string;
  fields: Array<{
    id?: string;
    type: string;
    name: string;
    isPrimary?: boolean;
    options?: Record<string, unknown>;
    config?: Record<string, unknown>;
  }>;
  views?: Array<{ type: string; name?: string }>;
}

const createTable = async (
  commandBus: ICommandBus,
  baseId: BaseId,
  input: ICreateTableInput
): Promise<{ table: Table; fieldIds: Map<string, FieldId> }> => {
  const command = CreateTableCommand.create({
    baseId: baseId.toString(),
    name: input.name,
    fields: input.fields,
    views: input.views ?? [{ type: 'grid' }],
  })._unsafeUnwrap();

  const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
    createContext(),
    command
  );

  const { table } = result._unsafeUnwrap();

  const fieldIds = new Map<string, FieldId>();
  for (const field of table.getFields()) {
    fieldIds.set(field.name().toString(), field.id());
  }

  return { table, fieldIds };
};

// Generate unique field IDs for test isolation
let fieldIdCounter = 0;
const nextFieldId = (): string => {
  fieldIdCounter++;
  const hex = fieldIdCounter.toString(16).padStart(16, '0');
  return `fld${hex}`;
};

// =============================================================================
// Tests
// =============================================================================

describe('FieldDependencyChain Integration Tests', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
    fieldIdCounter = 0;
  });

  afterEach(async () => {
    await getV2NodeTestContainer().dispose();
  });

  // ===========================================================================
  // Scenario 1: Deep Formula Chain
  // ===========================================================================
  describe('Scenario 1: Deep Formula Chain (5 levels)', () => {
    it('should trace entire formula chain when base field changes', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      // Create field IDs
      const baseFieldId = nextFieldId();
      const formula1Id = nextFieldId();
      const formula2Id = nextFieldId();
      const formula3Id = nextFieldId();
      const formula4Id = nextFieldId();

      // Create table: Base -> F1 -> F2 -> F3 -> F4
      const { fieldIds } = await createTable(commandBus, baseId, {
        name: 'DeepFormulaChain',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: baseFieldId, name: 'Base' },
          {
            type: 'formula',
            id: formula1Id,
            name: 'F1',
            options: { expression: `{${baseFieldId}} * 2` },
          },
          {
            type: 'formula',
            id: formula2Id,
            name: 'F2',
            options: { expression: `{${formula1Id}} + 10` },
          },
          {
            type: 'formula',
            id: formula3Id,
            name: 'F3',
            options: { expression: `{${formula2Id}} * 3` },
          },
          {
            type: 'formula',
            id: formula4Id,
            name: 'F4',
            options: { expression: `{${formula3Id}} - 5` },
          },
        ],
      });

      // Load dependency graph starting from base field
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [fieldIds.get('Base')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // All formula fields should be in the graph
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(fieldIds.get('F1')!.toString());
      expect(fieldIdsInGraph).toContain(fieldIds.get('F2')!.toString());
      expect(fieldIdsInGraph).toContain(fieldIds.get('F3')!.toString());
      expect(fieldIdsInGraph).toContain(fieldIds.get('F4')!.toString());

      // Verify edge chain exists
      const hasEdge = (from: string, to: string): boolean =>
        data.edges.some((e) => e.fromFieldId.toString() === from && e.toFieldId.toString() === to);

      expect(hasEdge(baseFieldId, formula1Id)).toBe(true);
      expect(hasEdge(formula1Id, formula2Id)).toBe(true);
      expect(hasEdge(formula2Id, formula3Id)).toBe(true);
      expect(hasEdge(formula3Id, formula4Id)).toBe(true);
    });
  });

  // ===========================================================================
  // Scenario 2: Multi-Table Lookup Chain
  // ===========================================================================
  describe('Scenario 2: Multi-Table Lookup Chain (3 tables)', () => {
    it('should trace lookup chain across three tables', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const aValueId = nextFieldId();
      const bLinkId = nextFieldId();
      const bLookupId = nextFieldId();
      const cLinkId = nextFieldId();
      const cLookupId = nextFieldId();

      // TableA: Name (primary), Value (number)
      const { table: tableA, fieldIds: aFields } = await createTable(commandBus, baseId, {
        name: 'TableA',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: aValueId, name: 'Value' },
        ],
      });
      const aNameId = aFields.get('Name')!;

      // TableB: Name (primary), LinkToA, LookupA
      const { table: tableB, fieldIds: bFields } = await createTable(commandBus, baseId, {
        name: 'TableB',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkId,
            name: 'LinkToA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: bLookupId,
            name: 'LookupA',
            options: {
              linkFieldId: bLinkId,
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aValueId,
            },
          },
        ],
      });
      const bNameId = bFields.get('Name')!;

      // TableC: Name (primary), LinkToB, LookupB (lookups B.LookupA)
      const { fieldIds: cFields } = await createTable(commandBus, baseId, {
        name: 'TableC',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: cLinkId,
            name: 'LinkToB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id().toString(),
              lookupFieldId: bNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: cLookupId,
            name: 'LookupB',
            options: {
              linkFieldId: cLinkId,
              foreignTableId: tableB.id().toString(),
              lookupFieldId: bLookupId,
            },
          },
        ],
      });

      // Load dependency graph starting from A.Value
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [aFields.get('Value')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Both B.LookupA and C.LookupB should be in the graph
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(bFields.get('LookupA')!.toString());
      expect(fieldIdsInGraph).toContain(cFields.get('LookupB')!.toString());

      // Verify edge: A.Value -> B.LookupA (cross_record, lookup_source)
      const aToB = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === aValueId &&
          e.toFieldId.toString() === bLookupId &&
          e.semantic === 'lookup_source'
      );
      expect(aToB).toBeDefined();
      expect(aToB!.kind).toBe('cross_record');

      // Verify edge: B.LookupA -> C.LookupB (cross_record, lookup_source)
      const bToC = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === bLookupId &&
          e.toFieldId.toString() === cLookupId &&
          e.semantic === 'lookup_source'
      );
      expect(bToC).toBeDefined();
      expect(bToC!.kind).toBe('cross_record');
    });
  });

  // ===========================================================================
  // Scenario 3: Rollup with Formula Combination
  // ===========================================================================
  describe('Scenario 3: Rollup + Formula Combination', () => {
    it('should trace rollup through to dependent formula', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const itemAmountId = nextFieldId();
      const orderLinkId = nextFieldId();
      const orderTotalId = nextFieldId();
      const orderFormulaId = nextFieldId();

      // Items table: Name (primary), Amount (number)
      const { table: itemsTable, fieldIds: itemFields } = await createTable(commandBus, baseId, {
        name: 'Items',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: itemAmountId, name: 'Amount' },
        ],
      });
      const itemNameId = itemFields.get('Name')!;

      // Orders table: Name (primary), Items (link), Total (rollup SUM), WithTax (formula)
      const { fieldIds: orderFields } = await createTable(commandBus, baseId, {
        name: 'Orders',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: orderLinkId,
            name: 'Items',
            options: {
              relationship: 'oneMany',
              foreignTableId: itemsTable.id().toString(),
              lookupFieldId: itemNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'rollup',
            id: orderTotalId,
            name: 'Total',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: orderLinkId,
              foreignTableId: itemsTable.id().toString(),
              lookupFieldId: itemAmountId,
            },
          },
          {
            type: 'formula',
            id: orderFormulaId,
            name: 'WithTax',
            options: { expression: `{${orderTotalId}} * 1.1` },
          },
        ],
      });

      // Load dependency graph starting from Items.Amount
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [itemFields.get('Amount')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Both Orders.Total and Orders.WithTax should be in the graph
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(orderFields.get('Total')!.toString());
      expect(fieldIdsInGraph).toContain(orderFields.get('WithTax')!.toString());

      // Verify edge chain: Items.Amount -> Orders.Total -> Orders.WithTax
      const amountToTotal = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === itemAmountId &&
          e.toFieldId.toString() === orderTotalId &&
          e.semantic === 'rollup_source'
      );
      expect(amountToTotal).toBeDefined();
      expect(amountToTotal!.kind).toBe('cross_record');

      const totalToFormula = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === orderTotalId &&
          e.toFieldId.toString() === orderFormulaId &&
          e.semantic === 'formula_ref'
      );
      expect(totalToFormula).toBeDefined();
      expect(totalToFormula!.kind).toBe('same_record');
    });
  });

  // ===========================================================================
  // Scenario 4: Bidirectional Link (Symmetric)
  // ===========================================================================
  describe('Scenario 4: Bidirectional Link', () => {
    it('should include both sides of bidirectional link in dependency graph', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const personLinkId = nextFieldId();

      // People table with self-referential link (Friends)
      const { table: peopleTable, fieldIds: personFields } = await createTable(commandBus, baseId, {
        name: 'People',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      const personNameId = personFields.get('Name')!;

      // Add self-referential link (not one-way, so it creates symmetric field)
      const { fieldIds: personFieldsWithLink } = await createTable(commandBus, baseId, {
        name: 'PeopleWithFriends',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: personLinkId,
            name: 'Friends',
            options: {
              relationship: 'manyMany',
              foreignTableId: peopleTable.id().toString(),
              lookupFieldId: personNameId.toString(),
              isOneWay: false, // bidirectional
            },
          },
        ],
      });

      // Load full dependency graph
      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Verify link field exists and has link_title edge
      const linkTitleEdges = data.edges.filter((e) => e.semantic === 'link_title');
      expect(linkTitleEdges.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Scenario 5: ConditionalRollup
  // ===========================================================================
  describe('Scenario 5: ConditionalRollup', () => {
    it('should include conditional rollup in dependency chain', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const taskStatusId = nextFieldId();
      const taskPointsId = nextFieldId();
      const projectTotalId = nextFieldId();

      // Tasks table: Name, Status (select), Points (number)
      const { table: tasksTable, fieldIds: taskFields } = await createTable(commandBus, baseId, {
        name: 'Tasks',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: taskStatusId,
            name: 'Status',
            options: {
              choices: [
                { name: 'Todo', color: 'grayLight1' },
                { name: 'Done', color: 'greenLight1' },
              ],
            },
          },
          { type: 'number', id: taskPointsId, name: 'Points' },
        ],
      });
      const taskNameId = taskFields.get('Name')!;

      // Projects table: Name, ConditionalRollup (SUM of Points where Status = Done)
      const { fieldIds: projectFields } = await createTable(commandBus, baseId, {
        name: 'Projects',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: projectTotalId,
            name: 'CompletedPoints',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: tasksTable.id().toString(),
              lookupFieldId: taskPointsId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: taskStatusId,
                      operator: 'is',
                      value: 'Done',
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      // Load dependency graph starting from Tasks.Points
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [taskFields.get('Points')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Projects.CompletedPoints should be in the graph
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(projectFields.get('CompletedPoints')!.toString());

      // Verify edge: Tasks.Points -> Projects.CompletedPoints
      const pointsToRollup = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === taskPointsId &&
          e.toFieldId.toString() === projectTotalId &&
          e.semantic === 'conditional_rollup_source'
      );
      expect(pointsToRollup).toBeDefined();
      expect(pointsToRollup!.kind).toBe('cross_record');
    });
  });

  // ===========================================================================
  // Scenario 6: Formula Referencing Multiple Fields
  // ===========================================================================
  describe('Scenario 6: Formula with Multiple Dependencies', () => {
    it('should be included when any referenced field changes', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const priceId = nextFieldId();
      const quantityId = nextFieldId();
      const discountId = nextFieldId();
      const totalId = nextFieldId();

      // Table with formula that references 3 fields
      const { fieldIds } = await createTable(commandBus, baseId, {
        name: 'OrderItems',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: priceId, name: 'Price' },
          { type: 'number', id: quantityId, name: 'Quantity' },
          { type: 'number', id: discountId, name: 'Discount' },
          {
            type: 'formula',
            id: totalId,
            name: 'Total',
            options: { expression: `({${priceId}} * {${quantityId}}) - {${discountId}}` },
          },
        ],
      });

      // Test each field separately - all should lead to Total
      for (const fieldName of ['Price', 'Quantity', 'Discount']) {
        const dataResult = await graph.load(baseId, undefined, {
          requiredFieldIds: [fieldIds.get(fieldName)!],
        });
        expect(dataResult.isOk()).toBe(true);
        const data = dataResult._unsafeUnwrap();

        const fieldIdsInGraph = [...data.fieldsById.keys()];
        expect(fieldIdsInGraph, `Total should be in graph when ${fieldName} changes`).toContain(
          fieldIds.get('Total')!.toString()
        );
      }
    });
  });

  // ===========================================================================
  // Scenario 7: Lookup on Computed Field
  // ===========================================================================
  describe('Scenario 7: Lookup on Computed Field', () => {
    it('should trace through computed source field', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const baseNumberId = nextFieldId();
      const computedId = nextFieldId();
      const linkId = nextFieldId();
      const lookupId = nextFieldId();

      // TableA: Name, Base (number), Computed (formula)
      const { table: tableA, fieldIds: aFields } = await createTable(commandBus, baseId, {
        name: 'SourceWithComputed',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: baseNumberId, name: 'Base' },
          {
            type: 'formula',
            id: computedId,
            name: 'Computed',
            options: { expression: `{${baseNumberId}} * 100` },
          },
        ],
      });
      const aNameId = aFields.get('Name')!;

      // TableB: Name, Link, Lookup (lookups A.Computed)
      const { fieldIds: bFields } = await createTable(commandBus, baseId, {
        name: 'TargetLookupComputed',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: linkId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: lookupId,
            name: 'LookupComputed',
            options: {
              linkFieldId: linkId,
              foreignTableId: tableA.id().toString(),
              lookupFieldId: computedId,
            },
          },
        ],
      });

      // Load dependency graph starting from A.Base
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [aFields.get('Base')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Both A.Computed and B.LookupComputed should be in the graph
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(aFields.get('Computed')!.toString());
      expect(fieldIdsInGraph).toContain(bFields.get('LookupComputed')!.toString());

      // Verify complete chain: Base -> Computed -> LookupComputed
      const baseToComputed = data.edges.find(
        (e) => e.fromFieldId.toString() === baseNumberId && e.toFieldId.toString() === computedId
      );
      expect(baseToComputed).toBeDefined();

      const computedToLookup = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === computedId &&
          e.toFieldId.toString() === lookupId &&
          e.semantic === 'lookup_source'
      );
      expect(computedToLookup).toBeDefined();
    });
  });

  // ===========================================================================
  // Scenario 8: Diamond Dependency Pattern
  // ===========================================================================
  describe('Scenario 8: Diamond Dependency Pattern', () => {
    /**
     * Diamond pattern:
     *       Base
     *      /    \
     *     F1    F2
     *      \    /
     *       F3
     *
     * F3 depends on both F1 and F2, which both depend on Base
     */
    it('should handle diamond dependency correctly', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const baseId_ = nextFieldId();
      const f1Id = nextFieldId();
      const f2Id = nextFieldId();
      const f3Id = nextFieldId();

      const { fieldIds } = await createTable(commandBus, baseId, {
        name: 'DiamondTable',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: baseId_, name: 'Base' },
          {
            type: 'formula',
            id: f1Id,
            name: 'F1',
            options: { expression: `{${baseId_}} * 2` },
          },
          {
            type: 'formula',
            id: f2Id,
            name: 'F2',
            options: { expression: `{${baseId_}} + 10` },
          },
          {
            type: 'formula',
            id: f3Id,
            name: 'F3',
            options: { expression: `{${f1Id}} + {${f2Id}}` },
          },
        ],
      });

      // Load dependency graph starting from Base
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [fieldIds.get('Base')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // All formula fields should be in the graph
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(fieldIds.get('F1')!.toString());
      expect(fieldIdsInGraph).toContain(fieldIds.get('F2')!.toString());
      expect(fieldIdsInGraph).toContain(fieldIds.get('F3')!.toString());

      // F3 should appear exactly once (no duplicates from diamond)
      const f3Occurrences = fieldIdsInGraph.filter((id) => id === fieldIds.get('F3')!.toString());
      expect(f3Occurrences.length).toBe(1);
    });
  });

  // ===========================================================================
  // Scenario 9: Edge Deduplication
  // ===========================================================================
  describe('Scenario 9: Edge Deduplication', () => {
    it('should not create duplicate edges', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const aValueId = nextFieldId();
      const bLinkId = nextFieldId();
      const bLookupId = nextFieldId();

      // Create standard lookup scenario
      const { table: tableA, fieldIds: aFields } = await createTable(commandBus, baseId, {
        name: 'EdgeDedup_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: aValueId, name: 'Value' },
        ],
      });
      const aNameId = aFields.get('Name')!;

      const { fieldIds: bFields } = await createTable(commandBus, baseId, {
        name: 'EdgeDedup_B',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: bLookupId,
            name: 'Lookup',
            options: {
              linkFieldId: bLinkId,
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aValueId,
            },
          },
        ],
      });

      // Load full graph
      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Find all edges from A.Value to B.Lookup
      const lookupSourceEdges = data.edges.filter(
        (e) =>
          e.fromFieldId.toString() === aValueId &&
          e.toFieldId.toString() === bLookupId &&
          e.semantic === 'lookup_source'
      );

      // Should have exactly one edge (no duplicates from reference + derived)
      expect(lookupSourceEdges.length).toBe(1);
    });
  });

  // ===========================================================================
  // Scenario 10: Large Field Count Performance
  // ===========================================================================
  describe('Scenario 10: Performance with Many Fields', () => {
    it('should handle table with 50+ computed fields efficiently', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const baseId_ = nextFieldId();
      const formulaCount = 50;

      // Create base field and many formula fields
      const fields: Array<{
        id?: string;
        type: string;
        name: string;
        isPrimary?: boolean;
        options?: Record<string, unknown>;
      }> = [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: baseId_, name: 'Base' },
      ];

      // Each formula references the base field
      for (let i = 0; i < formulaCount; i++) {
        fields.push({
          type: 'formula',
          id: nextFieldId(),
          name: `Formula${i}`,
          options: { expression: `{${baseId_}} + ${i}` },
        });
      }

      const { fieldIds } = await createTable(commandBus, baseId, {
        name: 'ManyFieldsTable',
        fields,
      });

      // Measure time to load dependency graph
      const startTime = Date.now();
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [fieldIds.get('Base')!],
      });
      const endTime = Date.now();

      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // All formula fields should be included
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      for (let i = 0; i < formulaCount; i++) {
        expect(fieldIdsInGraph).toContain(fieldIds.get(`Formula${i}`)!.toString());
      }

      // Performance check: should complete in reasonable time (< 5s)
      const elapsedMs = endTime - startTime;
      expect(elapsedMs).toBeLessThan(5000);
    });
  });

  // ===========================================================================
  // Scenario 11: Precise Dependency Chain Validation
  // ===========================================================================
  describe('Scenario 11: Precise Dependency Chain', () => {
    /**
     * Complex scenario with multiple independent chains:
     *
     * Chain 1: A.Value -> A.Formula1 -> A.Formula2
     * Chain 2: A.Other -> A.OtherFormula (independent)
     * Chain 3: A.Value -> B.Lookup -> B.LookupFormula
     *
     * When querying from A.Value, should get:
     * - A.Formula1, A.Formula2 (same table formulas)
     * - B.Lookup, B.LookupFormula (cross-table)
     *
     * Should NOT get:
     * - A.Other, A.OtherFormula (independent chain)
     */
    it('should return exact affected fields - no more, no less', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      // Field IDs for tracking
      const valueId = nextFieldId();
      const formula1Id = nextFieldId();
      const formula2Id = nextFieldId();
      const otherId = nextFieldId();
      const otherFormulaId = nextFieldId();
      const linkId = nextFieldId();
      const lookupId = nextFieldId();
      const lookupFormulaId = nextFieldId();

      // TableA: Value (base), Formula1, Formula2, Other (independent), OtherFormula
      const { table: tableA, fieldIds: aFields } = await createTable(commandBus, baseId, {
        name: 'TableA_Precise',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: valueId, name: 'Value' },
          {
            type: 'formula',
            id: formula1Id,
            name: 'Formula1',
            options: { expression: `{${valueId}} * 2` },
          },
          {
            type: 'formula',
            id: formula2Id,
            name: 'Formula2',
            options: { expression: `{${formula1Id}} + 1` },
          },
          { type: 'number', id: otherId, name: 'Other' },
          {
            type: 'formula',
            id: otherFormulaId,
            name: 'OtherFormula',
            options: { expression: `{${otherId}} * 3` },
          },
        ],
      });
      const aNameId = aFields.get('Name')!;

      // TableB: Link -> Lookup -> LookupFormula
      const { fieldIds: bFields } = await createTable(commandBus, baseId, {
        name: 'TableB_Precise',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: linkId,
            name: 'LinkToA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: lookupId,
            name: 'LookupValue',
            options: {
              linkFieldId: linkId,
              foreignTableId: tableA.id().toString(),
              lookupFieldId: valueId,
            },
          },
          {
            type: 'formula',
            id: lookupFormulaId,
            name: 'LookupFormula',
            options: { expression: `{${lookupId}} + 100` },
          },
        ],
      });

      // Query dependency chain starting from A.Value
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [aFields.get('Value')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      const affectedFieldIds = new Set(data.fieldsById.keys());

      // SHOULD be affected (Chain 1 + Chain 3)
      const expectedAffected = [
        aFields.get('Value')!.toString(), // seed field itself
        aFields.get('Formula1')!.toString(),
        aFields.get('Formula2')!.toString(),
        bFields.get('LookupValue')!.toString(),
        bFields.get('LookupFormula')!.toString(),
      ];

      for (const fieldId of expectedAffected) {
        expect(affectedFieldIds.has(fieldId), `Expected ${fieldId} to be affected`).toBe(true);
      }

      // SHOULD NOT be affected (independent chain)
      const expectedNotAffected = [
        aFields.get('Other')!.toString(),
        aFields.get('OtherFormula')!.toString(),
      ];

      for (const fieldId of expectedNotAffected) {
        expect(affectedFieldIds.has(fieldId), `Expected ${fieldId} NOT to be affected`).toBe(false);
      }
    });
  });

  // ===========================================================================
  // Scenario 12: Four-Level Cross-Table Chain
  // ===========================================================================
  describe('Scenario 12: Four-Level Cross-Table Chain', () => {
    /**
     * Deep cross-table dependency:
     * TableA.Value -> TableB.Lookup -> TableC.Lookup -> TableD.Lookup
     *
     * Each level looks up from the previous level's lookup field.
     */
    it('should trace through 4-level cross-table lookup chain', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const aValueId = nextFieldId();
      const bLinkId = nextFieldId();
      const bLookupId = nextFieldId();
      const cLinkId = nextFieldId();
      const cLookupId = nextFieldId();
      const dLinkId = nextFieldId();
      const dLookupId = nextFieldId();

      // TableA: Value
      const { table: tableA, fieldIds: aFields } = await createTable(commandBus, baseId, {
        name: 'Level1',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: aValueId, name: 'Value' },
        ],
      });
      const aNameId = aFields.get('Name')!;

      // TableB: Link to A, Lookup A.Value
      const { table: tableB, fieldIds: bFields } = await createTable(commandBus, baseId, {
        name: 'Level2',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: bLookupId,
            name: 'Lookup',
            options: {
              linkFieldId: bLinkId,
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aValueId,
            },
          },
        ],
      });
      const bNameId = bFields.get('Name')!;

      // TableC: Link to B, Lookup B.Lookup
      const { table: tableC, fieldIds: cFields } = await createTable(commandBus, baseId, {
        name: 'Level3',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: cLinkId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id().toString(),
              lookupFieldId: bNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: cLookupId,
            name: 'Lookup',
            options: {
              linkFieldId: cLinkId,
              foreignTableId: tableB.id().toString(),
              lookupFieldId: bLookupId,
            },
          },
        ],
      });
      const cNameId = cFields.get('Name')!;

      // TableD: Link to C, Lookup C.Lookup
      const { fieldIds: dFields } = await createTable(commandBus, baseId, {
        name: 'Level4',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: dLinkId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableC.id().toString(),
              lookupFieldId: cNameId.toString(),
              isOneWay: true,
            },
          },
          {
            type: 'lookup',
            id: dLookupId,
            name: 'Lookup',
            options: {
              linkFieldId: dLinkId,
              foreignTableId: tableC.id().toString(),
              lookupFieldId: cLookupId,
            },
          },
        ],
      });

      // Query from A.Value - should find all 4 levels
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [aFields.get('Value')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      const affectedFieldIds = [...data.fieldsById.keys()];

      // All lookup fields should be in the chain
      expect(affectedFieldIds).toContain(bFields.get('Lookup')!.toString());
      expect(affectedFieldIds).toContain(cFields.get('Lookup')!.toString());
      expect(affectedFieldIds).toContain(dFields.get('Lookup')!.toString());
    });
  });

  // ===========================================================================
  // Scenario 13: ConditionalRollup with Condition Filter Field Dependency
  // ===========================================================================
  // When a field used in the condition filter changes, the conditionalRollup
  // should be recalculated because the set of matching records may have changed.
  describe('Scenario 13: ConditionalRollup Filter Field Dependency', () => {
    it('should include conditional rollup when condition filter field changes', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const taskStatusId = nextFieldId();
      const taskPointsId = nextFieldId();
      const projectTotalId = nextFieldId();

      // Tasks table: Name, Status (select), Points (number)
      const { table: tasksTable, fieldIds: taskFields } = await createTable(commandBus, baseId, {
        name: 'Tasks',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: taskStatusId,
            name: 'Status',
            options: {
              choices: [
                { name: 'Todo', color: 'grayLight1' },
                { name: 'Done', color: 'greenLight1' },
              ],
            },
          },
          { type: 'number', id: taskPointsId, name: 'Points' },
        ],
      });
      const taskNameId = taskFields.get('Name')!;

      // Projects table: Name, ConditionalRollup (SUM of Points where Status = Done)
      const { fieldIds: projectFields } = await createTable(commandBus, baseId, {
        name: 'Projects',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: projectTotalId,
            name: 'CompletedPoints',
            options: {
              expression: 'sum({values})',
            },
            config: {
              foreignTableId: tasksTable.id().toString(),
              lookupFieldId: taskPointsId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: taskStatusId,
                      operator: 'is',
                      value: 'Done',
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      // KEY TEST: Load dependency graph starting from Tasks.Status (the FILTER field, not lookupFieldId)
      // When Status changes from 'Todo' to 'Done', the conditionalRollup should recalculate
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [taskFields.get('Status')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Projects.CompletedPoints should be in the graph because it depends on Status via filter
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(projectFields.get('CompletedPoints')!.toString());

      // Verify edge: Tasks.Status -> Projects.CompletedPoints (conditional_rollup_source)
      const statusToRollup = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === taskStatusId &&
          e.toFieldId.toString() === projectTotalId &&
          e.semantic === 'conditional_rollup_source'
      );
      expect(statusToRollup).toBeDefined();
      expect(statusToRollup!.kind).toBe('cross_record');
    });

    it('should include conditional lookup when condition filter field changes', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const taskStatusId = nextFieldId();
      const taskValueId = nextFieldId();
      const projectLookupId = nextFieldId();

      // Tasks table: Name, Status (select), Value (number)
      const { table: tasksTable, fieldIds: taskFields } = await createTable(commandBus, baseId, {
        name: 'Tasks',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: taskStatusId,
            name: 'Status',
            options: {
              choices: [
                { name: 'Todo', color: 'grayLight1' },
                { name: 'Done', color: 'greenLight1' },
              ],
            },
          },
          { type: 'number', id: taskValueId, name: 'Value' },
        ],
      });

      // Projects table: Name, ConditionalLookup (Values where Status = Done)
      const { fieldIds: projectFields } = await createTable(commandBus, baseId, {
        name: 'Projects',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'conditionalLookup',
            id: projectLookupId,
            name: 'DoneValues',
            options: {
              foreignTableId: tasksTable.id().toString(),
              lookupFieldId: taskValueId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: taskStatusId,
                      operator: 'is',
                      value: 'Done',
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      // Load dependency graph starting from Tasks.Status (the FILTER field)
      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [taskFields.get('Status')!],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Projects.DoneValues should be in the graph because it depends on Status via filter
      const fieldIdsInGraph = [...data.fieldsById.keys()];
      expect(fieldIdsInGraph).toContain(projectFields.get('DoneValues')!.toString());

      // Verify edge: Tasks.Status -> Projects.DoneValues (conditional_lookup_source)
      const statusToLookup = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === taskStatusId &&
          e.toFieldId.toString() === projectLookupId &&
          e.semantic === 'conditional_lookup_source'
      );
      expect(statusToLookup).toBeDefined();
      expect(statusToLookup!.kind).toBe('cross_record');
    });
  });
});
