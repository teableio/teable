import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { TrashType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { CanaryService } from '../canary/canary.service';
import type { ITrashResourceHandler } from '../trash/resource/trash-resource-handler';
import { TableOpenApiV2Service } from './open-api/table-open-api-v2.service';
import { TableOpenApiService } from './open-api/table-open-api.service';

@Injectable()
export class TableTrashHandler implements ITrashResourceHandler {
  readonly type = TrashType.Table;
  readonly notFoundI18nKey = 'httpErrors.table.notFound' as const;
  // A restore re-emits TABLE_CREATE (v1) or TableRestored (v2), which becomes the `table.restore`
  // row; the table's own permanent delete writes `table.permanent-delete` for every entry point.
  readonly auditActions = {};

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly tableOpenApiV2Service: TableOpenApiV2Service,
    private readonly canaryService: CanaryService
  ) {}

  async listTrashed(baseId: string) {
    return this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: { not: null } },
      select: { id: true, name: true },
    });
  }

  async findLiveIds(resourceIds: string[]) {
    const rows = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: resourceIds }, deletedTime: null },
      select: { id: true },
    });
    return new Set(rows.map(({ id }) => id));
  }

  async describe() {
    return undefined;
  }

  async findTrashed(resourceId: string) {
    const row = await this.prismaService.tableMeta.findUnique({
      where: { id: resourceId },
      select: { baseId: true, deletedTime: true },
    });
    return row && { deletedTime: row.deletedTime, parentId: row.baseId };
  }

  async findBaseId(resourceId: string) {
    const table = await this.prismaService.txClient().tableMeta.findUnique({
      where: { id: resourceId },
      select: { baseId: true },
    });
    return table?.baseId ?? null;
  }

  ownsRestoreTransaction() {
    return Boolean(this.cls.get('useV2'));
  }

  /** The trash controller decides v1 or v2 for the request and leaves it in the context. */
  async restore(baseId: string, resourceId: string) {
    if (this.cls.get('useV2')) {
      await this.tableOpenApiV2Service.restoreTable(baseId, resourceId);
      return;
    }
    await this.tableOpenApiService.restoreTable(baseId, resourceId);
  }

  async purge(baseId: string, resourceIds: string[]) {
    if (!resourceIds.length) return;
    const base = await this.prismaService.txClient().base.findUnique({
      where: { id: baseId },
      select: { spaceId: true, v2Enabled: true },
    });
    const decision = await this.canaryService.shouldUseV2ForBaseWithReason(base, 'deleteTable');
    const tableApi = decision.useV2 ? this.tableOpenApiV2Service : this.tableOpenApiService;
    await tableApi.permanentDeleteTables(baseId, resourceIds);
  }
}
