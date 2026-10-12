import { describe, expect, it } from 'vitest';

import {
  MAX_PROJECTION_PAYLOAD_BYTES,
  projectionPayloadTooLargeError,
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
