import path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import StorageAdapter from '../../features/attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../features/attachments/plugins/storage';

/**
 * Uploads profiler artifacts (.cpuprofile / .heapprofile) to the private
 * storage bucket under a date-partitioned directory, with timeout and
 * exponential-backoff retries. Shared by the CPU and heap profiler services.
 */
@Injectable()
export class ProfileUploader {
  private readonly logger = new Logger(ProfileUploader.name);

  private readonly uploadTimeoutMs = 30000; // 30 seconds upload timeout
  private readonly maxUploadRetries = 3;

  constructor(
    @StorageConfig() readonly storageConfig: IStorageConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter
  ) {}

  async upload(directory: string, filename: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(directory, dayjs().format('YYYY-MM-DD'), filename);

    // Retry logic with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxUploadRetries; attempt++) {
      try {
        const uploadPromise = this.storageAdapter.uploadFile(
          this.storageConfig.privateBucket,
          fullPath,
          buffer,
          {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          }
        );

        // Add timeout wrapper; unref so a pending timer never delays shutdown
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Upload timeout after ${this.uploadTimeoutMs}ms`)),
            this.uploadTimeoutMs
          ).unref()
        );

        await Promise.race([uploadPromise, timeoutPromise]);

        // Success!
        if (attempt > 1) {
          this.logger.log(`Upload succeeded on attempt ${attempt}/${this.maxUploadRetries}`);
        }
        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Upload attempt ${attempt}/${this.maxUploadRetries} failed: ${lastError.message}`
        );

        if (attempt < this.maxUploadRetries) {
          // Exponential backoff: 1s, 2s, 4s, ...
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.logger.debug(`Retrying upload in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries failed
    throw new Error(
      `Failed to upload profile after ${this.maxUploadRetries} attempts: ${lastError?.message}`
    );
  }
}
