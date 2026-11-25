import { v2CoreTokens } from '@teable/v2-core';
import type { RecordInitiator } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

describe('V2ExecutionContextFactory trusted initiator propagation', () => {
  it.each<[string, RecordInitiator | undefined]>([
    ['appRobot', { type: 'appUser', id: 'apuStablePrincipal' }],
    ['automationRobot', { type: 'automation', id: 'wflStableWorkflow' }],
    ['aiRobot', { type: 'system', id: 'field-ai' }],
    ['usrActual', { type: 'user', id: 'usrActual' }],
    ['anonymous', undefined],
    ['appRobot', undefined],
  ])('keeps executor %s separate from its trusted initiator', async (executor, initiator) => {
    const values: Record<string, unknown> = {
      ['user.id']: executor,
      ['user.name']: 'Executor',
      ['user.email']: '',
      recordInitiator: initiator,
      audit: {
        operationId: 'operation-frozen',
        occurredAt: '2026-01-01T00:00:00.000Z',
        rootAction: 'table.record.update',
      },
    };
    const cls = { get: vi.fn((key: string) => values[key]), getId: () => 'requestId' };
    const tracer = {};
    const container = {
      isRegistered: () => false,
      resolve: (token: unknown) => (token === v2CoreTokens.tracer ? tracer : {}),
    };
    const factory = new V2ExecutionContextFactory(
      {} as never,
      cls as never,
      { t: () => '' } as never
    );
    const context = await factory.createContext(container as never);
    expect(context.actorId.toString()).toBe(executor);
    expect(context.initiator).toEqual(initiator);
    expect(context.operationAttribution).toMatchObject({
      operationId: 'operation-frozen',
      occurredAt: '2026-01-01T00:00:00.000Z',
      action: 'table.record.update',
    });
    expect(context).not.toHaveProperty('appId');
    expect(context.operationAttribution?.attributes).toEqual({});
  });

  it('freezes workflow provenance as scalar attributes before the request ends', async () => {
    const workflow = {
      workflowId: 'wfl_original',
      runId: 'run_original',
      actionId: 'action_original',
      workflowName: 'Original workflow',
      triggeredBy: 'usr_original',
    };
    const values: Record<string, unknown> = {
      ['user.id']: 'automationRobot',
      workflowContext: workflow,
    };
    const factory = new V2ExecutionContextFactory(
      {} as never,
      { get: (key: string) => values[key], getId: () => 'requestId' } as never,
      { t: () => '' } as never
    );
    const context = await factory.createContext({
      isRegistered: () => false,
      resolve: () => ({}),
    } as never);
    workflow.workflowId = 'wfl_later';
    workflow.runId = 'run_later';
    expect(context.operationAttribution?.attributes).toEqual({
      ['automation.workflowId']: 'wfl_original',
      ['automation.runId']: 'run_original',
      ['automation.actionId']: 'action_original',
      ['automation.workflowName']: 'Original workflow',
      ['automation.triggeredBy']: 'usr_original',
    });
    expect(Object.isFrozen(context.operationAttribution?.attributes)).toBe(true);
  });

  it.each([true, false, undefined])(
    'propagates only the trusted storage policy: %s',
    async (requireActorStorage) => {
      const values: Record<string, unknown> = {
        ['user.id']: 'automationRobot',
        recordInitiator: { type: 'automation', id: 'wflStableWorkflow' },
        requireActorStorage,
      };
      const factory = new V2ExecutionContextFactory(
        {} as never,
        { get: (key: string) => values[key], getId: () => 'requestId' } as never,
        { t: () => '' } as never
      );
      const context = await factory.createContext({
        isRegistered: () => false,
        resolve: () => ({}),
      } as never);
      expect(context.requireActorStorage).toBe(requireActorStorage);
    }
  );
});
