/* eslint-disable sonarjs/no-duplicate-string */
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { generateAttachmentId, getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  createBase,
  createSpace,
  deleteBase,
  getSignature,
  notify,
  publishBase,
  uploadFile,
  UploadType,
} from '@teable/openapi';
import type { ITemplateCoverRo } from '@teable/openapi';
import { ATTACHMENT_LG_THUMBNAIL_HEIGHT } from '../src/features/attachments/constant';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { deleteSpace, initApp } from './utils/init-app';

describe('Template Cover Crop (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let spaceId: string;
  let baseId: string;

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    prismaService = app.get(PrismaService);

    // Create a space for testing
    const spaceData = await createSpace({
      name: 'Template Cover Crop Test Space',
    });
    spaceId = spaceData.data.id;
  });

  afterAll(async () => {
    await deleteSpace(spaceId);
  });

  beforeEach(async () => {
    // Create a base for testing
    const { id } = (
      await createBase({
        name: 'Template Cover Crop Test Base',
        spaceId,
      })
    ).data;
    baseId = id;
  });

  afterEach(async () => {
    // Clean up templates
    const tx = prismaService.txClient();
    await tx.template.deleteMany({
      where: { baseId },
    });
    await deleteBase(baseId);
  });

  /**
   * Helper function to upload an image to Template bucket
   */
  async function uploadTemplateCoverImage(imageHeight: number) {
    // Create an SVG image with the specified height
    // SVG is easy to create with specific dimensions
    const imageWidth = Math.round(imageHeight * 1.5); // 3:2 aspect ratio
    const imagePath = path.join(
      StorageAdapter.TEMPORARY_DIR,
      `template-cover-${getRandomString(8)}.svg`
    );

    const svgContent = `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#4a90d9"/>
  <circle cx="${imageWidth / 2}" cy="${imageHeight / 2}" r="${Math.min(imageWidth, imageHeight) / 4}" fill="#ffffff"/>
  <text x="${imageWidth / 2}" y="${imageHeight / 2}" font-size="24" text-anchor="middle" fill="#333">${imageWidth}x${imageHeight}</text>
</svg>`;

    fs.writeFileSync(imagePath, svgContent);

    try {
      const stats = fs.statSync(imagePath);

      // Get upload signature
      const signatureResult = await getSignature({
        type: UploadType.Template,
        contentType: 'image/svg+xml',
        contentLength: stats.size,
      });

      const { token, requestHeaders } = signatureResult.data;

      // Upload the file
      const fileStream = fs.createReadStream(imagePath);
      await uploadFile(token, fileStream, requestHeaders);

      // Notify to get file info
      const notifyResult = await notify(token, undefined, `cover-${imageHeight}.svg`);

      return {
        token,
        notifyData: notifyResult.data,
      };
    } finally {
      // Clean up temp file
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
  }

  describe('cropTemplateCoverImage', () => {
    it('should generate thumbnails when cover image height > ATTACHMENT_LG_THUMBNAIL_HEIGHT', async () => {
      // Upload an image taller than the threshold (525px)
      const largeImageHeight = ATTACHMENT_LG_THUMBNAIL_HEIGHT + 200; // 725px
      const { notifyData } = await uploadTemplateCoverImage(largeImageHeight);

      // Prepare cover data
      const cover: ITemplateCoverRo = {
        id: generateAttachmentId(),
        name: `cover-${largeImageHeight}.svg`,
        token: notifyData.token,
        size: notifyData.size,
        url: notifyData.url,
        path: notifyData.path,
        mimetype: notifyData.mimetype,
        width: notifyData.width,
        height: notifyData.height,
      };

      // Publish base with cover
      const result = await publishBase(baseId, {
        title: 'Test Template with Large Cover',
        description: 'Testing crop template cover image',
        cover,
      });

      expect(result.status).toBe(201);

      // Verify the template has thumbnail paths in cover
      const template = await prismaService.txClient().template.findFirst({
        where: { baseId },
        select: { cover: true },
      });

      expect(template).toBeDefined();
      expect(template?.cover).toBeDefined();

      const savedCover = JSON.parse(template!.cover as string) as ITemplateCoverRo;
      expect(savedCover.thumbnailPath).toBeDefined();
      expect(savedCover.thumbnailPath?.lg).toBeDefined();
      expect(savedCover.thumbnailPath?.sm).toBeDefined();
      expect(savedCover.thumbnailPath?.lg).toContain('_lg');
      expect(savedCover.thumbnailPath?.sm).toContain('_sm');
    });

    it('should NOT generate thumbnails when cover image height <= ATTACHMENT_LG_THUMBNAIL_HEIGHT', async () => {
      // Upload a small image (below threshold)
      const smallImageHeight = ATTACHMENT_LG_THUMBNAIL_HEIGHT - 100; // 425px
      const { notifyData } = await uploadTemplateCoverImage(smallImageHeight);

      // Prepare cover data
      const cover: ITemplateCoverRo = {
        id: generateAttachmentId(),
        name: `cover-${smallImageHeight}.svg`,
        token: notifyData.token,
        size: notifyData.size,
        url: notifyData.url,
        path: notifyData.path,
        mimetype: notifyData.mimetype,
        width: notifyData.width,
        height: notifyData.height,
      };

      // Publish base with cover
      const result = await publishBase(baseId, {
        title: 'Test Template with Small Cover',
        description: 'Testing crop template cover image with small image',
        cover,
      });

      expect(result.status).toBe(201);

      // Verify the template does NOT have thumbnail paths (image too small)
      const template = await prismaService.txClient().template.findFirst({
        where: { baseId },
        select: { cover: true },
      });

      expect(template).toBeDefined();
      expect(template?.cover).toBeDefined();

      const savedCover = JSON.parse(template!.cover as string) as ITemplateCoverRo;
      // thumbnailPath should be undefined because image height <= threshold
      expect(savedCover.thumbnailPath).toBeUndefined();
    });

    it('should NOT generate thumbnails when cover has no height info', async () => {
      // Upload an image but manually remove height info
      const imageHeight = ATTACHMENT_LG_THUMBNAIL_HEIGHT + 200;
      const { notifyData } = await uploadTemplateCoverImage(imageHeight);

      // Prepare cover data WITHOUT height
      const cover: ITemplateCoverRo = {
        id: generateAttachmentId(),
        name: `cover-no-height.svg`,
        token: notifyData.token,
        size: notifyData.size,
        url: notifyData.url,
        path: notifyData.path,
        mimetype: notifyData.mimetype,
        width: notifyData.width,
        // height intentionally omitted
      };

      // Publish base with cover
      const result = await publishBase(baseId, {
        title: 'Test Template without Height Info',
        description: 'Testing crop template cover image without height',
        cover,
      });

      expect(result.status).toBe(201);

      // Verify the template does NOT have thumbnail paths (no height info)
      const template = await prismaService.txClient().template.findFirst({
        where: { baseId },
        select: { cover: true },
      });

      expect(template).toBeDefined();
      expect(template?.cover).toBeDefined();

      const savedCover = JSON.parse(template!.cover as string) as ITemplateCoverRo;
      expect(savedCover.thumbnailPath).toBeUndefined();
    });

    it('should NOT generate thumbnails for non-image mimetype', async () => {
      // Create a non-image file
      const filePath = path.join(StorageAdapter.TEMPORARY_DIR, `template-cover-text.txt`);
      fs.writeFileSync(filePath, 'This is not an image');

      try {
        const stats = fs.statSync(filePath);

        // Get upload signature
        const signatureResult = await getSignature({
          type: UploadType.Template,
          contentType: 'text/plain',
          contentLength: stats.size,
        });

        const { token, requestHeaders } = signatureResult.data;

        // Upload the file
        const fileStream = fs.createReadStream(filePath);
        await uploadFile(token, fileStream, requestHeaders);

        // Notify to get file info
        const notifyResult = await notify(token, undefined, 'cover.txt');

        // Prepare cover data with non-image mimetype
        const cover: ITemplateCoverRo = {
          id: generateAttachmentId(),
          name: 'cover.txt',
          token: notifyResult.data.token,
          size: notifyResult.data.size,
          url: notifyResult.data.url,
          path: notifyResult.data.path,
          mimetype: notifyResult.data.mimetype, // text/plain
          width: 1000, // Fake dimensions
          height: 1000,
        };

        // Publish base with non-image cover
        const result = await publishBase(baseId, {
          title: 'Test Template with Non-Image Cover',
          description: 'Testing crop template cover image with non-image file',
          cover,
        });

        expect(result.status).toBe(201);

        // Verify the template does NOT have thumbnail paths (not an image)
        const template = await prismaService.txClient().template.findFirst({
          where: { baseId },
          select: { cover: true },
        });

        expect(template).toBeDefined();
        expect(template?.cover).toBeDefined();

        const savedCover = JSON.parse(template!.cover as string) as ITemplateCoverRo;
        expect(savedCover.thumbnailPath).toBeUndefined();
      } finally {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });

    it('should update thumbnails when republishing with new cover', async () => {
      // First publish with a large image
      const firstImageHeight = ATTACHMENT_LG_THUMBNAIL_HEIGHT + 100;
      const { notifyData: firstNotifyData } = await uploadTemplateCoverImage(firstImageHeight);

      const firstCover: ITemplateCoverRo = {
        id: generateAttachmentId(),
        name: `cover-first.svg`,
        token: firstNotifyData.token,
        size: firstNotifyData.size,
        url: firstNotifyData.url,
        path: firstNotifyData.path,
        mimetype: firstNotifyData.mimetype,
        width: firstNotifyData.width,
        height: firstNotifyData.height,
      };

      await publishBase(baseId, {
        title: 'Test Template First Publish',
        description: 'First publish',
        cover: firstCover,
      });

      // Get first template's thumbnail paths
      const firstTemplate = await prismaService.txClient().template.findFirst({
        where: { baseId },
        select: { cover: true },
      });
      const firstSavedCover = JSON.parse(firstTemplate!.cover as string) as ITemplateCoverRo;
      const firstThumbnailPaths = firstSavedCover.thumbnailPath;

      expect(firstThumbnailPaths).toBeDefined();

      // Republish with a different large image
      const secondImageHeight = ATTACHMENT_LG_THUMBNAIL_HEIGHT + 300;
      const { notifyData: secondNotifyData } = await uploadTemplateCoverImage(secondImageHeight);

      const secondCover: ITemplateCoverRo = {
        id: generateAttachmentId(),
        name: `cover-second.svg`,
        token: secondNotifyData.token,
        size: secondNotifyData.size,
        url: secondNotifyData.url,
        path: secondNotifyData.path,
        mimetype: secondNotifyData.mimetype,
        width: secondNotifyData.width,
        height: secondNotifyData.height,
      };

      await publishBase(baseId, {
        title: 'Test Template Second Publish',
        description: 'Second publish',
        cover: secondCover,
      });

      // Verify the template has NEW thumbnail paths
      const secondTemplate = await prismaService.txClient().template.findFirst({
        where: { baseId },
        select: { cover: true },
      });

      const secondSavedCover = JSON.parse(secondTemplate!.cover as string) as ITemplateCoverRo;
      expect(secondSavedCover.thumbnailPath).toBeDefined();
      expect(secondSavedCover.thumbnailPath?.lg).toBeDefined();
      expect(secondSavedCover.thumbnailPath?.sm).toBeDefined();

      // Thumbnail paths should be different from the first publish
      expect(secondSavedCover.thumbnailPath?.lg).not.toBe(firstThumbnailPaths?.lg);
      expect(secondSavedCover.thumbnailPath?.sm).not.toBe(firstThumbnailPaths?.sm);
    });

    it('should publish without cover successfully', async () => {
      // Publish base without cover
      const result = await publishBase(baseId, {
        title: 'Test Template without Cover',
        description: 'Testing publish without cover',
      });

      expect(result.status).toBe(201);

      // Verify the template has no cover
      const template = await prismaService.txClient().template.findFirst({
        where: { baseId },
        select: { cover: true },
      });

      expect(template).toBeDefined();
      expect(template?.cover).toBeNull();
    });
  });
});
