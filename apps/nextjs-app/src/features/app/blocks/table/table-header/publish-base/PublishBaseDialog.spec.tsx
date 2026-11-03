import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BaseNodeResourceType, type IGetBaseVo } from '@teable/openapi';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOT_ID } from '../../../base/base-node/hooks';
import type { TreeItemData } from '../../../base/base-node/hooks';
import { PublishBaseDialog } from './PublishBaseDialog';

const createNode = (
  id: string,
  resourceType: BaseNodeResourceType,
  children: string[] = [],
  parentId: string | null = null
): TreeItemData => ({
  id,
  resourceType,
  resourceId: id,
  resourceMeta: { name: `Node ${id}` },
  order: 0,
  parentId,
  children,
});

/**
 * root
 *   ├── parent (folder)
 *   │     ├── childA (folder)
 *   │     │     └── tableA
 *   │     └── childB (folder)
 *   │           └── tableB
 *   └── other (table)
 */
const buildTree = (): Record<string, TreeItemData> => ({
  [ROOT_ID]: createNode(ROOT_ID, BaseNodeResourceType.Folder, ['parent', 'other']),
  parent: createNode('parent', BaseNodeResourceType.Folder, ['childA', 'childB'], ROOT_ID),
  childA: createNode('childA', BaseNodeResourceType.Folder, ['tableA'], 'parent'),
  tableA: createNode('tableA', BaseNodeResourceType.Table, [], 'childA'),
  childB: createNode('childB', BaseNodeResourceType.Folder, ['tableB'], 'parent'),
  tableB: createNode('tableB', BaseNodeResourceType.Table, [], 'childB'),
  other: createNode('other', BaseNodeResourceType.Table, [], ROOT_ID),
});

const allNodeIds = Object.keys(buildTree()).filter((id) => id !== ROOT_ID);

const { state, publishBase, getTemplateByBaseId } = vi.hoisted(() => ({
  state: { treeItems: {} as Record<string, unknown> },
  publishBase: vi.fn(),
  getTemplateByBaseId: vi.fn(),
}));

vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishBase,
  getTemplateByBaseId,
  getBaseNodeTree: vi.fn(async () => ({ data: { nodes: [], maxFolderDepth: 2 } })),
}));
// The dialog reads the tree by id and shapes it itself; the test hands it the shaped tree.
vi.mock('../../../base/base-node/hooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildTreeItems: () => state.treeItems,
  filterAutoHiddenFolders: (nodes: unknown) => nodes,
}));
vi.mock('@teable/sdk/components', () => ({ AttachmentManager: class {} }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('@/features/app/components/emoji/Emoji', () => ({ Emoji: () => null }));
vi.mock('@/features/app/hooks/useIsCloud', () => ({ useIsCloud: () => true }));
vi.mock('@/features/app/hooks/useOrigin', () => ({ useOrigin: () => 'http://localhost' }));
vi.mock('@/features/app/hooks/useShortLink', () => ({
  useShortLink: () => ({ shortUrl: undefined, isFallback: false }),
}));
vi.mock('./NodeSelect', () => ({ NodeSelect: () => null }));
vi.mock('./TemplateSubmissionState', () => ({
  TemplateChangelogField: () => null,
  TemplateReviewPanel: () => null,
}));

const testBase = { id: 'bseTest', name: 'Base' } as IGetBaseVo;

const renderDialog = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <PublishBaseDialog base={testBase} onClose={() => undefined}>
        <button type="button">open-publish</button>
      </PublishBaseDialog>
    </QueryClientProvider>
  );
  const result = render(ui());
  return { rerender: () => result.rerender(ui()) };
};

const getCheckbox = (name: string) => {
  const row = screen.getByTitle(name).closest('div.flex.w-full') as HTMLElement;
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
};

// Mirrors BaseDuplicateService.collectNodesAndResourceIds: every submitted node is
// published together with its whole subtree (ancestors are only added for structure)
const expandLikePublish = (nodes: string[]) => {
  const tree = buildTree();
  const result = new Set<string>();
  const visit = (id: string) => {
    result.add(id);
    tree[id]?.children.forEach(visit);
  };
  nodes.forEach(visit);
  return [...result].sort();
};

describe('PublishBaseDialog publish nodes', () => {
  beforeEach(() => {
    state.treeItems = buildTree();
    publishBase.mockReset().mockResolvedValue({ data: {} });
    getTemplateByBaseId.mockReset().mockResolvedValue({
      data: {
        id: 'tplTest',
        name: 'Template',
        description: 'Desc',
        isPublished: true,
        publishInfo: { nodes: allNodeIds, includeData: true },
      },
    });
  });

  it('keeps an unchecked parent folder cleared after nodes refresh and in the payload', async () => {
    const { rerender } = renderDialog();
    fireEvent.click(screen.getByText('open-publish'));
    await waitFor(() => expect(screen.getByText('common:allNodes')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('combobox')[0]);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Node parent'));
    });
    await act(async () => {
      fireEvent.click(getCheckbox('Node parent'));
    });
    expect(getCheckbox('Node childA').checked).toBe(false);

    // a base-node update (e.g. a rename pushed over the socket) produces a new tree object
    state.treeItems = {
      ...buildTree(),
      other: { ...buildTree().other, resourceMeta: { name: 'Node other' } },
    };
    await act(async () => {
      rerender();
    });

    expect(getCheckbox('Node parent').checked).toBe(false);
    expect(getCheckbox('Node childA').checked).toBe(false);
    expect(screen.queryByText('common:allNodes')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText('publishBase.update'));
    });

    await waitFor(() => expect(publishBase).toHaveBeenCalledTimes(1));
    expect(publishBase.mock.calls[0][1].nodes).toEqual(['other']);
  });

  it('does not submit a partially selected folder that would republish unchecked branches', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('open-publish'));
    await waitFor(() => expect(screen.getByText('common:allNodes')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('combobox')[0]);
    for (const name of ['Node parent', 'Node childA']) {
      await act(async () => {
        fireEvent.click(screen.getByTitle(name));
      });
    }
    await act(async () => {
      fireEvent.click(getCheckbox('Node parent'));
    });
    await act(async () => {
      fireEvent.click(getCheckbox('Node tableA'));
    });
    expect(getCheckbox('Node parent').indeterminate).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText('publishBase.update'));
    });

    await waitFor(() => expect(publishBase).toHaveBeenCalledTimes(1));
    const { nodes } = publishBase.mock.calls[0][1];
    expect(nodes).not.toContain('parent');
    // what gets published is exactly what is checked in the tree
    expect(expandLikePublish(nodes)).toEqual(['childA', 'other', 'tableA']);
  });

  it('drops stale sub-folder ids from saved nodes so they are not republished', async () => {
    // saved by the old selector: parent unchecked, but the childB folder id was left behind
    getTemplateByBaseId.mockResolvedValue({
      data: {
        id: 'tplTest',
        name: 'Template',
        description: 'Desc',
        isPublished: true,
        publishInfo: { nodes: ['childB', 'other'], includeData: true },
      },
    });
    renderDialog();
    fireEvent.click(screen.getByText('open-publish'));
    await waitFor(() => expect(getTemplateByBaseId).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('publishBase.update')).toBeInTheDocument());

    // publish without touching any checkbox
    await act(async () => {
      fireEvent.click(screen.getByText('publishBase.update'));
    });

    await waitFor(() => expect(publishBase).toHaveBeenCalledTimes(1));
    const { nodes } = publishBase.mock.calls[0][1];
    expect(nodes).not.toContain('childB');
    expect(expandLikePublish(nodes)).toEqual(['other']);
  });
});
