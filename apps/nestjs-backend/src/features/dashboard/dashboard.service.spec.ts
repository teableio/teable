import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import type { AuditScope } from '../audit/audit-scope';
import type { BaseImportService } from '../base/base-import.service';
import type { CollaboratorService } from '../collaborator/collaborator.service';
import { DashboardModule } from './dashboard.module';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, DashboardModule],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('DashboardService audit', () => {
  const baseId = 'bseAudit';
  const dashboardId = 'dshAudit';
  const pluginId = 'plgAudit';
  const emitAtomic = vi.fn();
  const tx = {
    plugin: { findFirstOrThrow: vi.fn() },
    pluginInstall: { create: vi.fn(), delete: vi.fn() },
    dashboard: { findFirstOrThrow: vi.fn(), update: vi.fn() },
    collaborator: { count: vi.fn() },
  };
  const prismaService = {
    ...tx,
    txClient: () => tx,
    $tx: vi.fn(async (fn: (prisma: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const cls = { get: vi.fn(() => 'usrActor') } as unknown as ClsService<IClsStore>;
  let service: DashboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.dashboard.findFirstOrThrow.mockResolvedValue({ layout: null });
    service = new DashboardService(
      prismaService,
      cls,
      {} as CollaboratorService,
      {} as BaseImportService,
      { emitAtomic } as unknown as AuditScope
    );
  });

  it('records plugin.install for a dashboard install', async () => {
    tx.plugin.findFirstOrThrow.mockResolvedValue({ id: pluginId });
    tx.pluginInstall.create.mockResolvedValue({
      id: 'pinAudit',
      name: 'Chart',
      pluginId,
      plugin: { pluginUser: null },
    });

    await service.installPlugin(baseId, dashboardId, { pluginId, name: 'Chart' });

    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.install',
      resourceId: 'pinAudit',
      params: {
        pluginId,
        name: 'Chart',
        location: PluginPosition.Dashboard,
        baseId,
        dashboardId,
      },
    });
  });

  it('records plugin.uninstall with the removed plugin', async () => {
    tx.pluginInstall.delete.mockResolvedValue({ id: 'pinAudit', pluginId, name: 'Chart' });

    await service.removePlugin(baseId, dashboardId, 'pinAudit');

    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.uninstall',
      resourceId: 'pinAudit',
      params: {
        pluginId,
        name: 'Chart',
        location: PluginPosition.Dashboard,
        baseId,
        dashboardId,
      },
    });
  });

  it('writes no row when the plugin to remove is not found', async () => {
    tx.pluginInstall.delete.mockRejectedValue(new Error('Record to delete does not exist'));

    await expect(service.removePlugin(baseId, dashboardId, 'pinMissing')).rejects.toMatchObject({
      message: 'Plugin not found',
    });
    expect(emitAtomic).not.toHaveBeenCalled();
  });
});
