/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship, Role, ViewType } from '@teable/core';
import type { IBaseNodeTableResourceMeta, IBaseNodeVo } from '@teable/openapi';
import {
  axios,
  createBaseNode,
  getBaseNodeTree,
  getBaseNode,
  updateBaseNode,
  deleteBaseNode,
  moveBaseNode,
  duplicateBaseNode,
  BaseNodeResourceType,
  createBase,
  emailBaseInvitation,
  createSpace as apiCreateSpace,
  permanentDeleteSpace as apiPermanentDeleteSpace,
  urlBuilder,
  GET_BASE_NODE_LIST,
  GET_BASE_NODE_TREE,
  GET_BASE_NODE,
  CREATE_BASE_NODE,
  UPDATE_BASE_NODE,
  DELETE_BASE_NODE,
  MOVE_BASE_NODE,
  DUPLICATE_BASE_NODE,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { getFields, initApp, permanentDeleteBase } from './utils/init-app';

// Constants for reused strings
const nonExistentId = 'non-existent-node-id';
const getTestFolder = 'Get Test Folder';
const originalName = 'Original Name';
const testFolder = 'Test Folder';
const updatedName = 'Updated Name';
const testTableName = 'Test Table';
const windowIdHeader = 'x-window-id';

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
      expect(createdNode?.resourceMeta?.name).toBe('Tree Test Folder');
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
      await deleteBaseNode(baseId, testNodeId);
    });

    it('should get single node successfully', async () => {
      const response = await getBaseNode(baseId, testNodeId);

      expect(response.data).toBeDefined();
      expect(response.data.id).toBe(testNodeId);
      expect(response.data.resourceMeta?.name).toBe(getTestFolder);
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
      for (const nodeId of [...nodesToCleanup].reverse()) {
        await deleteBaseNode(baseId, nodeId);
      }
      nodesToCleanup.length = 0;
    });

    it('should create a folder node successfully', async () => {
      const response = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: testFolder,
      });

      expect(response.data).toBeDefined();
      expect(response.data.resourceMeta?.name).toBe(testFolder);
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
      const resourceMeta = response.data.resourceMeta as IBaseNodeTableResourceMeta;
      expect(response.data).toBeDefined();
      expect(resourceMeta.name).toBe(testTableName);
      expect(resourceMeta.defaultViewId).toBeDefined();
      expect(response.data.resourceType).toBe(BaseNodeResourceType.Table);
      expect(response.data.resourceId).toBeDefined();

      nodesToCleanup.push(response.data.id);
    });

    it('should expose create-table canary headers when creating a table node', async () => {
      const response = await axios.post(
        urlBuilder(CREATE_BASE_NODE, { baseId }),
        {
          resourceType: BaseNodeResourceType.Table,
          name: 'Create Via Node Route',
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        },
        {
          headers: {
            [windowIdHeader]: 'win-base-node-create-table',
          },
        }
      );

      expect(response.status).toBe(201);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.headers['x-teable-v2-feature']).toBe('createTable');
      expect(response.headers['x-teable-v2-reason']).toBe('new_base');

      nodesToCleanup.push(response.data.id);
    });

    it('should create all supported table field types through the node canary route', async () => {
      const foreignNode = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'All Types Foreign',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Revenue', type: FieldType.Number },
        ],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(foreignNode.data.id);

      const foreignFields = await getFields(foreignNode.data.resourceId);
      const foreignNameFieldId = foreignFields.find((field) => field.name === 'Name')?.id;
      const foreignRevenueFieldId = foreignFields.find((field) => field.name === 'Revenue')?.id;

      expect(foreignNameFieldId).toBeTruthy();
      expect(foreignRevenueFieldId).toBeTruthy();
      if (!foreignNameFieldId || !foreignRevenueFieldId) return;

      const amountFieldId = 'fldalltypesamount01';
      const companyLinkFieldId = 'fldalltypeslink0001';
      const companyLookupFieldId = 'fldalltypeslook0001';
      const companyRollupFieldId = 'fldalltypesroll0001';
      const conditionalLookupFieldId = 'fldalltypescdl00001';
      const conditionalRollupFieldId = 'fldalltypescdr00001';

      const response = await axios.post(
        urlBuilder(CREATE_BASE_NODE, { baseId }),
        {
          resourceType: BaseNodeResourceType.Table,
          name: 'All Types Via Node Route',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            { name: 'Description', type: FieldType.LongText, options: { defaultValue: 'Details' } },
            {
              id: amountFieldId,
              name: 'Amount',
              type: FieldType.Number,
              options: {
                formatting: { type: 'currency', precision: 2, symbol: '$' },
                showAs: { type: 'bar', color: 'teal', showValue: true, maxValue: 100 },
                defaultValue: 10,
              },
            },
            {
              name: 'Score',
              type: FieldType.Formula,
              options: { expression: `{${amountFieldId}} * 2` },
            },
            {
              name: 'Priority',
              type: FieldType.Rating,
              options: { max: 5, icon: 'star', color: 'yellowBright' },
            },
            {
              name: 'Status',
              type: FieldType.SingleSelect,
              options: {
                choices: [
                  { name: 'Todo', color: 'blue' },
                  { name: 'Doing', color: 'yellow' },
                  { name: 'Done', color: 'green' },
                ],
              },
            },
            {
              name: 'Tags',
              type: FieldType.MultipleSelect,
              options: {
                choices: [
                  { name: 'Frontend', color: 'purple' },
                  { name: 'Backend', color: 'orange' },
                ],
              },
            },
            { name: 'Done', type: FieldType.Checkbox, options: { defaultValue: true } },
            { name: 'Files', type: FieldType.Attachment },
            {
              name: 'Due Date',
              type: FieldType.Date,
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'UTC' },
                defaultValue: 'now',
              },
            },
            { name: 'Auto Number', type: FieldType.AutoNumber },
            { name: 'Created Time', type: FieldType.CreatedTime },
            { name: 'Last Modified Time', type: FieldType.LastModifiedTime },
            { name: 'Created By', type: FieldType.CreatedBy },
            { name: 'Last Modified By', type: FieldType.LastModifiedBy },
            {
              name: 'Owner',
              type: FieldType.User,
              options: { isMultiple: true, shouldNotify: false, defaultValue: ['me'] },
            },
            {
              name: 'Action',
              type: FieldType.Button,
              options: {
                label: 'Run',
                color: 'teal',
                maxCount: 3,
                resetCount: true,
                workflow: { id: 'wflaaaaaaaaaaaaaaaa', name: 'Deploy', isActive: true },
              },
            },
            {
              id: companyLinkFieldId,
              name: 'Company',
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyOne,
                foreignTableId: foreignNode.data.resourceId,
                lookupFieldId: foreignNameFieldId,
              },
            },
            {
              id: companyLookupFieldId,
              name: 'Company Name',
              type: FieldType.SingleLineText,
              isLookup: true,
              lookupOptions: {
                linkFieldId: companyLinkFieldId,
                foreignTableId: foreignNode.data.resourceId,
                lookupFieldId: foreignNameFieldId,
              },
            },
            {
              id: companyRollupFieldId,
              name: 'Company Revenue Total',
              type: FieldType.Rollup,
              options: { expression: 'sum({values})', timeZone: 'UTC' },
              lookupOptions: {
                linkFieldId: companyLinkFieldId,
                foreignTableId: foreignNode.data.resourceId,
                lookupFieldId: foreignRevenueFieldId,
              },
            },
            {
              id: conditionalLookupFieldId,
              name: 'High Revenue Companies',
              type: FieldType.SingleLineText,
              isLookup: true,
              isConditionalLookup: true,
              lookupOptions: {
                foreignTableId: foreignNode.data.resourceId,
                lookupFieldId: foreignNameFieldId,
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignRevenueFieldId,
                      operator: 'isGreater',
                      value: 100,
                    },
                  ],
                },
              },
            },
            {
              id: conditionalRollupFieldId,
              name: 'High Revenue Total',
              type: FieldType.ConditionalRollup,
              options: {
                foreignTableId: foreignNode.data.resourceId,
                lookupFieldId: foreignRevenueFieldId,
                expression: 'sum({values})',
                timeZone: 'UTC',
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignRevenueFieldId,
                      operator: 'isGreater',
                      value: 100,
                    },
                  ],
                },
              },
            },
          ],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        },
        {
          headers: {
            [windowIdHeader]: 'win-base-node-all-types',
          },
        }
      );

      expect(response.status).toBe(201);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.headers['x-teable-v2-feature']).toBe('createTable');
      expect(response.headers['x-teable-v2-reason']).toBe('new_base');

      nodesToCleanup.push(response.data.id);

      const fields = await getFields(response.data.resourceId);
      const fieldByName = new Map(fields.map((field) => [field.name, field]));

      expect(fieldByName.get('Name')?.type).toBe(FieldType.SingleLineText);
      expect(fieldByName.get('Description')?.type).toBe(FieldType.LongText);
      expect(fieldByName.get('Amount')?.type).toBe(FieldType.Number);
      expect(fieldByName.get('Score')?.type).toBe(FieldType.Formula);
      expect(fieldByName.get('Priority')?.type).toBe(FieldType.Rating);
      expect(fieldByName.get('Status')?.type).toBe(FieldType.SingleSelect);
      expect(fieldByName.get('Tags')?.type).toBe(FieldType.MultipleSelect);
      expect(fieldByName.get('Done')?.type).toBe(FieldType.Checkbox);
      expect(fieldByName.get('Files')?.type).toBe(FieldType.Attachment);
      expect(fieldByName.get('Due Date')?.type).toBe(FieldType.Date);
      expect(fieldByName.get('Auto Number')?.type).toBe(FieldType.AutoNumber);
      expect(fieldByName.get('Created Time')?.type).toBe(FieldType.CreatedTime);
      expect(fieldByName.get('Last Modified Time')?.type).toBe(FieldType.LastModifiedTime);
      expect(fieldByName.get('Created By')?.type).toBe(FieldType.CreatedBy);
      expect(fieldByName.get('Last Modified By')?.type).toBe(FieldType.LastModifiedBy);
      expect(fieldByName.get('Owner')?.type).toBe(FieldType.User);
      expect(fieldByName.get('Action')?.type).toBe(FieldType.Button);
      expect(fieldByName.get('Company')?.type).toBe(FieldType.Link);
      expect(fieldByName.get('Company Name')?.type).toBe(FieldType.SingleLineText);
      expect(fieldByName.get('Company Name')?.isLookup).toBe(true);
      expect(fieldByName.get('Company Revenue Total')?.type).toBe(FieldType.Rollup);
      expect(fieldByName.get('High Revenue Companies')?.type).toBe(FieldType.SingleLineText);
      expect(fieldByName.get('High Revenue Companies')?.isLookup).toBe(true);
      expect(fieldByName.get('High Revenue Companies')?.isConditionalLookup).toBe(true);
      expect(fieldByName.get('High Revenue Total')?.type).toBe(FieldType.ConditionalRollup);
    });

    it('should create a dashboard node successfully', async () => {
      const response = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Dashboard,
        name: 'Test Dashboard',
      });

      expect(response.data).toBeDefined();
      expect(response.data.resourceMeta?.name).toBe('Test Dashboard');
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

      expect(response.data.resourceMeta?.name).toBe('Trimmed Name');
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
      await deleteBaseNode(baseId, testNodeId);
    });

    it('should update node name successfully', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        name: updatedName,
      });

      expect(response.data.resourceMeta?.name).toBe(updatedName);
      expect(response.data.id).toBe(testNodeId);
    });

    it('should update node icon successfully', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        icon: '📁',
      });

      expect(response.data.resourceMeta?.icon).toBe('📁');
      expect(response.data.id).toBe(testNodeId);
    });

    it('should update both name and icon', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        name: updatedName,
        icon: '🎯',
      });

      expect(response.data.resourceMeta?.name).toBe(updatedName);
      expect(response.data.resourceMeta?.icon).toBe('🎯');
    });

    it('should trim name when updating', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {
        name: '  Trimmed Updated  ',
      });

      expect(response.data.resourceMeta?.name).toBe('Trimmed Updated');
    });

    it('should handle empty update object', async () => {
      const response = await updateBaseNode(baseId, testNodeId, {});

      expect(response.data.id).toBe(testNodeId);
      expect(response.data.resourceMeta?.name).toBe(originalName);
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

    it('should fail when delete folder node with children', async () => {
      const folder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder',
      }).then((res) => res.data);

      await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Child',
        parentId: folder.id,
      }).then((res) => res.data.id);

      // Verify it's deleted
      const error = await getError(() => deleteBaseNode(baseId, folder.id));
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should expose delete-table canary headers when deleting a table node', async () => {
      const table = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Delete Via Node Route',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });

      const response = await axios.delete(
        urlBuilder(DELETE_BASE_NODE, { baseId, nodeId: table.data.id }),
        {
          headers: {
            [windowIdHeader]: 'win-base-node-delete-table',
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.headers['x-teable-v2-feature']).toBe('deleteTable');
      expect(response.headers['x-teable-v2-reason']).toBe('new_base');

      const error = await getError(() => getBaseNode(baseId, table.data.id));
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PUT /api/base/:baseId/node/:nodeId/move - Move node', () => {
    const nodesToCleanup: string[] = [];

    afterEach(async () => {
      for (const nodeId of [...nodesToCleanup].reverse()) {
        await deleteBaseNode(baseId, nodeId);
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
      for (const nodeId of [...nodesToCleanup].reverse()) {
        await deleteBaseNode(baseId, nodeId);
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
      expect(duplicate.data.resourceMeta?.name).toBe('Duplicated Table');
    });

    it('should expose duplicate-table canary headers when duplicating a table node', async () => {
      const original = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Original Table Via Node Route',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(original.data.id);

      const response = await axios.post(
        urlBuilder(DUPLICATE_BASE_NODE, { baseId, nodeId: original.data.id }),
        {
          name: 'Duplicated Table Via Node Route',
          includeRecords: false,
        },
        {
          headers: {
            [windowIdHeader]: 'win-base-node-duplicate-table',
          },
        }
      );

      expect(response.status).toBe(201);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.headers['x-teable-v2-feature']).toBe('duplicateTable');
      expect(response.headers['x-teable-v2-reason']).toBe('new_base');

      nodesToCleanup.push(response.data.id);
      expect(response.data.resourceMeta?.name).toBe('Duplicated Table Via Node Route');
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
      expect(duplicate.data.resourceMeta?.name).toBe('Duplicated Dashboard');
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
      for (const nodeId of [...nodesToCleanup].reverse()) {
        await deleteBaseNode(baseId, nodeId);
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
      expect(created.data.resourceMeta?.name).toBe('Lifecycle Test');
      nodesToCleanup.push(created.data.id);

      // Read
      const read = await getBaseNode(baseId, created.data.id);
      expect(read.data.id).toBe(created.data.id);

      // Update
      const updated = await updateBaseNode(baseId, created.data.id, {
        name: 'Updated Lifecycle Test',
        icon: '🔄',
      });
      expect(updated.data.resourceMeta?.name).toBe('Updated Lifecycle Test');
      expect(updated.data.resourceMeta?.icon).toBe('🔄');

      // Delete
      await deleteBaseNode(baseId, created.data.id);
      const error = await getError(() => getBaseNode(baseId, created.data.id));
      expect(error?.status).toBeGreaterThanOrEqual(400);

      // Remove from cleanup since already deleted
      nodesToCleanup.pop();
    });

    it('should handle complex folder hierarchy', async () => {
      const root = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Root',
      });
      nodesToCleanup.push(root.data.id);

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

      const child1Table = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Child 1 Table',
        parentId: child1.data.id,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(child1Table.data.id);

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

  describe('Folder depth limitation', () => {
    const nodesToCleanup: string[] = [];

    afterEach(async () => {
      // Cleanup nodes in reverse order to handle hierarchy
      for (const nodeId of [...nodesToCleanup].reverse()) {
        await deleteBaseNode(baseId, nodeId);
      }
      nodesToCleanup.length = 0;
    });

    it('should allow creating folders up to max depth (3 levels)', async () => {
      // Create level 1 folder
      const level1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Level 1 Folder',
      });
      nodesToCleanup.push(level1.data.id);
      expect(level1.data.parentId).toBeNull();

      // Create level 2 folder
      const level2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Level 2 Folder',
        parentId: level1.data.id,
      });
      nodesToCleanup.push(level2.data.id);
      expect(level2.data.parentId).toBe(level1.data.id);
    });

    it('should fail when creating folder exceeding max depth (4th level)', async () => {
      // Create 3 levels of folders
      const level1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Depth Limit Level 1',
      });
      nodesToCleanup.push(level1.data.id);

      const level2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Depth Limit Level 2',
        parentId: level1.data.id,
      });
      nodesToCleanup.push(level2.data.id);

      // Try to create level 4 folder (should fail)
      const error = await getError(() =>
        createBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'Depth Limit Level 3',
          parentId: level2.data.id,
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should allow creating table in folder at max depth', async () => {
      // Create 2 levels of folders
      const level1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Table Depth Level 1',
      });
      nodesToCleanup.push(level1.data.id);

      const level2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Table Depth Level 2',
        parentId: level1.data.id,
      });
      nodesToCleanup.push(level2.data.id);

      // Create table in level 2 folder (should succeed - tables don't count as depth)
      const table = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table in Max Depth',
        parentId: level2.data.id,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(table.data.id);
      expect(table.data.parentId).toBe(level2.data.id);
    });

    it('should fail when moving folder to exceed max depth using anchorId', async () => {
      // Create 3 levels of folders
      const level1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Move Depth Level 1',
      });
      nodesToCleanup.push(level1.data.id);

      const level2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Move Depth Level 2',
        parentId: level1.data.id,
      });
      nodesToCleanup.push(level2.data.id);

      const level3 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table in Move Depth Level 3',
        parentId: level2.data.id,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(level3.data.id);

      // Create a folder at root level to move
      const folderToMove = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder to Move',
      });
      nodesToCleanup.push(folderToMove.data.id);

      // Try to move folder next to level2 (which would make it level 3 if it had the same parent)
      // Using anchorId with position should check depth
      const error = await getError(() =>
        moveBaseNode(baseId, folderToMove.data.id, {
          anchorId: level3.data.id,
          position: 'after',
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail when moving folder to another folder exceeds max depth using parentId', async () => {
      // Create 2 levels of folders (max depth)
      const level1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent Move Depth Level 1',
      });
      nodesToCleanup.push(level1.data.id);

      const level2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent Move Depth Level 2',
        parentId: level1.data.id,
      });
      nodesToCleanup.push(level2.data.id);

      // Create a folder at root level to move
      const folderToMove = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder to Move Into Depth',
      });
      nodesToCleanup.push(folderToMove.data.id);

      // Try to move folder into level2 using parentId (would exceed max depth)
      const error = await getError(() =>
        moveBaseNode(baseId, folderToMove.data.id, {
          parentId: level2.data.id,
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should allow moving folder within valid depth using anchorId', async () => {
      // Create 2 levels of folders
      const level1 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Valid Move Level 1',
      });
      nodesToCleanup.push(level1.data.id);

      const level2 = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Valid Move Level 2',
        parentId: level1.data.id,
      });
      nodesToCleanup.push(level2.data.id);

      // Create a folder at root level
      const folderToMove = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Folder to Move Valid',
      });
      nodesToCleanup.push(folderToMove.data.id);

      // Move folder next to level2 (which makes it level 3 - still valid)
      const response = await moveBaseNode(baseId, folderToMove.data.id, {
        anchorId: level2.data.id,
        position: 'after',
      });

      expect(response.data.id).toBe(folderToMove.data.id);
      expect(response.data.parentId).toBe(level1.data.id);
    });

    it('should return maxFolderDepth in tree response', async () => {
      const response = await getBaseNodeTree(baseId);

      expect(response.data).toHaveProperty('maxFolderDepth');
      expect(response.data.maxFolderDepth).toBe(2);
    });

    it('should fail when moving folder-with-subfolder into another root folder via parentId', async () => {
      const folderA = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Subtree Depth A',
      });
      nodesToCleanup.push(folderA.data.id);

      const subfolderB = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Subtree Depth B',
        parentId: folderA.data.id,
      });
      nodesToCleanup.push(subfolderB.data.id);

      const folderC = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Subtree Depth C',
      });
      nodesToCleanup.push(folderC.data.id);

      // Moving folderA (which contains subfolderB) into folderC
      // Result would be: C(1) > A(2) > B(3) — depth 3 exceeds maxFolderDepth=2
      const error = await getError(() =>
        moveBaseNode(baseId, folderA.data.id, {
          parentId: folderC.data.id,
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail when moving folder-with-subfolder via anchorId inside a folder', async () => {
      const folderD = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Subtree Anchor D',
      });
      nodesToCleanup.push(folderD.data.id);

      const subfolderE = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Subtree Anchor E',
        parentId: folderD.data.id,
      });
      nodesToCleanup.push(subfolderE.data.id);

      const folderF = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Subtree Anchor F',
      });
      nodesToCleanup.push(folderF.data.id);

      // Create a child inside folderF to use as anchor
      const childInF = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Table in F',
        parentId: folderF.data.id,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(childInF.data.id);

      // Moving folderD (with subfolderE) next to childInF (inside folderF)
      // Result would be: F(1) > D(2) > E(3) — depth 3 exceeds maxFolderDepth=2
      const error = await getError(() =>
        moveBaseNode(baseId, folderD.data.id, {
          anchorId: childInF.data.id,
          position: 'after',
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should allow moving leaf folder into another root folder', async () => {
      const targetFolder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Target Folder',
      });
      nodesToCleanup.push(targetFolder.data.id);

      const leafFolder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Leaf Folder',
      });
      nodesToCleanup.push(leafFolder.data.id);

      // Moving a leaf folder (no children) into targetFolder — depth=2, within limit
      const response = await moveBaseNode(baseId, leafFolder.data.id, {
        parentId: targetFolder.data.id,
      });

      expect(response.data.id).toBe(leafFolder.data.id);
      expect(response.data.parentId).toBe(targetFolder.data.id);
    });
  });

  describe('Permission tests', () => {
    let permissionSpaceId: string;
    let permissionBaseId: string;
    let viewerAxios: AxiosInstance;
    let creatorAxios: AxiosInstance;
    let nonCollaboratorAxios: AxiosInstance;
    const nodesToCleanup: string[] = [];

    const viewerEmail = 'base-node-viewer@test.com';
    const creatorEmail = 'base-node-creator@test.com';
    const nonCollaboratorEmail = 'base-node-non-collaborator@test.com';

    beforeAll(async () => {
      // Create a new space and base for permission tests
      const space = await apiCreateSpace({ name: 'Permission Test Space' }).then((res) => res.data);
      permissionSpaceId = space.id;

      const base = await createBase({
        name: 'Permission Test Base',
        spaceId: permissionSpaceId,
      }).then((res) => res.data);
      permissionBaseId = base.id;

      // Create test users
      viewerAxios = await createNewUserAxios({
        email: viewerEmail,
        password: '12345678',
      });

      creatorAxios = await createNewUserAxios({
        email: creatorEmail,
        password: '12345678',
      });

      nonCollaboratorAxios = await createNewUserAxios({
        email: nonCollaboratorEmail,
        password: '12345678',
      });

      // Invite viewer with Viewer role (read-only)
      await emailBaseInvitation({
        baseId: permissionBaseId,
        emailBaseInvitationRo: {
          emails: [viewerEmail],
          role: Role.Viewer,
        },
      });

      // Invite creator with Creator role (full access)
      await emailBaseInvitation({
        baseId: permissionBaseId,
        emailBaseInvitationRo: {
          emails: [creatorEmail],
          role: Role.Creator,
        },
      });
    });

    afterAll(async () => {
      // Cleanup nodes first
      for (const nodeId of [...nodesToCleanup].reverse()) {
        await deleteBaseNode(permissionBaseId, nodeId);
      }
      // Then delete the space (which will delete the base)
      await apiPermanentDeleteSpace(permissionSpaceId);
    });

    describe('Non-collaborator access', () => {
      it('should fail to get node list when user is not a collaborator', async () => {
        const error = await getError(() =>
          nonCollaboratorAxios.get(urlBuilder(GET_BASE_NODE_LIST, { baseId: permissionBaseId }))
        );
        expect(error?.status).toBe(403);
      });

      it('should fail to get node tree when user is not a collaborator', async () => {
        const error = await getError(() =>
          nonCollaboratorAxios.get(urlBuilder(GET_BASE_NODE_TREE, { baseId: permissionBaseId }))
        );
        expect(error?.status).toBe(403);
      });

      it('should fail to create node when user is not a collaborator', async () => {
        const error = await getError(() =>
          nonCollaboratorAxios.post(urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }), {
            resourceType: BaseNodeResourceType.Folder,
            name: 'Unauthorized Folder',
          })
        );
        expect(error?.status).toBe(403);
      });
    });

    describe('Viewer role permissions', () => {
      let testFolderId: string;
      let testTableId: string;
      let testDashboardId: string;

      beforeAll(async () => {
        // Create test nodes as owner for viewer to test against
        const folder = await createBaseNode(permissionBaseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'Viewer Test Folder',
        });
        testFolderId = folder.data.id;
        nodesToCleanup.push(testFolderId);

        const table = await createBaseNode(permissionBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Viewer Test Table',
          fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        });
        testTableId = table.data.id;
        nodesToCleanup.push(testTableId);

        const dashboard = await createBaseNode(permissionBaseId, {
          resourceType: BaseNodeResourceType.Dashboard,
          name: 'Viewer Test Dashboard',
        });
        testDashboardId = dashboard.data.id;
        nodesToCleanup.push(testDashboardId);
      });

      it('should allow viewer to get node list', async () => {
        const response = await viewerAxios.get(
          urlBuilder(GET_BASE_NODE_LIST, { baseId: permissionBaseId })
        );
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data)).toBe(true);
      });

      it('should allow viewer to get node tree', async () => {
        const response = await viewerAxios.get(
          urlBuilder(GET_BASE_NODE_TREE, { baseId: permissionBaseId })
        );
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('nodes');
      });

      it('should allow viewer to get single folder node', async () => {
        const response = await viewerAxios.get(
          urlBuilder(GET_BASE_NODE, { baseId: permissionBaseId, nodeId: testFolderId })
        );
        expect(response.status).toBe(200);
        expect(response.data.id).toBe(testFolderId);
      });

      it('should allow viewer to get single table node', async () => {
        const response = await viewerAxios.get(
          urlBuilder(GET_BASE_NODE, { baseId: permissionBaseId, nodeId: testTableId })
        );
        expect(response.status).toBe(200);
        expect(response.data.id).toBe(testTableId);
      });

      it('should allow viewer to get single dashboard node', async () => {
        const response = await viewerAxios.get(
          urlBuilder(GET_BASE_NODE, { baseId: permissionBaseId, nodeId: testDashboardId })
        );
        expect(response.status).toBe(200);
        expect(response.data.id).toBe(testDashboardId);
      });

      it('should deny viewer from creating folder node', async () => {
        const error = await getError(() =>
          viewerAxios.post(urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }), {
            resourceType: BaseNodeResourceType.Folder,
            name: 'Viewer Created Folder',
          })
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from creating table node', async () => {
        // Viewer doesn't have table|create permission
        const error = await getError(() =>
          viewerAxios.post(urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }), {
            resourceType: BaseNodeResourceType.Table,
            name: 'Viewer Table',
            fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
            views: [{ name: 'Grid view', type: ViewType.Grid }],
          })
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from creating dashboard node', async () => {
        // Viewer doesn't have base|update permission required for Dashboard creation
        const error = await getError(() =>
          viewerAxios.post(urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }), {
            resourceType: BaseNodeResourceType.Dashboard,
            name: 'Viewer Dashboard',
          })
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from updating table node', async () => {
        // Viewer doesn't have table|update permission
        const error = await getError(() =>
          viewerAxios.put(
            urlBuilder(UPDATE_BASE_NODE, { baseId: permissionBaseId, nodeId: testTableId }),
            { name: 'Viewer Updated Table' }
          )
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from updating dashboard node', async () => {
        // Viewer doesn't have base|update permission
        const error = await getError(() =>
          viewerAxios.put(
            urlBuilder(UPDATE_BASE_NODE, { baseId: permissionBaseId, nodeId: testDashboardId }),
            { name: 'Viewer Updated Dashboard' }
          )
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from deleting table node', async () => {
        // Viewer doesn't have table|delete permission
        const error = await getError(() =>
          viewerAxios.delete(
            urlBuilder(DELETE_BASE_NODE, { baseId: permissionBaseId, nodeId: testTableId })
          )
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from deleting dashboard node', async () => {
        // Viewer doesn't have base|update permission
        const error = await getError(() =>
          viewerAxios.delete(
            urlBuilder(DELETE_BASE_NODE, { baseId: permissionBaseId, nodeId: testDashboardId })
          )
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from moving node (requires base|update)', async () => {
        // Move operation requires base|update permission
        const error = await getError(() =>
          viewerAxios.put(
            urlBuilder(MOVE_BASE_NODE, { baseId: permissionBaseId, nodeId: testTableId }),
            { parentId: testFolderId }
          )
        );
        expect(error?.status).toBe(403);
      });

      it('should deny viewer from duplicating table node', async () => {
        // Duplicate requires BaseNodeAction.Read and BaseNodeAction.Create
        // For table, create requires table|create which viewer doesn't have
        const error = await getError(() =>
          viewerAxios.post(
            urlBuilder(DUPLICATE_BASE_NODE, { baseId: permissionBaseId, nodeId: testTableId }),
            { name: 'Duplicated Table' }
          )
        );
        expect(error?.status).toBe(403);
      });
    });

    describe('Creator role permissions', () => {
      const creatorNodesToCleanup: string[] = [];

      afterEach(async () => {
        for (const nodeId of [...creatorNodesToCleanup].reverse()) {
          await deleteBaseNode(permissionBaseId, nodeId);
        }
        creatorNodesToCleanup.length = 0;
      });

      it('should allow creator to get node list', async () => {
        const response = await creatorAxios.get(
          urlBuilder(GET_BASE_NODE_LIST, { baseId: permissionBaseId })
        );
        expect(response.status).toBe(200);
      });

      it('should allow creator to get node tree', async () => {
        const response = await creatorAxios.get(
          urlBuilder(GET_BASE_NODE_TREE, { baseId: permissionBaseId })
        );
        expect(response.status).toBe(200);
      });

      it('should allow creator to create folder node', async () => {
        const response = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Folder,
            name: 'Creator Folder',
          }
        );
        expect(response.status).toBe(201);
        expect(response.data.resourceMeta?.name).toBe('Creator Folder');
        creatorNodesToCleanup.push(response.data.id);
      });

      it('should allow creator to create table node', async () => {
        const response = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Table,
            name: 'Creator Table',
            fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
            views: [{ name: 'Grid view', type: ViewType.Grid }],
          }
        );
        expect(response.status).toBe(201);
        expect(response.data.resourceMeta?.name).toBe('Creator Table');
        creatorNodesToCleanup.push(response.data.id);
      });

      it('should allow creator to create dashboard node', async () => {
        const response = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Dashboard,
            name: 'Creator Dashboard',
          }
        );
        expect(response.status).toBe(201);
        expect(response.data.resourceMeta?.name).toBe('Creator Dashboard');
        creatorNodesToCleanup.push(response.data.id);
      });

      it('should allow creator to update table node', async () => {
        const table = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Table,
            name: 'Table to Update',
            fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
            views: [{ name: 'Grid view', type: ViewType.Grid }],
          }
        );
        creatorNodesToCleanup.push(table.data.id);

        const response = await creatorAxios.put(
          urlBuilder(UPDATE_BASE_NODE, { baseId: permissionBaseId, nodeId: table.data.id }),
          { name: 'Updated Table Name' }
        );
        expect(response.status).toBe(200);
        expect(response.data.resourceMeta?.name).toBe('Updated Table Name');
      });

      it('should allow creator to delete table node', async () => {
        const table = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Table,
            name: 'Table to Delete',
            fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
            views: [{ name: 'Grid view', type: ViewType.Grid }],
          }
        );

        const response = await creatorAxios.delete(
          urlBuilder(DELETE_BASE_NODE, { baseId: permissionBaseId, nodeId: table.data.id })
        );
        expect(response.status).toBe(200);
      });

      it('should allow creator to move node', async () => {
        const folder = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Folder,
            name: 'Move Target Folder',
          }
        );
        creatorNodesToCleanup.push(folder.data.id);

        const table = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Table,
            name: 'Table to Move',
            fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
            views: [{ name: 'Grid view', type: ViewType.Grid }],
          }
        );
        creatorNodesToCleanup.push(table.data.id);

        const response = await creatorAxios.put(
          urlBuilder(MOVE_BASE_NODE, { baseId: permissionBaseId, nodeId: table.data.id }),
          { parentId: folder.data.id }
        );
        expect(response.status).toBe(200);
        expect(response.data.parentId).toBe(folder.data.id);
      });

      it('should allow creator to duplicate table node', async () => {
        const table = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Table,
            name: 'Table to Duplicate',
            fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
            views: [{ name: 'Grid view', type: ViewType.Grid }],
          }
        );
        creatorNodesToCleanup.push(table.data.id);

        const response = await creatorAxios.post(
          urlBuilder(DUPLICATE_BASE_NODE, { baseId: permissionBaseId, nodeId: table.data.id }),
          { name: 'Duplicated Table' }
        );
        expect(response.status).toBe(201);
        expect(response.data.resourceMeta?.name).toBe('Duplicated Table');
        creatorNodesToCleanup.push(response.data.id);
      });

      it('should allow creator to duplicate dashboard node', async () => {
        const dashboard = await creatorAxios.post(
          urlBuilder(CREATE_BASE_NODE, { baseId: permissionBaseId }),
          {
            resourceType: BaseNodeResourceType.Dashboard,
            name: 'Dashboard to Duplicate',
          }
        );
        creatorNodesToCleanup.push(dashboard.data.id);

        const response = await creatorAxios.post(
          urlBuilder(DUPLICATE_BASE_NODE, { baseId: permissionBaseId, nodeId: dashboard.data.id }),
          { name: 'Duplicated Dashboard' }
        );
        expect(response.status).toBe(201);
        expect(response.data.resourceMeta?.name).toBe('Duplicated Dashboard');
        creatorNodesToCleanup.push(response.data.id);
      });
    });

    describe('Permission filtering on list/tree endpoints', () => {
      it('should filter nodes based on user permissions in list', async () => {
        // Create nodes as owner
        const folder = await createBaseNode(permissionBaseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'Shared Folder',
        });
        nodesToCleanup.push(folder.data.id);

        const table = await createBaseNode(permissionBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Shared Table',
          fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        });
        nodesToCleanup.push(table.data.id);

        // Viewer should see nodes they have permission to read
        const viewerList = await viewerAxios.get(
          urlBuilder(GET_BASE_NODE_LIST, { baseId: permissionBaseId })
        );
        expect(viewerList.status).toBe(200);

        // Viewer has table|read so they should see the table
        const viewerTableNode = viewerList.data.find((n: IBaseNodeVo) => n.id === table.data.id);
        expect(viewerTableNode).toBeDefined();

        // Viewer has base|read so they should see the folder (folder has no special permission)
        const viewerFolderNode = viewerList.data.find((n: IBaseNodeVo) => n.id === folder.data.id);
        expect(viewerFolderNode).toBeDefined();
      });

      it('should filter nodes based on user permissions in tree', async () => {
        const folder = await createBaseNode(permissionBaseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'Tree Test Folder',
        });
        nodesToCleanup.push(folder.data.id);

        const dashboard = await createBaseNode(permissionBaseId, {
          resourceType: BaseNodeResourceType.Dashboard,
          name: 'Tree Test Dashboard',
        });
        nodesToCleanup.push(dashboard.data.id);

        // Viewer should see nodes in tree
        const viewerTree = await viewerAxios.get(
          urlBuilder(GET_BASE_NODE_TREE, { baseId: permissionBaseId })
        );
        expect(viewerTree.status).toBe(200);

        // Viewer has base|read so they should see dashboard (dashboard read requires base|read)
        const viewerDashboardNode = viewerTree.data.nodes.find(
          (n: IBaseNodeVo) => n.id === dashboard.data.id
        );
        expect(viewerDashboardNode).toBeDefined();
      });
    });
  });

  describe('Resource ID resolution (using resourceId instead of nodeId)', () => {
    const nodesToCleanup: string[] = [];

    afterEach(async () => {
      for (const nodeId of [...nodesToCleanup].reverse()) {
        await deleteBaseNode(baseId, nodeId);
      }
      nodesToCleanup.length = 0;
    });

    it('should get node by resourceId (tableId)', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Resolve Get Test',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(node.data.id);

      const response = await getBaseNode(baseId, node.data.resourceId);

      expect(response.data.id).toBe(node.data.id);
      expect(response.data.resourceId).toBe(node.data.resourceId);
      expect(response.data.resourceMeta?.name).toBe('Resolve Get Test');
    });

    it('should update node by resourceId', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Resolve Update Test',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(node.data.id);

      const response = await updateBaseNode(baseId, node.data.resourceId, {
        name: 'Resolve Updated',
      });

      expect(response.data.id).toBe(node.data.id);
      expect(response.data.resourceMeta?.name).toBe('Resolve Updated');
    });

    it('should duplicate node by resourceId', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Resolve Duplicate Test',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(node.data.id);

      const duplicate = await duplicateBaseNode(baseId, node.data.resourceId, {
        name: 'Resolve Duplicated',
      });
      nodesToCleanup.push(duplicate.data.id);

      expect(duplicate.data.id).not.toBe(node.data.id);
      expect(duplicate.data.resourceMeta?.name).toBe('Resolve Duplicated');
    });

    it('should move node by resourceId', async () => {
      const folder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Resolve Move Folder',
      });
      nodesToCleanup.push(folder.data.id);

      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Resolve Move Test',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(node.data.id);

      const response = await moveBaseNode(baseId, node.data.resourceId, {
        parentId: folder.data.id,
      });

      expect(response.data.id).toBe(node.data.id);
      expect(response.data.parentId).toBe(folder.data.id);
    });

    it('should delete node by resourceId', async () => {
      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Resolve Delete Test',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });

      await deleteBaseNode(baseId, node.data.resourceId);

      const error = await getError(() => getBaseNode(baseId, node.data.id));
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should move node with resourceId as parentId', async () => {
      const folder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Resolve Parent Folder',
      });
      nodesToCleanup.push(folder.data.id);

      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Resolve Parent Move Test',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(node.data.id);

      const response = await moveBaseNode(baseId, node.data.id, {
        parentId: folder.data.resourceId,
      });

      expect(response.data.id).toBe(node.data.id);
      expect(response.data.parentId).toBe(folder.data.id);
    });

    it('should create node with resourceId as parentId', async () => {
      const folder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Resolve Create Parent Folder',
      });
      nodesToCleanup.push(folder.data.id);

      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Resolve Create In Folder Test',
        parentId: folder.data.resourceId,
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(node.data.id);

      expect(node.data.parentId).toBe(folder.data.id);
    });

    it('should move node with resourceId as anchorId', async () => {
      const anchor = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Anchor Table',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(anchor.data.id);

      const node = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Movable Table',
        fields: [{ name: 'Field1', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      nodesToCleanup.push(node.data.id);

      const response = await moveBaseNode(baseId, node.data.id, {
        anchorId: anchor.data.resourceId,
        position: 'before',
      });

      expect(response.data.id).toBe(node.data.id);
    });
  });
});
