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

  it('accepts a normal gateway model id', () => {
    const result = gatewayModelSchema.safeParse({
      id: 'anthropic/claude-sonnet-4',
      label: 'Claude Sonnet 4',
    });
    expect(result.success).toBe(true);
  });

  it("rejects a gateway model id containing '@' (reserved model key delimiter)", () => {
    const result = gatewayModelSchema.safeParse({
      id: 'custom/image-model@beta',
      label: 'Image Model Beta',
    });
    expect(result.success).toBe(false);
  });
});
