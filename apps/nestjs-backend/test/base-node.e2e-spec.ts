import type { INestApplication } from '@nestjs/common';
import { FieldType, ViewType } from '@teable/core';
import type { IBaseNodeVo } from '@teable/openapi';
import {
  createBaseNode,
  getBaseNodeTree,
  getBaseNode,
  updateBaseNode,
  deleteBaseNode,
  moveBaseNode,
  duplicateBaseNode,
  BaseNodeResourceType,
  createBase,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import { initApp, permanentDeleteBase } from './utils/init-app';

// Constants for reused strings
const nonExistentId = 'non-existent-node-id';
const getTestFolder = 'Get Test Folder';
const originalName = 'Original Name';
const testFolder = 'Test Folder';
const updatedName = 'Updated Name';
const testTableName = 'Test Table';

describe('BaseNodeController (e2e) /api/base/:baseId/node', () => {
  let app: INestApplication;
  let baseId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const base = await createBase({
      name: 'test base node',
      spaceId: globalThis.testConfig.spaceId,
    }).then((res) => res.data);
    baseId = base.id;
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    await app.close();
  });

  describe('GET /api/base/:baseId/node/tree - Get tree structure', () => {
    it('should get base node tree successfully', async () => {
      const response = await getBaseNodeTree(baseId);

      expect(response.data).toBeDefined();
      expect(response.data).toHaveProperty('nodes');
      expect(Array.isArray(response.data.nodes)).toBe(true);
    });

    it('should return tree with correct structure', async () => {
      // Create a test node
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Tree Test Folder',
      });

      const response = await getBaseNodeTree(baseId);
      const createdNode = response.data.nodes.find((n: IBaseNodeVo) => n.id === node.data.id);

      expect(createdNode).toBeDefined();
      expect(createdNode?.name).toBe('Tree Test Folder');
      expect(createdNode?.resourceType).toBe(BaseNodeResourceType.Folder);

      // Cleanup
      await deleteBaseNode(baseId, node.data.id);
    });
  });

  describe('GET /api/base/:baseId/node/:nodeId - Get single node', () => {
    let testNodeId: string;

    beforeEach(async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: getTestFolder,
      });
      testNodeId = node.data.id;
    });

    afterEach(async () => {
      try {
        await deleteBaseNode(baseId, testNodeId);
      } catch (e) {
        // Node might already be deleted
      }
    });

    it('should get single node successfully', async () => {
      const response = await getBaseNode(baseId, testNodeId);

      expect(response.data).toBeDefined();
      expect(response.data.id).toBe(testNodeId);
      expect(response.data.name).toBe(getTestFolder);
      expect(response.data.resourceType).toBe(BaseNodeResourceType.Folder);
    });

    it('should fail when node does not exist', async () => {
      const error = await getError(() => getBaseNode(baseId, nonExistentId));

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should fail when baseId and nodeId do not match', async () => {
      const wrongBaseId = 'wrong-base-id';
      const error = await getError(() => getBaseNode(wrongBaseId, testNodeId));

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/base/:baseId/node - Create node', () => {
    const nodesToCleanup: string[] = [];

    afterEach(async () => {
      // Cleanup created nodes
      for (const nodeId of nodesToCleanup) {
        try {
          await deleteBaseNode(baseId, nodeId);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      nodesToCleanup.length = 0;
    });

    it('should create a folder node successfully', async () => {
      const response = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: testFolder,
      });

      expect(response.data).toBeDefined();
      expect(response.data.name).toBe(testFolder);
      expect(response.data.resourceType).toBe(BaseNodeResourceType.Folder);
      expect(response.data.id).toBeDefined();

      nodesToCleanup.push(response.data.id);
    });

    it('should create a table node successfully', async () => {
      const response = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: testTableName,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });

      expect(response.data).toBeDefined();
      expect(response.data.name).toBe(testTableName);
      expect(response.data.resourceType).toBe(BaseNodeResourceType.Table);
      expect(response.data.resourceId).toBeDefined();

      nodesToCleanup.push(response.data.id);
    });

    it('should create a dashboard node successfully', async () => {
      const response = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Dashboard,
        name: 'Test Dashboard',
      });

      expect(response.data).toBeDefined();
      expect(response.data.name).toBe('Test Dashboard');
      expect(response.data.resourceType).toBe(BaseNodeResourceType.Dashboard);
      expect(response.data.resourceId).toBeDefined();

      nodesToCleanup.push(response.data.id);
    });

    it('should create nested node with parentId', async () => {
      // Create parent folder
      const parent = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent Folder',
      });
      nodesToCleanup.push(parent.data.id);

      // Create child node
      const child = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child Folder',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(child.data.id);

      expect(child.data.parentId).toBe(parent.data.id);

      // Verify in tree
      const tree = await getBaseNodeTree(baseId);
      const parentNode = tree.data.nodes.find((n: IBaseNodeVo) => n.id === parent.data.id);
      expect(parentNode?.children).toBeDefined();
      expect(parentNode?.children?.some((c) => c.id === child.data.id)).toBe(true);
    });

    it('should trim node name', async () => {
      const response = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: '  Trimmed Name  ',
      });

      expect(response.data.name).toBe('Trimmed Name');
      nodesToCleanup.push(response.data.id);
    });

    it('should fail with empty name', async () => {
      const error = await getError(() =>
        createBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: '',
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail with whitespace only name', async () => {
      const error = await getError(() =>
        createBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: '   ',
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail when parent node does not exist', async () => {
      const error = await getError(() =>
        createBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'Test Folder',
          parentId: 'non-existent-parent-id',
        })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should fail when parent node is not folder type', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: testTableName,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });

      nodesToCleanup.push(node.data.id);

      const error = await getError(() =>
        createBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Table,
          name: testTableName,
          fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
          parentId: node.data.id,
        })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PUT /api/base/:baseId/node/:nodeId - Update node', () => {
    let testNodeId: string;

    beforeEach(async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: originalName,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      testNodeId = node.data.id;
    });

    afterEach(async () => {
      try {
        await deleteBaseNode(baseId, testNodeId);
      } catch (e) {
        // Node might already be deleted
      }
    });

    it('should update node name successfully', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        name: updatedName,
      });

      expect(response.data.name).toBe(updatedName);
      expect(response.data.id).toBe(testNodeId);
    });

    it('should update node icon successfully', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        icon: '📁',
      });

      expect(response.data.icon).toBe('📁');
      expect(response.data.id).toBe(testNodeId);
    });

    it('should update both name and icon', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        name: updatedName,
        icon: '🎯',
      });

      expect(response.data.name).toBe(updatedName);
      expect(response.data.icon).toBe('🎯');
    });

    it('should trim name when updating', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        name: '  Trimmed Updated  ',
      });

      expect(response.data.name).toBe('Trimmed Updated');
    });

    it('should handle empty update object', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {});

      expect(response.data.id).toBe(testNodeId);
      expect(response.data.name).toBe(originalName);
    });

    it('should fail when updating non-existent node', async () => {
      const error = await getError(() =>
        updateBaseNode(baseId, nonExistentId, { name: 'New Name' })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should fail with empty name', async () => {
      const error = await getError(() => updateBaseNode(baseId, testNodeId, { name: '' }));

      expect(error?.status).toBe(400);
    });
  });

  describe('DELETE /api/base/:baseId/node/:nodeId - Delete node', () => {
    it('should delete leaf node successfully', async () => {
      // Create a node
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'To Delete',
      });

      // Delete it
      await deleteBaseNode(baseId, node.data.id);

      // Verify it's deleted
      const error = await getError(() => getBaseNode(baseId, node.data.id));
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should fail when deleting non-existent node', async () => {
      const error = await getError(() => deleteBaseNode(baseId, nonExistentId));

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle deletion of already deleted node', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Temp Node',
      });

      // Delete once
      await deleteBaseNode(baseId, node.data.id);

      // Try to delete again
      const error = await getError(() => deleteBaseNode(baseId, node.data.id));
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PUT /api/base/:baseId/node/:nodeId/move - Move node', () => {
    const nodesToCleanup: string[] = [];

    afterEach(async () => {
      for (const nodeId of nodesToCleanup) {
        try {
          await deleteBaseNode(baseId, nodeId);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      nodesToCleanup.length = 0;
    });

    it('should move node to another folder', async () => {
      // Create nodes
      const folder1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder 1',
      });
      nodesToCleanup.push(folder1.data.id);

      const folder2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder 2',
      });
      nodesToCleanup.push(folder2.data.id);

      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Node to Move',
        parentId: folder1.data.id,
      });
      nodesToCleanup.push(node.data.id);

      // Move node to folder2
      const response = await moveBaseNode(baseId, node.data.id, {
        parentId: folder2.data.id,
      });

      expect(response.data.parentId).toBe(folder2.data.id);
    });

    it('should move node to root level', async () => {
      // Create parent folder and child
      const parent = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent',
      });
      nodesToCleanup.push(parent.data.id);

      const child = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(child.data.id);

      // Move to root
      const response = await moveBaseNode(baseId, child.data.id, {
        parentId: null,
      });

      expect(response.data.parentId).toBeNull();
    });

    it('should reorder nodes using anchorId and position', async () => {
      // Create multiple nodes at root level
      const node1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Node 1',
      });
      nodesToCleanup.push(node1.data.id);

      const node2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Node 2',
      });
      nodesToCleanup.push(node2.data.id);

      const node3 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Node 3',
      });
      nodesToCleanup.push(node3.data.id);

      // Move node3 before node1
      const response = await moveBaseNode(baseId, node3.data.id, {
        anchorId: node1.data.id,
        position: 'before',
      });

      expect(response.data).toBeDefined();
      expect(response.data.id).toBe(node3.data.id);
    });

    it('should reorder nodes using position before and anchorId same parent', async () => {
      // Create a parent folder
      const parent = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent Folder',
      });
      nodesToCleanup.push(parent.data.id);

      // Create multiple child nodes under same parent
      const child1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child 1',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(child1.data.id);

      const child2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child 2',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(child2.data.id);

      const child3 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child 3',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(child3.data.id);

      // Move child3 before child1 (both have same parent)
      const response = await moveBaseNode(baseId, child3.data.id, {
        anchorId: child1.data.id,
        position: 'before',
      });

      expect(response.data).toBeDefined();
      expect(response.data.id).toBe(child3.data.id);
      expect(response.data.parentId).toBe(parent.data.id);
    });

    it('should reorder nodes using position after', async () => {
      const node1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Node A',
      });
      nodesToCleanup.push(node1.data.id);

      const node2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Node B',
      });
      nodesToCleanup.push(node2.data.id);

      // Move node1 after node2
      const response = await moveBaseNode(baseId, node1.data.id, {
        anchorId: node2.data.id,
        position: 'after',
      });

      expect(response.data.id).toBe(node1.data.id);
    });

    it('should reorder nodes using position after and anchorId same parent', async () => {
      // Create a parent folder
      const parent = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent Container',
      });
      nodesToCleanup.push(parent.data.id);

      // Create multiple child nodes under same parent
      const childA = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child A',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(childA.data.id);

      const childB = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child B',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(childB.data.id);

      const childC = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child C',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(childC.data.id);

      // Move childA after childC (both have same parent)
      const response = await moveBaseNode(baseId, childA.data.id, {
        anchorId: childC.data.id,
        position: 'after',
      });

      expect(response.data).toBeDefined();
      expect(response.data.id).toBe(childA.data.id);
      expect(response.data.parentId).toBe(parent.data.id);
    });

    it('should fail when moving node to itself', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Self Reference Node',
      });
      nodesToCleanup.push(node.data.id);

      const error = await getError(() =>
        moveBaseNode(baseId, node.data.id, {
          parentId: node.data.id,
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail when moving node to its own child (circular reference)', async () => {
      // Create parent and child
      const parent = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent',
      });
      nodesToCleanup.push(parent.data.id);

      const child = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child',
        parentId: parent.data.id,
      });
      nodesToCleanup.push(child.data.id);

      // Try to move parent into child (circular reference)
      const error = await getError(() =>
        moveBaseNode(baseId, parent.data.id, {
          parentId: child.data.id,
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail when anchor node does not exist', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Test Node',
      });
      nodesToCleanup.push(node.data.id);

      const error = await getError(() =>
        moveBaseNode(baseId, node.data.id, {
          anchorId: 'non-existent-anchor',
          position: 'before',
        })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should fail when parent node does not folder type', async () => {
      // Create a table node (non-folder type)
      const table = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Non-Folder Parent',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(table.data.id);

      // Create a folder node
      const folder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder Node',
      });
      nodesToCleanup.push(folder.data.id);

      // Try to move folder under table (should fail because table is not a folder)
      const error = await getError(() =>
        moveBaseNode(baseId, folder.data.id, {
          parentId: table.data.id,
        })
      );

      expect(error?.status).toBe(400);
    });
  });

  describe('POST /api/base/:baseId/node/:nodeId/duplicate - Duplicate node', () => {
    const nodesToCleanup: string[] = [];

    afterEach(async () => {
      for (const nodeId of nodesToCleanup) {
        try {
          await deleteBaseNode(baseId, nodeId);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      nodesToCleanup.length = 0;
    });

    it('should duplicate folder fail', async () => {
      const original = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Original Folder',
      });
      nodesToCleanup.push(original.data.id);

      const error = await getError(() =>
        duplicateBaseNode(baseId, original.data.id, {
          name: 'Duplicated Folder',
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should duplicate table successfully', async () => {
      const original = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Original Table',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(original.data.id);

      const duplicate = await duplicateBaseNode(baseId, original.data.id, {
        name: 'Duplicated Table',
      });
      nodesToCleanup.push(duplicate.data.id);

      expect(duplicate.data.id).not.toBe(original.data.id);
      expect(duplicate.data.resourceId).not.toBe(original.data.resourceId);
      expect(duplicate.data.name).toBe('Duplicated Table');
    });

    it('should duplicate dashboard successfully', async () => {
      const original = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Dashboard,
        name: 'Original Dashboard',
      });
      nodesToCleanup.push(original.data.id);

      const duplicate = await duplicateBaseNode(baseId, original.data.id, {
        name: 'Duplicated Dashboard',
      });
      nodesToCleanup.push(duplicate.data.id);

      expect(duplicate.data.id).not.toBe(original.data.id);
      expect(duplicate.data.name).toBe('Duplicated Dashboard');
    });

    it('should fail when duplicating non-existent node', async () => {
      const error = await getError(() =>
        duplicateBaseNode(baseId, nonExistentId, { name: 'Duplicate' })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Integration scenarios', () => {
    const nodesToCleanup: string[] = [];

    afterEach(async () => {
      for (const nodeId of nodesToCleanup) {
        try {
          await deleteBaseNode(baseId, nodeId);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      nodesToCleanup.length = 0;
    });

    it('should handle complete CRUD lifecycle', async () => {
      // Create
      const created = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Lifecycle Test',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      expect(created.data.name).toBe('Lifecycle Test');
      nodesToCleanup.push(created.data.id);

      // Read
      const read = await getBaseNode(baseId, created.data.id);
      expect(read.data.id).toBe(created.data.id);

      // Update
      const updated = await updateBaseNode(baseId, created.data.id, {
        name: 'Updated Lifecycle Test',
        icon: '🔄',
      });
      expect(updated.data.name).toBe('Updated Lifecycle Test');
      expect(updated.data.icon).toBe('🔄');

      // Delete
      await deleteBaseNode(baseId, created.data.id);
      const error = await getError(() => getBaseNode(baseId, created.data.id));
      expect(error?.status).toBeGreaterThanOrEqual(400);

      // Remove from cleanup since already deleted
      nodesToCleanup.pop();
    });

    it('should handle complex folder hierarchy', async () => {
      // Create root folder
      const root = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Root',
      });
      nodesToCleanup.push(root.data.id);

      // Create level 1 children
      const child1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child 1',
        parentId: root.data.id,
      });
      nodesToCleanup.push(child1.data.id);

      const child2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child 2',
        parentId: root.data.id,
      });
      nodesToCleanup.push(child2.data.id);

      // Create level 2 children
      const grandchild = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Grandchild',
        parentId: child1.data.id,
      });
      nodesToCleanup.push(grandchild.data.id);

      // Verify structure
      const tree = await getBaseNodeTree(baseId);
      const rootNode = tree.data.nodes.find((n: IBaseNodeVo) => n.id === root.data.id);

      expect(rootNode?.children).toHaveLength(2);
      const child1Node = tree.data.nodes.find((n: IBaseNodeVo) => n.id === child1.data.id);
      expect(child1Node?.children).toHaveLength(1);
    });

    it('should handle moving nodes between folders', async () => {
      // Create structure: Folder A with Child, Folder B empty
      const folderA = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder A',
      });
      nodesToCleanup.push(folderA.data.id);

      const folderB = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder B',
      });
      nodesToCleanup.push(folderB.data.id);

      const child = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Movable Table',
        parentId: folderA.data.id,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(child.data.id);

      // Verify initial state
      let node = await getBaseNode(baseId, child.data.id);
      expect(node.data.parentId).toBe(folderA.data.id);

      // Move to Folder B
      await moveBaseNode(baseId, child.data.id, {
        parentId: folderB.data.id,
      });

      // Verify moved
      node = await getBaseNode(baseId, child.data.id);
      expect(node.data.parentId).toBe(folderB.data.id);

      // Move to root
      await moveBaseNode(baseId, child.data.id, {
        parentId: null,
      });

      // Verify at root
      node = await getBaseNode(baseId, child.data.id);
      expect(node.data.parentId).toBeNull();
    });

    it('should maintain order when creating and moving nodes', async () => {
      // Create multiple nodes
      const nodes = [];
      for (let i = 1; i <= 3; i++) {
        const node = await createBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: `Order Test ${i}`,
        });
        nodes.push(node.data);
        nodesToCleanup.push(node.data.id);
      }

      // Get tree and verify all nodes exist
      const tree = await getBaseNodeTree(baseId);
      for (const node of nodes) {
        const found = tree.data.nodes.find((n: IBaseNodeVo) => n.id === node.id);
        expect(found).toBeDefined();
      }
    });
  });
});
