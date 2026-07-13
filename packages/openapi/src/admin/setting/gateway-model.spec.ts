import { describe, expect, it } from 'vitest';
import { gatewayModelSchema } from './gateway-model';

describe('gateway model schemas', () => {
  it('accepts providers recently added to the pi registry as ownedBy', () => {
    for (const ownedBy of ['interfaze', 'sakana', 'stepfun']) {
      const parsed = gatewayModelSchema.parse({
        id: `${ownedBy}/some-model`,
        label: 'Some Model',
        enabled: true,
        ownedBy,
      });
      expect(parsed.ownedBy).toBe(ownedBy);
    }
  });
});
