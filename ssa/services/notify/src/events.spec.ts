import { describe, expect, it } from 'vitest';
import { extractFieldValues, isRecordEvent, valuesEqual, verifySignature } from './events.js';
import type { ISsaRecordEvent } from './events.js';

const baseEvent = (overrides: Partial<ISsaRecordEvent> = {}): ISsaRecordEvent => ({
  version: 1,
  event: 'record.created',
  tableId: 'tbl1',
  recordIds: ['rec1'],
  recordCount: 1,
  isBulk: false,
  truncated: false,
  timestamp: 'T',
  ...overrides,
});

describe('verifySignature', () => {
  const body = JSON.stringify({ hello: 'world' });
  const secret = 'topsecret';
  const valid = `sha256=${createHmacForTest(secret, body)}`;

  it('accepts a correct signature', () => {
    expect(verifySignature(secret, body, valid)).toBe(true);
  });

  it('rejects a wrong signature or secret', () => {
    expect(verifySignature(secret, body, 'sha256=deadbeef')).toBe(false);
    expect(verifySignature('other', body, valid)).toBe(false);
    expect(verifySignature(secret, `${body} `, valid)).toBe(false);
  });

  it('rejects missing inputs', () => {
    expect(verifySignature('', body, valid)).toBe(false);
    expect(verifySignature(secret, body, '')).toBe(false);
  });
});

describe('isRecordEvent', () => {
  it('accepts well-formed events and rejects others', () => {
    expect(isRecordEvent(baseEvent())).toBe(true);
    expect(isRecordEvent({ event: 'record.created' })).toBe(false);
    expect(isRecordEvent(null)).toBe(false);
  });
});

describe('extractFieldValues', () => {
  it('returns per-record values for creates', () => {
    const event = baseEvent({
      records: [
        { id: 'rec1', fields: { fldA: 'x' } },
        { id: 'rec2', fields: { fldA: 'y' } },
      ],
    });

    expect(extractFieldValues(event)).toEqual([
      { recordId: 'rec1', fieldId: 'fldA', value: 'x' },
      { recordId: 'rec2', fieldId: 'fldA', value: 'y' },
    ]);
  });

  it('returns new values for updates', () => {
    const event = baseEvent({
      event: 'record.updated',
      changes: {
        fieldIds: ['fldStatus'],
        cellContexts: [{ fieldId: 'fldStatus', oldValue: 'Todo', newValue: 'Done' }],
      },
    });

    expect(extractFieldValues(event)).toEqual([
      { recordId: undefined, fieldId: 'fldStatus', value: 'Done' },
    ]);
  });

  it('keeps record ids from v2 batch updates', () => {
    const event = baseEvent({
      event: 'record.updated',
      changes: {
        fieldIds: ['fldStatus'],
        cellContexts: [{ recordId: 'rec9', fieldId: 'fldStatus', newValue: 'Done' }],
      },
    });

    expect(extractFieldValues(event)).toEqual([
      { recordId: 'rec9', fieldId: 'fldStatus', value: 'Done' },
    ]);
  });
});

describe('valuesEqual', () => {
  it('compares primitives, arrays and objects', () => {
    expect(valuesEqual('a', 'a')).toBe(true);
    expect(valuesEqual(1, '1')).toBe(true);
    expect(valuesEqual(['a'], ['a'])).toBe(true);
    expect(valuesEqual(['a'], ['b'])).toBe(false);
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual(null, undefined)).toBe(false);
  });
});

// Local HMAC helper so the test does not duplicate production code paths.
import { createHmac } from 'node:crypto';
function createHmacForTest(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
