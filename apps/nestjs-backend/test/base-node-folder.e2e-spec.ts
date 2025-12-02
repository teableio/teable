/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  createBaseNodeFolder,
  updateBaseNodeFolder,
  deleteBaseNodeFolder,
  createBaseNode,
  BaseNodeResourceType,
  deleteBaseNode,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

describe('BaseNodeFolderController (e2e) /api/base/:baseId/node/folder', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const folderNameToDelete = 'Folder To Delete';
  const whitespaceOnlyName = '   ';
  const originalFolderName = 'Original Folder';
  let prisma: PrismaService;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/base/:baseId/node/folder - Create folder', () => {
    it('should create a folder successfully', async () => {
      const ro = { name: 'Test Folder' };
      const response = await createBaseNodeFolder(baseId, ro);

      expect(response.data).toBeDefined();
      expect(response.data.name).toContain('Test Folder');
      expect(response.data.id).toBeDefined();

      // Cleanup
      await deleteBaseNodeFolder(baseId, response.data.id);
    });

    it('should create multiple folders with same name (auto unique)', async () => {
      const ro = { name: 'Duplicate Folder' };
      const response1 = await createBaseNodeFolder(baseId, ro);
      const response2 = await createBaseNodeFolder(baseId, ro);

      expect(response1.data.name).toContain('Duplicate Folder');
      expect(response2.data.name).toContain('Duplicate Folder');
      expect(response1.data.name).not.toBe(response2.data.name);
      expect(response1.data.id).not.toBe(response2.data.id);

      // Cleanup
      await deleteBaseNodeFolder(baseId, response1.data.id);
      await deleteBaseNodeFolder(baseId, response2.data.id);
    });

    it('should trim folder name', async () => {
      const ro = { name: '  Trimmed Folder  ' };
      const response = await createBaseNodeFolder(baseId, ro);

      expect(response.data.name).toContain('Trimmed Folder');

      // Cleanup
      await deleteBaseNodeFolder(baseId, response.data.id);
    });

    it('should fail with empty name', async () => {
      const ro = { name: '' };
      const error = await getError(() => createBaseNodeFolder(baseId, ro));

      expect(error?.status).toBe(400);
    });

    it('should fail with whitespace only name', async () => {
      const ro = { name: whitespaceOnlyName };
      const error = await getError(() => createBaseNodeFolder(baseId, ro));

      expect(error?.status).toBe(400);
    });
  });

  describe('PATCH /api/base/:baseId/node/folder/:folderId - Update folder', () => {
    let folderId: string;

    beforeEach(async () => {
      const response = await createBaseNodeFolder(baseId, { name: originalFolderName });
      folderId = response.data.id;
    });

    afterEach(async () => {
      try {
        await deleteBaseNodeFolder(baseId, folderId);
      } catch (e) {
        // Folder might already be deleted in some tests
      }
    });

    it('should rename folder successfully', async () => {
      const updateRo = { name: 'Renamed Folder' };
      const response = await updateBaseNodeFolder(baseId, folderId, updateRo);

      expect(response.data).toBeDefined();
      expect(response.data.name).toBe('Renamed Folder');
      expect(response.data.id).toBe(folderId);
    });

    it('should trim folder name when renaming', async () => {
      const updateRo = { name: '  Trimmed Renamed  ' };
      const response = await updateBaseNodeFolder(baseId, folderId, updateRo);

      expect(response.data.name).toBe('Trimmed Renamed');
    });

    it('should fail when renaming to existing folder name', async () => {
      // Create another folder
      const anotherFolder = await createBaseNodeFolder(baseId, { name: 'Existing Folder' });

      // Try to rename original folder to existing name
      const updateRo = { name: 'Existing Folder' };
      const error = await getError(() => updateBaseNodeFolder(baseId, folderId, updateRo));

      expect(error?.status).toBe(400);
      expect(error?.message).toContain('Folder name already exists');

      // Cleanup
      await deleteBaseNodeFolder(baseId, anotherFolder.data.id);
    });

    it('should allow renaming folder to same name', async () => {
      const updateRo = { name: originalFolderName };
      const response = await updateBaseNodeFolder(baseId, folderId, updateRo);

      expect(response.data.name).toBe(originalFolderName);
    });

    it('should fail with empty name', async () => {
      const updateRo = { name: '' };
      const error = await getError(() => updateBaseNodeFolder(baseId, folderId, updateRo));

      expect(error?.status).toBe(400);
    });

    it('should fail with whitespace only name', async () => {
      const updateRo = { name: whitespaceOnlyName };
      const error = await getError(() => updateBaseNodeFolder(baseId, folderId, updateRo));

      expect(error?.status).toBe(400);
    });

    it('should fail when updating non-existent folder', async () => {
      const nonExistentId = 'non-existent-folder-id';
      const updateRo = { name: 'New Name' };
      const error = await getError(() => updateBaseNodeFolder(baseId, nonExistentId, updateRo));

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('DELETE /api/base/:baseId/node/folder/:folderId - Delete folder', () => {
    it('should delete empty folder successfully', async () => {
      // Create a folder
      const folder = await createBaseNodeFolder(baseId, { name: folderNameToDelete });
      const folderId = folder.data.id;

      const findFolder = await prisma.baseNodeFolder.findFirst({
        where: { id: folderId },
      });
      expect(findFolder).toBeDefined();

      // Delete the folder
      await deleteBaseNodeFolder(baseId, folderId);

      const findFolderAfterDelete = await prisma.baseNodeFolder.findFirst({
        where: { id: folderId },
      });
      expect(findFolderAfterDelete).toBeNull();

      // Verify folder is deleted
      const error = await getError(() => deleteBaseNodeFolder(baseId, folderId));
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should fail when deleting folder with children', async () => {
      // Create a parent folder
      const parentFolder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: 'Parent Folder',
      }).then((res) => res.data);

      // Create a child folder inside the parent folder using createBaseNode
      const childFolder = await createBaseNode(baseId, {
        resourceType: BaseNodeResourceType.Folder,
        parentId: parentFolder.id,
        name: 'Child Folder',
      }).then((res) => res.data);

      // Try to delete the parent folder
      const error = await getError(() => deleteBaseNode(baseId, parentFolder.id));

      expect(error?.status).toBe(400);
      expect(error?.message).toContain('Cannot delete folder because it is not empty');

      // Cleanup - need to delete the folder manually after removing children
      await deleteBaseNode(baseId, childFolder.id);
      await deleteBaseNode(baseId, parentFolder.id);

      const findFolderAfterDelete = await prisma.baseNodeFolder.findFirst({
        where: { id: { in: [parentFolder.id, childFolder.id] } },
      });
      expect(findFolderAfterDelete).toBeNull();
    });

    it('should fail when deleting non-existent folder', async () => {
      const nonExistentId = 'non-existent-folder-id';
      const error = await getError(() => deleteBaseNodeFolder(baseId, nonExistentId));

      expect(error?.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle deletion of already deleted folder', async () => {
      // Create and delete a folder
      const folder = await createBaseNodeFolder(baseId, { name: 'Temp Folder' });
      const folderId = folder.data.id;
      await deleteBaseNodeFolder(baseId, folderId);

      // Try to delete again
      const error = await getError(() => deleteBaseNodeFolder(baseId, folderId));
      expect(error?.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Integration tests', () => {
    it('should create, update and delete folder in sequence', async () => {
      // Create
      const createResponse = await createBaseNodeFolder(baseId, { name: 'Integration Folder' });
      expect(createResponse.data.name).toContain('Integration Folder');
      const folderId = createResponse.data.id;

      // Update
      const newName = getRandomString(10);
      const updateResponse = await updateBaseNodeFolder(baseId, folderId, {
        name: newName,
      });
      expect(updateResponse.data.name).toContain(newName);

      // Delete
      await deleteBaseNodeFolder(baseId, folderId);

      const findFolderAfterDelete = await prisma.baseNodeFolder.findFirst({
        where: { id: folderId },
      });
      expect(findFolderAfterDelete).toBeNull();
    });
  });
});
