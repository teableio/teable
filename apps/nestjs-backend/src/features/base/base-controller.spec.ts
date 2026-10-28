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

  // T8066: MCP/CLI page this list instead of pulling every accessible base.
  describe('getAllBase', () => {
    const bases = ['bse1', 'bse2', 'bse3', 'bse4', 'bse5'].map((id) => ({ id, spaceId: 'spc1' }));

    const createListController = () => {
      const baseService = { getAllBaseList: vi.fn().mockResolvedValue(bases) };
      const basePersonalOrderService = {
        sortForUser: vi.fn().mockImplementation(async (rows: typeof bases) => [...rows].reverse()),
      };
      const controller = new BaseController(
        baseService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        basePersonalOrderService as never
      );
      return { controller, baseService };
    };

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

    it('hands the filters and the page to the query for the shared order', async () => {
      const { controller, baseService } = createListController();
      baseService.getAllBaseList.mockResolvedValue(bases.slice(1, 3));

      const page = await controller.getAllBase({ spaceId: 'spc1', search: 'x', skip: 1, take: 2 });

      expect(baseService.getAllBaseList).toHaveBeenCalledWith({
        spaceId: 'spc1',
        search: 'x',
        skip: 1,
        take: 2,
      });
      expect(ids(page)).toEqual(['bse2', 'bse3']);
    });

    it('returns every base when no page is asked for', async () => {
      const { controller } = createListController();
      expect(ids(await controller.getAllBase({}))).toEqual(ids(bases));
    });

    it('pages after the personal order is applied', async () => {
      const { controller, baseService } = createListController();
      const page = await controller.getAllBase({ orderBy: 'personal', skip: 0, take: 2 });
      expect(baseService.getAllBaseList).toHaveBeenCalledWith({
        spaceId: undefined,
        search: undefined,
      });
      expect(ids(page)).toEqual(['bse5', 'bse4']);
    });
  });
});
