/**
 * FieldDependencyGraph integration tests.
 *
 * These tests verify the edge generation logic including:
 * - Edge kind classification (same_record vs cross_record)
 * - Semantic hints for debugging
 * - Link field ID association for cross_record edges
 *
 * Uses real database via createV2NodeTestContainer.
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

// =============================================================================
// Tests
// =============================================================================

describe('FieldDependencyGraph (db)', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  afterEach(async () => {
    await getV2NodeTestContainer().dispose();
  });

  describe('edge classification', () => {
    it('classifies formula ref as same_record', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { table, baseFieldId, formula1FieldId, formula2FieldId } =
        await createFormulaChainTable(commandBus, baseId);

      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Find edges related to our formula chain
      const baseToFormula1 = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === baseFieldId.toString() &&
          e.toFieldId.toString() === formula1FieldId.toString()
      );

      const formula1ToFormula2 = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === formula1FieldId.toString() &&
          e.toFieldId.toString() === formula2FieldId.toString()
      );

      // Both should be same_record edges
      expect(baseToFormula1).toBeDefined();
      expect(baseToFormula1!.kind).toBe('same_record');
      expect(baseToFormula1!.semantic).toBe('formula_ref');
      expect(baseToFormula1!.linkFieldId).toBeUndefined();

      expect(formula1ToFormula2).toBeDefined();
      expect(formula1ToFormula2!.kind).toBe('same_record');
      expect(formula1ToFormula2!.semantic).toBe('formula_ref');

      // All edges should be in the same table
      expect(baseToFormula1!.fromTableId.equals(table.id())).toBe(true);
      expect(baseToFormula1!.toTableId.equals(table.id())).toBe(true);
    });

    it('classifies lookup source as cross_record with correct linkFieldId', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { tableA, tableB, aValueFieldId, bLinkFieldId, bLookupFieldId } =
        await createLookupScenario(commandBus, baseId);

      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Find the cross-table lookup edge: A.Value -> B.LookupValue
      const lookupSourceEdge = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === aValueFieldId.toString() &&
          e.toFieldId.toString() === bLookupFieldId.toString()
      );

      expect(lookupSourceEdge).toBeDefined();
      expect(lookupSourceEdge!.kind).toBe('cross_record');
      expect(lookupSourceEdge!.semantic).toBe('lookup_source');
      expect(lookupSourceEdge!.linkFieldId).toBeDefined();
      expect(lookupSourceEdge!.linkFieldId!.toString()).toBe(bLinkFieldId.toString());

      // Verify table IDs
      expect(lookupSourceEdge!.fromTableId.equals(tableA.id())).toBe(true);
      expect(lookupSourceEdge!.toTableId.equals(tableB.id())).toBe(true);
    });

    it('classifies lookup_link as same_record', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { tableB, bLinkFieldId, bLookupFieldId } = await createLookupScenario(
        commandBus,
        baseId
      );

      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Find the lookup_link edge: B.Link -> B.LookupValue
      const lookupLinkEdge = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === bLinkFieldId.toString() &&
          e.toFieldId.toString() === bLookupFieldId.toString() &&
          e.semantic === 'lookup_link'
      );

      expect(lookupLinkEdge).toBeDefined();
      expect(lookupLinkEdge!.kind).toBe('same_record');
      expect(lookupLinkEdge!.linkFieldId).toBeUndefined();

      // Both fields are in the same table
      expect(lookupLinkEdge!.fromTableId.equals(tableB.id())).toBe(true);
      expect(lookupLinkEdge!.toTableId.equals(tableB.id())).toBe(true);
    });
  });

  describe('semantic hints', () => {
    it('tags formula references with formula_ref semantic', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { baseFieldId, formula1FieldId } = await createFormulaChainTable(commandBus, baseId);

      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      const formulaRefEdge = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === baseFieldId.toString() &&
          e.toFieldId.toString() === formula1FieldId.toString()
      );

      expect(formulaRefEdge).toBeDefined();
      expect(formulaRefEdge!.semantic).toBe('formula_ref');
    });

    it('tags lookup source with lookup_source semantic', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { aValueFieldId, bLookupFieldId } = await createLookupScenario(commandBus, baseId);

      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      const lookupSourceEdge = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === aValueFieldId.toString() &&
          e.toFieldId.toString() === bLookupFieldId.toString()
      );

      expect(lookupSourceEdge).toBeDefined();
      expect(lookupSourceEdge!.semantic).toBe('lookup_source');
    });

    it('tags link title dependency with link_title semantic', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { tableA, bLinkFieldId } = await createLookupScenario(commandBus, baseId);

      // Get the Name field from table A (the lookup field for link)
      const aNameField = tableA.getFields().find((f) => f.name().toString() === 'Name');
      expect(aNameField).toBeDefined();

      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Link field depends on the primary field of foreign table (link_title)
      const linkTitleEdge = data.edges.find(
        (e) =>
          e.fromFieldId.toString() === aNameField!.id().toString() &&
          e.toFieldId.toString() === bLinkFieldId.toString() &&
          e.semantic === 'link_title'
      );

      expect(linkTitleEdge).toBeDefined();
      expect(linkTitleEdge!.kind).toBe('cross_record');
    });
  });

  describe('field metadata', () => {
    it('loads all fields in the base', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { baseFieldId, formula1FieldId, formula2FieldId } = await createFormulaChainTable(
        commandBus,
        baseId
      );

      const dataResult = await graph.load(baseId, undefined, {
        requiredFieldIds: [baseFieldId, formula1FieldId, formula2FieldId],
      });
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Should have all fields from the table
      const fieldIds = [...data.fieldsById.keys()];
      expect(fieldIds).toContain(baseFieldId.toString());
      expect(fieldIds).toContain(formula1FieldId.toString());
      expect(fieldIds).toContain(formula2FieldId.toString());
    });

    it('marks computed fields correctly', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const graph = container.resolve<FieldDependencyGraph>(
        v2RecordRepositoryPostgresTokens.computedDependencyGraph
      );

      const { bLookupFieldId } = await createLookupScenario(commandBus, baseId);

      const dataResult = await graph.load(baseId);
      expect(dataResult.isOk()).toBe(true);
      const data = dataResult._unsafeUnwrap();

      // Lookup field should be marked as computed
      const lookupMeta = data.fieldsById.get(bLookupFieldId.toString());
      expect(lookupMeta).toBeDefined();
      expect(lookupMeta!.isComputed).toBe(true);
    });
  });
});
