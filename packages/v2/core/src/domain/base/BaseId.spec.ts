import { describe, expect, it } from 'vitest';

import { BaseId } from './BaseId';

const baseIdPattern = /^bse[0-9a-zA-Z]{16}$/;

describe('BaseId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = BaseId.generate();
    const baseId = result._unsafeUnwrap();
    expect(baseId.toString()).toMatch(baseIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `bse${'a'.repeat(16)}`;
    const invalidLegacy = `bse${'a'.repeat(15)}_`;
    BaseId.create(valid)._unsafeUnwrap();
    BaseId.create(invalidLegacy)._unsafeUnwrapErr();
  });
});
