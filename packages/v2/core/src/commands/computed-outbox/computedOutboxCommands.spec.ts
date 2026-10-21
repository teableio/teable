import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import type { IComputedOutboxAdmin } from '../../ports/ComputedOutboxAdmin';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { ExtendComputedOutboxPauseCommand } from './ExtendComputedOutboxPauseCommand';
import { ExtendComputedOutboxPauseHandler } from './ExtendComputedOutboxPauseHandler';
import { PauseComputedOutboxCommand } from './PauseComputedOutboxCommand';
import { PauseComputedOutboxHandler } from './PauseComputedOutboxHandler';
import { RecoverComputedOutboxAnomalyCommand } from './RecoverComputedOutboxAnomalyCommand';
import { RecoverComputedOutboxAnomalyHandler } from './RecoverComputedOutboxAnomalyHandler';
import { UpdateComputedOutboxWorkerConcurrencyCommand } from './UpdateComputedOutboxWorkerConcurrencyCommand';

const context = (): IExecutionContext => ({
  actorId: ActorId.create('usrxxxxxxxxxxxxxxxxx')._unsafeUnwrap(),
});

describe('computed outbox commands', () => {
  it('rejects invalid pause input', () => {
    const result = PauseComputedOutboxCommand.create({ spaceId: '' });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('validation.invalid');
  });

  it('pauses a space through the admin port with the actor id', async () => {
    const scope = {
      id: 'pause-1',
      targetId: 'meta-fallback',
      storage: 'default' as const,
      connectionId: null,
      scopeType: 'space' as const,
      scopeId: 'spc1',
      scopeName: 'Ops',
      baseId: null,
      baseName: null,
      spaceId: 'spc1',
      spaceName: 'Ops',
      pausedAt: '2026-08-07T00:00:00.000Z',
      pausedBy: 'usrxxxxxxxxxxxxxxxxx',
      resumeAt: null,
      reason: 'maintenance',
      writePolicy: 'allow_bounded' as const,
      updatedAt: '2026-08-07T00:00:00.000Z',
      updatedBy: 'usrxxxxxxxxxxxxxxxxx',
    };
    const pauseSpace = vi.fn().mockResolvedValue(ok(scope));
    const handler = new PauseComputedOutboxHandler({
      pauseSpace,
    } as unknown as IComputedOutboxAdmin);
    const command = PauseComputedOutboxCommand.create({
      spaceId: 'spc1',
      reason: 'maintenance',
      durationMinutes: 30,
    })._unsafeUnwrap();

    const result = await handler.handle(context(), command);
    expect(result._unsafeUnwrap().scope).toEqual(scope);
    expect(pauseSpace).toHaveBeenCalledWith(expect.anything(), {
      spaceId: 'spc1',
      reason: 'maintenance',
      durationMinutes: 30,
      actor: 'usrxxxxxxxxxxxxxxxxx',
    });
  });

  it('extends an exact pause lease through the admin port with the actor id', async () => {
    const scope = {
      id: 'cup123',
      targetId: 'cnpg-connection',
      storage: 'byodb' as const,
      connectionId: 'cnpg-connection',
      scopeType: 'base' as const,
      scopeId: 'bse1',
      scopeName: 'Operations',
      baseId: 'bse1',
      baseName: 'Operations',
      spaceId: 'spc1',
      spaceName: 'Ops',
      pausedAt: '2026-08-07T00:00:00.000Z',
      pausedBy: 'usrxxxxxxxxxxxxxxxxx',
      resumeAt: '2026-08-07T01:00:00.000Z',
      reason: 'maintenance',
      writePolicy: 'block' as const,
      updatedAt: '2026-08-07T00:30:00.000Z',
      updatedBy: 'usrxxxxxxxxxxxxxxxxx',
    };
    const extendPause = vi.fn().mockResolvedValue(ok(scope));
    const handler = new ExtendComputedOutboxPauseHandler({
      extendPause,
    } as unknown as IComputedOutboxAdmin);
    const command = ExtendComputedOutboxPauseCommand.create({
      targetId: 'cnpg-connection',
      leaseId: 'cup123',
      durationMinutes: 60,
    })._unsafeUnwrap();

    const result = await handler.handle(context(), command);
    expect(result._unsafeUnwrap().scope).toEqual(scope);
    expect(extendPause).toHaveBeenCalledWith(expect.anything(), {
      targetId: 'cnpg-connection',
      leaseId: 'cup123',
      durationMinutes: 60,
      actor: 'usrxxxxxxxxxxxxxxxxx',
    });
  });

  it('returns admin port failures from recover', async () => {
    const recoverAnomaly = vi
      .fn()
      .mockResolvedValue(err(domainError.notFound({ message: 'gone' })));
    const handler = new RecoverComputedOutboxAnomalyHandler({
      recoverAnomaly,
    } as unknown as IComputedOutboxAdmin);
    const command = RecoverComputedOutboxAnomalyCommand.create({
      targetId: 'meta-fallback',
      taskId: 'cuo1',
      kind: 'dead',
    })._unsafeUnwrap();

    const result = await handler.handle(context(), command);
    expect(result.isErr()).toBe(true);
  });

  it('rejects worker concurrency outside the allowed range', () => {
    expect(UpdateComputedOutboxWorkerConcurrencyCommand.create({ concurrency: 0 }).isErr()).toBe(
      true
    );
    expect(UpdateComputedOutboxWorkerConcurrencyCommand.create({ concurrency: 65 }).isErr()).toBe(
      true
    );
    expect(UpdateComputedOutboxWorkerConcurrencyCommand.create({ concurrency: null }).isOk()).toBe(
      true
    );
  });
});
