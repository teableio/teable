import { Injectable } from '@nestjs/common';
import { HttpErrorCode, IdPrefix, type IOtOperation } from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import type { IUpdateOrderRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import { RawOpType } from '../../../share-db/interface';
import { RawOpStagingService } from '../../../share-db/raw-op-staging.service';
import type { IClsStore } from '../../../types/cls';
import { updateOrder } from '../../../utils/update-order';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';

/** Sidebar order and its existing table-document protocol belong to the host. */
@Injectable()
export class TableMetadataOrderService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly rawOpStagingService: RawOpStagingService,
    private readonly migrationGuard: SpaceDataDbMigrationGuardService
  ) {}

  private async writeOrder(baseId: string, tableId: string, order: number) {
    const prisma = this.prismaService.txClient();
    const previous = await prisma.tableMeta.findFirstOrThrow({
      where: { id: tableId, baseId, deletedTime: null, provisionState: ProvisionState.ready },
      select: { order: true, version: true, lastModifiedBy: true, lastModifiedTime: true },
    });
    const data = {
      order,
      version: previous.version + 1,
      lastModifiedBy: this.cls.get('user.id'),
      lastModifiedTime: new Date().toISOString(),
    };
    await prisma.tableMeta.update({ where: { id: tableId }, data });
    const ops = Object.entries(data)
      .filter(([key, value]) => value !== previous[key as keyof typeof previous])
      .map<IOtOperation>(([key, value]) => ({
        p: [key],
        oi: value,
        od: previous[key as keyof typeof previous],
      }));
    this.rawOpStagingService.saveRawOps(baseId, RawOpType.Edit, IdPrefix.Table, [
      { docId: tableId, version: previous.version, data: ops },
    ]);
  }

  private async shuffle(baseId: string) {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null, provisionState: ProvisionState.ready },
      select: { id: true },
      orderBy: { order: 'asc' },
    });
    await this.prismaService.$tx(async () => {
      for (let index = 0; index < tables.length; index++) {
        await this.writeOrder(baseId, tables[index].id, index);
      }
    });
  }

  async updateOrder(baseId: string, tableId: string, input: IUpdateOrderRo) {
    await this.migrationGuard.assertBaseWritable(baseId);
    const prisma = this.prismaService.txClient();
    const orders = await prisma.tableMeta.findMany({
      where: { baseId, deletedTime: null, provisionState: ProvisionState.ready },
      select: { order: true },
    });
    if (new Set(orders.map((table) => table.order)).size !== orders.length) {
      await this.shuffle(baseId);
    }
    const table = await prisma.tableMeta.findFirst({
      where: { baseId, id: tableId, deletedTime: null, provisionState: ProvisionState.ready },
      select: { id: true, order: true },
    });
    if (!table) {
      throw new CustomHttpException(`Table ${tableId} not found`, HttpErrorCode.NOT_FOUND, {
        localization: { i18nKey: 'httpErrors.table.notFound' },
      });
    }
    const anchor = await prisma.tableMeta.findFirst({
      where: {
        baseId,
        id: input.anchorId,
        deletedTime: null,
        provisionState: ProvisionState.ready,
      },
      select: { id: true, order: true },
    });
    if (!anchor) {
      throw new CustomHttpException(`Anchor ${input.anchorId} not found`, HttpErrorCode.NOT_FOUND, {
        localization: { i18nKey: 'httpErrors.table.anchorNotFound' },
      });
    }
    await updateOrder({
      query: baseId,
      position: input.position,
      item: table,
      anchorItem: anchor,
      getNextItem: (order, align) =>
        prisma.tableMeta.findFirst({
          where: { baseId, deletedTime: null, provisionState: ProvisionState.ready, order },
          select: { id: true, order: true },
          orderBy: { order: align },
        }),
      update: async (parentId, id, { newOrder }) => {
        await this.prismaService.$tx(async () => this.writeOrder(parentId, id, newOrder));
      },
      shuffle: async (parentId) => {
        await this.shuffle(parentId);
        const refreshed = await prisma.tableMeta.findMany({
          where: {
            baseId: parentId,
            id: { in: [table.id, anchor.id] },
            deletedTime: null,
            provisionState: ProvisionState.ready,
          },
          select: { id: true, order: true },
        });
        const nextTable = refreshed.find((item) => item.id === table.id);
        const nextAnchor = refreshed.find((item) => item.id === anchor.id);
        if (nextTable) Object.assign(table, nextTable);
        if (nextAnchor) Object.assign(anchor, nextAnchor);
      },
    });
  }
}
