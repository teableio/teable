/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { AuditScope } from '../audit/audit-scope';
import type { BaseImportService } from '../base/base-import.service';
import type { CollaboratorService } from '../collaborator/collaborator.service';
import { PluginPanelService } from './plugin-panel.service';

describe('PluginPanelService audit', () => {
  const tableId = 'tblAudit';
  const baseId = 'bseAudit';
  const pluginPanelId = 'plpAudit';
  const pluginId = 'plgAudit';
  const emitAtomic = vi.fn();
  const tx = {
    tableMeta: { findUnique: vi.fn() },
    plugin: { findUnique: vi.fn() },
    pluginInstall: { create: vi.fn(), delete: vi.fn() },
    pluginPanel: { findUnique: vi.fn(), update: vi.fn() },
    collaborator: { count: vi.fn() },
  };
  const prismaService = {
    ...tx,
    txClient: () => tx,
    $tx: vi.fn(async (fn: (prisma: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const cls = { get: vi.fn(() => 'usrActor') } as unknown as ClsService<IClsStore>;
  let service: PluginPanelService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.tableMeta.findUnique.mockResolvedValue({ baseId });
    tx.pluginPanel.findUnique.mockResolvedValue({ layout: null });
    service = new PluginPanelService(
      prismaService,
      cls,
      {} as CollaboratorService,
      {} as BaseImportService,
      { emitAtomic } as unknown as AuditScope
    );
  });

  it('records plugin.install for a panel install', async () => {
    tx.plugin.findUnique.mockResolvedValue({ id: pluginId, name: 'Chart' });
    tx.pluginInstall.create.mockResolvedValue({
      id: 'pinAudit',
      name: 'Chart',
      pluginId,
      plugin: { pluginUser: null },
    });

    await service.installPluginPanel(tableId, pluginPanelId, { pluginId });

    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.install',
      resourceId: 'pinAudit',
      params: {
        pluginId,
        name: 'Chart',
        location: PluginPosition.Panel,
        baseId,
        tableId,
        pluginPanelId,
      },
    });
  });

  it('writes no row when the install fails', async () => {
    tx.plugin.findUnique.mockResolvedValue(null);

    await expect(
      service.installPluginPanel(tableId, pluginPanelId, { pluginId })
    ).rejects.toThrow();
    expect(emitAtomic).not.toHaveBeenCalled();
  });

  it('records plugin.uninstall with the removed plugin', async () => {
    tx.pluginInstall.delete.mockResolvedValue({ id: 'pinAudit', pluginId, name: 'Chart' });

    await service.removePluginPanelPlugin(tableId, pluginPanelId, 'pinAudit');

    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.uninstall',
      resourceId: 'pinAudit',
      params: {
        pluginId,
        name: 'Chart',
        location: PluginPosition.Panel,
        baseId,
        tableId,
        pluginPanelId,
      },
    });
  });
});
