import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { createNewLinkField } from '../../domain/table/fields/FieldFactory';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import type { LinkField } from '../../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { ForeignTable } from '../../domain/table/ForeignTable';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import { CloneViewVisitor } from '../../domain/table/views/visitors/CloneViewVisitor';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITableRepository } from '../../ports/TableRepository';
import { FieldDeletionPreparationService } from './FieldDeletionPreparationService';
import { FieldDeletionSideEffectService } from './FieldDeletionSideEffectService';
import type { IForeignTableLoaderService } from './ForeignTableLoaderService';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

const buildTable = (options?: { readonly dependent?: boolean; readonly view?: boolean }) => {
  const targetId = fieldId('t');
  const primaryId = fieldId('p');
  const dependentId = fieldId('d');
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId('h'))
    .withName(TableName.create('Host')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(targetId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  if (options?.dependent) {
    builder
      .field()
      .formula()
      .withId(dependentId)
      .withName(FieldName.create('Computed')._unsafeUnwrap())
      .withExpression(FormulaExpression.create(`{${targetId.toString()}}`)._unsafeUnwrap())
      .done();
  }
  builder.view().defaultGrid().done();
  const built = builder.build()._unsafeUnwrap();
  if (!options?.view) return { table: built, targetId, primaryId, dependentId };

  const sourceView = built.views()[0]!;
  const view = sourceView.accept(new CloneViewVisitor())._unsafeUnwrap();
  view
    .setColumnMeta(
      ViewColumnMeta.create(sourceView.columnMeta()._unsafeUnwrap().toDto())._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  view
    .setQueryDefaults(
      ViewQueryDefaults.create({
        filter: {
          conjunction: 'and',
          items: [{ fieldId: targetId.toString(), operator: 'isGreater', value: 1 }],
        },
      })._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  return {
    table: Table.rehydrate({
      id: built.id(),
      baseId: built.baseId(),
      name: built.name(),
      fields: built.getFields(),
      views: [view],
      primaryFieldId: built.primaryFieldId(),
    })._unsafeUnwrap(),
    targetId,
    primaryId,
    dependentId,
  };
};

const createService = (tables: ReadonlyArray<Table>, loadedForeignTables: ReadonlyArray<Table>) => {
  const persistenceCalls = {
    updateOne: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
  };
  const repository = {
    findOne: vi.fn(
      async (_context: IExecutionContext, spec: ISpecification<Table, ITableSpecVisitor>) =>
        ok(tables.find((table) => spec.isSatisfiedBy(table))!)
    ),
    find: vi.fn(async () => ok(tables)),
    ...persistenceCalls,
  } as unknown as ITableRepository;
  const loader = {
    load: vi.fn(async () => ok(loadedForeignTables)),
  } as unknown as IForeignTableLoaderService;
  return {
    service: new FieldDeletionPreparationService(
      repository,
      loader,
      { prepare: FieldDeletionSideEffectService.prepare },
      new DefaultTableMapper()
    ),
    persistenceCalls,
  };
};

describe('FieldDeletionPreparationService', () => {
  it('prepares an isolated field deletion without invoking persistence', async () => {
    const fixture = buildTable();
    const harness = createService([fixture.table], []);

    const result = await harness.service.prepare(context, {
      baseId,
      tableId: fixture.table.id(),
      fieldIds: [fixture.targetId],
    });

    expect(result.isOk()).toBe(true);
    const preparation = result._unsafeUnwrap();
    expect(preparation.directTargets.map((target) => target.fieldId)).toEqual([
      fixture.targetId.toString(),
    ]);
    expect(preparation.dependentFields).toEqual([]);
    expect(preparation.views).toEqual([
      expect.objectContaining({
        viewId: fixture.table.views()[0]!.id().toString(),
        changes: ['columnMeta'],
      }),
    ]);
    expect(preparation.symmetricTargets).toEqual([]);
    expect(harness.persistenceCalls.updateOne).not.toHaveBeenCalled();
    expect(harness.persistenceCalls.delete).not.toHaveBeenCalled();
    expect(harness.persistenceCalls.insert).not.toHaveBeenCalled();
  });

  it('enumerates surviving dependent fields and affected views', async () => {
    const fixture = buildTable({ dependent: true, view: true });
    const harness = createService([fixture.table], []);

    const preparation = (
      await harness.service.prepare(context, {
        baseId,
        tableId: fixture.table.id(),
        fieldIds: [fixture.targetId],
      })
    )._unsafeUnwrap();

    expect(preparation.dependentFields).toEqual([
      expect.objectContaining({
        fieldId: fixture.dependentId.toString(),
        deletedFieldId: fixture.targetId.toString(),
      }),
    ]);
    expect(preparation.snapshotFields).toEqual([
      expect.objectContaining({ fieldId: fixture.dependentId.toString() }),
    ]);
    expect(preparation.views).toEqual([
      expect.objectContaining({
        viewId: fixture.table.views()[0]!.id().toString(),
        deletedFieldId: fixture.targetId.toString(),
        changes: expect.arrayContaining(['queryDefaults']),
      }),
    ]);

    const originalDependent = fixture.table
      .getField((field) => field.id().equals(fixture.dependentId))
      ._unsafeUnwrap();
    const undoDependent = preparation.tablesBeforeDeletionById
      .get(fixture.table.id().toString())!
      .getField((field) => field.id().equals(fixture.dependentId))
      ._unsafeUnwrap();
    expect(originalDependent.hasError().isError()).toBe(false);
    expect(undoDependent.hasError().isError()).toBe(false);
    expect(undoDependent).not.toBe(originalDependent);
  });

  it('enumerates symmetric link deletion through the execution visitor', async () => {
    const host = buildTable().table;
    const foreignFixture = buildTable();
    const foreign = Table.rehydrate({
      id: tableId('f'),
      baseId,
      name: TableName.create('Foreign')._unsafeUnwrap(),
      fields: foreignFixture.table.getFields(),
      views: foreignFixture.table.views(),
      primaryFieldId: foreignFixture.table.primaryFieldId(),
    })._unsafeUnwrap();
    const linkId = fieldId('l');
    const link = createNewLinkField({
      id: linkId,
      name: FieldName.create('Foreign link')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreign.id().toString(),
        lookupFieldId: foreign.primaryFieldId().toString(),
      })._unsafeUnwrap(),
      baseId,
      hostTableId: host.id(),
    })._unsafeUnwrap() as LinkField;
    const symmetric = link
      .buildSymmetricField({ foreignTable: ForeignTable.from(foreign), hostTable: host })
      ._unsafeUnwrap();
    const foreignWithSymmetric = foreign
      .update((mutator) => mutator.addField(symmetric, { foreignTables: [host] }))
      ._unsafeUnwrap().table;
    const hostWithLink = host
      .update((mutator) => mutator.addField(link, { foreignTables: [foreignWithSymmetric] }))
      ._unsafeUnwrap().table;
    const harness = createService([hostWithLink, foreignWithSymmetric], [foreignWithSymmetric]);

    const preparation = (
      await harness.service.prepare(context, {
        baseId,
        tableId: host.id(),
        fieldIds: [linkId],
      })
    )._unsafeUnwrap();

    expect(preparation.symmetricTargets).toEqual([
      expect.objectContaining({
        tableId: foreign.id().toString(),
        fieldId: symmetric.id().toString(),
      }),
    ]);
  });

  it('reports missing foreign metadata as unknown instead of zero impact', async () => {
    const host = buildTable().table;
    const missingForeignId = tableId('m');
    const linkId = fieldId('l');
    const link = createNewLinkField({
      id: linkId,
      name: FieldName.create('Missing link')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: missingForeignId.toString(),
        lookupFieldId: fieldId('q').toString(),
      })._unsafeUnwrap(),
      baseId,
      hostTableId: host.id(),
    })._unsafeUnwrap();
    const hostWithLink = Table.rehydrate({
      id: host.id(),
      baseId: host.baseId(),
      name: host.name(),
      fields: [...host.getFields(), link],
      views: host.views(),
      primaryFieldId: host.primaryFieldId(),
    })._unsafeUnwrap();
    const harness = createService([hostWithLink], []);

    const preparation = (
      await harness.service.prepare(context, {
        baseId,
        tableId: host.id(),
        fieldIds: [linkId],
      })
    )._unsafeUnwrap();

    expect(preparation.symmetricTargets).toEqual([]);
    expect(preparation.missingMetadata).toEqual([
      {
        kind: 'foreignTable',
        tableId: missingForeignId.toString(),
        referencedByFieldId: linkId.toString(),
        reason: 'foreign-table-not-loaded',
      },
    ]);
  });

  it('returns the same domain blocker used by detached aggregate removal', async () => {
    const fixture = buildTable();
    const harness = createService([fixture.table], []);

    const result = await harness.service.prepare(context, {
      baseId,
      tableId: fixture.table.id(),
      fieldIds: [fixture.primaryId],
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('forbidden.table.delete_primary_field');
    expect(harness.persistenceCalls.updateOne).not.toHaveBeenCalled();
  });
});
