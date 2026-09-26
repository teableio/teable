/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { AuditScope } from '../audit/audit-scope';
import type { CollaboratorService } from '../collaborator/collaborator.service';
import { PluginContextMenuService } from './plugin-context-menu.service';

describe('PluginContextMenuService audit', () => {
  const tableId = 'tblAudit';
  const baseId = 'bseAudit';
  const pluginId = 'plgAudit';
  const emitAtomic = vi.fn();
  const tx = {
    tableMeta: { findUnique: vi.fn() },
    plugin: { findUnique: vi.fn() },
    pluginInstall: { create: vi.fn(), delete: vi.fn() },
    pluginContextMenu: { aggregate: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    collaborator: { count: vi.fn() },
  };
  const prismaService = {
    ...tx,
    txClient: () => tx,
    $tx: vi.fn(async (fn: (prisma: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const cls = { get: vi.fn(() => 'usrActor') } as unknown as ClsService<IClsStore>;
  let service: PluginContextMenuService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.tableMeta.findUnique.mockResolvedValue({ baseId });
    service = new PluginContextMenuService(
      prismaService,
      cls,
      {} as CollaboratorService,
      {
        emitAtomic,
      } as unknown as AuditScope
    );
  });

  it('records plugin.install for a context-menu install', async () => {
    tx.plugin.findUnique.mockResolvedValue({ name: 'Script' });
    tx.pluginInstall.create.mockResolvedValue({ id: 'pinAudit', plugin: { pluginUser: null } });
    tx.pluginContextMenu.aggregate.mockResolvedValue({ _max: { order: 2 } });

    const res = await service.installPluginContextMenu(tableId, { pluginId });

    expect(res).toEqual({ pluginInstallId: 'pinAudit', name: 'Script', order: 3 });
    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.install',
      resourceId: 'pinAudit',
      params: {
        pluginId,
        name: 'Script',
        location: PluginPosition.ContextMenu,
        baseId,
        tableId,
      },
    });
  });

  it('records plugin.uninstall with the removed plugin', async () => {
    tx.pluginInstall.delete.mockResolvedValue({ id: 'pinAudit', pluginId, name: 'Script' });

    await service.deletePluginContextMenu(tableId, 'pinAudit');

    expect(emitAtomic).toHaveBeenCalledWith({
      action: 'plugin.uninstall',
      resourceId: 'pinAudit',
      params: {
        pluginId,
        name: 'Script',
        location: PluginPosition.ContextMenu,
        baseId,
        tableId,
      },
    });
  });

  it('writes no row when the install to remove does not exist', async () => {
    tx.pluginInstall.delete.mockRejectedValue(new Error('Record to delete does not exist'));

    await expect(service.deletePluginContextMenu(tableId, 'pinMissing')).rejects.toThrow();
    expect(emitAtomic).not.toHaveBeenCalled();
  });
});
