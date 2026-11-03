import { createChildContainer, type DependencyContainer } from '@teable/v2-di';
import { domainError, v2CoreTokens, type IExecutionContext } from '@teable/v2-core';
import { err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { createCorePreviewPlannerRegistry } from './createCorePreviewPlannerRegistry';

const createContainer = (): DependencyContainer => {
  const dependencies = new Map<unknown, unknown>([
    [v2CoreTokens.tableQueryService, {}],
    [v2CoreTokens.tableRecordQueryRepository, {}],
    [v2CoreTokens.fieldConversionPreparationService, {}],
    [v2CoreTokens.fieldDeletionPreparationService, {}],
    [v2CoreTokens.tableDeletionPreparationService, {}],
    [v2CoreTokens.pastePreparationService, {}],
    [v2CoreTokens.bulkRecordPreparationService, {}],
    [v2CoreTokens.duplicateTablePreparationService, {}],
    [v2CoreTokens.deleteByRangeApplicationService, {}],
  ]);
  const container = createChildContainer();
  for (const [token, dependency] of dependencies) {
    container.registerInstance(token as symbol, dependency);
  }
  return container;
};

describe('createCorePreviewPlannerRegistry', () => {
  it('registers every core-owned operation and derives its capability metadata', () => {
    const registry = createCorePreviewPlannerRegistry(createContainer());

    expect(registry.capabilities().map((capability) => capability.operation)).toEqual([
      'field.convert',
      'field.delete',
      'records.bulkDelete',
      'records.bulkUpdate',
      'records.paste',
      'table.delete',
      'table.duplicate',
    ]);
    expect(registry.resolve('base.duplicate')._unsafeUnwrapErr().code).toBe(
      'preview.operation.unsupported'
    );
  });

  it('preserves host preparation admission when assembling a preview planner', async () => {
    const container = createContainer();
    const rejection = domainError.forbidden({
      code: 'host.field_conversion.denied',
      message: 'Host preparation denied field conversion',
    });
    const prepare = vi.fn(async () => err(rejection));
    container.registerInstance(v2CoreTokens.fieldConversionPreparationService, { prepare });
    const registry = createCorePreviewPlannerRegistry(container);
    const input = {
      tableId: `tbl${'a'.repeat(16)}`,
      fieldId: `fld${'b'.repeat(16)}`,
      field: { type: 'singleLineText' },
    };
    const context = {} as IExecutionContext;
    const result = await registry.resolve('field.convert')._unsafeUnwrap().plan(context, input, {
      detail: 'summary',
      includeComplexity: false,
      maxItems: 100,
    });

    expect(result._unsafeUnwrapErr()).toBe(rejection);
  });
});
