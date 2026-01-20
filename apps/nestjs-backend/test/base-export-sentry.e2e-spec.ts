/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { BaseExportService } from '../src/features/base/base-export.service';
import type { IClsStore } from '../src/types/cls';
import { createBase, initApp, permanentDeleteBase, runWithTestUser } from './utils/init-app';

const waitFor = async (condition: () => boolean, timeout = 1000, interval = 25) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Condition not met within timeout');
};

describe('Base export sentry reporting (e2e)', () => {
  let app: INestApplication;
  let baseExportService: BaseExportService;
  let clsService: ClsService<IClsStore>;
  let baseId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    clsService = app.get(ClsService);
    baseExportService = app.get(BaseExportService);
    const base = await createBase({
      name: `sentry-export-${Date.now()}`,
      spaceId: globalThis.testConfig.spaceId,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    if (baseId) {
      await permanentDeleteBase(baseId);
    }
    await app.close();
  });

  it('captures export failures in sentry even when running asynchronously', async () => {
    const exportError = new Error('mock export failure');
    // Cast to `any` to access private methods for testing purposes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exportService = baseExportService as any;

    const captureErrorSpy = vi.spyOn(exportService, 'captureExportError');
    const processSpy = vi
      .spyOn(exportService, 'processExportBaseZip')
      .mockRejectedValue(exportError);
    const notifySpy = vi.spyOn(exportService, 'notifyExportResult').mockResolvedValue(undefined);

    await runWithTestUser(clsService, async () => {
      await baseExportService.exportBaseZip(baseId, false);
    });

    await waitFor(() => notifySpy.mock.calls.length > 0);

    expect(captureErrorSpy).toHaveBeenCalledWith(
      exportError,
      expect.objectContaining({
        baseId,
        baseName: expect.any(String),
        includeData: false,
        stage: 'processExport',
      })
    );
    expect(notifySpy).toHaveBeenCalled();

    processSpy.mockRestore();
    notifySpy.mockRestore();
    captureErrorSpy.mockRestore();
  });
});
