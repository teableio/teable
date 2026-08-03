import { BaseController } from './base.controller';

const createController = (useV2Export: boolean) => {
  const baseService = {
    getBaseById: vi.fn().mockResolvedValue({
      id: 'bseTest',
      v2Status: { useV2: true, reason: useV2Export ? 'new_base' : 'space_feature' },
    }),
    shouldUseV2BaseExport: vi.fn().mockResolvedValue(useV2Export),
  };
  const baseExportService = {
    exportBaseZip: vi.fn().mockResolvedValue('v1-export'),
  };
  const baseExportV2Service = {
    exportBaseZip: vi.fn().mockResolvedValue('v2-export'),
  };

  return {
    controller: new BaseController(
      baseService as never,
      baseExportService as never,
      baseExportV2Service as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    ),
    baseService,
    baseExportService,
    baseExportV2Service,
  };
};

describe('BaseController', () => {
  describe('exportBase', () => {
    it('uses the v2 exporter for physical v2 bases', async () => {
      const { controller, baseExportService, baseExportV2Service, baseService } =
        createController(true);

      await expect(controller.exportBase('bseTest')).resolves.toBe('v2-export');

      expect(baseService.shouldUseV2BaseExport).toHaveBeenCalledWith('bseTest');
      expect(baseExportV2Service.exportBaseZip).toHaveBeenCalledWith('bseTest', true);
      expect(baseExportService.exportBaseZip).not.toHaveBeenCalled();
    });

    it('uses the v2 exporter even when FORCE_V2_ALL overrides canary reason', async () => {
      const { controller, baseExportService, baseExportV2Service, baseService } =
        createController(true);
      baseService.getBaseById.mockResolvedValue({
        id: 'bseTest',
        v2Status: { useV2: true, reason: 'env_force_v2_all' },
      });

      await expect(controller.exportBase('bseTest')).resolves.toBe('v2-export');

      expect(baseExportV2Service.exportBaseZip).toHaveBeenCalledWith('bseTest', true);
      expect(baseExportService.exportBaseZip).not.toHaveBeenCalled();
    });

    it('keeps rollout-only v2 decisions on the legacy exporter', async () => {
      const { controller, baseExportService, baseExportV2Service } = createController(false);

      await expect(controller.exportBase('bseTest', '0')).resolves.toBe('v1-export');

      expect(baseExportService.exportBaseZip).toHaveBeenCalledWith('bseTest', false);
      expect(baseExportV2Service.exportBaseZip).not.toHaveBeenCalled();
    });
  });
});
