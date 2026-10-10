import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import { describe, expect, it, vi } from 'vitest';

import { DomainEventWakeupHandler } from './domain-event-wakeup.handler';

describe('DomainEventWakeupHandler', () => {
  it('throws when pollOnce fails so BullMQ can retry the BYODB wakeup', async () => {
    const pollOnce = vi.fn().mockResolvedValue({
      isErr: () => true,
      error: { code: 'domain_event.poll_failed' },
    });
    const resolve = vi.fn((token: unknown) => {
      if (token !== v2RecordRepositoryPostgresTokens.domainEventOutboxWorker) {
        throw new Error(`Unexpected token ${String(token)}`);
      }
      return { pollOnce };
    });
    const handler = new DomainEventWakeupHandler({
      getContainerForBase: vi.fn().mockResolvedValue({ resolve }),
    } as never);

    await expect(
      handler.handle({ eventId: 'deotest0000000001', baseId: 'bseWakeup000000001' })
    ).rejects.toThrow('domain_event wakeup poll failed: domain_event.poll_failed');
  });
});
