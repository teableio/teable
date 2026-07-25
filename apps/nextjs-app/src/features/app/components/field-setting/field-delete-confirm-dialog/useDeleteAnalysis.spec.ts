import type { IFieldDeleteReferencesItem } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { mapItemReferences } from './useDeleteAnalysis';
import { getAffectedItemDisplayName } from './utils';

describe('mapItemReferences', () => {
  it('preserves a workflow node custom name and category independently', () => {
    const refs: IFieldDeleteReferencesItem = {
      dependentFields: [],
      views: [],
      authorityMatrixRoles: [],
      workflowNodes: [
        {
          id: 'wfnTestNode',
          name: 'Publish Public Release',
          type: 'action',
          category: 'httpRequest',
          source: {
            id: 'wflTestWorkflow',
            name: 'Publish release',
            base: { id: 'bseTestBase', name: 'Project Management' },
          },
        },
      ],
    };

    const [item] = mapItemReferences(refs);

    expect([item]).toEqual([
      expect.objectContaining({
        name: 'Publish Public Release',
        category: 'httpRequest',
      }),
    ]);

    const resolveNodeTypeName = vi.fn(() => {
      throw new Error('custom node names are not workflow categories');
    });

    expect(getAffectedItemDisplayName(item, resolveNodeTypeName)).toBe('Publish Public Release');
    expect(resolveNodeTypeName).not.toHaveBeenCalled();
  });

  it('resolves an unnamed workflow node from its type and category', () => {
    const resolveNodeTypeName = vi.fn(() => 'HTTP request');

    expect(
      getAffectedItemDisplayName(
        {
          id: 'wfnTestNode',
          name: '',
          itemType: 'workflow',
          type: 'action',
          category: 'httpRequest',
        },
        resolveNodeTypeName
      )
    ).toBe('HTTP request');
    expect(resolveNodeTypeName).toHaveBeenCalledWith('action', 'httpRequest');
  });
});
