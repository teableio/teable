/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition, PluginStatus } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import type { AuditScope } from '../audit/audit-scope';
import type { UserService } from '../user/user.service';
import { PluginModule } from './plugin.module';
import { PluginService } from './plugin.service';

describe('PluginService', () => {
  let service: PluginService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, PluginModule],
    }).compile();

    service = module.get<PluginService>(PluginService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('PluginService audit', () => {
  const pluginId = 'plgAudit';
  const storedPlugin = {
    name: 'Audit plugin',
    description: 'desc',
    detailDesc: null,
    positions: JSON.stringify([PluginPosition.Dashboard]),
    helpUrl: null,
    logo: '/plugin/logo.png',
    url: 'https://plugin.example.com',
    config: JSON.stringify({}),
    i18n: JSON.stringify({}),
  };
  const emitAtomic = vi.fn();
  const audit = { emitAtomic } as unknown as AuditScope;
  const cls = {
    get: vi.fn((key: string) => (key === 'user.id' ? 'usrActor' : undefined)),
  } as unknown as ClsService<IClsStore>;
  const userService = {
    createSystemUser: vi.fn(),
    updateUserName: vi.fn(),
  } as unknown as UserService;
  const tx = {
    plugin: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    user: { delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  };
  const prismaService = {
    ...tx,
    txClient: () => tx,
    $tx: vi.fn(async (fn: (prisma: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  let service: PluginService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PluginService(prismaService, cls, userService, audit);
  });

  const emitted = () => emitAtomic.mock.calls.map(([input]) => input);

  it('records plugin.create with the new id and never the secret', async () => {
    tx.plugin.create.mockImplementation(async ({ data }: any) => ({
      ...storedPlugin,
      id: data.id,
      status: PluginStatus.Developing,
      secret: data.secret,
      createdTime: new Date(),
    }));
    const vo = await service.createPlugin({
      name: storedPlugin.name,
      logo: storedPlugin.logo,
      url: storedPlugin.url,
      positions: [PluginPosition.Dashboard],
    });

    expect(emitted()).toEqual([
      {
        action: 'plugin.create',
        resourceId: vo.id,
        params: {
          name: storedPlugin.name,
          url: storedPlugin.url,
          positions: [PluginPosition.Dashboard],
          pluginUserId: undefined,
        },
      },
    ]);
    expect(JSON.stringify(emitAtomic.mock.calls)).not.toContain(vo.secret);
  });

  it('records plugin.update with the changed columns and both ends of a URL change', async () => {
    tx.plugin.findFirst.mockResolvedValue(storedPlugin);
    tx.plugin.update.mockResolvedValue({
      ...storedPlugin,
      id: pluginId,
      url: 'https://evil.example.com',
      description: 'new desc',
      status: PluginStatus.Developing,
      maskedSecret: '****',
      pluginUser: null,
    });

    await service.updatePlugin(pluginId, {
      name: storedPlugin.name,
      description: 'new desc',
      logo: storedPlugin.logo,
      url: 'https://evil.example.com',
      positions: [PluginPosition.Dashboard],
      config: {},
      i18n: {},
    } as any);

    expect(emitted()).toEqual([
      {
        action: 'plugin.update',
        resourceId: pluginId,
        params: {
          name: storedPlugin.name,
          changedKeys: ['description', 'url'],
          oldUrl: storedPlugin.url,
          newUrl: 'https://evil.example.com',
        },
      },
    ]);
  });

  it('writes no plugin.update row when nothing changed', async () => {
    tx.plugin.findFirst.mockResolvedValue(storedPlugin);
    tx.plugin.update.mockResolvedValue({
      ...storedPlugin,
      id: pluginId,
      status: PluginStatus.Developing,
      maskedSecret: '****',
      pluginUser: null,
    });

    await service.updatePlugin(pluginId, {
      name: storedPlugin.name,
      logo: storedPlugin.logo,
      positions: [PluginPosition.Dashboard],
    } as any);

    expect(emitAtomic).not.toHaveBeenCalled();
  });

  it('records plugin.delete with the plugin name and its bot user', async () => {
    tx.plugin.delete.mockResolvedValue({ id: pluginId, name: 'Gone', pluginUser: 'usrBot' });

    await service.delete(pluginId);

    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'usrBot' } });
    expect(emitted()).toEqual([
      {
        action: 'plugin.delete',
        resourceId: pluginId,
        params: { name: 'Gone', pluginUserId: 'usrBot' },
      },
    ]);
  });

  it('writes no row when the plugin to delete is not found', async () => {
    tx.plugin.delete.mockRejectedValue(new Error('not found'));

    await expect(service.delete(pluginId)).rejects.toMatchObject({ message: 'Plugin not found' });
    expect(emitAtomic).not.toHaveBeenCalled();
  });

  it('records plugin.secret.rotate without the new secret', async () => {
    tx.plugin.update.mockResolvedValue({ id: pluginId, secret: 'hashed' });

    const { secret } = await service.regenerateSecret(pluginId);

    expect(emitted()).toEqual([{ action: 'plugin.secret.rotate', resourceId: pluginId }]);
    expect(JSON.stringify(emitAtomic.mock.calls)).not.toContain(secret);
  });

  it('records plugin.unpublish', async () => {
    tx.plugin.update.mockResolvedValue({ name: 'Audit plugin' });

    await service.unpublishPlugin(pluginId);

    expect(emitted()).toEqual([
      {
        action: 'plugin.unpublish',
        resourceId: pluginId,
        params: { name: 'Audit plugin', status: PluginStatus.Developing },
      },
    ]);
  });

  it('records plugin.submit with the review status', async () => {
    tx.plugin.update.mockResolvedValue({ name: 'Audit plugin' });

    await service.submitPlugin(pluginId);

    expect(emitted()).toEqual([
      {
        action: 'plugin.submit',
        resourceId: pluginId,
        params: { name: 'Audit plugin', status: PluginStatus.Reviewing },
      },
    ]);
  });
});
