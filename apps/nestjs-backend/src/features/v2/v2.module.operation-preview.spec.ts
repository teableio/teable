import { describe, expect, it } from 'vitest';

import { toV2HttpError } from './v2.module';

describe('V2Module HTTP error envelope', () => {
  it('preserves stable DomainError metadata emitted by operation preview', () => {
    expect(
      toV2HttpError({
        message: 'Unsupported preview operation: future.operation',
        data: {
          domainCode: 'preview.operation.unsupported',
          domainTags: ['validation'],
          details: { operation: 'future.operation' },
        },
      })
    ).toEqual({
      message: 'Unsupported preview operation: future.operation',
      code: 'preview.operation.unsupported',
      tags: ['validation'],
      details: { operation: 'future.operation' },
    });
  });

  it('keeps validation and non-domain errors backward-compatible as messages', () => {
    expect(
      toV2HttpError({
        message: 'Input validation failed',
        data: { issues: [{ path: ['input', 'tableId'], message: 'Required' }] },
      })
    ).toBe('Input validation failed: input.tableId: Required');
    expect(toV2HttpError('Forbidden')).toBe('Forbidden');
  });
});
