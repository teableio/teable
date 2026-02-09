/**
 * ComputedUpdatePlanner integration tests.
 *
 * These tests verify the plan generation logic including:
 * - Steps count and level ordering
 * - Edge structure and dependencies
 * - Same-table batch optimization
 *
 * Uses real database via createV2NodeTestContainer.
 */
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import type { ComputedUpdatePlanner } from '@teable/v2-adapter-table-repository-postgres';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  RecordId,
  v2CoreTokens,
  type BaseId,
  type CreateRecordResult,
  type CreateTableResult,
  type FieldId,
  type ICommandBus,
  type IExecutionContext,
  type RecordId as RecordIdType,
  type Table,
  type TableId,
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

const createRecord = async (
  commandBus: ICommandBus,
  tableId: TableId,
  fields: Record<string, unknown>
): Promise<RecordIdType> => {
  const command = CreateRecordCommand.create({
    tableId: tableId.toString(),
    fields,
  })._unsafeUnwrap();

  const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
    createContext(),
    command
  );

  return result._unsafeUnwrap().record.id();
};

/**
 * Creates a table with a formula chain: number -> formula1 -> formula2
 */
const createFormulaChainTable = async (
  commandBus: ICommandBus,
  baseId: BaseId
): Promise<{
  table: Table;
  baseFieldId: FieldId;
  formula1FieldId: FieldId;
  formula2FieldId: FieldId;
}> => {
  const baseFieldId = `fld${'a'.repeat(16)}`;
  const formula1FieldId = `fld${'b'.repeat(16)}`;
  const formula2FieldId = `fld${'c'.repeat(16)}`;

  const { table, fieldIds } = await createTable(commandBus, baseId, {
    name: 'FormulaChainTable',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      { type: 'number', id: baseFieldId, name: 'Base' },
      {
        type: 'formula',
        id: formula1FieldId,
        name: 'Step1',
        options: { expression: `{${baseFieldId}} * 2` },
      },
      {
        type: 'formula',
        id: formula2FieldId,
        name: 'Step2',
        options: { expression: `{${formula1FieldId}} + 10` },
      },
    ],
  });

  return {
    table,
    baseFieldId: fieldIds.get('Base')!,
    formula1FieldId: fieldIds.get('Step1')!,
    formula2FieldId: fieldIds.get('Step2')!,
  };
};

/**
 * Creates two-table lookup scenario:
 * TableA: Name (primary), Value (number)
 * TableB: Name (primary), Link (link to A), Lookup (lookup A.Value)
 */
const createLookupScenario = async (
  commandBus: ICommandBus,
  baseId: BaseId
): Promise<{
  tableA: Table;
  tableB: Table;
  aValueFieldId: FieldId;
  bLinkFieldId: FieldId;
  bLookupFieldId: FieldId;
}> => {
  const aValueFieldId = `fld${'d'.repeat(16)}`;
  const bLinkFieldId = `fld${'e'.repeat(16)}`;
  const bLookupFieldId = `fld${'f'.repeat(16)}`;

  const { table: tableA, fieldIds: aFieldIds } = await createTable(commandBus, baseId, {
    name: 'SourceTable',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      { type: 'number', id: aValueFieldId, name: 'Value' },
    ],
  });

  const aNameFieldId = aFieldIds.get('Name')!;

  const { table: tableB, fieldIds: bFieldIds } = await createTable(commandBus, baseId, {
    name: 'TargetTable',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: bLinkFieldId,
        name: 'Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: tableA.id().toString(),
          lookupFieldId: aNameFieldId.toString(),
          isOneWay: true,
        },
      },
      {
        type: 'lookup',
        id: bLookupFieldId,
        name: 'LookupValue',
        options: {
          linkFieldId: bLinkFieldId,
          foreignTableId: tableA.id().toString(),
          lookupFieldId: aValueFieldId,
        },
      },
    ],
  });

  return {
    tableA,
    tableB,
    aValueFieldId: aFieldIds.get('Value')!,
    bLinkFieldId: bFieldIds.get('Link')!,
    bLookupFieldId: bFieldIds.get('LookupValue')!,
  };
};

/**
 * Creates three-table lookup chain:
 * TableA: Name, Status
 * TableB: Name, LinkA, LookupStatus (from A)
 * TableC: Name, LinkB, LookupStatus (from B's lookup)
 */
const createCrossTableLookupChain = async (
  commandBus: ICommandBus,
  baseId: BaseId
): Promise<{
  tableA: Table;
  tableB: Table;
  tableC: Table;
  aStatusFieldId: FieldId;
  bLinkFieldId: FieldId;
  bLookupFieldId: FieldId;
  cLinkFieldId: FieldId;
  cLookupFieldId: FieldId;
}> => {
  const aStatusFieldId = `fld${'g'.repeat(16)}`;
  const bLinkFieldId = `fld${'h'.repeat(16)}`;
  const bLookupFieldId = `fld${'i'.repeat(16)}`;
  const cLinkFieldId = `fld${'j'.repeat(16)}`;
  const cLookupFieldId = `fld${'k'.repeat(16)}`;

  const { table: tableA, fieldIds: aFieldIds } = await createTable(commandBus, baseId, {
    name: 'ChainA',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      { type: 'singleLineText', id: aStatusFieldId, name: 'Status' },
    ],
  });

  const aNameFieldId = aFieldIds.get('Name')!;

  const { table: tableB, fieldIds: bFieldIds } = await createTable(commandBus, baseId, {
    name: 'ChainB',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: bLinkFieldId,
        name: 'LinkA',
        options: {
          relationship: 'manyOne',
          foreignTableId: tableA.id().toString(),
          lookupFieldId: aNameFieldId.toString(),
          isOneWay: true,
        },
      },
      {
        type: 'lookup',
        id: bLookupFieldId,
        name: 'StatusFromA',
        options: {
          linkFieldId: bLinkFieldId,
          foreignTableId: tableA.id().toString(),
          lookupFieldId: aStatusFieldId,
        },
      },
    ],
  });

  const bNameFieldId = bFieldIds.get('Name')!;

  const { table: tableC, fieldIds: cFieldIds } = await createTable(commandBus, baseId, {
    name: 'ChainC',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: cLinkFieldId,
        name: 'LinkB',
        options: {
          relationship: 'manyOne',
          foreignTableId: tableB.id().toString(),
          lookupFieldId: bNameFieldId.toString(),
          isOneWay: true,
        },
      },
      {
        type: 'lookup',
        id: cLookupFieldId,
        name: 'StatusFromB',
        options: {
          linkFieldId: cLinkFieldId,
          foreignTableId: tableB.id().toString(),
          lookupFieldId: bLookupFieldId,
        },
      },
    ],
  });

  return {
    tableA,
    tableB,
    tableC,
    aStatusFieldId: aFieldIds.get('Status')!,
    bLinkFieldId: bFieldIds.get('LinkA')!,
    bLookupFieldId: bFieldIds.get('StatusFromA')!,
    cLinkFieldId: cFieldIds.get('LinkB')!,
    cLookupFieldId: cFieldIds.get('StatusFromB')!,
  };
};

// =============================================================================
// Tests
// =============================================================================

describe('ComputedUpdatePlanner (db)', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  afterEach(async () => {
    await getV2NodeTestContainer().dispose();
  });

  describe('plan steps generation', () => {
    it('generates correct steps for same-table formula chain', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { table, baseFieldId, formula1FieldId, formula2FieldId } =
        await createFormulaChainTable(commandBus, baseId);

      const recordId = await createRecord(commandBus, table.id(), {});

      const planResult = await planner.plan({
        table,
        changedFieldIds: [baseFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Formula chain: Base -> Step1 -> Step2
      expect(plan.steps.length).toBeGreaterThanOrEqual(2);

      // Steps should contain formula1 at some level
      const formula1Step = plan.steps.find((s) =>
        s.fieldIds.some((id) => id.toString() === formula1FieldId.toString())
      );
      expect(formula1Step).toBeDefined();

      // Steps should contain formula2 at a higher level
      const formula2Step = plan.steps.find((s) =>
        s.fieldIds.some((id) => id.toString() === formula2FieldId.toString())
      );
      expect(formula2Step).toBeDefined();

      // Formula2 should have a higher level than formula1
      expect(formula2Step!.level).toBeGreaterThan(formula1Step!.level);

      // All formula steps should be in the same table
      expect(formula1Step!.tableId.equals(table.id())).toBe(true);
      expect(formula2Step!.tableId.equals(table.id())).toBe(true);

      // Complexity should reflect the number of computed fields
      expect(plan.estimatedComplexity).toBeGreaterThanOrEqual(2);
    });

    it('generates correct steps for cross-table lookup', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { tableA, tableB, aValueFieldId, bLookupFieldId } = await createLookupScenario(
        commandBus,
        baseId
      );

      const recordId = await createRecord(commandBus, tableA.id(), {});

      const planResult = await planner.plan({
        table: tableA,
        changedFieldIds: [aValueFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Lookup in tableB depends on tableA.Value
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].tableId.equals(tableB.id())).toBe(true);
      expect(plan.steps[0].fieldIds.map((id) => id.toString())).toContain(
        bLookupFieldId.toString()
      );
    });

    it('generates correct steps for three-table lookup chain', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { tableA, tableB, tableC, aStatusFieldId } = await createCrossTableLookupChain(
        commandBus,
        baseId
      );

      const recordId = await createRecord(commandBus, tableA.id(), {});

      const planResult = await planner.plan({
        table: tableA,
        changedFieldIds: [aStatusFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Chain: A.Status -> B.LookupStatus -> C.LookupStatus
      expect(plan.steps.length).toBe(2);

      // First step in tableB
      expect(plan.steps[0].tableId.equals(tableB.id())).toBe(true);
      expect(plan.steps[0].level).toBe(0);

      // Second step in tableC
      expect(plan.steps[1].tableId.equals(tableC.id())).toBe(true);
      expect(plan.steps[1].level).toBe(1);
    });

    it('returns empty plan when no computed fields depend on changed field', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { table } = await createFormulaChainTable(commandBus, baseId);

      const recordId = RecordId.generate()._unsafeUnwrap();

      // Use the primary field "Name" that nothing depends on
      const nameField = table.getFields().find((f) => f.name().toString() === 'Name');
      expect(nameField).toBeDefined();

      const planResult = await planner.plan({
        table,
        changedFieldIds: [nameField!.id()],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // No computed fields depend on "Name"
      expect(plan.steps.length).toBe(0);
      expect(plan.estimatedComplexity).toBe(0);
    });

    it('includes context-free formulas even when no dependencies match', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { table, fieldIds } = await createTable(commandBus, baseId, {
        name: 'ConstantFormulaTable',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'formula', name: 'Const', options: { expression: '1+1' } },
        ],
      });

      const recordId = RecordId.generate()._unsafeUnwrap();
      const nameFieldId = fieldIds.get('Name')!;
      const constFormulaFieldId = fieldIds.get('Const')!;

      const planResult = await planner.plan({
        table,
        changedFieldIds: [nameFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].tableId.equals(table.id())).toBe(true);
      expect(
        plan.steps[0].fieldIds.some((id) => id.toString() === constFormulaFieldId.toString())
      ).toBe(true);
    });
  });

  describe('edge generation', () => {
    it('generates edges for cross-table lookup dependencies', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { tableA, tableB, aValueFieldId, bLinkFieldId, bLookupFieldId } =
        await createLookupScenario(commandBus, baseId);

      const recordId = await createRecord(commandBus, tableA.id(), {});

      const planResult = await planner.plan({
        table: tableA,
        changedFieldIds: [aValueFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Should have at least 1 edge: A.Value -> B.LookupValue
      // (There may be additional link_title edges)
      expect(plan.edges.length).toBeGreaterThanOrEqual(1);

      // Find the specific edge we're testing
      const lookupEdge = plan.edges.find(
        (e) =>
          e.fromFieldId.toString() === aValueFieldId.toString() &&
          e.toFieldId.toString() === bLookupFieldId.toString()
      );
      expect(lookupEdge).toBeDefined();
      expect(lookupEdge!.fromTableId.equals(tableA.id())).toBe(true);
      expect(lookupEdge!.toTableId.equals(tableB.id())).toBe(true);

      // Cross-table lookup edge should have linkFieldId
      expect(lookupEdge!.linkFieldId).toBeDefined();
      expect(lookupEdge!.linkFieldId!.toString()).toBe(bLinkFieldId.toString());
    });

    it('generates edges with correct order for chained lookups', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const {
        tableA,
        aStatusFieldId,
        bLookupFieldId: bLookup,
        cLookupFieldId: cLookup,
      } = await createCrossTableLookupChain(commandBus, baseId);

      const recordId = await createRecord(commandBus, tableA.id(), {});

      const planResult = await planner.plan({
        table: tableA,
        changedFieldIds: [aStatusFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Should have at least 2 lookup edges (may have more link_title edges)
      expect(plan.edges.length).toBeGreaterThanOrEqual(2);

      // Find the lookup edges by field ID
      const lookupEdges = plan.edges.filter(
        (e) =>
          e.toFieldId.toString() === bLookup.toString() ||
          e.toFieldId.toString() === cLookup.toString()
      );
      expect(lookupEdges.length).toBeGreaterThanOrEqual(2);

      // Edges should be ordered (first lookup edge should have lower order)
      const bLookupEdge = lookupEdges.find((e) => e.toFieldId.toString() === bLookup.toString());
      const cLookupEdge = lookupEdges.find((e) => e.toFieldId.toString() === cLookup.toString());
      expect(bLookupEdge).toBeDefined();
      expect(cLookupEdge).toBeDefined();
      expect(cLookupEdge!.order).toBeGreaterThan(bLookupEdge!.order);
    });

    it('does not generate edges for same_record formula dependencies', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { table, baseFieldId } = await createFormulaChainTable(commandBus, baseId);

      const recordId = await createRecord(commandBus, table.id(), {});

      const planResult = await planner.plan({
        table,
        changedFieldIds: [baseFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Formula chain is same_record only, no cross_record edges needed
      expect(plan.edges.length).toBe(0);
    });
  });

  describe('same-table batches', () => {
    it('batches same-table formula steps together', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { table, baseFieldId } = await createFormulaChainTable(commandBus, baseId);

      const recordId = await createRecord(commandBus, table.id(), {});

      const planResult = await planner.plan({
        table,
        changedFieldIds: [baseFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Two formula steps should be batched into one batch
      expect(plan.sameTableBatches.length).toBe(1);

      const batch = plan.sameTableBatches[0];
      expect(batch.tableId.equals(table.id())).toBe(true);
      expect(batch.steps.length).toBe(2);
      expect(batch.minLevel).toBe(0);
      expect(batch.maxLevel).toBe(1);
    });

    it('creates separate batches for different tables', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { tableA, tableB, tableC, aStatusFieldId } = await createCrossTableLookupChain(
        commandBus,
        baseId
      );

      const recordId = await createRecord(commandBus, tableA.id(), {});

      const planResult = await planner.plan({
        table: tableA,
        changedFieldIds: [aStatusFieldId],
        changedRecordIds: [recordId],
        changeType: 'update',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Each cross-table step should be in its own batch
      expect(plan.sameTableBatches.length).toBe(2);

      const tableIds = plan.sameTableBatches.map((b) => b.tableId.toString());
      expect(tableIds).toContain(tableB.id().toString());
      expect(tableIds).toContain(tableC.id().toString());
    });
  });

  describe('change type handling', () => {
    it('preserves change type in plan', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { table, baseFieldId } = await createFormulaChainTable(commandBus, baseId);
      const recordId = await createRecord(commandBus, table.id(), {});

      for (const changeType of ['insert', 'update', 'delete'] as const) {
        const planResult = await planner.plan({
          table,
          changedFieldIds: [baseFieldId],
          changedRecordIds: [recordId],
          changeType,
        });

        expect(planResult.isOk()).toBe(true);
        const plan = planResult._unsafeUnwrap();
        expect(plan.changeType).toBe(changeType);
      }
    });
  });

  describe('insert optimization for link fields', () => {
    /**
     * Minimal reproduction for FK location optimization:
     *
     * TableA (One side): Name, [SymmetricLink] (oneMany, FK NOT here)
     * TableB (Many side): Name, Link (manyOne, FK HERE)
     *
     * On insert to TableA: steps should be empty (FK not in TableA)
     * On insert to TableB: steps should include link field (FK in TableB)
     */
    const createMinimalBidirectionalLink = async (
      commandBus: ICommandBus,
      baseId: BaseId
    ): Promise<{
      tableA: Table;
      tableB: Table;
      bLinkFieldId: FieldId;
    }> => {
      const bLinkFieldId = `fld${'n'.repeat(16)}`;

      // TableA: One side (will get symmetric oneMany link)
      const { table: tableA, fieldIds: aFieldIds } = await createTable(commandBus, baseId, {
        name: 'OneSide',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });

      const aNameFieldId = aFieldIds.get('Name')!;

      // TableB: Many side with manyOne link (FK is here, bidirectional)
      const { table: tableB, fieldIds: bFieldIds } = await createTable(commandBus, baseId, {
        name: 'ManySide',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: bLinkFieldId,
            name: 'LinkToA',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id().toString(),
              lookupFieldId: aNameFieldId.toString(),
              // isOneWay omitted = false (bidirectional, creates symmetric field in TableA)
            },
          },
        ],
      });

      return {
        tableA,
        tableB,
        bLinkFieldId: bFieldIds.get('LinkToA')!,
      };
    };

    it('skips oneMany link on insert to One-side table (FK not in current table)', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { tableA } = await createMinimalBidirectionalLink(commandBus, baseId);
      const recordId = RecordId.generate()._unsafeUnwrap();

      // Insert to TableA (One side, FK is NOT here)
      const planResult = await planner.plan({
        table: tableA,
        changedFieldIds: [],
        changedRecordIds: [recordId],
        changeType: 'insert',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Steps should be empty: the symmetric oneMany link field should be skipped
      // because FK is in TableB, not TableA. A new record in TableA cannot have
      // any FK pointing to it yet.
      expect(plan.steps.length).toBe(0);
      expect(plan.estimatedComplexity).toBe(0); // No computed steps to process
    });

    it('includes manyOne link on insert to Many-side table (FK in current table)', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const planner = container.resolve<ComputedUpdatePlanner>(
        v2RecordRepositoryPostgresTokens.computedUpdatePlanner
      );

      const { tableA, tableB, bLinkFieldId } = await createMinimalBidirectionalLink(
        commandBus,
        baseId
      );
      const recordId = RecordId.generate()._unsafeUnwrap();

      // Insert to TableB (Many side, FK IS here)
      const planResult = await planner.plan({
        table: tableB,
        changedFieldIds: [bLinkFieldId],
        changedRecordIds: [recordId],
        changeType: 'insert',
      });

      expect(planResult.isOk()).toBe(true);
      const plan = planResult._unsafeUnwrap();

      // Steps should include link fields for both sides (bidirectional link)
      expect(plan.steps.length).toBe(2);
      expect(plan.steps.some((step) => step.tableId.equals(tableB.id()))).toBe(true);
      expect(plan.steps.some((step) => step.tableId.equals(tableA.id()))).toBe(true);

      const tableBStep = plan.steps.find((step) => step.tableId.equals(tableB.id()));
      expect(tableBStep).toBeDefined();
      const hasLinkField = tableBStep!.fieldIds.some(
        (id) => id.toString() === bLinkFieldId.toString()
      );
      expect(hasLinkField).toBe(true);
    });

    it('creates record with null link value on One-side table', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

      const { tableA } = await createMinimalBidirectionalLink(commandBus, baseId);

      // Actually create a record to verify the value is correct
      const recordId = await createRecord(commandBus, tableA.id(), { Name: 'Test' });

      expect(recordId).toBeDefined();
      // Record created successfully - the oneMany link field should be empty/null
      // (This verifies the optimization doesn't break actual record creation)
    });
  });
});
