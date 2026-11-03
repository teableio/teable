import { PreviewPlannerRegistry, v2CommandExplainTokens } from '@teable/v2-command-explain';
import { v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it, vi } from 'vitest';
import {
  parseRecordsPasteHostPreviewInput,
  RecordsPastePreviewRegistrar,
} from './record-paste-preview-registrar.service';

const routeInput = {
  tableId: `tbl${'p'.repeat(16)}`,
  ranges: [
    [0, 0],
    [0, 0],
  ] as [[number, number], [number, number]],
  content: [['preview']],
};

describe('records paste host preview registration', () => {
  it('accepts the mounted paste body with default-view semantics', () => {
    const parsed = parseRecordsPasteHostPreviewInput(routeInput)._unsafeUnwrap();

    expect(parsed.tableId).toBe(routeInput.tableId);
    expect(parsed.pasteRo).toMatchObject({
      ranges: routeInput.ranges,
      content: routeInput.content,
    });
    expect(parsed.pasteRo.viewId).toBeUndefined();
  });

  it('registers the host adapter with the actual route and container-owned preparation', () => {
    const registry = PreviewPlannerRegistry.empty();
    const preparation = { prepare: vi.fn() };
    const resolve = vi.fn((token: symbol) => {
      if (token === v2CoreTokens.pastePreparationService) return preparation;
      if (token === v2CommandExplainTokens.previewPlannerRegistry) return registry;
      throw new Error(`Unexpected token: ${String(token)}`);
    });
    const registrar = new RecordsPastePreviewRegistrar({} as never);
    registrar.registerProjections({ resolve } as unknown as DependencyContainer);

    expect(resolve).toHaveBeenCalledWith(v2CoreTokens.pastePreparationService);
    expect(registry.capabilities()).toContainEqual(
      expect.objectContaining({
        operation: 'records.paste',
        canonicalWriteRoute: 'PATCH /table/{tableId}/selection/paste',
        supportLevel: 'partial',
        requiredPermissionScope: 'record:update',
      })
    );
  });
});
