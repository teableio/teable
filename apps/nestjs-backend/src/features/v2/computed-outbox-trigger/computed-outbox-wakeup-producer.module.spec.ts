import type { IComputedOutboxWakeupPublisher } from '@teable/v2-adapter-table-repository-postgres';
import { createComputedOutboxWakeup } from '@teable/v2-adapter-table-repository-postgres';
import { describe, expect, it, vi } from 'vitest';

import { createRoleAwareWakeupPublisher } from './computed-outbox-wakeup-producer.module';

describe('createRoleAwareWakeupPublisher', () => {
  const wakeup = () =>
    createComputedOutboxWakeup({
      taskId: 'cuo1234567890123456',
      baseId: 'bse1234567890123456',
      cause: 'created',
    });

  it('allows consumer-generated wakeups without enabling ordinary request producers', async () => {
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const publisher = createRoleAwareWakeupPublisher(
      { publish } as IComputedOutboxWakeupPublisher,
      { producerEnabled: false, consumerEnabled: true }
    );

    await expect(publisher.publish(wakeup())).resolves.toEqual({ status: 'disabled' });
    await publisher.runAsConsumer(async () => {
      await expect(publisher.publish(wakeup())).resolves.toEqual({ status: 'accepted' });
    });

    expect(publish).toHaveBeenCalledTimes(1);
  });
});
