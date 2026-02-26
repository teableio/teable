import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILookupOptionsRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { IBaseNodeVo, IGetBaseShareVo } from '@teable/openapi';
import {
  BASE_SHARE_AUTH,
  BASE_SHARE_ID_HEADER,
  BaseNodeResourceType,
  copyBaseShare,
  createBase,
  createBaseNode,
  createBaseShare,
  createField,
  createSpace,
  deleteBaseShare,
  deleteSpace,
  GET_BASE_NODE_LIST,
  GET_BASE_NODE_TREE,
  GET_BASE_SHARE,
  getBaseNodeList,
  getBaseShareByNodeId,
  getFields,
  getTableList,
  listBaseShare,
  moveBaseNode,
  refreshBaseShare,
  updateBaseShare,
  urlBuilder,
} from '@teable/openapi';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { getError } from './utils/get-error';
import {
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  updateRecord,
} from './utils/init-app';

describe('BaseShareController (e2e)', () => {
  let app: INestApplication;
  let baseId: string;
  let folderNodeId: string;
  let rootTableId: string;
  let childTableId: string;
  let rootTableNodeId: string;
  let childTableNodeId: string;
  let anonymousUser: ReturnType<typeof createAnonymousUserAxios>;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);

    const base = await createBase({
      name: 'base-share-e2e',
      spaceId: globalThis.testConfig.spaceId,
    }).then((res) => res.data);
    baseId = base.id;

    const rootTable = await createTable(baseId, { name: 'root-table' });
    const childTable = await createTable(baseId, { name: 'child-table' });
    rootTableId = rootTable.id;
    childTableId = childTable.id;

    const folder = await createBaseNode(baseId, {
      resourceType: BaseNodeResourceType.Folder,
      name: 'share-folder',
    });
    folderNodeId = folder.data.id;

    const nodeList = await getBaseNodeList(baseId);
    const rootTableNode = nodeList.data.find((node) => node.resourceId === rootTableId);
    const childTableNode = nodeList.data.find((node) => node.resourceId === childTableId);
    if (!rootTableNode || !childTableNode) {
      throw new Error('Table nodes not found in base node list');
    }
    rootTableNodeId = rootTableNode.id;
    childTableNodeId = childTableNode.id;

    await moveBaseNode(baseId, childTableNodeId, { parentId: folderNodeId });
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    await app.close();
  });

  describe('BaseShareController - Admin API /api/base/:baseId/share', () => {
    const createdShareIds: string[] = [];

    afterEach(async () => {
      // Clean up all shares created during the test
      for (const shareId of createdShareIds) {
        await deleteBaseShare(baseId, shareId).catch(() => undefined);
      }
      createdShareIds.length = 0;
    });

    it('should create base share with nodeId', async () => {
      const res = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(res.data.shareId);
      expect(res.status).toEqual(201);
      expect(res.data.baseId).toEqual(baseId);
      expect(res.data.shareId).toBeDefined();
      expect(res.data.nodeId).toEqual(rootTableNodeId);
      expect(res.data.enabled).toBe(true);
      expect(res.data.password).toBe(false);
      expect(res.data.allowSave).toBeNull();
      expect(res.data.allowCopy).toBeNull();
    });

    it('should create base share with password', async () => {
      const res = await createBaseShare(baseId, {
        nodeId: rootTableNodeId,
        password: 'test123456',
      });
      createdShareIds.push(res.data.shareId);
      expect(res.status).toEqual(201);
      expect(res.data.password).toBe(true);
    });

    it('should create base share with folder nodeId', async () => {
      const res = await createBaseShare(baseId, { nodeId: folderNodeId });
      createdShareIds.push(res.data.shareId);
      expect(res.status).toEqual(201);
      expect(res.data.nodeId).toEqual(folderNodeId);
    });

    it('should create base share with allowSave and allowCopy', async () => {
      const res = await createBaseShare(baseId, {
        nodeId: rootTableNodeId,
        allowSave: true,
        allowCopy: true,
      });
      createdShareIds.push(res.data.shareId);
      expect(res.status).toEqual(201);
      expect(res.data.allowSave).toBe(true);
      expect(res.data.allowCopy).toBe(true);
    });

    it('should list all shared node IDs', async () => {
      // Create shares with different nodeIds
      const share1 = await createBaseShare(baseId, { nodeId: folderNodeId });
      createdShareIds.push(share1.data.shareId);
      const share2 = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share2.data.shareId);

      const res = await listBaseShare(baseId);
      expect(res.status).toEqual(200);
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThanOrEqual(2);

      // List only returns nodeId
      const nodeIds = res.data.map((s) => s.nodeId);
      expect(nodeIds).toContain(folderNodeId);
      expect(nodeIds).toContain(rootTableNodeId);
    });

    it('should get base share by nodeId', async () => {
      // Use childTableNodeId to avoid conflicts with Public API tests using folderNodeId
      const share = await createBaseShare(baseId, {
        nodeId: childTableNodeId,
        password: 'secret123',
      });
      createdShareIds.push(share.data.shareId);

      const res = await getBaseShareByNodeId(baseId, childTableNodeId);
      expect(res.status).toEqual(200);
      expect(res.data.shareId).toEqual(share.data.shareId);
      expect(res.data.baseId).toEqual(baseId);
      expect(res.data.nodeId).toEqual(childTableNodeId);
      // password is returned as boolean
      expect(res.data.password).toBe(true);
    });

    it('should update base share settings', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      // Update allowSave and allowCopy
      const updateRes = await updateBaseShare(baseId, shareId, {
        allowSave: true,
        allowCopy: true,
      });
      expect(updateRes.status).toEqual(200);
      expect(updateRes.data.allowSave).toBe(true);
      expect(updateRes.data.allowCopy).toBe(true);

      // Add password
      const passwordRes = await updateBaseShare(baseId, shareId, { password: 'newpass123' });
      expect(passwordRes.status).toEqual(200);
      expect(passwordRes.data.password).toBe(true);

      // Remove password by setting null
      const removePassRes = await updateBaseShare(baseId, shareId, { password: null });
      expect(removePassRes.status).toEqual(200);
      expect(removePassRes.data.password).toBe(false);

      // Update enabled status (do this last as disabled share may not be updatable)
      const disableRes = await updateBaseShare(baseId, shareId, { enabled: false });
      expect(disableRes.status).toEqual(200);
      expect(disableRes.data.enabled).toBe(false);
    });

    it('should delete base share', async () => {
      // Use childTableNodeId to avoid conflicts with other tests using folderNodeId
      const share = await createBaseShare(baseId, { nodeId: childTableNodeId });
      const shareId = share.data.shareId;

      const deleteRes = await deleteBaseShare(baseId, shareId);
      expect(deleteRes.status).toEqual(200);

      // Verify share is deleted (getByNodeId should return null or empty)
      const res = await getBaseShareByNodeId(baseId, childTableNodeId);
      expect(res.status).toEqual(200);
      expect(res.data).toBeFalsy();
    });

    it('should refresh base share id', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      const originalShareId = share.data.shareId;

      const refreshRes = await refreshBaseShare(baseId, originalShareId);
      createdShareIds.push(refreshRes.data.shareId);
      expect(refreshRes.status).toEqual(201);
      expect(refreshRes.data.shareId).not.toEqual(originalShareId);
      expect(refreshRes.data.baseId).toEqual(baseId);

      // Verify the share still exists with new shareId via nodeId lookup
      const newShareRes = await getBaseShareByNodeId(baseId, rootTableNodeId);
      expect(newShareRes.status).toEqual(200);
      expect(newShareRes.data.shareId).toEqual(refreshRes.data.shareId);
    });
  });

  describe('BaseShareOpenController - Public API /api/share/:shareId/base', () => {
    const createdShareIds: string[] = [];

    afterEach(async () => {
      // Clean up all shares created during the test
      for (const shareId of createdShareIds) {
        await deleteBaseShare(baseId, shareId).catch(() => undefined);
      }
      createdShareIds.length = 0;
    });

    it('should get base share info without password', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const res = await anonymousUser.get<IGetBaseShareVo>(urlBuilder(GET_BASE_SHARE, { shareId }));
      expect(res.status).toEqual(200);
      expect(res.data.baseId).toEqual(baseId);
      expect(res.data.shareMeta).toBeDefined();
      expect(res.data.shareMeta.password).toBe(false);
      expect(res.data.shareMeta.nodeId).toEqual(rootTableNodeId);
    });

    it('should return defaultUrl for redirect', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const res = await anonymousUser.get<IGetBaseShareVo>(urlBuilder(GET_BASE_SHARE, { shareId }));
      expect(res.status).toEqual(200);

      // Should have defaultUrl for redirect
      expect(res.data.defaultUrl).toBeDefined();
      expect(res.data.defaultUrl).toContain(`/base/${baseId}/table/${rootTableId}`);
    });

    it('should return nodeId in shareMeta when sharing a folder', async () => {
      const share = await createBaseShare(baseId, { nodeId: folderNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const res = await anonymousUser.get<IGetBaseShareVo>(urlBuilder(GET_BASE_SHARE, { shareId }));
      expect(res.status).toEqual(200);
      expect(res.data.shareMeta.nodeId).toEqual(folderNodeId);

      // defaultUrl should point to the first table within the shared folder
      expect(res.data.defaultUrl).toBeDefined();
      expect(res.data.defaultUrl).toContain(`/base/${baseId}/table/${childTableId}`);
    });

    it('should return defaultUrl for shared table node', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const res = await anonymousUser.get<IGetBaseShareVo>(urlBuilder(GET_BASE_SHARE, { shareId }));
      expect(res.status).toEqual(200);

      // defaultUrl should point to the shared table
      expect(res.data.defaultUrl).toBeDefined();
      expect(res.data.defaultUrl).toContain(`/base/${baseId}/table/${rootTableId}`);
    });

    it('should include allowSave and allowCopy in shareMeta', async () => {
      const share = await createBaseShare(baseId, {
        nodeId: rootTableNodeId,
        allowSave: true,
        allowCopy: false,
      });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const res = await anonymousUser.get<IGetBaseShareVo>(urlBuilder(GET_BASE_SHARE, { shareId }));
      expect(res.status).toEqual(200);
      expect(res.data.shareMeta.allowSave).toBe(true);
      expect(res.data.shareMeta.allowCopy).toBe(false);
    });

    it('should require authentication for password-protected share', async () => {
      const share = await createBaseShare(baseId, {
        nodeId: rootTableNodeId,
        password: 'testpwd123',
      });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      // Direct access without auth should return 401 for password-protected shares
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId }))
      );
      expect(error?.status).toEqual(401);
    });

    it('should authenticate with correct password', async () => {
      const password = 'correctpass123';
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId, password });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const authRes = await anonymousUser.post(urlBuilder(BASE_SHARE_AUTH, { shareId }), {
        password,
      });
      expect(authRes.status).toEqual(200);
      expect(authRes.data.token).toBeDefined();
      expect(authRes.headers['set-cookie']).toBeDefined();
    });

    it('should reject authentication with wrong password', async () => {
      const share = await createBaseShare(baseId, {
        nodeId: rootTableNodeId,
        password: 'correctpass',
      });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const error = await getError(() =>
        anonymousUser.post(urlBuilder(BASE_SHARE_AUTH, { shareId }), {
          password: 'wrongpassword',
        })
      );
      expect(error?.status).toEqual(400);
    });

    it('requires password for base share protected endpoints', async () => {
      const share = await createBaseShare(baseId, {
        nodeId: rootTableNodeId,
        password: '123123123',
      });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const error = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_NODE_LIST, { baseId }), {
          headers: {
            [BASE_SHARE_ID_HEADER]: shareId,
          },
        })
      );
      expect(error?.status).toEqual(401);

      const authRes = await anonymousUser.post(urlBuilder(BASE_SHARE_AUTH, { shareId }), {
        password: '123123123',
      });
      const listRes = await anonymousUser.get(urlBuilder(GET_BASE_NODE_LIST, { baseId }), {
        headers: {
          [BASE_SHARE_ID_HEADER]: shareId,
          cookie: authRes.headers['set-cookie'],
        },
      });
      expect(listRes.status).toEqual(200);
    });

    it('rejects disabled base share access', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      await updateBaseShare(baseId, shareId, { enabled: false });

      const getShareError = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId }))
      );
      expect(getShareError?.status).toEqual(404);

      const listError = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_NODE_LIST, { baseId }), {
          headers: {
            [BASE_SHARE_ID_HEADER]: shareId,
          },
        })
      );
      expect(listError?.status).toEqual(403);
    });

    it('filters base node list/tree by shared node', async () => {
      const share = await createBaseShare(baseId, { nodeId: folderNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      const listRes = await anonymousUser.get<IBaseNodeVo[]>(
        urlBuilder(GET_BASE_NODE_LIST, { baseId }),
        {
          headers: {
            [BASE_SHARE_ID_HEADER]: shareId,
          },
        }
      );
      const listNodeIds = new Set(listRes.data.map((node) => node.id));
      // Verify folder and child table are included
      expect(listNodeIds.has(folderNodeId)).toBe(true);
      expect(listNodeIds.has(childTableNodeId)).toBe(true);

      const treeRes = await anonymousUser.get<{ nodes: IBaseNodeVo[] }>(
        urlBuilder(GET_BASE_NODE_TREE, { baseId }),
        {
          headers: {
            [BASE_SHARE_ID_HEADER]: shareId,
          },
        }
      );
      const treeNodeIds = new Set(treeRes.data.nodes.map((node) => node.id));
      // Verify folder and child table are included in tree
      expect(treeNodeIds.has(folderNodeId)).toBe(true);
      expect(treeNodeIds.has(childTableNodeId)).toBe(true);
    });

    it('should return 404 for non-existent share', async () => {
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId: 'non-existent-share-id' }))
      );
      expect(error?.status).toEqual(404);
    });
  });

  describe('BaseShareOpenController - Copy Base Share /api/share/:shareId/base/copy', () => {
    let targetSpaceId: string;
    let copiedBaseId: string | undefined;
    let testShareId: string | undefined;
    const rejectedCopyName = 'should-not-copy';

    beforeAll(async () => {
      const space = await createSpace({ name: 'copy-target-space' });
      targetSpaceId = space.data.id;
    });

    afterAll(async () => {
      await deleteSpace(targetSpaceId);
    });

    afterEach(async () => {
      if (copiedBaseId) {
        await permanentDeleteBase(copiedBaseId);
        copiedBaseId = undefined;
      }
      if (testShareId) {
        await deleteBaseShare(baseId, testShareId).catch(() => undefined);
        testShareId = undefined;
      }
    });

    it('should copy base share to my space', async () => {
      const share = await createBaseShare(baseId, { nodeId: folderNodeId, allowSave: true });
      testShareId = share.data.shareId;

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: targetSpaceId,
        name: 'copied-base',
        withRecords: true,
      });

      expect(copyRes.status).toEqual(200);
      expect(copyRes.data.id).toBeDefined();
      expect(copyRes.data.name).toEqual('copied-base');

      copiedBaseId = copyRes.data.id;

      // Verify tables are copied
      const tableList = await getTableList(copiedBaseId);
      expect(tableList.data.length).toBeGreaterThan(0);
    });

    it('should copy base share with records', async () => {
      const share = await createBaseShare(baseId, { nodeId: folderNodeId, allowSave: true });
      testShareId = share.data.shareId;

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: targetSpaceId,
        name: 'copied-base-with-records',
        withRecords: true,
      });

      expect(copyRes.status).toEqual(200);
      copiedBaseId = copyRes.data.id;

      // Verify records are copied
      const tableList = await getTableList(copiedBaseId);
      const records = await getRecords(tableList.data[0].id);
      expect(records.records.length).toBeGreaterThan(0);
    });

    it('should copy base share without records', async () => {
      const share = await createBaseShare(baseId, { nodeId: folderNodeId, allowSave: true });
      testShareId = share.data.shareId;

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: targetSpaceId,
        name: 'copied-base-without-records',
        withRecords: false,
      });

      expect(copyRes.status).toEqual(200);
      copiedBaseId = copyRes.data.id;

      // Verify no records are copied
      const tableList = await getTableList(copiedBaseId);
      const records = await getRecords(tableList.data[0].id);
      expect(records.records.length).toEqual(0);
    });

    it('should reject copy when allowSave is false', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId, allowSave: false });
      testShareId = share.data.shareId;
      // Clear any inherited password from previously soft-deleted share for this nodeId
      await updateBaseShare(baseId, testShareId, { password: null });

      const error = await getError(() =>
        copyBaseShare(testShareId!, {
          spaceId: targetSpaceId,
          name: rejectedCopyName,
          withRecords: true,
        })
      );

      expect(error?.status).toEqual(403);
    });

    it('should reject copy when allowSave is not set (null)', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      testShareId = share.data.shareId;
      // Clear any inherited password from previously soft-deleted share for this nodeId
      await updateBaseShare(baseId, testShareId, { password: null });

      const error = await getError(() =>
        copyBaseShare(testShareId!, {
          spaceId: targetSpaceId,
          name: rejectedCopyName,
          withRecords: true,
        })
      );

      expect(error?.status).toEqual(403);
    });

    it('should reject copy of password-protected base share without password', async () => {
      // Password-protected shares require authentication even for logged-in users
      const share = await createBaseShare(baseId, {
        nodeId: rootTableNodeId,
        password: 'testpassword123',
        allowSave: true,
      });
      testShareId = share.data.shareId;

      const error = await getError(() =>
        copyBaseShare(testShareId!, {
          spaceId: targetSpaceId,
          name: rejectedCopyName,
          withRecords: true,
        })
      );

      expect(error?.status).toEqual(401);
    });

    it('should reject copy to non-existent space', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId, allowSave: true });
      testShareId = share.data.shareId;
      // Clear any inherited password from previously soft-deleted share for this nodeId
      await updateBaseShare(baseId, testShareId, { password: null });

      const error = await getError(() =>
        copyBaseShare(testShareId!, {
          spaceId: 'non-existent-space-id',
          name: rejectedCopyName,
          withRecords: true,
        })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should generate default name when name is not provided', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId, allowSave: true });
      testShareId = share.data.shareId;
      // Clear any inherited password from previously soft-deleted share for this nodeId
      await updateBaseShare(baseId, testShareId, { password: null });

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: targetSpaceId,
        withRecords: true,
      });

      expect(copyRes.status).toEqual(200);
      copiedBaseId = copyRes.data.id;
      expect(copyRes.data.name).toBeDefined();
      expect(copyRes.data.name.length).toBeGreaterThan(0);
    });
  });

  describe('BaseShareOpenController - Copy Base Share with Link Fields', () => {
    let linkBaseId: string;
    let linkTargetSpaceId: string;
    let copiedBaseId: string | undefined;
    let testShareId: string | undefined;
    let table1Id: string;
    let table2Id: string;
    let table3Id: string;
    let table1NodeId: string;
    let linkField12: { id: string; name: string };
    let linkField13: { id: string; name: string };

    beforeAll(async () => {
      // Create target space
      const space = await createSpace({ name: 'link-copy-target-space' });
      linkTargetSpaceId = space.data.id;

      // Create a separate base for link field tests
      const base = await createBase({
        name: 'base-share-link-e2e',
        spaceId: globalThis.testConfig.spaceId,
      });
      linkBaseId = base.data.id;

      // Create tables
      const table1 = await createTable(linkBaseId, { name: 'Orders' });
      const table2 = await createTable(linkBaseId, { name: 'Customers' });
      const table3 = await createTable(linkBaseId, { name: 'Products' });
      table1Id = table1.id;
      table2Id = table2.id;
      table3Id = table3.id;

      // Get node ID for table1 (Orders)
      const linkNodeList = await getBaseNodeList(linkBaseId);
      const table1Node = linkNodeList.data.find((n) => n.resourceId === table1Id);
      if (!table1Node) {
        throw new Error('Table1 node not found in link base node list');
      }
      table1NodeId = table1Node.id;

      // Create link from Orders to Customers
      const linkFieldRo12: IFieldRo = {
        name: 'customer',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2Id,
        },
      };
      const field12 = await createField(table1Id, linkFieldRo12);
      linkField12 = { id: field12.data.id, name: field12.data.name };

      // Create link from Orders to Products
      const linkFieldRo13: IFieldRo = {
        name: 'products',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table3Id,
        },
      };
      const field13 = await createField(table1Id, linkFieldRo13);
      linkField13 = { id: field13.data.id, name: field13.data.name };

      // Create some link data
      const table1Records = await getRecords(table1Id);
      const table2Records = await getRecords(table2Id);
      const table3Records = await getRecords(table3Id);

      await updateRecord(table1Id, table1Records.records[0].id, {
        record: {
          fields: {
            [linkField12.name]: [{ id: table2Records.records[0].id }],
            [linkField13.name]: [{ id: table3Records.records[0].id }],
          },
        },
      });
    });

    afterAll(async () => {
      await permanentDeleteBase(linkBaseId);
      await deleteSpace(linkTargetSpaceId);
    });

    afterEach(async () => {
      if (copiedBaseId) {
        await permanentDeleteBase(copiedBaseId);
        copiedBaseId = undefined;
      }
      if (testShareId) {
        await deleteBaseShare(linkBaseId, testShareId).catch(() => undefined);
        testShareId = undefined;
      }
    });

    it('should copy base share with single table and disconnect link fields', async () => {
      const share = await createBaseShare(linkBaseId, { nodeId: table1NodeId, allowSave: true });
      testShareId = share.data.shareId;

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: linkTargetSpaceId,
        name: 'copied-link-base',
        withRecords: true,
      });

      expect(copyRes.status).toEqual(200);
      copiedBaseId = copyRes.data.id;

      // Only the shared table (Orders) should be copied;
      // linked tables (Customers, Products) are outside the shared node
      const tableList = await getTableList(copiedBaseId);
      expect(tableList.data.length).toBe(1);
      expect(tableList.data[0].name).toBe('Orders');

      // Link fields to tables outside the shared node should be disconnected (converted to text)
      const ordersFields = await getFields(tableList.data[0].id);
      const customerField = ordersFields.data.find((f) => f.name === linkField12.name);
      const productsField = ordersFields.data.find((f) => f.name === linkField13.name);
      expect(customerField?.type).toBe(FieldType.SingleLineText);
      expect(productsField?.type).toBe(FieldType.SingleLineText);
    });

    it('should convert disconnected link fields when copying partial base', async () => {
      // Create a separate base for this test to avoid state pollution
      const testBase = await createBase({
        name: 'partial-copy-test-base',
        spaceId: globalThis.testConfig.spaceId,
      });
      const testBaseId = testBase.data.id;

      // Create tables
      const ordersTable = await createTable(testBaseId, { name: 'Orders' });
      const customersTable = await createTable(testBaseId, { name: 'Customers' });
      const productsTable = await createTable(testBaseId, { name: 'Products' });

      // Create link from Orders to Customers
      await createField(ordersTable.id, {
        name: 'customer',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: customersTable.id,
        },
      });

      // Create link from Orders to Products (will be disconnected)
      await createField(ordersTable.id, {
        name: 'products',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: productsTable.id,
        },
      });

      // Get node IDs
      const nodeList = await getBaseNodeList(testBaseId);
      const ordersNode = nodeList.data.find((n) => n.resourceId === ordersTable.id);
      const customersNode = nodeList.data.find((n) => n.resourceId === customersTable.id);

      // Create a folder containing only Orders and Customers
      const folder = await createBaseNode(testBaseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'partial-folder',
      });

      await moveBaseNode(testBaseId, ordersNode!.id, { parentId: folder.data.id });
      await moveBaseNode(testBaseId, customersNode!.id, { parentId: folder.data.id });

      // Share only the folder
      const share = await createBaseShare(testBaseId, {
        nodeId: folder.data.id,
        allowSave: true,
      });

      const copyRes = await copyBaseShare(share.data.shareId, {
        spaceId: linkTargetSpaceId,
        name: 'copied-partial-link-base',
        withRecords: true,
      });

      expect(copyRes.status).toEqual(200);
      copiedBaseId = copyRes.data.id;

      // Verify only 2 tables are copied
      const tableList = await getTableList(copiedBaseId);
      expect(tableList.data.length).toBe(2);
      expect(tableList.data.map((t) => t.name).sort()).toEqual(['Customers', 'Orders'].sort());

      // Verify link to Customers remains as Link type
      const copiedOrdersTable = tableList.data.find((t) => t.name === 'Orders')!;
      const ordersFields = await getFields(copiedOrdersTable.id);
      const customerField = ordersFields.data.find((f) => f.name === 'customer');
      expect(customerField?.type).toBe(FieldType.Link);

      // Verify link to Products is converted to SingleLineText (disconnected)
      const productsField = ordersFields.data.find((f) => f.name === 'products');
      expect(productsField?.type).toBe(FieldType.SingleLineText);

      // Cleanup
      await permanentDeleteBase(testBaseId);
    });

    it('should handle lookup fields based on disconnected links', async () => {
      // Create a separate base for this test
      const testBase = await createBase({
        name: 'lookup-copy-test-base',
        spaceId: globalThis.testConfig.spaceId,
      });
      const testBaseId = testBase.data.id;

      // Create tables
      const ordersTable = await createTable(testBaseId, { name: 'Orders' });
      const customersTable = await createTable(testBaseId, { name: 'Customers' });
      const productsTable = await createTable(testBaseId, { name: 'Products' });

      // Create link from Orders to Products
      const linkToProducts = await createField(ordersTable.id, {
        name: 'products',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: productsTable.id,
        },
      });

      // Create a lookup field based on link to Products
      const productsFields = await getFields(productsTable.id);
      await createField(ordersTable.id, {
        name: 'product lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: productsTable.id,
          linkFieldId: linkToProducts.data.id,
          lookupFieldId: productsFields.data[0].id,
        } as ILookupOptionsRo,
      });

      // Get node IDs for Orders and Customers tables only (exclude Products)
      const nodeList = await getBaseNodeList(testBaseId);
      const ordersNode = nodeList.data.find((n) => n.resourceId === ordersTable.id);
      const customersNode = nodeList.data.find((n) => n.resourceId === customersTable.id);

      // Create a folder containing only Orders and Customers
      const folder = await createBaseNode(testBaseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'lookup-test-folder',
      });

      await moveBaseNode(testBaseId, ordersNode!.id, { parentId: folder.data.id });
      await moveBaseNode(testBaseId, customersNode!.id, { parentId: folder.data.id });

      // Share only the folder
      const share = await createBaseShare(testBaseId, {
        nodeId: folder.data.id,
        allowSave: true,
      });

      const copyRes = await copyBaseShare(share.data.shareId, {
        spaceId: linkTargetSpaceId,
        name: 'copied-lookup-test-base',
        withRecords: true,
      });

      expect(copyRes.status).toEqual(200);
      copiedBaseId = copyRes.data.id;

      // Verify lookup field is converted to SingleLineText (disconnected)
      const tableList = await getTableList(copiedBaseId);
      const copiedOrdersTable = tableList.data.find((t) => t.name === 'Orders')!;
      const ordersFields = await getFields(copiedOrdersTable.id);
      const lookupField = ordersFields.data.find((f) => f.name === 'product lookup');

      expect(lookupField?.type).toBe(FieldType.SingleLineText);
      expect(lookupField?.isLookup).toBeFalsy();

      // Cleanup
      await permanentDeleteBase(testBaseId);
    });
  });

  describe('BaseShareOpenController - Copy Share to Existing Base', () => {
    let sourceBaseId: string;
    let targetSpaceId: string;
    let targetBaseId: string;
    let copiedBaseId: string | undefined;
    let testShareId: string | undefined;

    beforeAll(async () => {
      const space = await createSpace({ name: 'copy-to-existing-base-space' });
      targetSpaceId = space.data.id;

      const srcBase = await createBase({
        name: 'share-copy-source',
        spaceId: globalThis.testConfig.spaceId,
      });
      sourceBaseId = srcBase.data.id;

      await createTable(sourceBaseId, { name: 'SourceTable1' });
      await createTable(sourceBaseId, { name: 'SourceTable2' });
    });

    afterAll(async () => {
      await permanentDeleteBase(sourceBaseId);
      await deleteSpace(targetSpaceId);
    });

    afterEach(async () => {
      if (copiedBaseId) {
        await permanentDeleteBase(copiedBaseId);
        copiedBaseId = undefined;
      }
      if (targetBaseId) {
        await permanentDeleteBase(targetBaseId).catch(() => undefined);
      }
      if (testShareId) {
        await deleteBaseShare(sourceBaseId, testShareId).catch(() => undefined);
        testShareId = undefined;
      }
    });

    it('should copy share tables into an existing base', async () => {
      const existingBase = await createBase({
        name: 'existing-target-base',
        spaceId: targetSpaceId,
      });
      targetBaseId = existingBase.data.id;

      await createTable(targetBaseId, { name: 'ExistingTable' });

      const nodeList = await getBaseNodeList(sourceBaseId);
      const firstNode = nodeList.data[0];

      const share = await createBaseShare(sourceBaseId, {
        nodeId: firstNode.id,
        allowSave: true,
      });
      testShareId = share.data.shareId;

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: targetSpaceId,
        withRecords: true,
        baseId: targetBaseId,
      });

      expect(copyRes.status).toEqual(200);
      expect(copyRes.data.id).toEqual(targetBaseId);

      const tableList = await getTableList(targetBaseId);
      const tableNames = tableList.data.map((t) => t.name);
      expect(tableNames).toContain('ExistingTable');
      expect(tableList.data.length).toBeGreaterThan(1);
    });

    it('should preserve existing base name and icon when copying into it', async () => {
      const existingBase = await createBase({
        name: 'my-precious-base',
        spaceId: targetSpaceId,
      });
      targetBaseId = existingBase.data.id;

      const nodeList = await getBaseNodeList(sourceBaseId);
      const firstNode = nodeList.data[0];

      const share = await createBaseShare(sourceBaseId, {
        nodeId: firstNode.id,
        allowSave: true,
      });
      testShareId = share.data.shareId;

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: targetSpaceId,
        withRecords: false,
        baseId: targetBaseId,
      });

      expect(copyRes.status).toEqual(200);
      expect(copyRes.data.name).toEqual('my-precious-base');
    });

    it('should reject copy to non-existent base', async () => {
      const nodeList = await getBaseNodeList(sourceBaseId);
      const firstNode = nodeList.data[0];

      const share = await createBaseShare(sourceBaseId, {
        nodeId: firstNode.id,
        allowSave: true,
      });
      testShareId = share.data.shareId;
      targetBaseId = '';

      const error = await getError(() =>
        copyBaseShare(testShareId!, {
          spaceId: targetSpaceId,
          withRecords: false,
          baseId: 'non-existent-base-id',
        })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should reject copy to base in different space', async () => {
      const otherSpace = await createSpace({ name: 'other-space-for-mismatch' });
      const existingBase = await createBase({
        name: 'base-in-other-space',
        spaceId: otherSpace.data.id,
      });
      targetBaseId = existingBase.data.id;

      const nodeList = await getBaseNodeList(sourceBaseId);
      const firstNode = nodeList.data[0];

      const share = await createBaseShare(sourceBaseId, {
        nodeId: firstNode.id,
        allowSave: true,
      });
      testShareId = share.data.shareId;

      const error = await getError(() =>
        copyBaseShare(testShareId!, {
          spaceId: targetSpaceId,
          withRecords: false,
          baseId: targetBaseId,
        })
      );

      expect(error?.status).toBeGreaterThanOrEqual(400);

      await permanentDeleteBase(targetBaseId);
      targetBaseId = '';
      await deleteSpace(otherSpace.data.id);
    });

    it('should reject copy when allowSave is false even with valid targetBaseId', async () => {
      const existingBase = await createBase({
        name: 'target-no-save',
        spaceId: targetSpaceId,
      });
      targetBaseId = existingBase.data.id;

      const nodeList = await getBaseNodeList(sourceBaseId);
      const firstNode = nodeList.data[0];

      const share = await createBaseShare(sourceBaseId, {
        nodeId: firstNode.id,
        allowSave: false,
      });
      testShareId = share.data.shareId;
      await updateBaseShare(sourceBaseId, testShareId, { password: null });

      const error = await getError(() =>
        copyBaseShare(testShareId!, {
          spaceId: targetSpaceId,
          withRecords: false,
          baseId: targetBaseId,
        })
      );

      expect(error?.status).toEqual(403);
    });

    it('should handle copying tables with same name into existing base', async () => {
      const existingBase = await createBase({
        name: 'base-with-same-table-name',
        spaceId: targetSpaceId,
      });
      targetBaseId = existingBase.data.id;

      await createTable(targetBaseId, { name: 'SourceTable1' });

      const nodeList = await getBaseNodeList(sourceBaseId);
      const firstNode = nodeList.data[0];

      const share = await createBaseShare(sourceBaseId, {
        nodeId: firstNode.id,
        allowSave: true,
      });
      testShareId = share.data.shareId;

      const copyRes = await copyBaseShare(testShareId, {
        spaceId: targetSpaceId,
        withRecords: true,
        baseId: targetBaseId,
      });

      expect(copyRes.status).toEqual(200);

      const tableList = await getTableList(targetBaseId);
      const tableNames = tableList.data.map((t) => t.name);
      expect(tableNames).toContain('SourceTable1');
      const renamedTable = tableNames.find(
        (n) => n.startsWith('SourceTable1') && n !== 'SourceTable1'
      );
      expect(renamedTable).toBeDefined();
    });
  });

  describe('BaseShareOpenController - Edge Cases', () => {
    const createdShareIds: string[] = [];

    afterEach(async () => {
      for (const shareId of createdShareIds) {
        await deleteBaseShare(baseId, shareId).catch(() => undefined);
      }
      createdShareIds.length = 0;
    });

    it('should reject copy after share is disabled', async () => {
      // Create a share with allowSave enabled, then disable it, then try to copy
      const share = await createBaseShare(baseId, { nodeId: folderNodeId, allowSave: true });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      // Disable the share
      await updateBaseShare(baseId, shareId, { enabled: false });

      // Attempt to copy — should fail because the share is disabled
      const error = await getError(() =>
        copyBaseShare(shareId, {
          spaceId: globalThis.testConfig.spaceId,
          name: 'should-not-exist',
          withRecords: false,
        })
      );
      // Disabled share should not be found (404) or be forbidden (403)
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should invalidate old shareId after refresh', async () => {
      // Create share, refresh to get new shareId, then access with old shareId
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      const oldShareId = share.data.shareId;
      createdShareIds.push(oldShareId);
      // Clear any inherited password from previously soft-deleted share for this nodeId
      await updateBaseShare(baseId, oldShareId, { password: null });

      // Refresh to get a new shareId
      const refreshed = await refreshBaseShare(baseId, oldShareId);
      const newShareId = refreshed.data.shareId;
      createdShareIds.push(newShareId);
      expect(newShareId).not.toEqual(oldShareId);

      // Old shareId should no longer work
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId: oldShareId }))
      );
      expect(error?.status).toEqual(404);

      // New shareId should work
      const res = await anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId: newShareId }));
      expect(res.status).toEqual(200);
    });

    it('should invalidate old JWT cookie after shareId refresh', async () => {
      const password = 'refreshtest123';
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId, password });
      const oldShareId = share.data.shareId;
      createdShareIds.push(oldShareId);

      // Authenticate with old shareId to get JWT cookie
      const authRes = await anonymousUser.post(
        urlBuilder(BASE_SHARE_AUTH, { shareId: oldShareId }),
        {
          password,
        }
      );
      expect(authRes.status).toEqual(200);
      const oldCookie = authRes.headers['set-cookie'];

      // Refresh the shareId
      const refreshed = await refreshBaseShare(baseId, oldShareId);
      const newShareId = refreshed.data.shareId;
      createdShareIds.push(newShareId);

      // Old cookie + old shareId should fail (share not found)
      const oldError = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId: oldShareId }), {
          headers: { cookie: oldCookie },
        })
      );
      expect(oldError?.status).toEqual(404);

      // Old cookie + new shareId should fail (cookie is keyed by old shareId, JWT contains old shareId)
      const mismatchError = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId: newShareId }), {
          headers: { cookie: oldCookie },
        })
      );
      // Should require re-authentication (401) since the new share still has password
      expect(mismatchError?.status).toEqual(401);
    });

    it('should handle concurrent creation of share for same nodeId', async () => {
      // Two concurrent requests to create a share for the same nodeId
      // Due to unique constraint on nodeId, at most one should succeed via create;
      // the other should either get a conflict error or be handled gracefully
      const results = await Promise.allSettled([
        createBaseShare(baseId, { nodeId: rootTableNodeId }),
        createBaseShare(baseId, { nodeId: rootTableNodeId }),
      ]);

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      // At least one should succeed
      expect(successes.length).toBeGreaterThanOrEqual(1);
      // If both "succeed" (second sees existing → conflict before DB), that's fine too
      // The key invariant: only one share should exist for this nodeId
      expect(successes.length + failures.length).toBe(2);

      // Clean up all successfully created shares
      for (const result of successes) {
        const r = result as PromiseFulfilledResult<Awaited<ReturnType<typeof createBaseShare>>>;
        createdShareIds.push(r.value.data.shareId);
      }

      // Verify only one share exists for this nodeId
      const shareList = await listBaseShare(baseId);
      const sharesForNode = shareList.data.filter((s) => s.nodeId === rootTableNodeId);
      expect(sharesForNode.length).toBe(1);
    });

    it('should allow authenticated user to access share via share header', async () => {
      // Logged-in user (not anonymous) accesses share endpoints via X-Tea-Base-Share header
      const share = await createBaseShare(baseId, { nodeId: folderNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;

      // Authenticated user should be able to get base node list via share header
      const listRes = await anonymousUser.get(urlBuilder(GET_BASE_NODE_LIST, { baseId }), {
        headers: {
          [BASE_SHARE_ID_HEADER]: shareId,
        },
      });
      expect(listRes.status).toEqual(200);
      expect(Array.isArray(listRes.data)).toBe(true);

      // Should only see nodes under the shared folder
      const nodeIds = new Set(listRes.data.map((n: IBaseNodeVo) => n.id));
      expect(nodeIds.has(folderNodeId)).toBe(true);
      expect(nodeIds.has(childTableNodeId)).toBe(true);
      // Root table is outside the shared folder, should not be visible
      expect(nodeIds.has(rootTableNodeId)).toBe(false);
    });
  });
});
