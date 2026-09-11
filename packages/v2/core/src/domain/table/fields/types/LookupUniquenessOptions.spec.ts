import { describe, expect, it } from 'vitest';

import { ConditionalLookupOptions } from './ConditionalLookupOptions';
import { LookupOptions } from './LookupOptions';

const common = {
  foreignTableId: `tbl${'a'.repeat(16)}`,
  lookupFieldId: `fld${'b'.repeat(16)}`,
};

describe.each([
  {
    name: 'lookup',
    create: (isUnique?: unknown) =>
      LookupOptions.create({ ...common, linkFieldId: `fld${'c'.repeat(16)}`, isUnique }),
  },
  {
    name: 'conditional lookup',
    create: (isUnique?: unknown) =>
      ConditionalLookupOptions.create({
        ...common,
        isUnique,
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: common.lookupFieldId, operator: 'isNotEmpty', value: null }],
          },
        },
      }),
  },
])('$name uniqueness', ({ create }) => {
  it('defaults to off and preserves explicit values in DTOs', () => {
    const defaults = create()._unsafeUnwrap();
    expect(defaults.isUnique()).toBe(false);
    expect(defaults.toDto()).not.toHaveProperty('isUnique');
    for (const enabled of [true, false]) {
      const options = create(enabled)._unsafeUnwrap();
      expect(options.isUnique()).toBe(enabled);
      expect(options.toDto()).toHaveProperty('isUnique', enabled);
    }
  });

  it('rejects non-boolean flags', () => {
    expect(create('true').isErr()).toBe(true);
    expect(create(null).isErr()).toBe(true);
  });
});
