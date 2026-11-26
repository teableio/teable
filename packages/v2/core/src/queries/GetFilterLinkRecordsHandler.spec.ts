import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { RecordQueryPluginRunner } from '../application/services/RecordQueryPluginRunner';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import { NoopTableRecordQueryRepository } from '../ports/defaults/NoopTableRecordQueryRepository';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import { RecordQueryOperationKind, type IRecordQueryPlugin } from '../ports/RecordQueryPlugin';
import { GetFilterLinkRecordsHandler } from './GetFilterLinkRecordsHandler';
import { GetFilterLinkRecordsQuery } from './GetFilterLinkRecordsQuery';

const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
const readableRecordId = `rec${'a'.repeat(16)}`;
const deniedRecordId = `rec${'b'.repeat(16)}`;
const deniedLinkFieldId = `fld${'d'.repeat(16)}`;
const readableLinkFieldId = `fld${'e'.repeat(16)}`;
const forbidden = domainError.forbidden({ message: 'Record read denied' });

const buildTable = (seed: string, links: ReadonlyArray<{ fieldId: string; table: Table }> = []) => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create(`Table ${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  for (const { fieldId, table } of links) {
    builder
      .field()
      .link()
      .withId(FieldId.create(fieldId)._unsafeUnwrap())
      .withName(FieldName.create(fieldId)._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship: 'manyMany',
          baseId: table.baseId().toString(),
          foreignTableId: table.id().toString(),
          lookupFieldId: table.primaryFieldId().toString(),
          isOneWay: true,
        })._unsafeUnwrap()
      )
      .done();
  }
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const setup = async (options?: { sourceError?: DomainError; foreignError?: DomainError }) => {
  const denied = buildTable('b');
  const readable = buildTable('c');
  const source = buildTable('a', [
    { fieldId: deniedLinkFieldId, table: denied },
    { fieldId: readableLinkFieldId, table: readable },
  ]);
  const tables = new MemoryTableRepository();
  for (const table of [source, denied, readable]) {
    (await tables.insert(context, table))._unsafeUnwrap();
  }
  const records = new NoopTableRecordQueryRepository();
  const find = vi.spyOn(records, 'find').mockResolvedValue(
    ok({
      records: [
        {
          id: readableRecordId,
          fields: { [readable.primaryFieldId().toString()]: 'Readable title' },
          version: 1,
          createdByActorType: null,
          createdByActorId: null,
          lastModifiedByActorType: null,
          lastModifiedByActorId: null,
        },
      ],
      total: 1,
    })
  );
  const plugin: IRecordQueryPlugin = {
    name: 'candidate-read-permissions',
    supports: (operation) => operation === RecordQueryOperationKind.getByIds,
    guard: ({ table }) => {
      if (table.id().equals(source.id()) && options?.sourceError) return err(options.sourceError);
      if (table.id().equals(denied.id())) return err(options?.foreignError ?? forbidden);
      return ok(undefined);
    },
  };
  const runner = new RecordQueryPluginRunner([plugin], new NoopLogger());
  const handler = new GetFilterLinkRecordsHandler(tables, records, runner);
  const input = {
    tableId: source.id().toString(),
    filter: {
      conjunction: 'and',
      filterSet: [
        { fieldId: deniedLinkFieldId, operator: 'isAnyOf', value: [deniedRecordId] },
        { fieldId: readableLinkFieldId, operator: 'isAnyOf', value: [readableRecordId] },
      ],
    },
  };
  const execute = (omitForbiddenGroups = true, filter: unknown = input.filter) =>
    handler.handle(
      context,
      GetFilterLinkRecordsQuery.create(
        { tableId: input.tableId, filter },
        { omitForbiddenGroups }
      )._unsafeUnwrap()
    );
  return { execute, find, readable };
};

describe('GetFilterLinkRecordsHandler', () => {
  it('returns readable candidates without querying the foreign group denied by the guard', async () => {
    const { execute, find, readable } = await setup();
    const result = await execute();

    expect(result._unsafeUnwrap().groups).toEqual([
      {
        tableId: readable.id().toString(),
        records: [{ id: readableRecordId, title: 'Readable title' }],
      },
    ]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]?.[1].id().equals(readable.id())).toBe(true);
  });

  it('collects literal link IDs from a filter containing workflow variables', async () => {
    const { execute, find, readable } = await setup();
    const variable = { resolvable: true, type: 'fact', fact: 'trigger', path: '$.record.id' };
    const result = await execute(false, {
      conjunction: 'or',
      filterSet: [
        { fieldId: deniedLinkFieldId, operator: 'isAnyOf', value: variable },
        {
          conjunction: 'and',
          filterSet: [
            { fieldId: readableLinkFieldId, operator: 'isAnyOf', value: [variable, readableRecordId] },
          ],
        },
      ],
    });

    expect(result._unsafeUnwrap().groups).toEqual([
      {
        tableId: readable.id().toString(),
        records: [{ id: readableRecordId, title: 'Readable title' }],
      },
    ]);
    expect(find).toHaveBeenCalledTimes(1);
    const spec = find.mock.calls[0]?.[2];
    expect(spec).toBeInstanceOf(RecordByIdsSpec);
    expect((spec as RecordByIdsSpec).recordIds().map((id) => id.toString())).toEqual([
      readableRecordId,
    ]);
  });

  it('propagates denial of the source table', async () => {
    const { execute, find } = await setup({ sourceError: forbidden });

    expect((await execute())._unsafeUnwrapErr()).toBe(forbidden);
    expect(find).not.toHaveBeenCalled();
  });

  it('propagates operational errors from the foreign read guard', async () => {
    const foreignError = domainError.infrastructure({ message: 'Permission store unavailable' });
    const { execute, find } = await setup({ foreignError });

    expect((await execute())._unsafeUnwrapErr()).toBe(foreignError);
    expect(find).not.toHaveBeenCalled();
  });

  it('propagates a foreign denial when omission is disabled', async () => {
    const { execute, find } = await setup();

    expect((await execute(false))._unsafeUnwrapErr()).toBe(forbidden);
    expect(find).not.toHaveBeenCalled();
  });
});
