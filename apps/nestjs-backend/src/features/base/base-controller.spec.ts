import { BaseController } from './base.controller';

describe('BaseController', () => {
  it('requires full project scope before starting an export', async () => {
    const baseService = { getBaseById: vi.fn() };
    const cls = { get: vi.fn().mockReturnValue({ baseId: 'bseFixture', nodeId: 'bnoFixture' }) };
    const controller = new BaseController(
      baseService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cls as never,
      {} as never
    );
    const response = { setHeader: vi.fn() };

    await expect(controller.exportBase('bseFixture', undefined, response as never)).rejects.toThrow(
      'Project export requires access to the entire project'
    );
    await expect(
      controller.exportBaseStream('bseFixture', undefined, response as never)
    ).rejects.toThrow('Project export requires access to the entire project');
    expect(baseService.getBaseById).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
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
