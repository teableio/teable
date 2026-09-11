import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdatePauseScope,
  type IComputedUpdatePauseRegistry,
} from '@teable/v2-adapter-table-repository-postgres';
import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Effect, Layer } from 'effect';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  ComputedTaskControl,
  type ResumeComputedScopesInput,
} from '../services/ComputedTaskControl';
import { Database } from '../services/Database';
import { ComputedTaskControlLive } from './ComputedTaskControlLive';

const pauseScope = (
  overrides: Partial<ComputedUpdatePauseScope> = {}
): ComputedUpdatePauseScope => ({
  id: 'cup_lease',
  scopeType: 'base',
  scopeId: 'bse_target',
  scopeName: 'Target Base',
  baseId: 'bse_target',
  baseName: 'Target Base',
  spaceId: 'spc_target',
  spaceName: 'Target Space',
  pausedAt: new Date('2026-08-02T06:00:00.000Z'),
  pausedBy: 'ops',
  resumeAt: new Date('2026-08-02T07:00:00.000Z'),
  reason: 'maintenance',
  writePolicy: 'allow_bounded',
  updatedAt: new Date('2026-08-02T06:00:00.000Z'),
  updatedBy: 'ops',
  active: true,
  ...overrides,
});

const runResume = async (
  registry: IComputedUpdatePauseRegistry,
  input: ResumeComputedScopesInput
) => {
  const container = {
    resolve: (token: unknown) => {
      if (token === v2RecordRepositoryPostgresTokens.computedUpdatePauseRegistry) return registry;
      if (token === v2CoreTokens.internalCommandBus) return { execute: vi.fn() };
      throw new Error('Unexpected dependency token');
    },
  } as unknown as DependencyContainer;
  const layer = ComputedTaskControlLive.pipe(
    Layer.provide(
      Layer.succeed(Database, {
        container,
        connectionString: 'pglite://memory',
        isPglite: true,
      })
    )
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      const control = yield* ComputedTaskControl;
      return yield* control.resumeScope(input);
    }).pipe(Effect.provide(layer))
  );
};

const registryStub = (): IComputedUpdatePauseRegistry => ({
  pauseScope: vi.fn(),
  resumeScope: vi.fn(),
  releaseLease: vi.fn(),
  extendLease: vi.fn(),
  listScopes: vi.fn(),
  admitComputedWrite: vi.fn(),
});

describe('ComputedTaskControlLive resume', () => {
  it('releases a lease by id and reports inherited blockers', async () => {
    const target = pauseScope();
    const inherited = pauseScope({
      id: 'cup_space',
      scopeType: 'space',
      scopeId: 'spc_target',
      scopeName: 'Target Space',
      baseId: null,
      baseName: null,
    });
    const descendant = pauseScope({
      id: 'cup_table',
      scopeType: 'table',
      scopeId: 'tbl_target',
      scopeName: 'Target Table',
    });
    const registry = registryStub();
    vi.mocked(registry.listScopes)
      .mockResolvedValueOnce(ok([target, inherited, descendant]))
      .mockResolvedValueOnce(ok([inherited, descendant]));
    vi.mocked(registry.releaseLease).mockResolvedValue(ok(true));

    const result = await runResume(registry, {
      leaseId: target.id,
      actor: 'resume-operator',
      releaseReason: 'incident resolved',
    });

    expect(registry.releaseLease).toHaveBeenCalledWith({
      leaseId: target.id,
      actor: 'resume-operator',
      releaseReason: 'incident resolved',
    });
    expect(result).toMatchObject({
      leaseId: target.id,
      scopeType: 'base',
      scopeId: 'bse_target',
      forced: false,
      resumed: true,
      remainingBlockers: [{ id: inherited.id }, { id: descendant.id }],
    });
  });

  it('keeps scope-wide resume as an explicit force-compatible path', async () => {
    const target = pauseScope();
    const registry = registryStub();
    vi.mocked(registry.listScopes)
      .mockResolvedValueOnce(ok([target]))
      .mockResolvedValueOnce(ok([]));
    vi.mocked(registry.resumeScope).mockResolvedValue(ok(true));

    const result = await runResume(registry, {
      scopeType: 'base',
      scopeId: 'bse_target',
      actor: 'force-operator',
    });

    expect(registry.resumeScope).toHaveBeenCalledWith({
      scopeType: 'base',
      scopeId: 'bse_target',
      actor: 'force-operator',
      releaseReason: undefined,
    });
    expect(result).toMatchObject({
      leaseId: target.id,
      forced: true,
      resumed: true,
      remainingBlockers: [],
    });
  });
});
