import type { TableAction } from '@teable/core';
import { BaseNodeResourceType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { filterAutoHiddenFolders, filterVisibleNodes } from './base-node.permission.helper';

const node = (id: string, resourceType: BaseNodeResourceType, parentId: string | null = null) => ({
  id,
  resourceType,
  parentId,
  resourceId: `res${id}`,
});
const folder = (id: string, parentId: string | null = null) =>
  node(id, BaseNodeResourceType.Folder, parentId);

describe('filterAutoHiddenFolders', () => {
  it('keeps a folder with content anywhere below it and drops one with only folders below', () => {
    const nodes = [
      folder('fOuter'),
      folder('fInner', 'fOuter'),
      node('tKept', BaseNodeResourceType.Table, 'fInner'),
      folder('fEmptyOuter'),
      folder('fEmptyInner', 'fEmptyOuter'),
      node('dRoot', BaseNodeResourceType.Dashboard),
    ];

    expect(filterAutoHiddenFolders(nodes).map(({ id }) => id)).toEqual([
      'fOuter',
      'fInner',
      'tKept',
      'dRoot',
    ]);
  });

  it('judges a folder by the nodes it is given, not by children it no longer has', () => {
    // The table under fFolder was filtered out before this point
    expect(filterAutoHiddenFolders([folder('fFolder')])).toEqual([]);
  });

  it('ends on a corrupt parent cycle instead of recursing forever', () => {
    expect(filterAutoHiddenFolders([folder('fA', 'fB'), folder('fB', 'fA')])).toEqual([]);
  });
});

describe('filterVisibleNodes', () => {
  const nodes = [
    folder('fShown'),
    node('tGranted', BaseNodeResourceType.Table, 'fShown'),
    folder('fHidden'),
    node('tWithheld', BaseNodeResourceType.Table, 'fHidden'),
    node('dRoot', BaseNodeResourceType.Dashboard),
  ];
  const permissionSet = new Set(['base|read', 'table|read']);
  const tablePermissionMap: Record<string, TableAction[]> = { restGranted: ['table|read'] };

  it('keeps what the matrix grants and drops the folders left with nothing readable', () => {
    const visible = filterVisibleNodes(nodes, {
      permissionSet,
      tablePermissionMap,
      hideInaccessibleFolders: true,
    });

    expect(visible.map(({ id }) => id)).toEqual(['fShown', 'tGranted', 'dRoot']);
  });

  it('keeps every folder the base role reads when not asked to hide them', () => {
    const visible = filterVisibleNodes(nodes, { permissionSet, tablePermissionMap });

    expect(visible.map(({ id }) => id)).toEqual(['fShown', 'tGranted', 'fHidden', 'dRoot']);
  });

  it('keeps a node share visitor to the shared node and everything below it', () => {
    const visible = filterVisibleNodes(
      [
        ...nodes,
        folder('fNested', 'fShown'),
        node('tNested', BaseNodeResourceType.Table, 'fNested'),
      ],
      { permissionSet, shareNodeId: 'fShown' }
    );

    expect(visible.map(({ id }) => id)).toEqual(['fShown', 'tGranted', 'fNested', 'tNested']);
  });

  it('shows a node share visitor nothing once the shared node is gone', () => {
    expect(filterVisibleNodes(nodes, { permissionSet, shareNodeId: 'fDeleted' })).toEqual([]);
  });
});
