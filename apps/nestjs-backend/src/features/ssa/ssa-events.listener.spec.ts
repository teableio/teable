import { describe, expect, it } from 'vitest';
import type { IEventRawContext } from '../../event-emitter/events';
import type { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import type { IUpdateRecordsPayload } from '../undo-redo/operations/update-records.operation';
import {
  buildCreateEvent,
  buildDeleteEvent,
  buildUpdateEvent,
  SSA_MAX_CELL_CONTEXTS,
  SSA_MAX_SAMPLE_RECORDS,
  signSsaPayload,
} from './ssa-events.listener';
import { safeEqual, SSA_TOKEN_HEADER } from './ssa-token.guard';

const rawContext = (overrides: Partial<IEventRawContext> = {}): IEventRawContext => ({
  reqUser: { id: 'usr1', name: 'Juan', email: 'juan@example.com' } as never,
  reqHeaders: {},
  reqParams: { tableId: 'tbl1' },
  reqQuery: {},
  reqBody: {},
  resolveData: { records: [{ id: 'rec1', fields: { fld1: 'A' } }] },
  ...overrides,
});

describe('buildCreateEvent', () => {
  it('maps request context to a canonical record.created event', () => {
    const event = buildCreateEvent(rawContext(), { timestamp: 'T' });

    expect(event).toMatchObject({
      event: 'record.created',
      tableId: 'tbl1',
      recordIds: ['rec1'],
      recordCount: 1,
      isBulk: false,
      truncated: false,
      timestamp: 'T',
      user: { id: 'usr1', name: 'Juan', email: 'juan@example.com' },
    });
    expect(event.records).toEqual([{ id: 'rec1', fields: { fld1: 'A' } }]);
  });

  it('supports the oversize fallback (ids only)', () => {
    const event = buildCreateEvent(rawContext(), { sampleRecords: false });

    expect(event.records).toBeUndefined();
    expect(event.recordIds).toEqual(['rec1']);
  });

  it('caps samples and flags truncation for bulk creates', () => {
    const records = Array.from({ length: SSA_MAX_SAMPLE_RECORDS + 5 }, (_, index) => ({
      id: `rec${index}`,
      fields: {},
    }));
    const event = buildCreateEvent(rawContext({ resolveData: { records } }), { timestamp: 'T' });

    expect(event.recordCount).toBe(SSA_MAX_SAMPLE_RECORDS + 5);
    expect(event.records).toHaveLength(SSA_MAX_SAMPLE_RECORDS);
    expect(event.truncated).toBe(true);
    expect(event.isBulk).toBe(true);
  });

  it('returns an empty tableId when the route params are missing', () => {
    const event = buildCreateEvent(rawContext({ reqParams: undefined }));

    expect(event.tableId).toBe('');
  });
});

describe('buildUpdateEvent', () => {
  const payload: IUpdateRecordsPayload = {
    windowId: 'win1',
    tableId: 'tbl1',
    userId: 'usr1',
    recordIds: ['rec1'],
    fieldIds: ['fld1'],
    cellContexts: [{ fieldId: 'fld1', oldValue: 'A', newValue: 'B' }] as never,
  };

  it('maps the update payload to record.updated', () => {
    const event = buildUpdateEvent(payload, { timestamp: 'T' });

    expect(event).toMatchObject({
      event: 'record.updated',
      tableId: 'tbl1',
      recordIds: ['rec1'],
      user: { id: 'usr1' },
      timestamp: 'T',
    });
    expect(event.changes?.fieldIds).toEqual(['fld1']);
    expect(event.changes?.cellContexts).toHaveLength(1);
  });

  it('bounds the sampled cell contexts', () => {
    const many = Array.from({ length: SSA_MAX_CELL_CONTEXTS + 10 }, (_, index) => ({
      fieldId: `fld${index}`,
      oldValue: null,
      newValue: index,
    }));
    const event = buildUpdateEvent({ ...payload, cellContexts: many as never });

    expect(event.changes?.cellContexts).toHaveLength(SSA_MAX_CELL_CONTEXTS);
    expect(event.truncated).toBe(true);
  });
});

describe('buildDeleteEvent', () => {
  it('maps the delete payload to record.deleted with last-known fields', () => {
    const payload: IDeleteRecordsPayload = {
      operationId: 'op1',
      tableId: 'tbl1',
      userId: 'usr1',
      records: [{ id: 'rec1', fields: { fld1: 'A' } }] as never,
    };

    const event = buildDeleteEvent(payload, { timestamp: 'T' });

    expect(event).toMatchObject({
      event: 'record.deleted',
      tableId: 'tbl1',
      recordIds: ['rec1'],
      recordCount: 1,
      user: { id: 'usr1' },
    });
    expect(event.records).toEqual([{ id: 'rec1', fields: { fld1: 'A' } }]);
  });
});

describe('signSsaPayload', () => {
  it('produces a stable sha256 HMAC over the exact body', () => {
    const first = signSsaPayload('secret', '{"a":1}');
    const second = signSsaPayload('secret', '{"a":1}');

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signSsaPayload('secret', '{"a":2}')).not.toBe(first);
  });
});

describe('SsaTokenGuard helpers', () => {
  it('compares tokens in constant time and rejects mismatches', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('uses the documented header name', () => {
    expect(SSA_TOKEN_HEADER).toBe('x-ssa-token');
  });
});
