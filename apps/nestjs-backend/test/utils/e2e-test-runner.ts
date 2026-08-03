import { axios } from '@teable/openapi';
import { VitestTestRunner } from 'vitest/runners';
import type { IBaseConfig } from '../../src/configs/base.config';
import { baseConfig } from '../../src/configs/base.config';
import { PerformanceCacheService } from '../../src/performance-cache';
import {
  getAllSharedBundles,
  reapStrayFreshApps,
  resetAxiosToSharedApp,
  restoreBaselineEnv,
  setPendingMaintenance,
} from './e2e-shared';

/**
 * E2e runner for the shared-app worker model (`isolate: false`).
 *
 * Workers execute many spec files in one process, so env mutations made by a spec
 * (runtime feature flags like FORCE_V2_ALL) would leak into the next file. After
 * each file finishes, reset process.env to the baseline captured right after the
 * worker booted its shared app.
 */
export default class E2eTestRunner extends VitestTestRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCollectStart(file: any): void {
    // Vitest may collect a file in a different worker than the one that runs it;
    // collection imports the module, so import-time env mutations would otherwise
    // linger in the collecting worker. Start every file from the baseline.
    restoreBaselineEnv();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const name = String(file?.filepath ?? '')
      .split('/')
      .pop();
    if (process.env.E2E_PROBE) {
      // eslint-disable-next-line no-console
      console.log(`[e2e-probe] file-start pool=${process.env.VITEST_POOL_ID} ${name}`);
    }
    super.onCollectStart(file);
  }

  onAfterRunFiles(): void {
    super.onAfterRunFiles();
    restoreBaselineEnv();
    reapStrayFreshApps();
    resetAxiosToSharedApp(axios);
    // Cache-stats specs assert absolute hit/miss counts, and some specs flip
    // boot-time config flags (e.g. recordHistoryDisabled) on the shared app.
    // Start each file from the same state a freshly booted app would have.
    const cleanups: Promise<unknown>[] = [];
    for (const bundle of getAllSharedBundles()) {
      try {
        const perfCache = bundle.app.get(PerformanceCacheService, { strict: false });
        perfCache?.resetTypeStats?.();
        // Values too: under app-per-file every file got a new session id, so
        // sid-scoped cache entries were never warm at file start. The flush is
        // async; the next file's initApp awaits it via setPendingMaintenance.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cleared = (perfCache as any)?._clear?.();
        if (cleared) cleanups.push(cleared.catch(() => undefined));
        const config = bundle.app.get<IBaseConfig>(baseConfig.KEY, { strict: false });
        if (config) {
          config.recordHistoryDisabled = true;
          config.storagePrefix = bundle.appUrl;
        }
      } catch {
        // app may be mid-shutdown; per-file state reset is best-effort
      }
    }
    if (cleanups.length > 0) {
      setPendingMaintenance(Promise.all(cleanups));
    }
  }
}
