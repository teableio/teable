import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILookupOptionsRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { IBaseNodeVo, IGetBaseShareVo, ITablePermissionVo } from '@teable/openapi';
import {
  BASE_SHARE_AUTH,
  BASE_SHARE_ID_HEADER,
  BaseNodeResourceType,
  COPY_BASE_SHARE,
  copyBaseShare,
  createBase,
  createBaseNode,
  createBaseShare,
  CREATE_RECORD,
  createField,
  createSpace,
  DELETE_RECORD_URL,
  deleteBaseShare,
  deleteSpace,
  GET_BASE_NODE_LIST,
  GET_BASE_NODE_TREE,
  GET_BASE_SHARE,
  GET_TABLE_PERMISSION,
  getBaseNodeList,
  getBaseShareByNodeId,
  getFields,
  getTableList,
  getBaseLevelShare,
  listBaseShare,
  moveBaseNode,
  refreshBaseShare,
  UPDATE_RECORD,
  updateBaseShare,
  urlBuilder,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  updateRecord,
} from './utils/init-app';

const setCookieHeader = 'set-cookie';

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

    it('should create base share with folder nodeId', async () => {
      const res = await createBaseShare(baseId, { nodeId: folderNodeId });
      createdShareIds.push(res.data.shareId);
      expect(res.status).toEqual(201);
      expect(res.data.nodeId).toEqual(folderNodeId);
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
      const share = await createBaseShare(baseId, { nodeId: childTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(baseId, share.data.shareId, { password: 'secret123' });

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
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;
      await updateBaseShare(baseId, shareId, { allowSave: true, allowCopy: false });

      const res = await anonymousUser.get<IGetBaseShareVo>(urlBuilder(GET_BASE_SHARE, { shareId }));
      expect(res.status).toEqual(200);
      expect(res.data.shareMeta.allowSave).toBe(true);
      expect(res.data.shareMeta.allowCopy).toBe(false);
    });

    it('should require authentication for password-protected share', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;
      await updateBaseShare(baseId, shareId, { password: 'testpwd123' });

      // Direct access without auth should return 401 for password-protected shares
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId }))
      );
      expect(error?.status).toEqual(401);
    });

    it('should authenticate with correct password', async () => {
      const password = 'correctpass123';
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;
      await updateBaseShare(baseId, shareId, { password });

      const authRes = await anonymousUser.post(urlBuilder(BASE_SHARE_AUTH, { shareId }), {
        password,
      });
      expect(authRes.status).toEqual(200);
      expect(authRes.data.token).toBeDefined();
      expect(authRes.headers[setCookieHeader]).toBeDefined();
    });

    it('should reject authentication with wrong password', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;
      await updateBaseShare(baseId, shareId, { password: 'correctpass' });

      const error = await getError(() =>
        anonymousUser.post(urlBuilder(BASE_SHARE_AUTH, { shareId }), {
          password: 'wrongpassword',
        })
      );
      expect(error?.status).toEqual(400);
    });

    it('requires password for base share protected endpoints', async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;
      await updateBaseShare(baseId, shareId, { password: '123123123' });

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
          cookie: authRes.headers[setCookieHeader],
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
      const share = await createBaseShare(baseId, { nodeId: folderNodeId });
      testShareId = share.data.shareId;
      await updateBaseShare(baseId, testShareId, { allowSave: true });

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
      const share = await createBaseShare(baseId, { nodeId: folderNodeId });
      testShareId = share.data.shareId;
      await updateBaseShare(baseId, testShareId, { allowSave: true });

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
      const share = await createBaseShare(baseId, { nodeId: folderNodeId });
      testShareId = share.data.shareId;
      await updateBaseShare(baseId, testShareId, { allowSave: true });

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
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      testShareId = share.data.shareId;
      await updateBaseShare(baseId, testShareId, { allowSave: false });

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
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      testShareId = share.data.shareId;
      await updateBaseShare(baseId, testShareId, { password: 'testpassword123', allowSave: true });

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
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      testShareId = share.data.shareId;
      await updateBaseShare(baseId, testShareId, { allowSave: true });

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
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      testShareId = share.data.shareId;
      await updateBaseShare(baseId, testShareId, { allowSave: true });

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
      const share = await createBaseShare(linkBaseId, { nodeId: table1NodeId });
      await updateBaseShare(linkBaseId, share.data.shareId, { allowSave: true });
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
      const share = await createBaseShare(testBaseId, { nodeId: folder.data.id });
      await updateBaseShare(testBaseId, share.data.shareId, { allowSave: true });

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
      const share = await createBaseShare(testBaseId, { nodeId: folder.data.id });
      await updateBaseShare(testBaseId, share.data.shareId, { allowSave: true });

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

      const share = await createBaseShare(sourceBaseId, { nodeId: firstNode.id });
      testShareId = share.data.shareId;
      await updateBaseShare(sourceBaseId, testShareId, { allowSave: true });

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

      const share = await createBaseShare(sourceBaseId, { nodeId: firstNode.id });
      testShareId = share.data.shareId;
      await updateBaseShare(sourceBaseId, testShareId, { allowSave: true });

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

      const share = await createBaseShare(sourceBaseId, { nodeId: firstNode.id });
      testShareId = share.data.shareId;
      await updateBaseShare(sourceBaseId, testShareId, { allowSave: true });
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

      const share = await createBaseShare(sourceBaseId, { nodeId: firstNode.id });
      testShareId = share.data.shareId;
      await updateBaseShare(sourceBaseId, testShareId, { allowSave: true });

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

      const share = await createBaseShare(sourceBaseId, { nodeId: firstNode.id });
      testShareId = share.data.shareId;
      await updateBaseShare(sourceBaseId, testShareId, { allowSave: false });

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
      const sourceTableNode = nodeList.data.find(
        (node) =>
          node.resourceType === BaseNodeResourceType.Table &&
          node.resourceMeta?.name === 'SourceTable1'
      );

      if (!sourceTableNode) {
        throw new Error('SourceTable1 node not found in base node list');
      }

      const share = await createBaseShare(sourceBaseId, { nodeId: sourceTableNode.id });
      testShareId = share.data.shareId;
      await updateBaseShare(sourceBaseId, testShareId, { allowSave: true });

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
      const share = await createBaseShare(baseId, { nodeId: folderNodeId });
      createdShareIds.push(share.data.shareId);
      const shareId = share.data.shareId;
      await updateBaseShare(baseId, shareId, { allowSave: true });

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
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      const oldShareId = share.data.shareId;
      createdShareIds.push(oldShareId);
      await updateBaseShare(baseId, oldShareId, { password });

      // Authenticate with old shareId to get JWT cookie
      const authRes = await anonymousUser.post(
        urlBuilder(BASE_SHARE_AUTH, { shareId: oldShareId }),
        {
          password,
        }
      );
      expect(authRes.status).toEqual(200);
      const oldCookie = authRes.headers[setCookieHeader];

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

  describe('BaseShare - allowEdit permission', () => {
    let editBaseId: string;
    let editTableId: string;
    let editTableNodeId: string;
    let editFolderNodeId: string;
    let loggedInUser: AxiosInstance;
    const createdShareIds: string[] = [];

    beforeAll(async () => {
      const base = await createBase({
        name: 'allowEdit-e2e',
        spaceId: globalThis.testConfig.spaceId,
      }).then((res) => res.data);
      editBaseId = base.id;

      const table = await createTable(editBaseId, { name: 'edit-table' });
      editTableId = table.id;

      const folder = await createBaseNode(editBaseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'edit-folder',
      });
      editFolderNodeId = folder.data.id;

      const nodeList = await getBaseNodeList(editBaseId);
      const tableNode = nodeList.data.find((n) => n.resourceId === editTableId);
      if (!tableNode) throw new Error('Table node not found');
      editTableNodeId = tableNode.id;

      loggedInUser = await createNewUserAxios({
        email: 'allow-edit-e2e@test.com',
        password: 'TestPassword123!',
      });
    });

    afterAll(async () => {
      await permanentDeleteBase(editBaseId);
    });

    afterEach(async () => {
      for (const shareId of createdShareIds) {
        await deleteBaseShare(editBaseId, shareId).catch(() => undefined);
      }
      createdShareIds.length = 0;
    });

    it('should enforce allowEdit/allowSave mutual exclusivity on update', async () => {
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowSave: true });

      // Switch to allowEdit
      const updated = await updateBaseShare(editBaseId, share.data.shareId, {
        allowEdit: true,
      });
      expect(updated.data.allowEdit).toBe(true);
      expect(updated.data.allowSave).toBe(false);
    });

    it('should create fresh share after soft-deleted share is removed', async () => {
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowEdit: true, allowCopy: true });

      // Soft-delete it
      await deleteBaseShare(editBaseId, share.data.shareId);

      // Re-create with same nodeId — should create a fresh share with default settings
      const fresh = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(fresh.data.shareId);
      expect(fresh.data.enabled).toBe(true);
      expect(fresh.data.shareId).not.toEqual(share.data.shareId);
      expect(fresh.data.allowEdit).toBeNull();
      expect(fresh.data.allowCopy).toBeNull();
    });

    it('should grant editor-level permissions to logged-in user with allowEdit', async () => {
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowEdit: true });

      const permRes = await loggedInUser.get<ITablePermissionVo>(
        urlBuilder(GET_TABLE_PERMISSION, { baseId: editBaseId, tableId: editTableId }),
        { headers: { [BASE_SHARE_ID_HEADER]: share.data.shareId } }
      );
      expect(permRes.status).toEqual(200);
      // Editor-level: can create/update/delete records
      expect(permRes.data.record['record|create']).toBe(true);
      expect(permRes.data.record['record|update']).toBe(true);
      expect(permRes.data.record['record|delete']).toBe(true);
      // Excluded: view|share must be denied
      expect(permRes.data.view['view|share']).toBeFalsy();
    });

    it('should only grant read-only permissions to anonymous user even with allowEdit', async () => {
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowEdit: true });

      const permRes = await anonymousUser.get<ITablePermissionVo>(
        urlBuilder(GET_TABLE_PERMISSION, { baseId: editBaseId, tableId: editTableId }),
        { headers: { [BASE_SHARE_ID_HEADER]: share.data.shareId } }
      );
      expect(permRes.status).toEqual(200);
      // Anonymous user should NOT have write permissions
      expect(permRes.data.record['record|create']).toBeFalsy();
      expect(permRes.data.record['record|update']).toBeFalsy();
      expect(permRes.data.record['record|delete']).toBeFalsy();
    });

    it('should allow logged-in user to create records via allowEdit share', async () => {
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowEdit: true });

      const fields = await getFields(editTableId);
      const firstField = fields.data[0];

      const createRes = await loggedInUser.post(
        urlBuilder(CREATE_RECORD, { tableId: editTableId }),
        { records: [{ fields: { [firstField.id]: 'share-edit-test' } }], fieldKeyType: 'id' },
        { headers: { [BASE_SHARE_ID_HEADER]: share.data.shareId } }
      );
      expect(createRes.status).toEqual(201);
      expect(createRes.data.records).toHaveLength(1);

      const recordId = createRes.data.records[0].id;

      // Update the record
      const updateRes = await loggedInUser.patch(
        urlBuilder(UPDATE_RECORD, { tableId: editTableId, recordId }),
        { record: { fields: { [firstField.id]: 'updated-via-share' } }, fieldKeyType: 'id' },
        { headers: { [BASE_SHARE_ID_HEADER]: share.data.shareId } }
      );
      expect(updateRes.status).toEqual(200);

      // Delete the record
      const deleteRes = await loggedInUser.delete(
        urlBuilder(DELETE_RECORD_URL, { tableId: editTableId, recordId }),
        { headers: { [BASE_SHARE_ID_HEADER]: share.data.shareId } }
      );
      expect(deleteRes.status).toEqual(200);
    });

    it('should deny anonymous user record creation even with allowEdit', async () => {
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowEdit: true });

      const fields = await getFields(editTableId);
      const firstField = fields.data[0];

      const error = await getError(() =>
        anonymousUser.post(
          urlBuilder(CREATE_RECORD, { tableId: editTableId }),
          { records: [{ fields: { [firstField.id]: 'should-fail' } }], fieldKeyType: 'id' },
          { headers: { [BASE_SHARE_ID_HEADER]: share.data.shareId } }
        )
      );
      expect(error?.status).toEqual(403);
    });

    it('should cap permissions at share level even for base owner', async () => {
      // The default test user is the base owner
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowEdit: true });

      // Access via share header — should get editor-level, not owner-level
      const permRes = await loggedInUser.get<ITablePermissionVo>(
        urlBuilder(GET_TABLE_PERMISSION, { baseId: editBaseId, tableId: editTableId }),
        { headers: { [BASE_SHARE_ID_HEADER]: share.data.shareId } }
      );
      expect(permRes.status).toEqual(200);
      // view|share is excluded from share permissions, even though owner normally has it
      expect(permRes.data.view['view|share']).toBeFalsy();
    });

    it('should include allowEdit in shareMeta via public API', async () => {
      const share = await createBaseShare(editBaseId, { nodeId: editTableNodeId });
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(editBaseId, share.data.shareId, { allowEdit: true });

      const res = await anonymousUser.get<IGetBaseShareVo>(
        urlBuilder(GET_BASE_SHARE, { shareId: share.data.shareId })
      );
      expect(res.status).toEqual(200);
      expect(res.data.shareMeta.allowEdit).toBe(true);
    });
  });

  describe('Whole Base Share', () => {
    const createdShareIds: string[] = [];

    afterEach(async () => {
      for (const shareId of createdShareIds) {
        await deleteBaseShare(baseId, shareId).catch(() => undefined);
      }
      createdShareIds.length = 0;
    });

    it('should create whole-base share (no nodeId)', async () => {
      const res = await createBaseShare(baseId, {});
      createdShareIds.push(res.data.shareId);
      expect(res.status).toEqual(201);
      expect(res.data.baseId).toEqual(baseId);
      expect(res.data.shareId).toBeDefined();
      expect(res.data.nodeId).toBeNull();
      expect(res.data.enabled).toBe(true);
    });

    it('should prevent duplicate whole-base share', async () => {
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);

      const error = await getError(() => createBaseShare(baseId, {}));
      expect(error?.status).toEqual(409);
    });

    it('should get base-level share via /node endpoint (no nodeId)', async () => {
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);

      const res = await getBaseLevelShare(baseId);
      expect(res.status).toEqual(200);
      expect(res.data).not.toBeNull();
      expect(res.data!.shareId).toEqual(share.data.shareId);
      expect(res.data!.nodeId).toBeNull();
    });

    it('should include whole-base share in list with nodeId null', async () => {
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);

      const res = await listBaseShare(baseId);
      expect(res.status).toEqual(200);
      const baseShareEntry = res.data.find((s) => s.nodeId === null);
      expect(baseShareEntry).toBeDefined();
    });

    it('should return valid defaultUrl for whole-base share via public API', async () => {
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);

      const res = await anonymousUser.get<IGetBaseShareVo>(
        urlBuilder(GET_BASE_SHARE, { shareId: share.data.shareId })
      );
      expect(res.status).toEqual(200);
      expect(res.data.shareMeta.nodeId).toBeNull();
      expect(res.data.defaultUrl).toBeDefined();
      // Should point to first table in base
      expect(res.data.defaultUrl).toContain(`/base/${baseId}/table/`);
    });

    it('should allow allowEdit for whole-base share', async () => {
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);
      const updated = await updateBaseShare(baseId, share.data.shareId, { allowEdit: true });
      expect(updated.data.allowEdit).toBe(true);
      expect(updated.data.allowSave).toBe(false);
    });

    it('should update whole-base share settings', async () => {
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);

      const updateRes = await updateBaseShare(baseId, share.data.shareId, {
        allowCopy: true,
        allowEdit: true,
      });
      expect(updateRes.status).toEqual(200);
      expect(updateRes.data.allowCopy).toBe(true);
      expect(updateRes.data.allowEdit).toBe(true);
    });

    it('should delete (soft) whole-base share', async () => {
      const share = await createBaseShare(baseId, {});
      const shareId = share.data.shareId;

      await deleteBaseShare(baseId, shareId);

      const res = await getBaseLevelShare(baseId);
      expect(res.data).toBeFalsy();
    });

    it('should coexist with node-level shares', async () => {
      // Create both whole-base and node-level shares
      const baseShare = await createBaseShare(baseId, {});
      createdShareIds.push(baseShare.data.shareId);

      const nodeShare = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      createdShareIds.push(nodeShare.data.shareId);
      // Both should work independently
      const list = await listBaseShare(baseId);
      expect(list.data.length).toBeGreaterThanOrEqual(2);

      const baseShareRes = await anonymousUser.get<IGetBaseShareVo>(
        urlBuilder(GET_BASE_SHARE, { shareId: baseShare.data.shareId })
      );
      expect(baseShareRes.status).toEqual(200);
      expect(baseShareRes.data.shareMeta.nodeId).toBeNull();

      const nodeRes = await anonymousUser.get<IGetBaseShareVo>(
        urlBuilder(GET_BASE_SHARE, { shareId: nodeShare.data.shareId })
      );
      expect(nodeRes.status).toEqual(200);
      expect(nodeRes.data.shareMeta.nodeId).toEqual(rootTableNodeId);
    });

    it('should support password protection for whole-base share', async () => {
      const password = 'wholebase123';
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);
      await updateBaseShare(baseId, share.data.shareId, { password });

      // Access without password should fail
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(GET_BASE_SHARE, { shareId: share.data.shareId }))
      );
      expect(error?.status).toEqual(401);

      // Auth with correct password should work
      const authRes = await anonymousUser.post(
        urlBuilder(BASE_SHARE_AUTH, { shareId: share.data.shareId }),
        { password }
      );
      expect(authRes.status).toEqual(200);
      expect(authRes.data.token).toBeDefined();
    });

    it('should show all nodes in base via share header for whole-base share', async () => {
      const share = await createBaseShare(baseId, {});
      createdShareIds.push(share.data.shareId);

      const listRes = await anonymousUser.get<IBaseNodeVo[]>(
        urlBuilder(GET_BASE_NODE_LIST, { baseId }),
        {
          headers: {
            [BASE_SHARE_ID_HEADER]: share.data.shareId,
          },
        }
      );
      expect(listRes.status).toEqual(200);
      const nodeIds = new Set(listRes.data.map((n: IBaseNodeVo) => n.id));
      // Both root table and folder should be visible
      expect(nodeIds.has(rootTableNodeId)).toBe(true);
      expect(nodeIds.has(folderNodeId)).toBe(true);
      expect(nodeIds.has(childTableNodeId)).toBe(true);
    });

    it('should copy whole-base share with all tables', async () => {
      const space = await createSpace({ name: 'whole-base-copy-space' });
      let copiedBaseId: string | undefined;

      try {
        const share = await createBaseShare(baseId, {});
        createdShareIds.push(share.data.shareId);
        await updateBaseShare(baseId, share.data.shareId, { allowSave: true });

        const copyRes = await copyBaseShare(share.data.shareId, {
          spaceId: space.data.id,
          name: 'copied-whole-base',
          withRecords: true,
        });

        expect(copyRes.status).toEqual(200);
        copiedBaseId = copyRes.data.id;

        // Verify all tables from the original base are copied
        const tableList = await getTableList(copiedBaseId);
        const tableNames = tableList.data.map((t) => t.name).sort();
        expect(tableNames).toContain('root-table');
        expect(tableNames).toContain('child-table');
      } finally {
        if (copiedBaseId) await permanentDeleteBase(copiedBaseId);
        await deleteSpace(space.data.id);
      }
    });

    it('should reject copy of whole-base share when allowSave is false', async () => {
      const space = await createSpace({ name: 'whole-base-copy-reject-space' });

      try {
        const share = await createBaseShare(baseId, {});
        createdShareIds.push(share.data.shareId);

        const error = await getError(() =>
          copyBaseShare(share.data.shareId, {
            spaceId: space.data.id,
            name: 'should-not-copy',
            withRecords: false,
          })
        );
        expect(error?.status).toEqual(403);
      } finally {
        await deleteSpace(space.data.id);
      }
    });
  });

  describe('BaseShare - User-scoped endpoints with share header', () => {
    let shareId: string;
    let loggedInUser: AxiosInstance;
    let userSpaceId: string;

    beforeAll(async () => {
      const share = await createBaseShare(baseId, { nodeId: rootTableNodeId });
      shareId = share.data.shareId;

      loggedInUser = await createNewUserAxios({
        email: 'share-user-scoped-e2e@test.com',
        password: 'TestPassword123!',
      });

      // Create a space owned by the logged-in user
      const space = await loggedInUser.post<{ id: string; name: string }>('/space', {
        name: 'user-scoped-test-space',
      });
      userSpaceId = space.data.id;
    });

    afterAll(async () => {
      await deleteBaseShare(baseId, shareId).catch(() => undefined);
      await loggedInUser.delete(`/space/${userSpaceId}`).catch(() => undefined);
    });

    it('should allow logged-in user to list spaces with share header', async () => {
      const res = await loggedInUser.get('/space', {
        headers: { [BASE_SHARE_ID_HEADER]: shareId },
      });
      expect(res.status).toEqual(200);
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThan(0);
    });

    it('should allow logged-in user to list bases in space with share header', async () => {
      const res = await loggedInUser.get(`/space/${userSpaceId}/base`, {
        headers: { [BASE_SHARE_ID_HEADER]: shareId },
      });
      expect(res.status).toEqual(200);
      expect(Array.isArray(res.data)).toBe(true);
    });

    it('should allow logged-in user to create space with share header', async () => {
      const res = await loggedInUser.post(
        '/space',
        { name: 'created-with-share-header' },
        { headers: { [BASE_SHARE_ID_HEADER]: shareId } }
      );
      expect(res.status).toEqual(201);
      // Clean up
      await loggedInUser.delete(`/space/${res.data.id}`).catch(() => undefined);
    });

    it('should allow copy base share when spaceId in body triggers PermissionGuard', async () => {
      // The copy endpoint has @ResourceMeta('spaceId', 'body') + @Permissions('base|create').
      // PermissionGuard must skip share check for space-scoped resourceId,
      // otherwise the spaceId gets rejected as "not accessible via share".
      const allowSaveShare = await createBaseShare(baseId, { nodeId: folderNodeId });
      await updateBaseShare(baseId, allowSaveShare.data.shareId, { allowSave: true });
      let copiedBaseId: string | undefined;

      try {
        // Use loggedInUser's axios to copy into their own space
        const copyRes = await loggedInUser.post(
          urlBuilder(COPY_BASE_SHARE, { shareId: allowSaveShare.data.shareId }),
          { spaceId: userSpaceId, name: 'copy-with-share-header', withRecords: false }
        );
        expect(copyRes.status).toEqual(200);
        copiedBaseId = copyRes.data.id;
      } finally {
        if (copiedBaseId) {
          await loggedInUser.delete(`/base/${copiedBaseId}/permanent`).catch(() => undefined);
        }
        await deleteBaseShare(baseId, allowSaveShare.data.shareId).catch(() => undefined);
      }
    });
  });
});
