/* eslint-disable sonarjs/no-duplicate-string */
import { describe, expect, it } from 'vitest';

import { BaseId } from './BaseId';

const baseIdPattern = /^bse[0-9a-zA-Z]{16}$/;

describe('BaseId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = BaseId.generate();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.toString()).toMatch(baseIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `bse${'a'.repeat(16)}`;
    const invalidLegacy = `bse${'a'.repeat(15)}_`;
    expect(BaseId.create(valid).isOk()).toBe(true);
    expect(BaseId.create(invalidLegacy).isErr()).toBe(true);
  });
});
