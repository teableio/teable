import { BaseController } from './base.controller';

const createController = (v2Reason: string | undefined) => {
  const baseService = {
    getBaseById: vi.fn().mockResolvedValue({
      id: 'bseTest',
      v2Status: v2Reason ? { useV2: true, reason: v2Reason } : undefined,
    }),
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
    it('uses the v2 exporter for v2-created bases', async () => {
      const { controller, baseExportService, baseExportV2Service } = createController('new_base');

      await expect(controller.exportBase('bseTest')).resolves.toBe('v2-export');

      expect(baseExportV2Service.exportBaseZip).toHaveBeenCalledWith('bseTest', true);
      expect(baseExportService.exportBaseZip).not.toHaveBeenCalled();
    });

    it('keeps rollout-only v2 decisions on the legacy exporter', async () => {
      const { controller, baseExportService, baseExportV2Service } =
        createController('space_feature');

      await expect(controller.exportBase('bseTest', '0')).resolves.toBe('v1-export');

      expect(baseExportService.exportBaseZip).toHaveBeenCalledWith('bseTest', false);
      expect(baseExportV2Service.exportBaseZip).not.toHaveBeenCalled();
    });
  });
});
