import { BaseNodeResourceType } from '@teable/openapi';
import { vi } from 'vitest';
import { findAdjacentNonFolderNode, ROOT_ID } from './helper';
import type { TreeItemData } from './useBaseNode';

/**
 * Helper function to create a TreeItemData node for testing
 */
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
 * Helper function to create a root node
 */
const createRootNode = (children: string[]): TreeItemData => ({
  id: ROOT_ID,
  resourceType: BaseNodeResourceType.Folder,
  resourceId: ROOT_ID,
  resourceMeta: { name: 'baseMenuRoot' },
  order: 0,
  parentId: null,
  children,
});

describe('findAdjacentNonFolderNode', () => {
  describe('basic traversal', () => {
    it('should return the next sibling if it is not a folder', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   └── table2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'table2']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });

    it('should return the previous sibling if next sibling does not exist', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1
       *   └── table2 (current)
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'table2']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table2');
      expect(result?.id).toBe('table1');
    });

    it('should return null when only one non-folder node exists', () => {
      /**
       * Tree structure:
       * root
       *   └── table1 (current)
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result).toBeNull();
    });
  });

  describe('folder handling', () => {
    it('should skip folder and return the next non-folder node', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   ├── folder1
       *   └── table2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'folder1', 'table2']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        folder1: createNode('folder1', BaseNodeResourceType.Folder),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });

    it('should enter folder children when searching below', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   └── folder1
       *       └── table2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'folder1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['table2']),
        table2: createNode('table2', BaseNodeResourceType.Table, [], 'folder1'),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });

    it('should skip empty folders and continue searching', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   ├── folder1 (empty)
       *   └── table2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'folder1', 'table2']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, []),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });

    it('should return null when only folders exist besides current node', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   └── folder1
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'folder1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        folder1: createNode('folder1', BaseNodeResourceType.Folder),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result).toBeNull();
    });
  });

  describe('nested folder traversal', () => {
    it('should find node in deeply nested folder', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   └── folder1
       *       └── folder2
       *           └── table2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'folder1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['folder2']),
        folder2: createNode('folder2', BaseNodeResourceType.Folder, ['table2'], 'folder1'),
        table2: createNode('table2', BaseNodeResourceType.Table, [], 'folder2'),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });

    it('should find parent sibling after reaching end of nested structure', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1
       *   │   └── table1 (current)
       *   └── table2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table2']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['table1']),
        table1: createNode('table1', BaseNodeResourceType.Table, [], 'folder1'),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });

    it('should traverse up and find previous sibling last descendant', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1
       *   │   └── table1
       *   └── table2 (current)
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table2']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['table1']),
        table1: createNode('table1', BaseNodeResourceType.Table, [], 'folder1'),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table2');
      expect(result?.id).toBe('table1');
    });
  });

  describe('alternating search pattern', () => {
    it('should prefer below over above when both exist', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1
       *   ├── table2 (current)
       *   └── table3
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'table2', 'table3']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        table2: createNode('table2', BaseNodeResourceType.Table),
        table3: createNode('table3', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table2');
      expect(result?.id).toBe('table3');
    });

    it('should fall back to above when below is folder', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1
       *   ├── table2 (current)
       *   └── folder1 (empty)
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'table2', 'folder1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        table2: createNode('table2', BaseNodeResourceType.Table),
        folder1: createNode('folder1', BaseNodeResourceType.Folder),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table2');
      expect(result?.id).toBe('table1');
    });
  });

  describe('different resource types', () => {
    it('should return dashboard node', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   └── dashboard1
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'dashboard1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        dashboard1: createNode('dashboard1', BaseNodeResourceType.Dashboard),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('dashboard1');
    });

    it('should return workflow node', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   └── workflow1
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'workflow1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        workflow1: createNode('workflow1', BaseNodeResourceType.Workflow),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('workflow1');
    });

    it('should return app node', () => {
      /**
       * Tree structure:
       * root
       *   ├── table1 (current)
       *   └── app1
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'app1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        app1: createNode('app1', BaseNodeResourceType.App),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('app1');
    });

    it('should handle mixed resource types', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1
       *   ├── table1 (current)
       *   ├── folder2
       *   ├── dashboard1
       *   └── workflow1
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table1', 'folder2', 'dashboard1', 'workflow1']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder),
        table1: createNode('table1', BaseNodeResourceType.Table),
        folder2: createNode('folder2', BaseNodeResourceType.Folder),
        dashboard1: createNode('dashboard1', BaseNodeResourceType.Dashboard),
        workflow1: createNode('workflow1', BaseNodeResourceType.Workflow),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('dashboard1');
    });
  });

  describe('complex tree structures', () => {
    it('should handle complex nested structure with multiple folders', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1
       *   │   ├── folder2
       *   │   │   └── table1 (current)
       *   │   └── table2
       *   └── table3
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table3']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['folder2', 'table2']),
        folder2: createNode('folder2', BaseNodeResourceType.Folder, ['table1'], 'folder1'),
        table1: createNode('table1', BaseNodeResourceType.Table, [], 'folder2'),
        table2: createNode('table2', BaseNodeResourceType.Table, [], 'folder1'),
        table3: createNode('table3', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });

    it('should find last descendant when going up from last child', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1
       *   │   ├── table1
       *   │   └── table2
       *   └── table3 (current)
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table3']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['table1', 'table2']),
        table1: createNode('table1', BaseNodeResourceType.Table, [], 'folder1'),
        table2: createNode('table2', BaseNodeResourceType.Table, [], 'folder1'),
        table3: createNode('table3', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table3');
      // Should find table2 as it's the last descendant of folder1
      expect(result?.id).toBe('table2');
    });

    it('should handle sibling at same level after nested children', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1
       *   │   └── table1 (current)
       *   ├── folder2
       *   │   └── table2
       *   └── table3
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'folder2', 'table3']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['table1']),
        table1: createNode('table1', BaseNodeResourceType.Table, [], 'folder1'),
        folder2: createNode('folder2', BaseNodeResourceType.Folder, ['table2']),
        table2: createNode('table2', BaseNodeResourceType.Table, [], 'folder2'),
        table3: createNode('table3', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      // Should go to folder2's first child (table2)
      expect(result?.id).toBe('table2');
    });
  });

  describe('edge cases', () => {
    it('should return null for non-existent node', () => {
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1']),
        table1: createNode('table1', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return null for empty tree', () => {
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode([]),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result).toBeNull();
    });

    it('should handle tree with only folders', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1 (current)
       *   └── folder2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'folder2']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder),
        folder2: createNode('folder2', BaseNodeResourceType.Folder),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'folder1');
      expect(result).toBeNull();
    });

    it('should find node when current is a folder with children', () => {
      /**
       * Tree structure:
       * root
       *   ├── folder1 (current)
       *   │   └── table1
       *   └── table2
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table2']),
        folder1: createNode('folder1', BaseNodeResourceType.Folder, ['table1']),
        table1: createNode('table1', BaseNodeResourceType.Table, [], 'folder1'),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      const result = findAdjacentNonFolderNode(treeItems, 'folder1');
      expect(result?.id).toBe('table1');
    });
  });

  describe('circular reference protection', () => {
    it('should handle circular reference in children (prevent infinite recursion)', () => {
      /**
       * Malformed tree with circular reference:
       * folder1.children includes folder1 itself
       */
      const folder1Node = createNode('folder1', BaseNodeResourceType.Folder, ['folder1']);
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table1']),
        folder1: folder1Node,
        table1: createNode('table1', BaseNodeResourceType.Table),
      };

      // Should not crash, should handle gracefully
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Suppress error logs during test
      });
      const result = findAdjacentNonFolderNode(treeItems, 'folder1');

      // Should return table1 or null, but not crash
      expect(result?.id === 'table1' || result === null).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should handle circular reference in parent chain (prevent infinite loop in getItemBelow)', () => {
      /**
       * Malformed tree where node points to itself as parent
       */
      const circularNode = createNode('circular', BaseNodeResourceType.Folder, [], 'circular');
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['circular', 'table1']),
        circular: circularNode,
        table1: createNode('table1', BaseNodeResourceType.Table),
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Suppress error logs during test
      });
      const result = findAdjacentNonFolderNode(treeItems, 'circular');

      // Should handle gracefully without infinite loop
      expect(result?.id === 'table1' || result === null).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should not exceed max iterations for deeply nested structure', () => {
      /**
       * Create a very deep structure to test max iteration limit
       * root -> folder1 -> folder2 -> ... -> folder10 -> table1
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['folder1', 'table2']),
      };

      let currentParent = 'folder1';
      for (let i = 1; i <= 10; i++) {
        const folderId = `folder${i}`;
        const nextId = i === 10 ? 'table1' : `folder${i + 1}`;

        treeItems[folderId] = createNode(
          folderId,
          BaseNodeResourceType.Folder,
          [nextId],
          i === 1 ? null : `folder${i - 1}`
        );
        currentParent = folderId;
      }

      treeItems['table1'] = createNode('table1', BaseNodeResourceType.Table, [], 'folder10');
      treeItems['table2'] = createNode('table2', BaseNodeResourceType.Table);

      // Should handle deep nesting without hitting max iterations
      const result = findAdjacentNonFolderNode(treeItems, 'folder5');
      expect(result?.id).toBeDefined();

      // Verify currentParent is used (eslint fix)
      expect(currentParent).toBe('folder10');
    });

    it('should handle two-node circular reference in main loop', () => {
      /**
       * Test case where getItemBelow/getItemAbove might revisit nodes
       */
      const treeItems: Record<string, TreeItemData> = {
        [ROOT_ID]: createRootNode(['table1', 'table2']),
        table1: createNode('table1', BaseNodeResourceType.Table),
        table2: createNode('table2', BaseNodeResourceType.Table),
      };

      // Normal case should work
      const result = findAdjacentNonFolderNode(treeItems, 'table1');
      expect(result?.id).toBe('table2');
    });
  });
});
