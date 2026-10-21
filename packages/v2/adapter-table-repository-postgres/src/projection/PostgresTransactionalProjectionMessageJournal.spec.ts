import { describe, expect, it } from 'vitest';

import {
  MAX_PROJECTION_PAYLOAD_BYTES,
  projectionPayloadTooLargeError,
  serializeProjectionPayload,
} from './PostgresTransactionalProjectionMessageJournal';

describe('projectionPayloadTooLargeError', () => {
  it('accepts batch payloads larger than 64 KiB', () => {
    expect(projectionPayloadTooLargeError(965_097)).toBeUndefined();
  });

  it('rejects runaway payloads above the hard cap', () => {
    const error = projectionPayloadTooLargeError(MAX_PROJECTION_PAYLOAD_BYTES + 1);
    expect(error?.code).toBe('projection_message.payload_too_large');
  });
});

describe('serializeProjectionPayload', () => {
  it('replaces lone surrogates so the payload is valid jsonb input', () => {
    const json = serializeProjectionPayload({ value: 'cheese \ud83e', nested: ['\udc00x'] });
    expect(json).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(JSON.parse(json)).toEqual({ value: 'cheese \ufffd', nested: ['\ufffdx'] });
  });

  it('keeps well-formed strings unchanged', () => {
    const payload = { value: 'Parmigiano ✨🧀', id: 'rec123' };
    expect(serializeProjectionPayload(payload)).toBe(JSON.stringify(payload));
  });
});
