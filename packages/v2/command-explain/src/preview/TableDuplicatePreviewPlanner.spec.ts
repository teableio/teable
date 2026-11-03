import {
  ActorId,
  DefaultTableMapper,
  DuplicateTableCommand,
  DuplicateTablePreparationService,
  domainError,
  type IExecutionContext,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  createTableDuplicatePreviewRegistration,
  TableDuplicatePreviewPlanner,
} from './TableDuplicatePreviewPlanner';
import type { PreviewOptions } from './types';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'b'.repeat(16)}`;
const otherBaseId = `bse${'z'.repeat(16)}`;
const externalTableId = `tbl${'c'.repeat(16)}`;
const primaryFieldId = `fld${'d'.repeat(16)}`;
const selfLinkFieldId = `fld${'e'.repeat(16)}`;
const externalLinkFieldId = `fld${'f'.repeat(16)}`;
const viewId = `viw${'g'.repeat(16)}`;

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};
const options: PreviewOptions = {
  detail: 'full',
  includeComplexity: false,
  maxItems: 100,
};

const createPlanner = (): TableDuplicatePreviewPlanner => {
  const mapper = new DefaultTableMapper();
  const sourceDto: ITablePersistenceDTO = {
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
          isOneWay: true,
          fkHostTableName: `${baseId}.__self_links`,
          selfKeyName: '__fk_self',
          foreignKeyName: '__fk_foreign',
        },
      },
      {
        id: externalLinkFieldId,
        name: 'Vendor',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: externalTableId,
          lookupFieldId: `fld${'h'.repeat(16)}`,
          isOneWay: true,
          fkHostTableName: `${baseId}.__external_links`,
          selfKeyName: '__fk_source',
          foreignKeyName: '__fk_target',
        },
      },
    ],
    views: [
      {
        id: viewId,
        name: 'Grid',
        type: 'grid',
        columnMeta: { [primaryFieldId]: { order: 0 } },
      },
    ],
  };
  const sourceTable = mapper.toDomain(sourceDto)._unsafeUnwrap();
  const preparation = new DuplicateTablePreparationService(
    { getByIdInBase: async () => ok(sourceTable) },
    mapper
  );
  return new TableDuplicatePreviewPlanner(preparation);
};

const createHydratedPlanner = (): TableDuplicatePreviewPlanner => {
  const mapper = new DefaultTableMapper();
  const sourceTable = mapper
    .toDomain({
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
            lookupFieldId: `fld${'h'.repeat(16)}`,
            isOneWay: false,
            symmetricFieldId: `fld${'i'.repeat(16)}`,
            fkHostTableName: `${baseId}.${externalTableId}`,
            selfKeyName: `__fk_${externalLinkFieldId}`,
            foreignKeyName: '__id',
          },
        },
      ],
      views: [{ id: viewId, name: 'Grid', type: 'grid', columnMeta: {} }],
    })
    ._unsafeUnwrap();
  return new TableDuplicatePreviewPlanner(
    new DuplicateTablePreparationService({ getByIdInBase: async () => ok(sourceTable) }, mapper)
  );
};

const createUnknownPathPlanner = (): TableDuplicatePreviewPlanner => {
  const mapper = new DefaultTableMapper();
  const sourceTable = mapper
    .toDomain({
      id: tableId,
      baseId,
      name: 'Unprovisioned orders',
      primaryFieldId,
      fields: [{ id: primaryFieldId, name: 'Name', type: 'singleLineText' }],
      views: [{ id: viewId, name: 'Grid', type: 'grid', columnMeta: {} }],
    })
    ._unsafeUnwrap();
  return new TableDuplicatePreviewPlanner(
    new DuplicateTablePreparationService({ getByIdInBase: async () => ok(sourceTable) }, mapper)
  );
};

const createCrossBasePlanner = (): TableDuplicatePreviewPlanner => {
  const mapper = new DefaultTableMapper();
  const sourceTable = mapper
    .toDomain({
      id: tableId,
      baseId,
      name: 'Cross-base orders',
      dbTableName: `${baseId}.${tableId}`,
      primaryFieldId,
      fields: [
        { id: primaryFieldId, name: 'Name', type: 'singleLineText', dbFieldName: 'Name' },
        {
          id: externalLinkFieldId,
          name: 'External vendor',
          type: 'link',
          options: {
            baseId: otherBaseId,
            relationship: 'manyMany',
            foreignTableId: externalTableId,
            lookupFieldId: `fld${'h'.repeat(16)}`,
            isOneWay: true,
            fkHostTableName: `${baseId}.__external_links`,
            selfKeyName: '__fk_source',
            foreignKeyName: '__fk_target',
          },
        },
      ],
      views: [{ id: viewId, name: 'Grid', type: 'grid', columnMeta: {} }],
    })
    ._unsafeUnwrap();
  return new TableDuplicatePreviewPlanner(
    new DuplicateTablePreparationService({ getByIdInBase: async () => ok(sourceTable) }, mapper)
  );
};

const createCommand = (includeRecords: boolean): DuplicateTableCommand =>
  DuplicateTableCommand.create({
    baseId,
    tableId,
    name: 'Orders Copy',
    includeRecords,
  })._unsafeUnwrap();

describe('TableDuplicatePreviewPlanner', () => {
  it('normalizes same-base structure, field/view mapping, and link decisions', async () => {
    const result = await createPlanner().preview(context, createCommand(false), options);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.blockers).toEqual([]);
    expect(result.value.coverage.unknown).toEqual(['table-operation-policy']);
    expect(result.value.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'table.duplicate.table_policy_unchecked' }),
      ])
    );
    expect(result.value.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'table.duplicate.structure.copy',
          kind: 'resource.copy',
          measures: {
            tables: { basis: 'exact', value: 1, unit: 'tables' },
            fields: { basis: 'exact', value: 3, unit: 'fields' },
            views: { basis: 'exact', value: 1, unit: 'views' },
          },
        }),
        expect.objectContaining({
          code: 'table.duplicate.link_references.classify',
          measures: {
            selfLinksRemapped: { basis: 'exact', value: 1, unit: 'fields' },
            externalLinksPreserved: { basis: 'exact', value: 1, unit: 'fields' },
            crossBaseLinks: { basis: 'exact', value: 0, unit: 'fields' },
          },
        }),
        expect.objectContaining({
          code: 'table.duplicate.records.omitted',
          measures: { records: { basis: 'exact', value: 0, unit: 'records' } },
        }),
      ])
    );

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(`${baseId}.${tableId}`);
    expect(serialized).not.toContain('sourceSql');
    expect(serialized).not.toContain('junctionCopies');
  });

  it('reports record count and final physical path as unknown rather than zero', async () => {
    const result = await createPlanner().preview(context, createCommand(true), options);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'table.duplicate.records.copy',
          measures: {
            records: expect.objectContaining({ basis: 'unknown', unit: 'records' }),
          },
        }),
      ])
    );
    expect(result.value.coverage.unknown).toEqual(
      expect.arrayContaining([
        'source-record-count',
        'final-record-copy-path',
        'hydrated-record-write-policy',
      ])
    );
    expect(result.value.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'table.duplicate.physical_path_pending_metadata' }),
      ])
    );
  });

  it('reports a source-proven hydrated record path without claiming physical uncertainty', async () => {
    const result = await createHydratedPlanner().preview(context, createCommand(true), options);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'table.duplicate.hydrated_path_required' }),
      ])
    );
    expect(result.value.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'table.duplicate.physical_path_pending_metadata' }),
      ])
    );
    expect(result.value.coverage.unknown).not.toContain('final-record-copy-path');
  });

  it('keeps missing physical metadata incomplete rather than treating it as hydrated', async () => {
    const result = await createUnknownPathPlanner().preview(context, createCommand(true), options);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'table.duplicate.source_physical_metadata_unavailable',
        }),
      ])
    );
    expect(result.value.coverage.unknown).toContain('final-record-copy-path');
  });

  it('defers cross-base reference policy to the host instead of claiming preservation', async () => {
    const result = await createCrossBasePlanner().preview(context, createCommand(false), options);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.coverage.unknown).toContain('cross-space-reference-policy');
    expect(result.value.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'table.duplicate.cross_space_policy_host_owned' }),
      ])
    );
    expect(result.value.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'table.duplicate.link_references.classify',
          measures: expect.objectContaining({
            externalLinksPreserved: { basis: 'exact', value: 0, unit: 'fields' },
            crossBaseLinks: { basis: 'exact', value: 1, unit: 'fields' },
          }),
        }),
      ])
    );
  });

  it('normalizes a read-only formula or aggregate admission failure as a blocker', async () => {
    const planner = new TableDuplicatePreviewPlanner({
      prepare: async () =>
        err(
          domainError.validation({
            code: 'table.duplicate.formula_blocked',
            message: 'Duplicate blocked by formula admission',
          })
        ),
    });

    const result = await planner.preview(context, createCommand(true), options);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().blockers).toEqual([
      {
        code: 'table.duplicate.formula_blocked',
        message: 'Table duplication cannot proceed with the supplied input and current metadata',
      },
    ]);
  });

  it('declares same-base and physical-path limitations in capability metadata', () => {
    const registration = createTableDuplicatePreviewRegistration({
      prepare: async () => err(domainError.unexpected({ message: 'not called' })),
    });

    expect(registration.capability).toMatchObject({
      canonicalWriteRoute: 'POST /tables/duplicateTable',
      supportLevel: 'partial',
      requiredPermissionScope: 'table:create,table:read',
    });
    expect(registration.capability.limitations.join(' ')).toContain('cross-space');
    expect(registration.capability.limitations.join(' ')).toContain('physical row-copy');
    expect(registration.capability.limitations.join(' ')).toContain('plugins');
  });
});
