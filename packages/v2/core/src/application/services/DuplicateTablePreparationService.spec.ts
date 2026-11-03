import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { DuplicateTableCommand } from '../../commands/DuplicateTableCommand';
import { ActorId } from '../../domain/shared/ActorId';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITablePersistenceDTO } from '../../ports/mappers/TableMapper';
import { DuplicateTablePreparationService } from './DuplicateTablePreparationService';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'b'.repeat(16)}`;
const externalTableId = `tbl${'c'.repeat(16)}`;
const primaryFieldId = `fld${'d'.repeat(16)}`;
const selfLinkFieldId = `fld${'e'.repeat(16)}`;
const selfLinkBackFieldId = `fld${'f'.repeat(16)}`;
const externalLinkFieldId = `fld${'g'.repeat(16)}`;
const externalLookupFieldId = `fld${'h'.repeat(16)}`;
const formulaFieldId = `fld${'k'.repeat(16)}`;
const viewId = `viw${'i'.repeat(16)}`;

const mapper = new DefaultTableMapper();
const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

const createSourceTable = (): Table => {
  const dto: ITablePersistenceDTO = {
    id: tableId,
    baseId,
    name: 'Orders',
    dbTableName: `${baseId}.${tableId}`,
    primaryFieldId,
    fields: [
      { id: primaryFieldId, name: 'Name', type: 'singleLineText', dbFieldName: 'Name' },
      {
        id: selfLinkFieldId,
        name: 'Related',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: tableId,
          lookupFieldId: primaryFieldId,
          isOneWay: false,
          symmetricFieldId: selfLinkBackFieldId,
          fkHostTableName: `${baseId}.__orders_related`,
          selfKeyName: '__fk_related_left',
          foreignKeyName: '__fk_related_right',
        },
      },
      {
        id: selfLinkBackFieldId,
        name: 'Related back',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: tableId,
          lookupFieldId: primaryFieldId,
          isOneWay: false,
          symmetricFieldId: selfLinkFieldId,
          fkHostTableName: `${baseId}.__orders_related`,
          selfKeyName: '__fk_related_right',
          foreignKeyName: '__fk_related_left',
        },
      },
      {
        id: externalLinkFieldId,
        name: 'Vendor',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: externalTableId,
          lookupFieldId: externalLookupFieldId,
          isOneWay: false,
          symmetricFieldId: `fld${'j'.repeat(16)}`,
          fkHostTableName: `${baseId}.__orders_vendor`,
          selfKeyName: '__fk_vendor_left',
          foreignKeyName: '__fk_vendor_right',
        },
      },
    ],
    views: [
      {
        id: viewId,
        name: 'Grid',
        type: 'grid',
        columnMeta: {
          [primaryFieldId]: { order: 0 },
          [selfLinkFieldId]: { order: 1 },
          [externalLinkFieldId]: { order: 2 },
        },
      },
    ],
  };
  return mapper.toDomain(dto)._unsafeUnwrap();
};

const createForeignHostedLinkTable = (): Table => {
  const dto: ITablePersistenceDTO = {
    id: tableId,
    baseId,
    name: 'Foreign hosted orders',
    dbTableName: `${baseId}.${tableId}`,
    primaryFieldId,
    fields: [
      { id: primaryFieldId, name: 'Name', type: 'singleLineText', dbFieldName: 'Name' },
      {
        id: externalLinkFieldId,
        name: 'Vendor orders',
        type: 'link',
        options: {
          relationship: 'oneMany',
          foreignTableId: externalTableId,
          lookupFieldId: externalLookupFieldId,
          isOneWay: false,
          symmetricFieldId: `fld${'j'.repeat(16)}`,
          fkHostTableName: `${baseId}.${externalTableId}`,
          selfKeyName: `__fk_${externalLinkFieldId}`,
          foreignKeyName: '__id',
        },
      },
    ],
    views: [{ id: viewId, name: 'Grid', type: 'grid', columnMeta: {} }],
  };
  return mapper.toDomain(dto)._unsafeUnwrap();
};

const createFormulaTable = (): Table => {
  const dto: ITablePersistenceDTO = {
    id: tableId,
    baseId,
    name: 'Formula orders',
    dbTableName: `${baseId}.${tableId}`,
    primaryFieldId,
    fields: [
      { id: primaryFieldId, name: 'Name', type: 'singleLineText', dbFieldName: 'Name' },
      {
        id: formulaFieldId,
        name: 'Nested',
        type: 'formula',
        dbFieldName: 'Nested',
        options: { expression: 'ABS(ABS(ABS(ABS(1))))' },
      },
    ],
    views: [{ id: viewId, name: 'Grid', type: 'grid', columnMeta: {} }],
  };
  return mapper.toDomain(dto)._unsafeUnwrap();
};

const createTableWithMissingPhysicalMetadata = (): Table =>
  mapper
    .toDomain({
      id: tableId,
      baseId,
      name: 'Unprovisioned orders',
      primaryFieldId,
      fields: [{ id: primaryFieldId, name: 'Name', type: 'singleLineText' }],
      views: [{ id: viewId, name: 'Grid', type: 'grid', columnMeta: {} }],
    })
    ._unsafeUnwrap();

const command = (includeRecords: boolean): DuplicateTableCommand =>
  DuplicateTableCommand.create({
    baseId,
    tableId,
    name: 'Orders Copy',
    includeRecords,
  })._unsafeUnwrap();

const createPreparationService = (sourceTable: Table) => {
  const getByIdInBase = vi.fn(async () => ok(sourceTable));
  return {
    service: new DuplicateTablePreparationService({ getByIdInBase }, mapper),
    getByIdInBase,
  };
};

describe('DuplicateTablePreparationService', () => {
  it('maps same-base structure, views, self links, and external links without persistence', async () => {
    const sourceTable = createSourceTable();
    const { service, getByIdInBase } = createPreparationService(sourceTable);

    const result = await service.prepare(context, command(false));

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(getByIdInBase).toHaveBeenCalledOnce();
    expect(result.value.fieldIdMap.size).toBe(4);
    expect(result.value.viewIdMap.size).toBe(1);
    const targetViewId = result.value.viewIdMap.get(viewId);
    expect(
      result.value.duplicatedTable
        .views()
        .find((view) => view.id().toString() === targetViewId)
        ?.name()
        .toString()
    ).toBe('Grid');
    expect(result.value.recordCopyPath).toEqual({ classification: 'none' });
    expect(result.value.linkDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceFieldId: selfLinkFieldId,
          decision: 'self-remapped',
          foreignTableId: result.value.duplicatedTable.id().toString(),
        }),
        expect.objectContaining({
          sourceFieldId: externalLinkFieldId,
          decision: 'external-preserved-one-way',
          foreignTableId: externalTableId,
        }),
      ])
    );
    expect([...result.value.fieldIdMap.keys()]).toEqual(
      expect.arrayContaining([
        primaryFieldId,
        selfLinkFieldId,
        selfLinkBackFieldId,
        externalLinkFieldId,
      ])
    );
    expect([...result.value.viewIdMap.keys()]).toEqual([viewId]);
    expect(sourceTable.pullDomainEvents()).toEqual([]);
  });

  it('marks record copy as physically preferred but unresolved until target metadata exists', async () => {
    const { service } = createPreparationService(createSourceTable());

    const result = await service.prepare(context, command(true));

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.includeRecords).toBe(true);
    expect(result.value.recordCopyPath).toEqual({
      classification: 'physical-pending-metadata',
      reason: 'target-physical-metadata-assigned-after-persistence',
    });
    expect(result.value.duplicatedTable.dbTableName().isErr()).toBe(true);
  });

  it('classifies foreign-hosted link storage for hydrated record copy before persistence', async () => {
    const { service } = createPreparationService(createForeignHostedLinkTable());

    const result = await service.prepare(context, command(true));

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.recordCopyPath).toEqual({ classification: 'hydrated' });
  });

  it('applies the execution formula source budget before producing duplication facts', async () => {
    const { service } = createPreparationService(createFormulaTable());
    const strictContext: IExecutionContext = {
      ...context,
      config: {
        formulaSourceBudget: { astDepth: 3, visitedNodes: 100, policyVersion: 1 },
      },
    };

    const result = await service.prepare(strictContext, command(false));

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_depth_max');
  });

  it('keeps missing source physical metadata unknown instead of claiming hydrated copy', async () => {
    const { service } = createPreparationService(createTableWithMissingPhysicalMetadata());

    const result = await service.prepare(context, command(true));

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.recordCopyPath).toEqual({
      classification: 'unknown',
      reason: 'source-physical-metadata-unavailable',
    });
  });
});
