import * as inspector from 'inspector';
import * as os from 'os';
import path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import dayjs from 'dayjs';
import { IStorageConfig, StorageConfig } from '../../configs/storage';
import StorageAdapter from '../../features/attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../features/attachments/plugins/storage';

/**
 * ProfilerService is used to profile the CPU usage of the application.
 * ENV:
 * // enable profiling, default false
 * - ENABLE_PROFILING=true
 * // save interval in milliseconds, default 1 hour (60 * 60 * 1000)
 * - PROFILE_SAVE_INTERVAL=60_000
 * // profile directory, default profiles
 * - PROFILE_DIRECTORY=profiles
 */

@Injectable()
export class ProfilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfilerService.name);
  private session: inspector.Session | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private saveInterval: number;
  private profileCounter = 0;
  private enabled = false;
  private profileDirectory: string;
  private isSaving = false;
  private isShuttingDown = false;
  private readonly hostname = os.hostname();

  // Safety limits
  private readonly maxProfileSizeMB = 500; // Max 500MB per profile
  private readonly uploadTimeoutMs = 30000; // 30 seconds upload timeout
  private readonly maxUploadRetries = 3;

  constructor(
    private readonly configService: ConfigService,
    @StorageConfig() readonly storageConfig: IStorageConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter
  ) {
    this.enabled = this.configService.get('ENABLE_PROFILING') === 'true';

    // default 1 hour
    this.saveInterval = parseInt(
      this.configService.get('PROFILE_SAVE_INTERVAL') || `${60 * 60 * 1000}`
    );

    this.profileDirectory = this.configService.get('PROFILE_DIRECTORY') || 'profiles';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('💤 Profiling disabled (set ENABLE_PROFILING=true to enable)');
      return;
    }

    const started = this.startSession();
    if (!started) {
      this.logger.error('Failed to initialize profiler');
      return;
    }

    this.startPeriodicSave();

    const intervalMinutes = Math.floor(this.saveInterval / 60000);
    this.logger.log(`📊 Profiler initialized - saving every ${intervalMinutes} minutes`);
  }

  async onModuleDestroy() {
    if (!this.enabled) {
      return;
    }

    this.logger.log('🛑 Shutting down profiler...');
    await this.cleanup();
  }

  /**
   * Start a new profiling session
   */
  private startSession(): boolean {
    try {
      if (this.session) {
        this.session.disconnect();
      }

      this.session = new inspector.Session();
      this.session.connect();
      this.session.post('Profiler.enable');
      this.session.post('Profiler.start');
      this.logger.log(`🔥 CPU Profiling started (Hostname: ${this.hostname})`);
      return true;
    } catch (error) {
      this.logger.error('Failed to start profiler', error);
      this.session = null;
      return false;
    }
  }

  /**
   * Stop the current profiling session and get profile data
   */
  private async stopSession(): Promise<inspector.Profiler.Profile | null> {
    if (!this.session) {
      return null;
    }

    return new Promise((resolve) => {
      this.session!.post('Profiler.stop', (err, { profile }) => {
        this.session?.disconnect();
        this.session = null;

        if (err) {
          this.logger.error('Failed to stop profiler', err);
          resolve(null);
        } else {
          resolve(profile);
        }
      });
    });
  }

  private generateProfileFilename() {
    this.profileCounter++;
    const timestamp = new Date().getTime();
    return `cpu-${this.profileCounter}-${this.hostname}-${timestamp}.cpuprofile`;
  }

  /**
   * Save profile data to storage
   */
  private async saveProfile(profile: inspector.Profiler.Profile): Promise<boolean> {
    try {
      const filename = this.generateProfileFilename();
      const buffer = Buffer.from(JSON.stringify(profile));
      const sizeInMB = (buffer.length / 1024 / 1024).toFixed(2);

      // Safety check: validate profile size
      const sizeMBNum = parseFloat(sizeInMB);
      if (sizeMBNum > this.maxProfileSizeMB) {
        this.logger.warn(
          `Profile size ${sizeInMB}MB exceeds maximum ${this.maxProfileSizeMB}MB, skipping upload`
        );
        return false;
      }

      await this.uploadToStorage(filename, buffer);
      this.logger.log(`✅ Profile uploaded: ${filename} (${sizeInMB} MB)`);
      return true;
    } catch (error) {
      this.logger.error('Failed to save profile', error);
      return false;
    }
  }

  private startPeriodicSave() {
    this.intervalTimer = setInterval(async () => {
      // Skip if already saving or shutting down
      if (this.isSaving || this.isShuttingDown) {
        this.logger.debug('Skipping periodic save (already in progress or shutting down)');
        return;
      }

      this.logger.log('⏰ Periodic save triggered');
      try {
        await this.saveAndRestart();
      } catch (error) {
        this.logger.error('Failed to save profile', error);
      }
    }, this.saveInterval);

    // Prevent timer from keeping process alive
    this.intervalTimer.unref();
  }

  /**
   * Save current profile and restart profiling session
   */
  private async saveAndRestart(): Promise<void> {
    if (!this.session) {
      this.logger.warn('No active profiling session');
      return;
    }

    if (this.isSaving) {
      this.logger.warn('Save already in progress, skipping');
      return;
    }

    this.isSaving = true;

    try {
      // Stop current session and get profile data with timeout
      const profile = await Promise.race([
        this.stopSession(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Stop session timeout after 60s')), 60000)
        ),
      ]);

      if (!profile) {
        throw new Error('Failed to get profile data');
      }

      // Save profile to storage
      await this.saveProfile(profile);

      // Restart profiling session if not shutting down
      if (!this.isShuttingDown) {
        const restarted = this.startSession();
        if (restarted) {
          this.logger.log('🔄 Profiling restarted');
        }
      }
    } catch (error) {
      this.logger.error('Failed to save/restart profile', error);

      // Try to restart profiler even if save failed
      if (!this.isShuttingDown && !this.session) {
        const restarted = this.startSession();
        if (restarted) {
          this.logger.log('🔄 Profiling restarted after error');
        }
      }

      throw error;
    } finally {
      this.isSaving = false;
    }
  }

  private async uploadToStorage(filename: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(this.profileDirectory, dayjs().format('YYYY-MM-DD'), filename);

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

        // Add timeout wrapper
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Upload timeout after ${this.uploadTimeoutMs}ms`)),
            this.uploadTimeoutMs
          )
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

  /**
   * Wait for ongoing save operation to complete
   */
  private async waitForSaveCompletion(maxWaitMs = 5000): Promise<void> {
    if (!this.isSaving) {
      return;
    }

    this.logger.log('Waiting for ongoing save to complete...');
    const startTime = Date.now();

    while (this.isSaving && Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.isSaving) {
      this.logger.warn(`Ongoing save did not complete within ${maxWaitMs}ms`);
    }
  }

  /**
   * Cleanup on shutdown: save final profile and release resources
   */
  private async cleanup(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Cleanup already in progress');
      return;
    }

    this.isShuttingDown = true;

    // Clear periodic save timer
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    // Wait for any ongoing save to complete
    await this.waitForSaveCompletion(5000);

    // Save final profile if session is active
    if (!this.session) {
      return;
    }

    try {
      // Stop session and get final profile with timeout
      const profile = await Promise.race([
        this.stopSession(),
        new Promise<null>((resolve) => {
          setTimeout(() => {
            this.logger.warn('⚠️ Final profile stop timeout (10s), forcing shutdown');
            this.session?.disconnect();
            this.session = null;
            resolve(null);
          }, 10000);
        }),
      ]);

      if (profile) {
        await this.saveProfile(profile);
        this.logger.log(`📊 Total profiles saved: ${this.profileCounter}`);
      }
    } catch (error) {
      this.logger.error('Failed to save final profile', error);
    }
  }

  /**
   * Manually trigger a profile save and restart
   * Note: This should be protected by authentication in production
   */
  async manualSave() {
    if (!this.enabled) {
      throw new Error('Profiling is not enabled');
    }

    if (this.isShuttingDown) {
      throw new Error('Service is shutting down');
    }

    this.logger.log('📸 Manual save triggered');
    await this.saveAndRestart();
  }
}
