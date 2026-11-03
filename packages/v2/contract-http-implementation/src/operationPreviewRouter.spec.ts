import { createRouterClient } from '@orpc/server';
import {
  PreviewPlannerRegistry,
  v2CommandExplainTokens,
  type IOperationPreviewService,
  type IPreviewPlanner,
  type OperationPreview,
} from '@teable/v2-command-explain';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { ActorId, domainError, type IExecutionContext } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createV2OrpcRouter } from './router';

const context: IExecutionContext = {
  actorId: ActorId.create('usrPreview')._unsafeUnwrap(),
};

const preview: OperationPreview = {
  operation: 'table.delete',
  outcome: 'blocked',
  effects: [],
  blockers: [{ code: 'table.delete.blocked' }],
  warnings: [],
  coverage: { known: ['target-table'], unknown: [] },
  complexity: null,
  authorization: 'checked',
  observedAt: '2026-10-27T10:00:00.000Z',
  consistency: 'best-effort',
  requestDigest: `sha256:${'a'.repeat(64)}`,
  implementation: { plannerVersion: 'table-delete-v1', executionPath: 'DeleteTableCommand' },
};

const capabilityRegistry = () => {
  const planner = {
    operation: 'table.delete',
    plannerVersion: 'table-delete-v1',
    executionPath: 'DeleteTableCommand',
    preview: vi.fn(),
  } as unknown as IPreviewPlanner<unknown>;
  return PreviewPlannerRegistry.create([
    {
      operation: 'table.delete',
      parseInput: (input: unknown) => ok(input),
      planner,
      capability: {
        canonicalWriteRoute: 'DELETE /tables/delete',
        supportLevel: 'partial',
        requiredPermissionScope: 'table.delete',
        detailLevels: ['summary', 'full'],
        limitations: [],
      },
    },
  ])._unsafeUnwrap();
};

const createClient = (service: IOperationPreviewService, registry = capabilityRegistry()) => {
  const container = {
    resolve: vi.fn((token: symbol) => {
      if (token === v2CommandExplainTokens.operationPreviewService) return service;
      if (token === v2CommandExplainTokens.previewPlannerRegistry) return registry;
      throw new Error(`Unexpected token: ${String(token)}`);
    }),
  } as unknown as IHandlerResolver;
  return {
    client: createRouterClient(
      createV2OrpcRouter({
        createContainer: () => container,
        createExecutionContext: () => context,
      }),
      { context: {} }
    ),
    container,
  };
};

describe('operation preview oRPC router', () => {
  it('dispatches preview through the canonical service without converting blocked output', async () => {
    const service = {
      preview: vi.fn().mockResolvedValue(ok(preview)),
    } as unknown as IOperationPreviewService;
    const { client } = createClient(service);

    await expect(
      client.operations.preview({
        operation: 'table.delete',
        input: { baseId: 'bseA', tableId: 'tblA' },
      })
    ).resolves.toEqual({ ok: true, data: preview });
    expect(service.preview).toHaveBeenCalledOnce();
  });

  it('preserves the unsupported operation domain code', async () => {
    const service = {
      preview: vi.fn().mockResolvedValue(
        err(
          domainError.validation({
            code: 'preview.operation.unsupported',
            message: 'Unsupported preview operation: future.operation',
          })
        )
      ),
    } as unknown as IOperationPreviewService;
    const { client } = createClient(service);

    await expect(
      client.operations.preview({ operation: 'future.operation', input: {} })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: { domainCode: 'preview.operation.unsupported' },
    });
  });

  it('reads capabilities from the selected container registry', async () => {
    const service = { preview: vi.fn() } as unknown as IOperationPreviewService;
    const registry = capabilityRegistry();
    const { client, container } = createClient(service, registry);

    const result = await client.operations.capabilities({});

    expect(result).toMatchObject({
      ok: true,
      data: [{ operation: 'table.delete', supportLevel: 'partial' }],
    });
    expect(container.resolve).toHaveBeenCalledWith(v2CommandExplainTokens.previewPlannerRegistry);
    expect(service.preview).not.toHaveBeenCalled();
  });
});
