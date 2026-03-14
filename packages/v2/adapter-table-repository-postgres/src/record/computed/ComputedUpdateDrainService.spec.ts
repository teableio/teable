import { ActorId, type IExecutionContext } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ComputedUpdateDrainService } from './ComputedUpdateDrainService';

describe('ComputedUpdateDrainService', () => {
  it('forwards the execution context to the computed update worker', async () => {
    const worker = {
      runOnce: vi.fn().mockResolvedValue(ok(3)),
    };
    const service = new ComputedUpdateDrainService(worker as never);
    const actorId = ActorId.create(`usr${'a'.repeat(17)}`)._unsafeUnwrap();
    const tracer = { startSpan: vi.fn() };
    const context: IExecutionContext = {
      actorId,
      tracer,
      requestId: 'test-request-id',
    };

    const result = await service.drainOnce(context, {
      workerId: 'worker-1',
      limit: 50,
    });

    expect(result.isOk()).toBe(true);
    expect(worker.runOnce).toHaveBeenCalledWith({
      workerId: 'worker-1',
      limit: 50,
      actorId,
      tracer,
      requestId: 'test-request-id',
    });
  });
});
