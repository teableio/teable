import { join, resolve, extname } from 'path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTOMATION_ROBOT_ID, APP_ROBOT_ID, ANONYMOUS_USER_ID } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { createReadStream, stat } from 'fs-extra';
import mime from 'mime-types';
import sharp from 'sharp';
import { CacheService } from '../../cache/cache.service';
import type { ICacheConfig } from '../../configs/cache.config';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';

/**
 * Built-in assets configuration interface
 */
export interface IBuiltinAssetConfig {
  /**
   * Unique identifier for the asset (e.g., 'automation-robot', 'chart-logo')
   */
  id: string;
  /**
   * Path to the source file relative to process.cwd()
   */
  filePath: string;
  /**
   * Upload type (determines bucket and directory)
   */
  uploadType: UploadType;
}

/**
 * Lock configuration
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const LOCK_KEY = 'lock:builtin-assets-init' as const;
// eslint-disable-next-line @typescript-eslint/naming-convention
const LOCK_TTL = 300; // 5 minutes

/**
 * Static asset paths
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const AUTOMATION_ROBOT_AVATAR_PATH = 'static/system/automation-robot.png';
// eslint-disable-next-line @typescript-eslint/naming-convention
const ANONYMOUS_USER_AVATAR_PATH = 'static/system/anonymous.png';
// eslint-disable-next-line @typescript-eslint/naming-convention
const EMAIL_LOGO_PATH = 'static/system/email-logo.png';
// eslint-disable-next-line @typescript-eslint/naming-convention
export const EMAIL_LOGO_TOKEN = 'email-logo';

/**
 * BuiltinAssetsInitService
 *
 * Unified service for initializing built-in assets (logos, avatars, etc.)
 * - Acquires Redis lock to ensure only one instance runs initialization
 * - Falls back to running without lock if Redis is not available
 * - Designed to be extended by EE version for additional assets
 *
 * This service consolidates all built-in asset uploads from:
 * - UserInitService (system user avatars)
 * - And any additional assets added by EE version
 */
@Injectable()
export class BuiltinAssetsInitService implements OnModuleInit {
  protected readonly logger = new Logger(BuiltinAssetsInitService.name);
  private lockValue: string;

  constructor(
    protected readonly prismaService: PrismaService,
    @InjectStorageAdapter() protected readonly storageAdapter: StorageAdapter,
    protected readonly cacheService: CacheService,
    protected readonly configService: ConfigService
  ) {
    // Generate unique lock value per instance
    this.lockValue = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      this.logger.debug('Skipping builtin assets initialization in test environment');
      return;
    }

    // Run initialization in background to avoid blocking app startup
    setImmediate(() => {
      this.runInitialization().catch((error) => {
        this.logger.error('Builtin assets initialization failed', error);
      });
    });
  }

  /**
   * Run the initialization process with distributed lock
   */
  private async runInitialization(): Promise<void> {
    const hasLock = await this.tryAcquireLock();
    if (!hasLock) {
      this.logger.log('Another instance is handling builtin assets initialization, skipping...');
      return;
    }

    try {
      this.logger.log('Starting builtin assets initialization...');
      await this.initializeAssets();
      this.logger.log('Builtin assets initialization completed');
    } finally {
      await this.releaseLock();
    }
  }

  onModuleDestroy() {
    this.releaseLock().catch((error) => {
      this.logger.error('Failed to release lock on module destroy', error);
    });
  }

  /**
   * Try to acquire a distributed lock using Redis
   * Returns true if lock acquired or Redis is not available (fallback to run)
   */
  protected async tryAcquireLock(): Promise<boolean> {
    const cacheProvider = this.configService.get<ICacheConfig>('cache')?.provider;

    // If not using Redis, skip lock and allow execution
    if (cacheProvider !== 'redis') {
      this.logger.debug('Redis not available, proceeding without distributed lock');
      return true;
    }

    try {
      // Use atomic setnx operation to acquire lock
      const acquired = await this.cacheService.setnx(LOCK_KEY, this.lockValue, LOCK_TTL);

      if (acquired) {
        this.logger.debug('Acquired distributed lock for builtin assets initialization');
        return true;
      }

      return false;
    } catch (error) {
      // If Redis fails, proceed without lock
      this.logger.warn('Failed to acquire Redis lock, proceeding anyway', error);
      return true;
    }
  }

  /**
   * Release the distributed lock
   */
  protected async releaseLock(): Promise<void> {
    const cacheProvider = this.configService.get<ICacheConfig>('cache')?.provider;

    if (cacheProvider !== 'redis') {
      return;
    }

    try {
      // Only delete if we own the lock
      const currentLock = await this.cacheService.get(LOCK_KEY);
      if (currentLock === this.lockValue) {
        await this.cacheService.del(LOCK_KEY);
        this.logger.debug('Released distributed lock');
      }
    } catch (error) {
      this.logger.warn('Failed to release Redis lock', error);
    }
  }

  /**
   * Main initialization method - override in subclass to add more initialization logic
   */
  protected async initializeAssets(): Promise<void> {
    const assets = this.getBuiltinAssets();

    for (const asset of assets) {
      try {
        await this.uploadBuiltinAsset(asset);
      } catch (error) {
        this.logger.error(`Failed to upload builtin asset: ${asset.id}`, error);
        // Continue with other assets
      }
    }
  }

  /**
   * Get the list of builtin assets to initialize
   * Override this method in EE subclass to add more assets
   *
   * This method consolidates assets from:
   * - System user avatars (automation robot, app robot, anonymous user, AI robot)
   * - Plugin assets will be handled by OfficialPluginInitService which calls uploadStatic
   */
  protected getBuiltinAssets(): IBuiltinAssetConfig[] {
    return [
      // System user avatars (from UserInitService)
      {
        id: AUTOMATION_ROBOT_ID,
        filePath: AUTOMATION_ROBOT_AVATAR_PATH,
        uploadType: UploadType.Avatar,
      },
      {
        id: APP_ROBOT_ID,
        filePath: AUTOMATION_ROBOT_AVATAR_PATH,
        uploadType: UploadType.Avatar,
      },
      {
        id: 'aiRobot',
        filePath: AUTOMATION_ROBOT_AVATAR_PATH,
        uploadType: UploadType.Avatar,
      },
      {
        id: ANONYMOUS_USER_ID,
        filePath: ANONYMOUS_USER_AVATAR_PATH,
        uploadType: UploadType.Avatar,
      },
      {
        id: EMAIL_LOGO_TOKEN,
        filePath: EMAIL_LOGO_PATH,
        uploadType: UploadType.Logo,
      },
      {
        id: 'actTestImage',
        filePath: 'static/test/test-image.png',
        uploadType: UploadType.ChatFile,
      },
      {
        id: 'actTestPDF',
        filePath: 'static/test/test-pdf.pdf',
        uploadType: UploadType.ChatFile,
      },
    ];
  }

  /**
   * Upload a single builtin asset
   */
  async uploadBuiltinAsset(config: IBuiltinAssetConfig): Promise<string> {
    const { id, filePath, uploadType } = config;
    return this.uploadStatic(id, filePath, uploadType);
  }

  /**
   * Core upload logic - reusable by other services
   * This method can be called by other services (like OfficialPluginInitService)
   * to upload their assets using the same logic
   *
   * Supports both image files (jpg, png, etc.) and non-image files (pdf, xlsx, csv, etc.)
   */
  async uploadStatic(id: string, filePath: string, type: UploadType): Promise<string> {
    if (process.env.NODE_ENV === 'test') {
      return `/${join(StorageAdapter.getDir(type), id)}`;
    }

    const fullPath = resolve(process.cwd(), filePath);
    const path = join(StorageAdapter.getDir(type), id);
    const bucket = StorageAdapter.getBucket(type);

    // Get file metadata based on file type
    const { size, width, height, mimetype } = await this.getFileMetadata(fullPath);

    const { hash } = await this.storageAdapter.uploadFileWidthPath(bucket, path, fullPath, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': mimetype,
    });

    await this.prismaService.txClient().attachments.upsert({
      create: {
        token: id,
        path,
        size,
        width,
        height,
        hash,
        mimetype,
        createdBy: 'system',
      },
      update: {
        size,
        width,
        height,
        hash,
        mimetype,
        lastModifiedBy: 'system',
      },
      where: {
        token: id,
        deletedTime: null,
      },
    });

    return `/${path}`;
  }

  /**
   * Get file metadata (size, dimensions, mimetype)
   * Uses sharp for images, fs.stat for other file types
   */
  private async getFileMetadata(
    fullPath: string
  ): Promise<{ size: number; width?: number; height?: number; mimetype: string }> {
    const ext = extname(fullPath).toLowerCase();
    const mimetypeFromExt = mime.lookup(ext) || 'application/octet-stream';

    // Check if it's an image format that sharp can handle
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.avif', '.heif'];
    const isImage = imageExtensions.includes(ext);

    if (isImage) {
      try {
        const fileStream = createReadStream(fullPath);
        const metaReader = sharp();
        const sharpReader = fileStream.pipe(metaReader);
        const metadata = await sharpReader.metadata();
        return {
          size: metadata.size || 0,
          width: metadata.width,
          height: metadata.height,
          mimetype: mimetypeFromExt,
        };
      } catch {
        // Fall back to basic file stats if sharp fails
        this.logger.warn(`Sharp failed to process image: ${fullPath}, falling back to basic stats`);
      }
    }

    // For non-image files or if sharp failed, use fs.stat
    const fileStat = await stat(fullPath);
    return {
      size: fileStat.size,
      width: undefined,
      height: undefined,
      mimetype: mimetypeFromExt,
    };
  }
}
