import * as inspector from 'inspector';
import * as os from 'os';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProfileUploader } from './profile-uploader';

// @types/node's SamplingHeapProfile predates the `samples` array the runtime
// actually returns (verified on Node 22)
interface ISamplingHeapProfileWithSamples extends inspector.HeapProfiler.SamplingHeapProfile {
  samples?: unknown[];
}

/**
 * HeapProfilerService runs the V8 sampling heap profiler continuously and
 * periodically exports the profile to storage.
 *
 * Unlike a full heap snapshot, allocation sampling is poisson-based: it never
 * pauses the event loop and its overhead is ~1%, so it is safe to keep
 * enabled in production. The sampling session is intentionally never
 * restarted — samples of dead objects are dropped by V8, so every export
 * attributes all *live* sampled memory since process start to its allocation
 * stack, which is what matters when hunting resident-memory growth.
 * Exported .heapprofile files load in Chrome DevTools (Memory panel).
 * ENV:
 * // enable heap sampling, default false
 * - ENABLE_HEAP_PROFILING=true
 * // export interval in milliseconds, default 1 hour
 * - HEAP_PROFILE_SAVE_INTERVAL=3600000
 * // average poisson sampling interval in bytes, default 32768
 * - HEAP_PROFILE_SAMPLING_INTERVAL=32768
 * // profile directory, default profiles (shared with the CPU profiler)
 * - PROFILE_DIRECTORY=profiles
 */
@Injectable()
export class HeapProfilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeapProfilerService.name);
  private session: inspector.Session | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly saveInterval: number;
  private readonly samplingInterval: number;
  private profileCounter = 0;
  private readonly enabled: boolean;
  private readonly profileDirectory: string;
  private isSaving = false;
  private isShuttingDown = false;
  // Same identity as /health/memory so per-pod signals correlate
  private readonly hostname = process.env.HOSTNAME || os.hostname();

  // Safety limit: a sampling profile is normally a few MB. Growing past this
  // means the sampling tree itself has become a memory burden on the pod
  // under investigation — sampling is stopped for good, not just skipped.
  private readonly maxProfileSizeMB = 25;

  constructor(
    private readonly configService: ConfigService,
    private readonly uploader: ProfileUploader
  ) {
    this.enabled = this.configService.get('ENABLE_HEAP_PROFILING') === 'true';

    // default 1 hour; floor of 1 minute guards against high-frequency dumps
    const rawSaveInterval = parseInt(
      this.configService.get('HEAP_PROFILE_SAVE_INTERVAL') || `${60 * 60 * 1000}`
    );
    this.saveInterval = Number.isFinite(rawSaveInterval)
      ? Math.max(rawSaveInterval, 60 * 1000)
      : 60 * 60 * 1000;

    // Clamp: a tiny interval approaches per-allocation sampling and would bog
    // down the very pod under investigation.
    const rawSamplingInterval = parseInt(
      this.configService.get('HEAP_PROFILE_SAMPLING_INTERVAL') || '32768'
    );
    this.samplingInterval = Number.isFinite(rawSamplingInterval)
      ? Math.min(Math.max(rawSamplingInterval, 4096), 1024 * 1024)
      : 32768;

    this.profileDirectory = this.configService.get('PROFILE_DIRECTORY') || 'profiles';
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('💤 Heap sampling disabled (set ENABLE_HEAP_PROFILING=true to enable)');
      return;
    }

    const started = await this.startSampling();
    if (!started) {
      this.logger.error('Failed to initialize heap profiler');
      return;
    }

    this.intervalTimer = setInterval(async () => {
      if (this.isSaving || this.isShuttingDown) {
        return;
      }
      try {
        await this.exportProfile(false);
      } catch (error) {
        this.logger.error('Failed to export heap profile', error);
      }
    }, this.saveInterval);

    // Prevent timer from keeping process alive
    this.intervalTimer.unref();

    const intervalMinutes = Math.floor(this.saveInterval / 60000);
    this.logger.log(
      `🔥 Heap sampling started - exporting every ${intervalMinutes} minutes (Hostname: ${this.hostname})`
    );
  }

  async onModuleDestroy() {
    if (!this.enabled) {
      return;
    }

    this.logger.log('🛑 Shutting down heap profiler...');
    await this.cleanup();
  }

  private startSampling(): Promise<boolean> {
    return new Promise((resolve) => {
      const fail = (error: unknown) => {
        this.logger.error('Failed to start heap sampling', error);
        this.session?.disconnect();
        this.session = null;
        resolve(false);
      };
      try {
        this.session = new inspector.Session();
        this.session.connect();
        this.session.post('HeapProfiler.enable');
        this.session.post(
          'HeapProfiler.startSampling',
          { samplingInterval: this.samplingInterval },
          (err) => (err ? fail(err) : resolve(true))
        );
      } catch (error) {
        fail(error);
      }
    });
  }

  /**
   * Fetch the current sampling profile. `final` stops the profiler (shutdown
   * only); periodic exports keep it running so profiles stay cumulative.
   */
  private collectProfile(
    final: boolean
  ): Promise<inspector.HeapProfiler.SamplingHeapProfile | null> {
    if (!this.session) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const callback = (
        err: Error | null,
        res?: { profile: inspector.HeapProfiler.SamplingHeapProfile }
      ) => {
        if (err || !res) {
          this.logger.error('Failed to collect heap profile', err);
          resolve(null);
        } else {
          resolve(res.profile);
        }
      };

      if (final) {
        this.session!.post('HeapProfiler.stopSampling', callback);
      } else {
        this.session!.post('HeapProfiler.getSamplingProfile', callback);
      }
    });
  }

  private async exportProfile(final: boolean): Promise<void> {
    if (this.isSaving) {
      return;
    }
    this.isSaving = true;

    try {
      const profile = await this.collectProfile(final);
      if (!profile) {
        return;
      }

      // Cheap pre-check from counts: a pathological sampling tree must never
      // be stringified — that transient alone would add ~2x the profile size
      // to the memory pressure being investigated.
      const estimatedMB = this.estimateProfileSizeMB(profile);
      if (estimatedMB > this.maxProfileSizeMB) {
        this.logger.error(
          `Heap profile estimated size ${estimatedMB.toFixed(2)}MB exceeds maximum ${this.maxProfileSizeMB}MB — stopping heap sampling on this pod`
        );
        this.disableSampling();
        return;
      }

      const buffer = Buffer.from(JSON.stringify(profile));
      const sizeInMB = buffer.length / 1024 / 1024;

      // Exact backstop for whatever the estimate missed
      if (sizeInMB > this.maxProfileSizeMB) {
        this.logger.error(
          `Heap profile size ${sizeInMB.toFixed(2)}MB exceeds maximum ${this.maxProfileSizeMB}MB — stopping heap sampling on this pod`
        );
        this.disableSampling();
        return;
      }

      this.profileCounter++;
      const filename = `heap-${this.profileCounter}-${this.hostname}-${Date.now()}.heapprofile`;
      await this.uploader.upload(this.profileDirectory, filename, buffer);
      this.logger.log(`✅ Heap profile uploaded: ${filename} (${sizeInMB.toFixed(2)} MB)`);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Rough serialized-size estimate from sample and stack-node counts —
   * ~50 bytes per serialized sample, ~250 bytes per stack node. Order-of-
   * magnitude only; the exact post-stringify check backstops it.
   */
  private estimateProfileSizeMB(profile: inspector.HeapProfiler.SamplingHeapProfile): number {
    let nodeCount = 0;
    const stack = [profile.head];
    while (stack.length > 0) {
      nodeCount++;
      const node = stack.pop();
      for (const child of node?.children ?? []) {
        stack.push(child);
      }
    }
    const samples = (profile as ISamplingHeapProfileWithSamples).samples ?? [];
    return (samples.length * 50 + nodeCount * 250) / 1024 / 1024;
  }

  /**
   * Safety valve: permanently stop sampling and the export loop on this pod.
   * Used when the profile grows pathologically large — re-serializing it
   * every interval would only add to the memory pressure being investigated.
   */
  private disableSampling(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.session) {
      this.session.post('HeapProfiler.stopSampling');
      this.session.disconnect();
      this.session = null;
    }
  }

  private async cleanup(): Promise<void> {
    this.isShuttingDown = true;

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    // A periodic export in flight has already captured a fresh profile —
    // skip the final one rather than racing it.
    if (!this.isSaving && this.session) {
      try {
        await Promise.race([
          this.exportProfile(true),
          new Promise<void>((resolve) => {
            setTimeout(() => {
              this.logger.warn('⚠️ Final heap profile export timeout (10s), forcing shutdown');
              resolve();
            }, 10000).unref();
          }),
        ]);
      } catch (error) {
        this.logger.error('Failed to export final heap profile', error);
      }
    }

    this.session?.disconnect();
    this.session = null;
  }
}
