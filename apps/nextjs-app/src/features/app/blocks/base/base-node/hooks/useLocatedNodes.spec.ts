import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TreeItemData } from './useBaseNode';
import { useLocatedNodesStore, useLocatedTreeNodes } from './useLocatedNodes';

const node = (id: string, parentId: string | null, resourceId: string) =>
  ({ id, parentId, resourceId, children: [] }) as unknown as TreeItemData;

const treeItems: Record<string, TreeItemData> = {
  bnoOps: node('bnoOps', null, 'fldrOps'),
  bnoHr: node('bnoHr', 'bnoOps', 'fldrHr'),
  bnoMembers: node('bnoMembers', 'bnoHr', 'tblMembers'),
  bnoApp: node('bnoApp', null, 'appSignOff'),
};

const locate = (ids: string[]) => act(() => useLocatedNodesStore.getState().locate(ids));

describe('useLocatedTreeNodes', () => {
  afterEach(() => locate([]));

  it('marks nothing until something is pointed at', () => {
    const { result } = renderHook(() => useLocatedTreeNodes(treeItems));

    expect(Object.keys(treeItems).some((id) => result.current(id, false))).toBe(false);
  });

  it('marks a node named by what it holds or by its own id', () => {
    const { result } = renderHook(() => useLocatedTreeNodes(treeItems));

    locate(['appSignOff']);
    expect(result.current('bnoApp', false)).toBe(true);
    expect(result.current('bnoMembers', false)).toBe(false);

    locate(['bnoMembers']);
    expect(result.current('bnoMembers', false)).toBe(true);
    expect(result.current('bnoApp', false)).toBe(false);
  });

  it('marks a folded folder that holds the node, and not one that is open', () => {
    const { result } = renderHook(() => useLocatedTreeNodes(treeItems));

    locate(['tblMembers']);
    expect(result.current('bnoHr', false)).toBe(true);
    expect(result.current('bnoOps', false)).toBe(true);
    expect(result.current('bnoHr', true)).toBe(false);
    expect(result.current('bnoOps', true)).toBe(false);
  });

  it('ignores an id that is nowhere in the project', () => {
    const { result } = renderHook(() => useLocatedTreeNodes(treeItems));

    locate(['tblGone']);
    expect(Object.keys(treeItems).some((id) => result.current(id, false))).toBe(false);
  });
});
