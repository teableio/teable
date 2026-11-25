import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldType, RecordOpBuilder } from '@teable/core';
import knex from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IRawOpMap } from '../../share-db/interface';
import { EventEmitterService, RECORD_HISTORY_PERSIST } from '../event-emitter.service';
import type { IRecordHistoryPersistRequest } from '../event-emitter.service';
import { Events, RecordUpdateEvent } from '../events';
import { RecordHistoryListener } from './record-history.listener';

vi.mock('../../features/field/model/factory', () => ({
  rawField2FieldObj: (field: unknown) => field,
}));

const makeHarness = () => {
  const inserts: Array<Array<Record<string, unknown>>> = [];
  const query = {
    withSchema: vi.fn().mockReturnThis(),
    insert: vi.fn((rows) => {
      inserts.push(rows);
      return query;
    }),
    into: vi.fn().mockReturnThis(),
    toQuery: vi.fn(() => `INSERT history batch ${inserts.length}`),
  };
  const fallbackExecute = vi.fn();
  const emitter = { emit: vi.fn() };
  const listener = new RecordHistoryListener(
    {
      dataKnexForTable: vi.fn().mockResolvedValue(query),
      getDataDatabaseUrlForTable: vi
        .fn()
        .mockResolvedValue('postgresql://localhost/history?schema=public'),
      executeDataPrismaForTable: fallbackExecute,
    } as never,
    emitter as never,
    { recordHistoryDisabled: false } as never,
    {
      field: {
        load: vi.fn().mockResolvedValue([
          {
            id: 'fldText',
            type: FieldType.SingleLineText,
            name: 'Text',
            cellValueType: 'string',
            options: null,
            isComputed: false,
          },
          {
            id: 'fldComputed',
            type: FieldType.Formula,
            name: 'Computed',
            cellValueType: 'string',
            options: null,
            isComputed: true,
          },
        ]),
      },
    } as never
  );
  return { listener, inserts, fallbackExecute, emitter };
};

const makeEvent = (count: number) =>
  new RecordUpdateEvent(
    'tblHistory',
    Array.from({ length: count }, (_, index) => ({
      id: `rec-${index}`,
      fields: {
        fldText: { oldValue: 'before', newValue: 'after' },
        fldComputed: { oldValue: 'before', newValue: 'after' },
      },
    })),
    undefined,
    {
      user: { id: 'usr-executor', name: 'Executor', email: 'executor@example.test' },
      recordInitiator: { type: 'appUser', id: 'apu-stable' },
      occurredAt: '2026-09-01T10:00:00.000Z',
    }
  );

afterEach(() => vi.useRealTimers());

describe('RecordHistoryListener UTC timestamp SQL', () => {
  it('renders a normalized UTC ISO literal for timestamp without time zone columns', async () => {
    const db = knex({ client: 'pg' });
    const queries: string[] = [];
    const event = new RecordUpdateEvent(
      'tblHistory',
      {
        id: 'rec0000000000000002',
        fields: {
          fldText: { oldValue: 'before', newValue: 'after' },
        },
      },
      undefined,
      {
        user: { id: 'usr-executor', name: 'Executor', email: 'executor@example.test' },
        occurredAt: '2026-11-05T18:11:18.886+08:00',
      }
    );
    const listener = new RecordHistoryListener(
      {
        dataKnexForTable: async () => db,
        getDataDatabaseUrlForTable: async () => 'postgresql://localhost/history?schema=public',
      } as never,
      { emit: vi.fn() } as never,
      { recordHistoryDisabled: false } as never,
      {
        field: {
          load: async () => [
            {
              id: 'fldText',
              type: FieldType.SingleLineText,
              name: 'Text',
              cellValueType: 'string',
              options: null,
              isComputed: false,
            },
          ],
        },
      } as never
    );
    try {
      await listener.persistRecordUpdates({
        event,
        execute: async (sql) => {
          queries.push(sql);
        },
      });
      expect(queries).toHaveLength(1);
      expect(queries[0]).toContain('"created_time"');
      expect(queries[0]).toContain("'2026-11-05T10:11:18.886Z'");
      expect(queries[0]).not.toContain('18:11:18.886');
    } finally {
      await db.destroy();
    }
  });
});

describe('RecordHistoryListener transactional consumption', () => {
  it('writes all >200 modification rows in bounded chunks with frozen actor/time and no computed rows', async () => {
    const { listener, inserts, fallbackExecute, emitter } = makeHarness();
    const execute = vi.fn().mockResolvedValue(1);
    await listener.persistRecordUpdates({ event: makeEvent(401), execute });
    expect(inserts.map((rows) => rows.length)).toEqual([200, 200, 1]);
    expect(inserts.flat()).toHaveLength(401);
    expect(inserts[0][0]).toMatchObject({
      created_by: 'usr-executor',
      actor_type: 'appUser',
      actor_id: 'apu-stable',
      created_time: '2026-09-01T10:00:00.000Z',
      field_id: 'fldText',
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(fallbackExecute).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('propagates a later insert failure to the enclosing mutation instead of swallowing it', async () => {
    const { listener, fallbackExecute, emitter } = makeHarness();
    const execute = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('history insert failed'));
    await expect(listener.persistRecordUpdates({ event: makeEvent(201), execute })).rejects.toThrow(
      'history insert failed'
    );
    expect(fallbackExecute).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('never writes a second copy when the transactional writer already persisted the event', async () => {
    const { listener, inserts, emitter } = makeHarness();
    const event = makeEvent(1);
    event.context.recordHistoryPersisted = true;
    await listener.recordUpdateListener(event);
    expect(inserts).toEqual([]);
    expect(emitter.emit).toHaveBeenCalledWith(Events.RECORD_HISTORY_CREATE, {
      recordIds: ['rec-0'],
    });
  });

  it('keeps unknown actor scalars null and omits no-op cells', async () => {
    const { listener, inserts } = makeHarness();
    const event = new RecordUpdateEvent(
      'tblHistory',
      {
        id: 'rec0000000000000002',
        fields: {
          fldText: { oldValue: 'same', newValue: 'same' },
        },
      },
      undefined,
      { user: { id: 'usr-executor', name: 'Executor', email: 'executor@example.test' } }
    );
    await listener.persistRecordUpdates({ event, execute: vi.fn() });
    expect(inserts).toEqual([]);
    const unknown = makeEvent(1);
    unknown.context.recordInitiator = undefined;
    await listener.persistRecordUpdates({ event: unknown, execute: vi.fn() });
    expect(inserts[0][0]).toMatchObject({ actor_type: null, actor_id: null });
  });
});

describe('EventEmitterService trusted history boundary', () => {
  it('freezes producer actor/time, writes once, and ignores later CLS identity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    let actor = { type: 'appUser', id: 'apu-producer' };
    const bus = new EventEmitter2();
    const service = new EventEmitterService(bus, {
      get: (key: string) => (key === 'recordInitiator' ? actor : undefined),
    } as never);
    const rawOps: IRawOpMap[] = [
      {
        ['rec_tblHistory']: {
          rec0000000000000002: {
            v: 1,
            src: 'server',
            seq: 1,
            m: {},
            op: [
              RecordOpBuilder.editor.setRecord.build({
                fieldId: 'fldText',
                oldCellValue: 'before',
                newCellValue: 'after',
              }),
            ],
          },
        },
      },
    ];
    const consume = vi.fn(async ({ event }: IRecordHistoryPersistRequest) => {
      expect(event.context.recordInitiator).toEqual({ type: 'appUser', id: 'apu-producer' });
      expect(event.occurredAt).toEqual(new Date('2026-09-01T10:00:00.000Z'));
    });
    bus.on(RECORD_HISTORY_PERSIST, consume);
    service.freezeRecordEventContext(rawOps);
    actor = { type: 'user', id: 'usr-later' };
    vi.setSystemTime(new Date('2026-09-02T10:00:00.000Z'));
    await service.persistRecordHistory(rawOps, vi.fn());
    await service.persistRecordHistory(rawOps, vi.fn());
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('keeps same-transaction create/import cell-history suppression and coalesces later edits', async () => {
    const bus = new EventEmitter2();
    const created: IRawOpMap = {
      ['rec_tblHistory']: {
        rec0000000000000002: {
          v: 0,
          src: 'server',
          seq: 1,
          m: {},
          create: { type: 'json0', data: { id: 'rec0000000000000002', fields: {} } },
        },
      },
    };
    const updated: IRawOpMap = {
      ['rec_tblHistory']: {
        rec0000000000000002: {
          v: 1,
          src: 'server',
          seq: 1,
          m: {},
          op: [
            RecordOpBuilder.editor.setRecord.build({
              fieldId: 'fldText',
              oldCellValue: null,
              newCellValue: 'after',
            }),
          ],
        },
      },
    };
    const pending = [created, updated];
    const service = new EventEmitterService(bus, {
      get: (key: string) => (key === 'tx.rawOpMaps' ? pending : undefined),
    } as never);
    service.freezeRecordEventContext([created]);
    const consume = vi.fn();
    const recordUpdated = vi.fn();
    const recordCreated = vi.fn();
    bus.on(RECORD_HISTORY_PERSIST, consume);
    bus.on(Events.TABLE_RECORD_UPDATE, recordUpdated);
    bus.on(Events.TABLE_RECORD_CREATE, recordCreated);
    await service.persistRecordHistory([updated], vi.fn());
    await service.ops2Event(pending);
    expect(consume).not.toHaveBeenCalled();
    expect(recordUpdated).not.toHaveBeenCalled();
    expect(recordCreated).toHaveBeenCalledTimes(1);
  });

  it('does not accept a submitted actor or handled marker from raw-op metadata', async () => {
    const bus = new EventEmitter2();
    const service = new EventEmitterService(bus, { get: () => undefined } as never);
    const consume = vi.fn(async ({ event }: IRecordHistoryPersistRequest) => {
      expect(event.context.recordInitiator).toBeUndefined();
      expect(event.context.recordHistoryPersisted).not.toBe(true);
    });
    bus.on(RECORD_HISTORY_PERSIST, consume);
    const rawOps: IRawOpMap[] = [
      {
        ['rec_tblHistory']: {
          rec0000000000000002: {
            v: 1,
            src: 'client',
            seq: 1,
            m: {
              recordInitiator: { type: 'appUser', id: 'apu-forged' },
              recordHistoryPersisted: true,
            },
            op: [
              RecordOpBuilder.editor.setRecord.build({
                fieldId: 'fldText',
                oldCellValue: 'before',
                newCellValue: 'after',
              }),
            ],
          },
        },
      },
    ];
    await service.persistRecordHistory(rawOps, vi.fn());
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('fails closed if no transactional history consumer is registered', async () => {
    const service = new EventEmitterService(new EventEmitter2(), { get: () => undefined } as never);
    const rawOps: IRawOpMap[] = [
      {
        ['rec_tblHistory']: {
          rec0000000000000002: {
            v: 1,
            src: 'server',
            seq: 1,
            m: {},
            op: [
              RecordOpBuilder.editor.setRecord.build({
                fieldId: 'fldText',
                oldCellValue: 'before',
                newCellValue: 'after',
              }),
            ],
          },
        },
      },
    ];
    await expect(service.persistRecordHistory(rawOps, vi.fn())).rejects.toThrow(
      'listener is unavailable'
    );
  });
});
