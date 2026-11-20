import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IdPrefix, SYSTEM_USER_ID } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { SettingKey } from '@teable/openapi';
import { ActorId, v2CoreTokens, type IExecutionContext, type ITracer } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ITrashConfig, TrashConfig } from '../../configs/trash.config';
import { SettingService } from '../setting/setting.service';

declare const retentionCapabilityBrand: unique symbol;
export type TrustedRetentionCapability = Readonly<{ [retentionCapabilityBrand]: true }>;
type RetainedTrash = {
  id: string;
  resourceType: string;
  resourceId: string;
  parentId: string | null;
  deletedTime: Date;
};

/** Explicit infrastructure identity, admitted only for a database-selected expired trash root. */
@Injectable()
export class TrustedRetentionContextService {
  private readonly issued = new WeakMap<TrustedRetentionCapability, RetainedTrash>();
  private readonly started = new WeakSet<TrustedRetentionCapability>();
  private readonly active = new AsyncLocalStorage<TrustedRetentionCapability>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingService,
    @TrashConfig() private readonly config: ITrashConfig
  ) {}

  private async readExpiredTrash(trashId: string): Promise<RetainedTrash> {
    const now = Date.now();
    const settings = await this.settings.getSetting([SettingKey.TRASH_CLEANUP_ENABLED_AT]);
    const enabled = settings[SettingKey.TRASH_CLEANUP_ENABLED_AT];
    const enabledAt = typeof enabled === 'string' ? new Date(enabled).getTime() : NaN;
    if (
      this.config.retention <= 0 ||
      !Number.isFinite(enabledAt) ||
      now < enabledAt + this.config.retention
    ) {
      throw new ForbiddenException('Trash retention is not enabled');
    }
    const trash = await this.prisma.txClient().trash.findUnique({
      where: { id: trashId },
      select: { id: true, resourceType: true, resourceId: true, parentId: true, deletedTime: true },
    });
    if (!trash) throw new NotFoundException(`The trash ${trashId} not found`);
    if (
      trash.deletedTime.getTime() > now - this.config.retention ||
      trash.parentId?.startsWith(IdPrefix.BaseNodeFolder)
    ) {
      throw new ForbiddenException('Trash item is no longer eligible for retention');
    }
    return trash;
  }

  async issueForExpiredTrash(trashId: string): Promise<TrustedRetentionCapability> {
    const trash = await this.readExpiredTrash(trashId);
    const capability = Object.freeze({}) as TrustedRetentionCapability;
    this.issued.set(capability, trash);
    return capability;
  }

  hasActive(): boolean {
    const capability = this.active.getStore();
    return !!capability && this.issued.has(capability);
  }

  assertActive(capability: TrustedRetentionCapability): void {
    if (!this.issued.has(capability) || this.active.getStore() !== capability) {
      throw new ForbiddenException('An admitted retention job context is required');
    }
  }

  async run<T>(
    capability: TrustedRetentionCapability,
    trashId: string,
    work: () => Promise<T>
  ): Promise<T> {
    const expected = this.issued.get(capability);
    if (!expected || this.started.has(capability)) {
      throw new ForbiddenException('Retention capability was not issued or was already used');
    }
    this.started.add(capability);
    try {
      const current = await this.readExpiredTrash(trashId);
      if (
        expected.id !== current.id ||
        expected.resourceType !== current.resourceType ||
        expected.resourceId !== current.resourceId ||
        expected.parentId !== current.parentId ||
        expected.deletedTime.getTime() !== current.deletedTime.getTime()
      ) {
        throw new ForbiddenException('Retention trash identity changed');
      }
      return await this.active.run(capability, work);
    } finally {
      this.issued.delete(capability);
    }
  }

  async revalidateActive(capability: TrustedRetentionCapability, trashId: string): Promise<void> {
    this.assertActive(capability);
    const expected = this.issued.get(capability)!;
    const current = await this.readExpiredTrash(trashId);
    if (
      expected.id !== current.id ||
      expected.resourceType !== current.resourceType ||
      expected.resourceId !== current.resourceId ||
      expected.parentId !== current.parentId ||
      expected.deletedTime.getTime() !== current.deletedTime.getTime()
    ) {
      throw new ForbiddenException('Retention trash identity changed');
    }
  }

  async createContextForTable(
    baseId: string,
    tableId: string,
    container: DependencyContainer
  ): Promise<IExecutionContext> {
    const capability = this.active.getStore();
    if (!capability) throw new ForbiddenException('An admitted retention job context is required');
    this.assertActive(capability);
    const root = this.issued.get(capability)!;
    const current = await this.readExpiredTrash(root.id);
    if (
      current.resourceType !== root.resourceType ||
      current.resourceId !== root.resourceId ||
      current.parentId !== root.parentId ||
      current.deletedTime.getTime() !== root.deletedTime.getTime()
    ) {
      throw new ForbiddenException('Retention trash identity changed');
    }
    const table = await this.prisma.txClient().tableMeta.findFirst({
      where: { id: tableId, baseId },
      select: { deletedTime: true, base: { select: { spaceId: true, deletedTime: true } } },
    });
    if (!table?.deletedTime || table.deletedTime.getTime() > Date.now() - this.config.retention) {
      throw new ForbiddenException('Retention table is no longer eligible');
    }
    let admitted = root.resourceType === 'table' && root.resourceId === tableId;
    if (root.resourceType === 'base') {
      admitted = root.resourceId === baseId && !!table.base.deletedTime;
    } else if (root.resourceType === 'space') {
      const space = await this.prisma.txClient().space.findFirst({
        where: { id: root.resourceId, deletedTime: { not: null } },
        select: { id: true },
      });
      admitted = !!space && table.base.spaceId === root.resourceId && !!table.base.deletedTime;
    } else if (root.resourceId.startsWith(IdPrefix.BaseNodeFolder)) {
      let parentId = (
        await this.prisma.txClient().trash.findUnique({
          where: { resourceType_resourceId: { resourceType: 'table', resourceId: tableId } },
          select: { parentId: true },
        })
      )?.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        if (parentId === root.resourceId) {
          admitted = true;
          break;
        }
        visited.add(parentId);
        parentId = (
          await this.prisma.txClient().trash.findFirst({
            where: { resourceId: parentId },
            select: { parentId: true },
          })
        )?.parentId;
      }
    }
    if (!admitted) throw new ForbiddenException('Table is outside the admitted retention root');
    const actor = ActorId.create(SYSTEM_USER_ID);
    if (actor.isErr()) throw new ForbiddenException(actor.error.message);
    return {
      actorId: actor.value,
      requestId: `retention:${root.id}`,
      tracer: container.resolve<ITracer>(v2CoreTokens.tracer),
    };
  }
}
