import {
  ActorId,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type IRecordQueryPlugin,
  type ITablePersistenceDTO,
  type Table,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { DataQueryDefinition } from './DataQueryDefinition';
import { DataQueryService } from './DataQueryService';

import type { DataQueryCandidate } from './queryExecutionProtocol';
const tableId = `tbl${'a'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const amountId = `fld${'b'.repeat(16)}`;
const linkId = `fld${'c'.repeat(16)}`;
const targetId = `tbl${'b'.repeat(16)}`;
const targetTitleId = `fld${'d'.repeat(16)}`;
const mapper = new DefaultTableMapper();
const context = { actorId: ActorId.create('app-principal')._unsafeUnwrap() };
const dto = (): ITablePersistenceDTO => ({
  id: tableId,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Source',
  dbTableName: 'base.source',
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
    { id: amountId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
    {
      id: linkId,
      name: 'Owner',
      type: 'link',
      dbFieldName: 'owner',
      options: {
        relationship: 'manyOne',
        foreignTableId: targetId,
        lookupFieldId: targetTitleId,
        isOneWay: true,
        fkHostTableName: 'base.source',
        selfKeyName: '__id',
        foreignKeyName: 'owner_fk',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});
const targetDto = (): ITablePersistenceDTO => ({
  ...dto(),
  id: targetId,
  name: 'Target',
  dbTableName: 'base.target',
  primaryFieldId: targetTitleId,
  fields: [{ id: targetTitleId, name: 'Name', type: 'singleLineText', dbFieldName: 'name' }],
});
const definition = DataQueryDefinition.create({
  version: 1,
  kind: 'records',
  tableId,
  select: [{ fieldId: titleId, alias: 'title' }],
})._unsafeUnwrap();
const candidate = { operation: 'delete' as const, tableId, fieldIds: [amountId] };

const setup = (
  tables: Table[],
  projected: ReadonlyMap<string, Table>,
  plugin?: IRecordQueryPlugin
) => {
  const execute = vi.fn(async () => ok({ rows: [] }));
  const executeRelation = vi.fn(async () => ok({ rows: [] }));
  const prepare = vi.fn(async () => ok(projected));
  const service = new DataQueryService(
    { findOne: async (_context, spec) => ok(tables.find((table) => spec.isSatisfiedBy(table))!) },
    new RecordQueryPluginRunner(plugin ? [plugin] : [], new NoopLogger()),
    { execute, executeRelation },
    prepare
  );
  return { service, execute, executeRelation, prepare };
};

const restorationScenario = (nested: boolean) => {
  const leafTableId = `tbl${'c'.repeat(16)}`;
  const leafTitleId = `fld${'e'.repeat(16)}`;
  const leafAmountId = `fld${'f'.repeat(16)}`;
  const leafLinkId = `fld${'g'.repeat(16)}`;
  const affectedTableId = nested ? leafTableId : tableId;
  const affectedFieldId = nested ? leafAmountId : amountId;
  const restoredDto: ITablePersistenceDTO = nested
    ? {
        ...targetDto(),
        id: leafTableId,
        name: 'Leaf',
        dbTableName: 'base.leaf',
        primaryFieldId: leafTitleId,
        fields: [
          { id: leafTitleId, name: 'Name', type: 'singleLineText', dbFieldName: 'name' },
          { id: leafAmountId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
        ],
      }
    : dto();
  const restored = mapper.toDomain(restoredDto)._unsafeUnwrap();
  const broken = mapper
    .toDomain({
      ...restoredDto,
      fields: restoredDto.fields.map((field) =>
        field.id === affectedFieldId ? { ...field, type: 'singleLineText', options: {} } : field
      ),
    })
    ._unsafeUnwrap();
  const parents = nested
    ? [
        mapper.toDomain(dto())._unsafeUnwrap(),
        mapper
          .toDomain({
            ...targetDto(),
            fields: [
              ...targetDto().fields,
              {
                id: leafLinkId,
                name: 'Leaf',
                type: 'link',
                dbFieldName: 'leaf',
                options: {
                  relationship: 'oneMany',
                  foreignTableId: leafTableId,
                  lookupFieldId: leafTitleId,
                  isOneWay: false,
                  fkHostTableName: 'base.leaf',
                  selfKeyName: 'owner_fk',
                  foreignKeyName: '__id',
                },
              },
            ],
          })
          ._unsafeUnwrap(),
      ]
    : [];
  const query = DataQueryDefinition.create(
    nested
      ? {
          version: 2,
          kind: 'aggregate',
          tableId,
          relations: {
            owner: { linkFieldId: linkId, tableId: targetId },
            leaf: { linkFieldId: leafLinkId, tableId: leafTableId, via: 'owner' },
          },
          aggregates: [
            { source: 'leaf', fieldId: leafAmountId, statisticFunc: 'sum', alias: 'total' },
          ],
        }
      : {
          version: 1,
          kind: 'aggregate',
          tableId,
          aggregates: [{ fieldId: amountId, statisticFunc: 'sum', alias: 'total' }],
        }
  )._unsafeUnwrap();
  const restoration: DataQueryCandidate = {
    operation: 'convert',
    tableId: affectedTableId,
    fieldId: affectedFieldId,
    field: { type: 'number' },
  };
  return {
    query,
    restoration,
    broken,
    affectedFieldId,
    liveTables: [...parents, broken],
    acceptedTables: [...parents, restored],
    projected: new Map([[affectedTableId, restored]]),
    liveTableIds: [...parents, broken].map((table) => table.id().toString()),
    brokenCode: nested ? 'data_query.relation_aggregate_type' : 'data_query.aggregate_incompatible',
  };
};

describe.each([
  { path: 'root aggregate', nested: false },
  { path: 'nested relation aggregate', nested: true },
])('restorative candidate validation: $path', ({ nested }) => {
  it('reports the current aggregate broken but admits a numeric restoration after live authorization', async () => {
    const fixture = restorationScenario(nested);
    const accepted = setup(fixture.acceptedTables, new Map());
    const contract = (
      await accepted.service.validate(context, fixture.query, {
        includeSchemaSignature: true,
        includeUsage: true,
      })
    )._unsafeUnwrap();
    expect(contract.outputs).toEqual([
      {
        alias: 'total',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
    ]);
    const seen: string[] = [];
    const plugin: IRecordQueryPlugin = {
      name: 'restoration-live-authorization',
      supports: () => true,
      scope: (input) => {
        expect(input.executionContext).toBe(context);
        expect(input.table).toBe(
          fixture.liveTables.find((table) => table.id().equals(input.table.id()))
        );
        seen.push(input.table.id().toString());
        return ok({});
      },
    };
    const { service, prepare, execute, executeRelation } = setup(
      fixture.liveTables,
      fixture.projected,
      plugin
    );
    const current = await service.validate(context, fixture.query);
    expect(current._unsafeUnwrapErr().code).toBe(fixture.brokenCode);
    expect(prepare).not.toHaveBeenCalled();
    seen.length = 0;

    const proposed = await service.validate(context, fixture.query, {
      candidate: fixture.restoration,
      includeSchemaSignature: true,
      includeUsage: true,
    });
    expect(proposed.isOk()).toBe(true);
    expect(proposed._unsafeUnwrap()).toEqual(contract);
    expect(seen).toEqual([...fixture.liveTableIds, ...fixture.liveTableIds]);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(context, fixture.restoration, undefined);
    expect(
      fixture.broken
        .getField((field) => field.id().toString() === fixture.affectedFieldId)
        ._unsafeUnwrap()
        .type()
        .toString()
    ).toBe('singleLineText');
    expect(execute).not.toHaveBeenCalled();
    expect(executeRelation).not.toHaveBeenCalled();
  });

  it('requires host admission even when the live aggregate is broken', async () => {
    const fixture = restorationScenario(nested);
    const execute = vi.fn(async () => ok({ rows: [] }));
    const executeRelation = vi.fn(async () => ok({ rows: [] }));
    const service = new DataQueryService(
      {
        findOne: async (_context, spec) =>
          ok(fixture.liveTables.find((table) => spec.isSatisfiedBy(table))!),
      },
      new RecordQueryPluginRunner([], new NoopLogger()),
      { execute, executeRelation }
    );
    const result = await service.validate(context, fixture.query, {
      candidate: fixture.restoration,
      includeUsage: true,
      includeSchemaSignature: true,
    });
    expect(result._unsafeUnwrapErr().code).toBe('data_query.candidate_forbidden');
    expect(JSON.stringify(result)).not.toMatch(/schemaSignature|outputs/);
    expect(execute).not.toHaveBeenCalled();
    expect(executeRelation).not.toHaveBeenCalled();
  });

  it.each(['current', 'candidate-before-admission', 'candidate-after-admission'] as const)(
    'denies an unreadable aggregate dependency during %s without executing or exposing outputs',
    async (phase) => {
      const fixture = restorationScenario(nested);
      const seen: string[] = [];
      let affectedPasses = 0;
      const plugin: IRecordQueryPlugin = {
        name: 'restoration-dependency-ceiling',
        supports: () => true,
        scope: (input) => {
          expect(input.executionContext).toBe(context);
          expect(input.table).toBe(
            fixture.liveTables.find((table) => table.id().equals(input.table.id()))
          );
          seen.push(input.table.id().toString());
          if (input.table.id().equals(fixture.broken.id())) {
            affectedPasses++;
            if (phase !== 'candidate-after-admission' || affectedPasses === 2) {
              return ok({ readableFieldIds: new Set<string>() });
            }
          }
          return ok({});
        },
      };
      const { service, prepare, execute, executeRelation } = setup(
        fixture.liveTables,
        fixture.projected,
        plugin
      );
      const result = await service.validate(context, fixture.query, {
        ...(phase === 'current' ? {} : { candidate: fixture.restoration }),
        includeUsage: true,
        includeSchemaSignature: true,
      });
      expect(result._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
      expect(seen).toEqual(
        phase === 'candidate-after-admission'
          ? [...fixture.liveTableIds, ...fixture.liveTableIds]
          : fixture.liveTableIds
      );
      expect(prepare).toHaveBeenCalledTimes(phase === 'candidate-after-admission' ? 1 : 0);
      expect(JSON.stringify(result)).not.toMatch(/schemaSignature|outputs|base\.leaf|base\.source/);
      expect(execute).not.toHaveBeenCalled();
      expect(executeRelation).not.toHaveBeenCalled();
    }
  );
});

describe('candidate query schema validation', () => {
  it('preserves usage and signatures for unaffected fields, independent of physical names', async () => {
    const live = mapper.toDomain(dto())._unsafeUnwrap();
    const next = dto();
    const projected = mapper
      .toDomain({
        ...next,
        dbTableName: 'moved.renamed',
        fields: next.fields
          .filter((field) => field.id !== amountId)
          .map((field) => ({ ...field, dbFieldName: `${field.dbFieldName}_moved` })),
      })
      ._unsafeUnwrap();
    const { service, execute, executeRelation } = setup([live], new Map([[tableId, projected]]));
    const current = (
      await service.validate(context, definition, {
        includeUsage: true,
        includeSchemaSignature: true,
      })
    )._unsafeUnwrap();
    const future = (
      await service.validate(context, definition, {
        includeUsage: true,
        includeSchemaSignature: true,
        candidate,
      })
    )._unsafeUnwrap();
    expect(future).toEqual(current);
    expect(future.schemaSignature).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(future.usage).toEqual([
      { source: 'root', tableId, fieldId: titleId, usages: ['projection'] },
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(executeRelation).not.toHaveBeenCalled();
    expect(live.getFields()).toHaveLength(3);
  });

  it('rejects deleted projections using the normal binder without exposing schema details', async () => {
    const live = mapper.toDomain(dto())._unsafeUnwrap();
    const projected = mapper
      .toDomain({ ...dto(), fields: dto().fields.filter((field) => field.id !== amountId) })
      ._unsafeUnwrap();
    const query = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId,
      select: [{ fieldId: amountId, alias: 'amount' }],
    })._unsafeUnwrap();
    const { service, execute } = setup([live], new Map([[tableId, projected]]));
    const result = await service.validate(context, query, { candidate, includeUsage: true });
    expect(result._unsafeUnwrapErr().code).toBe('data_query.field_missing');
    expect(JSON.stringify(result)).not.toContain('base.source');
    expect(execute).not.toHaveBeenCalled();
  });

  it('changes signature for used options even if the output wire contract is unchanged', async () => {
    const live = mapper.toDomain(dto())._unsafeUnwrap();
    const projected = mapper
      .toDomain({
        ...dto(),
        fields: dto().fields.map((field) =>
          field.id === amountId
            ? {
                ...field,
                type: 'number',
                options: { formatting: { type: 'decimal', precision: 4 } },
              }
            : field
        ),
      })
      ._unsafeUnwrap();
    const query = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId,
      select: [{ fieldId: amountId, alias: 'amount' }],
    })._unsafeUnwrap();
    const { service } = setup([live], new Map([[tableId, projected]]));
    const current = (
      await service.validate(context, query, { includeSchemaSignature: true })
    )._unsafeUnwrap();
    const future = (
      await service.validate(context, query, {
        includeSchemaSignature: true,
        candidate: { operation: 'convert', tableId, fieldId: amountId, field: { type: 'number' } },
      })
    )._unsafeUnwrap();
    expect(future.outputs).toEqual(current.outputs);
    expect(future.schemaSignature).not.toEqual(current.schemaSignature);
  });

  it('binds a relation target candidate while both plugin passes see only the live schemas and principal', async () => {
    const live = mapper.toDomain(dto())._unsafeUnwrap();
    const target = mapper.toDomain(targetDto())._unsafeUnwrap();
    const projected = mapper
      .toDomain({
        ...targetDto(),
        fields: [
          {
            id: targetTitleId,
            name: 'Name',
            type: 'number',
            dbFieldName: 'name',
          },
        ],
      })
      ._unsafeUnwrap();
    const seen: string[] = [];
    const plugin: IRecordQueryPlugin = {
      name: 'live-schema-authorization',
      supports: () => true,
      scope: (input) => {
        expect(input.executionContext).toBe(context);
        seen.push(input.table.id().toString());
        if (input.table.id().toString() === targetId) {
          expect(
            input.table
              .getField((field) => field.id().toString() === targetTitleId)
              ._unsafeUnwrap()
              .type()
              .toString()
          ).toBe('singleLineText');
        }
        return ok({});
      },
    };
    const { service, executeRelation } = setup(
      [live, target],
      new Map([[targetId, projected]]),
      plugin
    );
    const query = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetId } },
      select: [{ source: 'owner', fieldId: targetTitleId, alias: 'owner' }],
    })._unsafeUnwrap();
    const result = (
      await service.validate(context, query, {
        includeUsage: true,
        candidate: {
          operation: 'convert',
          tableId: targetId,
          fieldId: targetTitleId,
          field: { type: 'number' },
        },
      })
    )._unsafeUnwrap();
    expect(result.outputs[0]).toMatchObject({
      cellValueType: 'number',
      wireType: 'numberOrString',
    });
    expect(seen).toEqual([tableId, targetId, tableId, targetId]);
    expect(result.usage).toContainEqual({
      source: 'owner',
      tableId: targetId,
      fieldId: targetTitleId,
      usages: ['projection'],
    });
    expect(executeRelation).not.toHaveBeenCalled();
  });

  it('runs the candidate access guard again and fails closed when its scope denies dependencies', async () => {
    const live = mapper.toDomain(dto())._unsafeUnwrap();
    let passes = 0;
    const plugin: IRecordQueryPlugin = {
      name: 'candidate-dependency-ceiling',
      supports: () => true,
      scope: (input) => {
        expect(input.table).toBe(live);
        passes++;
        return ok(passes === 1 ? {} : { readableFieldIds: new Set<string>() });
      },
    };
    const { service, execute } = setup([live], new Map([[tableId, live]]), plugin);
    const result = await service.validate(context, definition, { candidate, includeUsage: true });
    expect(passes).toBe(2);
    expect(result._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
    expect(JSON.stringify(result)).not.toContain('schemaSignature');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects descriptors when the host did not install an authorized preparer', async () => {
    const table = mapper.toDomain(dto())._unsafeUnwrap();
    const service = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      { execute: async () => ok({ rows: [] }) }
    );
    expect(
      (await service.validate(context, definition, { candidate }))._unsafeUnwrapErr().code
    ).toBe('data_query.candidate_forbidden');
  });
});
