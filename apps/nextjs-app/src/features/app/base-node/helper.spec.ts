import { QueryClient } from '@tanstack/react-query';
import type { IBaseNodeVo, ITableVo } from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';

import { validateResourceExists } from './helper';
import type { ISSRContext } from './types';

const createTableNode = (resourceId: string): IBaseNodeVo =>
  ({
    id: `node_${resourceId}`,
    parentId: null,
    resourceId,
    order: 0,
    resourceType: BaseNodeResourceType.Table,
    resourceMeta: { name: resourceId },
  }) as IBaseNodeVo;

describe('validateResourceExists', () => {
  it('does not redirect back to a table excluded from the current table list', async () => {
    const queryClient = new QueryClient();
    const ssrApi = {
      getUserLastVisitBaseNode: vi.fn().mockResolvedValue({
        resourceId: 'tbl_error',
        resourceType: BaseNodeResourceType.Table,
      }),
      getBaseNodeList: vi
        .fn()
        .mockResolvedValue([createTableNode('tbl_error'), createTableNode('tbl_ready')]),
    };
    const ctx = {
      baseId: 'bse_test',
      queryClient,
      ssrApi,
    } as unknown as ISSRContext;

    const result = await validateResourceExists<Pick<ITableVo, 'id'>>(ctx, {
      resourceId: 'tbl_error',
      queryKey: ['table-list', 'bse_test'],
      fetchList: async () => [{ id: 'tbl_ready' }],
      extractIds: (list) => list.map((table) => table.id),
      filterDefaultNode: (node, resourceIds) =>
        node.resourceType !== BaseNodeResourceType.Table || resourceIds.has(node.resourceId),
    });

    expect(result).toEqual({
      redirect: {
        destination: '/base/bse_test/table/tbl_ready',
        permanent: false,
      },
    });
  });
});
