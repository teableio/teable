import { BaseNodeResourceType } from '@teable/openapi';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ROOT_ID } from '../../../base/base-node/hooks';
import type { TreeItemData } from '../../../base/base-node/hooks';
import { NodeTreeSelect } from './NodeTreeSelect';

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
 *   └── parent (folder)
 *         ├── childA (folder)
 *         │     └── tableA
 *         ├── childB (folder)
 *         │     └── grandChild (folder)
 *         │           └── tableB
 *         └── emptyChild (folder, no children)
 */
const treeItems: Record<string, TreeItemData> = {
  [ROOT_ID]: createNode(ROOT_ID, BaseNodeResourceType.Folder, ['parent']),
  parent: createNode(
    'parent',
    BaseNodeResourceType.Folder,
    ['childA', 'childB', 'emptyChild'],
    ROOT_ID
  ),
  childA: createNode('childA', BaseNodeResourceType.Folder, ['tableA'], 'parent'),
  tableA: createNode('tableA', BaseNodeResourceType.Table, [], 'childA'),
  childB: createNode('childB', BaseNodeResourceType.Folder, ['grandChild'], 'parent'),
  grandChild: createNode('grandChild', BaseNodeResourceType.Folder, ['tableB'], 'childB'),
  tableB: createNode('tableB', BaseNodeResourceType.Table, [], 'grandChild'),
  emptyChild: createNode('emptyChild', BaseNodeResourceType.Folder, [], 'parent'),
};

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/app/components/emoji/Emoji', () => ({ Emoji: () => null }));
vi.mock('../../../base/base-node/hooks/useBaseNodeContext', () => ({
  useBaseNodeContext: () => ({ treeItems }),
}));

// PublishBaseDialog seeds the selection with every node id, folders included
const allNodeIds = Object.keys(treeItems).filter((id) => id !== ROOT_ID);

let latestChecked: string[] = [];
const Harness = ({ initial = allNodeIds }: { initial?: string[] }) => {
  const [checked, setChecked] = useState<string[]>(initial);
  latestChecked = checked;
  return (
    <NodeTreeSelect
      showCheckbox
      checkedItems={checked}
      onCheckedItemsChange={setChecked}
      totalNodeCount={allNodeIds.length}
    />
  );
};

const getCheckbox = (name: string) => {
  const row = screen.getByTitle(name).closest('div.flex.w-full') as HTMLElement;
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
};

const openAndExpand = async (...names: string[]) => {
  fireEvent.click(screen.getByRole('combobox'));
  for (const name of names) {
    await act(async () => {
      fireEvent.click(screen.getByTitle(name));
    });
  }
};

const toggle = async (name: string) => {
  await act(async () => {
    fireEvent.click(getCheckbox(name));
  });
};

describe('NodeTreeSelect', () => {
  it('unchecking a parent folder clears every descendant, including sub-folder ids', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('combobox'));

    await act(async () => {
      fireEvent.click(screen.getByTitle('Node parent'));
    });
    expect(getCheckbox('Node parent').checked).toBe(true);

    await act(async () => {
      fireEvent.click(getCheckbox('Node parent'));
    });

    // payload / chips use this same list
    expect(latestChecked).toEqual([]);
    expect(getCheckbox('Node parent').checked).toBe(false);
    expect(getCheckbox('Node childA').checked).toBe(false);
    expect(getCheckbox('Node childB').checked).toBe(false);
    expect(getCheckbox('Node emptyChild').checked).toBe(false);
  });

  it('checking a parent folder selects every descendant, including collapsed ones', async () => {
    render(<Harness initial={[]} />);
    await openAndExpand('Node parent');

    await toggle('Node parent');

    expect([...latestChecked].sort()).toEqual([...allNodeIds].sort());
    expect(getCheckbox('Node parent').checked).toBe(true);
    expect(getCheckbox('Node childB').checked).toBe(true);
  });

  it('shows the parent as indeterminate after re-selecting one child', async () => {
    render(<Harness />);
    await openAndExpand('Node parent', 'Node childA');

    await toggle('Node parent');
    await toggle('Node tableA');

    const parent = getCheckbox('Node parent');
    expect(parent.checked).toBe(false);
    expect(parent.indeterminate).toBe(true);
    expect(getCheckbox('Node childA').checked).toBe(true);
    expect(getCheckbox('Node childB').checked).toBe(false);
    // the partially selected parent stays out: publishing would expand it to childB too
    expect([...latestChecked].sort()).toEqual(['childA', 'tableA']);
  });

  it('clears descendants hidden by search when unchecking a parent', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('combobox'));
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('common:actions.search'), {
        target: { value: 'childA' },
      });
    });
    expect(screen.queryByTitle('Node childB')).toBeNull();

    await toggle('Node parent');

    expect(latestChecked).toEqual([]);
  });
});
