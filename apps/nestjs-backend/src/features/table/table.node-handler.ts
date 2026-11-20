import { Injectable } from '@nestjs/common';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import { BaseNodeResourceType } from '@teable/openapi';
import type { ICreateTableRo, IDuplicateTableRo, IUpdateBaseNodeRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IMoveNodeContext } from '../base-node/base-node-move.service';
import type {
  IBaseNodeResourceCreateRo,
  IBaseNodeResourceHandler,
} from '../base-node/resource/base-node-resource-handler';
import { CanaryService } from '../canary/canary.service';
import { TableOpenApiV2Service } from './open-api/table-open-api-v2.service';
import { TableOpenApiService } from './open-api/table-open-api.service';
import { prepareCreateTableRo } from './open-api/table.pipe.helper';
import { TableDuplicateService } from './table-duplicate.service';
import type { ITableMovePlan } from './table-move.service';
import { TableMoveService } from './table-move.service';

/**
 * The request decides v1 or v2 for the table and leaves it in the context; a rename decides on
 * its own.
 */
@Injectable()
export class TableNodeHandler implements IBaseNodeResourceHandler {
  readonly type = BaseNodeResourceType.Table;

  constructor(
    protected readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly tableOpenApiV2Service: TableOpenApiV2Service,
    private readonly tableDuplicateService: TableDuplicateService,
    private readonly tableMoveService: TableMoveService,
    private readonly canaryService: CanaryService
  ) {}

  async list(baseId: string, ids?: string[]) {
    return await this.prismaService.tableMeta.findMany({
      where: {
        baseId,
        id: { in: ids || undefined },
        deletedTime: null,
        // `deleting` is in-flight (or about to roll back to ready). Dropping
        // the sidebar node here is permanent: base_node has no soft delete,
        // so a failed delete cannot restore the folder or order.
        provisionState: { in: [ProvisionState.ready, ProvisionState.deleting] },
      },
      select: {
        id: true,
        name: true,
        icon: true,
        createdBy: true,
        createdTime: true,
        lastModifiedBy: true,
        lastModifiedTime: true,
      },
    });
  }

  async create(baseId: string, ro: IBaseNodeResourceCreateRo) {
    const preparedRo = prepareCreateTableRo(ro as ICreateTableRo);
    const table = this.cls.get('useV2')
      ? await this.tableOpenApiV2Service.createTable(baseId, preparedRo)
      : await this.tableOpenApiService.createTable(baseId, preparedRo);

    return {
      id: table.id,
      name: table.name,
      icon: table.icon,
      defaultViewId: table.defaultViewId,
    };
  }

  async update(baseId: string, id: string, { name, icon }: IUpdateBaseNodeRo) {
    const base = await this.prismaService.txClient().base.findUnique({
      where: { id: baseId, deletedTime: null },
      select: { spaceId: true, v2Enabled: true },
    });
    const decision = await this.canaryService.shouldUseV2ForBaseWithReason(base, 'updateTable');
    const tableApi = decision.useV2 ? this.tableOpenApiV2Service : this.tableOpenApiService;
    if (name) {
      await tableApi.updateName(baseId, id, name);
    }
    if (icon !== undefined) {
      await tableApi.updateIcon(baseId, id, icon);
    }
  }

  async duplicate(baseId: string, id: string, ro: IDuplicateTableRo) {
    const table = this.cls.get('useV2')
      ? await this.tableOpenApiV2Service.duplicateTable(baseId, id, ro)
      : await this.tableDuplicateService.duplicateTable(baseId, id, ro);

    return {
      id: table.id,
      name: table.name,
      icon: table.icon ?? undefined,
      defaultViewId: table.defaultViewId,
    };
  }

  async delete(baseId: string, id: string, permanent?: boolean) {
    if (this.cls.get('useV2')) {
      await this.tableOpenApiV2Service.deleteTable(baseId, id, permanent ? 'permanent' : undefined);
      return;
    }
    if (permanent) {
      await this.tableOpenApiService.permanentDeleteTables(baseId, [id]);
    } else {
      await this.tableOpenApiService.deleteTable(baseId, id);
    }
  }

  async getNames(baseId: string, ids: string[]) {
    const rows = await this.prismaService.txClient().tableMeta.findMany({
      where: { baseId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** The move prepared the tables' plan; this applies its metadata half. */
  async moveResources(_ctx: IMoveNodeContext, plan: ITableMovePlan) {
    await this.tableMoveService.applyMetaMove(plan);
  }
}
