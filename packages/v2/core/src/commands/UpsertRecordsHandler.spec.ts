import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type {
  IRecordUpsertResult,
  RecordUpsertService,
} from '../application/services/RecordUpsertService';
import { TableQueryService } from '../application/services/TableQueryService';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { UpsertRecordsCommand } from './UpsertRecordsCommand';
import { UpsertRecordsHandler } from './UpsertRecordsHandler';

const TBL_ID = `tbl${'a'.repeat(16)}`;

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
  windowId: 'window-upsert',
};

const tableStub = {
  id: () => ({ toString: () => TBL_ID }),
  getFields: () => [],
} as unknown as Table;

const createHandler = (upsert: RecordUpsertService['upsert']) => {
  const tableQueryService = {
    getById: async () => ok(tableStub),
  } as unknown as TableQueryService;
  return new UpsertRecordsHandler(tableQueryService, { upsert } as unknown as RecordUpsertService);
};

describe('UpsertRecordsCommand', () => {
  it('rejects an unknown onConflict mode', () => {
    const result = UpsertRecordsCommand.create({
      tableId: TBL_ID,
      matchField: 'fldKey',
      onConflict: 'merge',
      records: [{ fields: {} }],
    });
    expect(result.isErr()).toBe(true);
  });

  it('requires at least one record', () => {
    const result = UpsertRecordsCommand.create({
      tableId: TBL_ID,
      matchField: 'fldKey',
      onConflict: 'ignore',
      records: [],
    });
    expect(result.isErr()).toBe(true);
  });

  it('keeps input order and defaults typecast to false', () => {
    const result = UpsertRecordsCommand.create({
      tableId: TBL_ID,
      matchField: 'fldKey',
      onConflict: 'update',
      records: [{ fields: { fldKey: 'a' } }, { fields: { fldKey: 'b' } }],
    });
    const command = result._unsafeUnwrap();
    expect(command.matchFieldId).toBe('fldKey');
    expect(command.onConflict).toBe('update');
    expect(command.typecast).toBe(false);
    expect(command.recordsFieldValues.map((fields) => fields.get('fldKey'))).toEqual(['a', 'b']);
  });
});

describe('UpsertRecordsHandler', () => {
  it('summarizes per-row dispositions in input order', async () => {
    const handler = createHandler(async () =>
      ok<IRecordUpsertResult, DomainError>({
        results: [
          { index: 0, status: 'created', recordId: 'recA' },
          { index: 1, status: 'skipped', recordId: 'recB' },
          { index: 2, status: 'unchanged', recordId: 'recC' },
        ],
        events: [],
      })
    );

    const command = UpsertRecordsCommand.create({
      tableId: TBL_ID,
      matchField: 'fldKey',
      onConflict: 'ignore',
      records: [
        { fields: { fldKey: 'a' } },
        { fields: { fldKey: 'b' } },
        { fields: { fldKey: 'c' } },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(context, command);
    const value = result._unsafeUnwrap();
    expect(value.results.map((row) => row.status)).toEqual(['created', 'skipped', 'unchanged']);
    expect(value.summary).toEqual({
      requested: 3,
      created: 1,
      updated: 0,
      unchanged: 1,
      skipped: 1,
    });
  });

  it('propagates upsert failures', async () => {
    const handler = createHandler(async () =>
      err<IRecordUpsertResult, DomainError>(
        domainError.conflict({ code: 'record.upsert.conflict', message: 'exists' })
      )
    );

    const command = UpsertRecordsCommand.create({
      tableId: TBL_ID,
      matchField: 'fldKey',
      onConflict: 'error',
      records: [{ fields: { fldKey: 'a' } }],
    })._unsafeUnwrap();

    const result = await handler.handle(context, command);
    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.code).toBe('record.upsert.conflict');
  });
});
