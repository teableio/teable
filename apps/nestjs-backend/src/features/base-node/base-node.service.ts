/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import { generateBaseNodeId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IMoveBaseNodeRo,
  IBaseNodeVo,
  IBaseNodeTreeVo,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IDuplicateTableRo,
  ICreateDashboardRo,
  ICreateFolderNodeRo,
  IDuplicateDashboardRo,
  IUpdateBaseNodeRo,
  IBaseNodeResourceMeta,
  IBaseNodeResourceMetaWithId,
  ICreateTableRo,
  IBaseNodePresenceCreatePayload,
  IBaseNodePresenceDeletePayload,
  IBaseNodePresenceUpdatePayload,
  IBaseNodeTableResourceMeta,
} from '@teable/openapi';
import { BaseNodeResourceType } from '@teable/openapi';
import { Knex } from 'knex';
import { isString, keyBy, omit } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { LocalPresence } from 'sharedb/lib/client';
import { CustomHttpException } from '../../custom.exception';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import { PerformanceCacheService } from '../../performance-cache/service';
import type { IPerformanceCacheStore } from '../../performance-cache/types';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { DashboardService } from '../dashboard/dashboard.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { prepareCreateTableRo } from '../table/open-api/table.pipe.helper';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { BaseNodeFolderService } from './folder/base-node-folder.service';
import { buildBatchUpdateSql, presenceHandler } from './helper';

type IBaseNodeEntry = {
  id: string;
  baseId: string;
  parentId: string | null;
  resourceType: string;
  resourceId: string;
  order: number;
  children: { id: string; order: number }[];
  parent: { id: string } | null;
};

// max depth is maxFolderDepth + 1
const maxFolderDepth = 2;

@Injectable()
export class BaseNodeService {
  private readonly logger = new Logger(BaseNodeService.name);
  constructor(
    private readonly performanceCacheService: PerformanceCacheService<IPerformanceCacheStore>,
    private readonly shareDbService: ShareDbService,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly cls: ClsService<IClsStore & { ignoreBaseNodeListener?: boolean }>,
    private readonly baseNodeFolderService: BaseNodeFolderService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly tableDuplicateService: TableDuplicateService,
    private readonly dashboardService: DashboardService
  ) {}

  private get userId() {
    return this.cls.get('user.id');
  }

  private setIgnoreBaseNodeListener() {
    this.cls.set('ignoreBaseNodeListener', true);
  }

  private getSelect() {
    return {
      id: true,
      baseId: true,
      parentId: true,
      resourceType: true,
      resourceId: true,
      order: true,
      children: {
        select: { id: true, order: true },
        orderBy: { order: 'asc' as const },
      },
      parent: {
        select: { id: true },
      },
    };
  }

  private generateDefaultUrl(
    baseId: string,
    resourceType: BaseNodeResourceType,
    resourceId: string,
    resourceMeta?: IBaseNodeResourceMeta
  ): string {
    switch (resourceType) {
      case BaseNodeResourceType.Table: {
        const tableMeta = resourceMeta as IBaseNodeTableResourceMeta | undefined;
        const viewId = tableMeta?.defaultViewId;
        if (viewId) {
          return `/base/${baseId}/table/${resourceId}/${viewId}`;
        }
        return `/base/${baseId}/table/${resourceId}`;
      }
      case BaseNodeResourceType.Dashboard:
        return `/base/${baseId}/dashboard/${resourceId}`;
      case BaseNodeResourceType.Workflow:
        return `/base/${baseId}/automation/${resourceId}`;
      case BaseNodeResourceType.App:
        return `/base/${baseId}/app/${resourceId}`;
      case BaseNodeResourceType.Folder:
        return `/base/${baseId}`;
      default:
        return `/base/${baseId}`;
    }
  }

  private async entry2vo(
    entry: IBaseNodeEntry,
    resource?: IBaseNodeResourceMeta
  ): Promise<IBaseNodeVo> {
    const resourceMeta =
      resource ||
      (
        await this.getNodeResource(entry.baseId, entry.resourceType as BaseNodeResourceType, [
          entry.resourceId,
        ])
      )[0];
    const resourceMetaWithoutId = resource ? resource : omit(resourceMeta, 'id');

    const defaultUrl = this.generateDefaultUrl(
      entry.baseId,
      entry.resourceType as BaseNodeResourceType,
      entry.resourceId,
      resourceMetaWithoutId
    );

    return {
      ...entry,
      resourceType: entry.resourceType as BaseNodeResourceType,
      resourceMeta: resourceMetaWithoutId,
      defaultUrl,
    };
  }

  protected getTableResources(baseId: string, ids?: string[]) {
    return this.prismaService.tableMeta.findMany({
      where: { baseId, id: { in: ids ? ids : undefined }, deletedTime: null },
      select: {
        id: true,
        name: true,
        icon: true,
      },
    });
  }

  protected getDashboardResources(baseId: string, ids?: string[]) {
    return this.prismaService.dashboard.findMany({
      where: { baseId, id: { in: ids ? ids : undefined } },
      select: {
        id: true,
        name: true,
      },
    });
  }

  protected getFolderResources(baseId: string, ids?: string[]) {
    return this.prismaService.baseNodeFolder.findMany({
      where: { baseId, id: { in: ids ? ids : undefined } },
      select: {
        id: true,
        name: true,
      },
    });
  }

  protected async getNodeResource(
    baseId: string,
    type: BaseNodeResourceType,
    ids?: string[]
  ): Promise<IBaseNodeResourceMetaWithId[]> {
    switch (type) {
      case BaseNodeResourceType.Folder:
        return this.getFolderResources(baseId, ids);
      case BaseNodeResourceType.Table:
        return this.getTableResources(baseId, ids);
      case BaseNodeResourceType.Dashboard:
        return this.getDashboardResources(baseId, ids);
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.invalidResourceType',
            },
          }
        );
    }
  }

  protected getResourceTypes(): BaseNodeResourceType[] {
    return [
      BaseNodeResourceType.Folder,
      BaseNodeResourceType.Table,
      BaseNodeResourceType.Dashboard,
    ];
  }

  async prepareNodeList(baseId: string): Promise<IBaseNodeVo[]> {
    const resourceTypes = this.getResourceTypes();
    const resourceResults = await Promise.all(
      resourceTypes.map((type) => this.getNodeResource(baseId, type))
    );

    const resources = resourceResults.flatMap((list, index) =>
      list.map((r) => ({ ...r, type: resourceTypes[index] }))
    );

    const resourceMap = keyBy(resources, (r) => `${r.type}_${r.id}`);
    const resourceKeys = new Set(resources.map((r) => `${r.type}_${r.id}`));

    const nodes = await this.prismaService.baseNode.findMany({
      where: { baseId },
      select: this.getSelect(),
      orderBy: { order: 'asc' },
    });

    const nodeKeys = new Set(nodes.map((n) => `${n.resourceType}_${n.resourceId}`));

    const toCreate = resources.filter((r) => !nodeKeys.has(`${r.type}_${r.id}`));
    const toDelete = nodes.filter((n) => !resourceKeys.has(`${n.resourceType}_${n.resourceId}`));
    const validParentIds = new Set(nodes.filter((n) => !toDelete.includes(n)).map((n) => n.id));
    const orphans = nodes.filter(
      (n) => n.parentId && !validParentIds.has(n.parentId) && !toDelete.includes(n)
    );

    if (toCreate.length === 0 && toDelete.length === 0 && orphans.length === 0) {
      return nodes.map((entry) => {
        const key = `${entry.resourceType}_${entry.resourceId}`;
        const resource = resourceMap[key];
        const resourceMeta = omit(resource, 'id');
        const defaultUrl = this.generateDefaultUrl(
          baseId,
          entry.resourceType as BaseNodeResourceType,
          entry.resourceId,
          resourceMeta
        );
        return {
          ...entry,
          resourceType: entry.resourceType as BaseNodeResourceType,
          resourceMeta,
          defaultUrl,
        };
      });
    }

    const finalMenus = await this.prismaService.$tx(async (prisma) => {
      // Delete redundant
      if (toDelete.length > 0) {
        await prisma.baseNode.deleteMany({
          where: { id: { in: toDelete.map((m) => m.id) } },
        });
      }

      // Prepare for create and update
      let nextOrder = 0;
      if (toCreate.length > 0 || orphans.length > 0) {
        const maxOrderAgg = await prisma.baseNode.aggregate({
          where: { baseId },
          _max: { order: true },
        });
        nextOrder = (maxOrderAgg._max.order ?? 0) + 1;
      }

      // Create missing
      if (toCreate.length > 0) {
        await prisma.baseNode.createMany({
          data: toCreate.map((r) => ({
            id: generateBaseNodeId(),
            baseId,
            resourceType: r.type,
            resourceId: r.id,
            order: nextOrder++,
            parentId: null,
            createdBy: this.userId,
          })),
        });
      }

      // Reset orphans to root level with new order
      if (orphans.length > 0) {
        await this.batchUpdateBaseNodes(
          orphans.map((orphan, index) => ({
            id: orphan.id,
            values: { parentId: null, order: nextOrder + index },
          }))
        );
      }
      return prisma.baseNode.findMany({
        where: { baseId },
        select: this.getSelect(),
        orderBy: { order: 'asc' },
      });
    });

    return await Promise.all(
      finalMenus.map(async (entry) => {
        const key = `${entry.resourceType}_${entry.resourceId}`;
        const resource = resourceMap[key];
        return await this.entry2vo(entry, omit(resource, 'id'));
      })
    );
  }

  async getNodeListWithCache(baseId: string): Promise<IBaseNodeVo[]> {
    return this.performanceCacheService.wrap(
      generateBaseNodeListCacheKey(baseId),
      () => this.prepareNodeList(baseId),
      {
        ttl: 60 * 60, // 1 hour
        statsType: 'base-node-list',
      }
    );
  }

  async getList(baseId: string): Promise<IBaseNodeVo[]> {
    return this.getNodeListWithCache(baseId);
  }

  async getTree(baseId: string): Promise<IBaseNodeTreeVo> {
    const nodes = await this.getNodeListWithCache(baseId);

    return {
      nodes,
      maxFolderDepth,
    };
  }

  async getNode(baseId: string, nodeId: string) {
    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      })
      .catch(() => {
        throw new CustomHttpException(`Base node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });
    return {
      ...node,
      resourceType: node.resourceType as BaseNodeResourceType,
    };
  }

  async getNodeVo(baseId: string, nodeId: string): Promise<IBaseNodeVo> {
    const node = await this.getNode(baseId, nodeId);
    return this.entry2vo(node);
  }

  async create(baseId: string, ro: ICreateBaseNodeRo): Promise<IBaseNodeVo> {
    this.setIgnoreBaseNodeListener();

    const { resourceType, parentId } = ro;
    const resource = await this.createResource(baseId, ro);
    const resourceId = resource.id;

    const maxOrder = await this.getMaxOrder(baseId);
    const entry = await this.prismaService.baseNode.create({
      data: {
        id: generateBaseNodeId(),
        baseId,
        resourceType,
        resourceId,
        order: maxOrder + 1,
        parentId,
        createdBy: this.userId,
      },
      select: this.getSelect(),
    });

    const vo = await this.entry2vo(entry, omit(resource, 'id'));
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'create',
        data: { ...vo },
      });
    });

    return vo;
  }

  protected async createResource(
    baseId: string,
    createRo: ICreateBaseNodeRo
  ): Promise<IBaseNodeResourceMetaWithId> {
    const { resourceType, parentId, ...ro } = createRo;
    const parentNode = parentId ? await this.getParentNodeOrThrow(parentId) : null;
    if (parentNode && parentNode.resourceType !== BaseNodeResourceType.Folder) {
      throw new CustomHttpException('Parent must be a folder', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.parentMustBeFolder',
        },
      });
    }

    if (parentNode && resourceType === BaseNodeResourceType.Folder) {
      await this.assertFolderDepth(baseId, parentNode.id);
    }

    switch (resourceType) {
      case BaseNodeResourceType.Folder: {
        const folder = await this.baseNodeFolderService.createFolder(
          baseId,
          ro as ICreateFolderNodeRo
        );
        return { id: folder.id, name: folder.name };
      }
      case BaseNodeResourceType.Table: {
        const preparedRo = prepareCreateTableRo(ro as ICreateTableRo);
        const table = await this.tableOpenApiService.createTable(baseId, preparedRo);

        return {
          id: table.id,
          name: table.name,
          icon: table.icon,
          defaultViewId: table.defaultViewId,
        };
      }
      case BaseNodeResourceType.Dashboard: {
        const dashboard = await this.dashboardService.createDashboard(
          baseId,
          ro as ICreateDashboardRo
        );
        return { id: dashboard.id, name: dashboard.name };
      }
      default:
        throw new CustomHttpException(
          `Invalid resource type ${resourceType}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.invalidResourceType',
            },
          }
        );
    }
  }

  async duplicate(baseId: string, nodeId: string, ro: IDuplicateBaseNodeRo) {
    this.setIgnoreBaseNodeListener();

    const anchor = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });
    const { resourceType, resourceId } = anchor;

    if (resourceType === BaseNodeResourceType.Folder) {
      throw new CustomHttpException('Cannot duplicate folder', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.cannotDuplicateFolder',
        },
      });
    }

    const resource = await this.duplicateResource(
      baseId,
      resourceType as BaseNodeResourceType,
      resourceId,
      ro
    );
    const { entry } = await this.prismaService.$tx(async (prisma) => {
      const maxOrder = await this.getMaxOrder(baseId, anchor.parentId);
      const newNodeId = generateBaseNodeId();
      const entry = await prisma.baseNode.create({
        data: {
          id: newNodeId,
          baseId,
          resourceType,
          resourceId: resource.id,
          order: maxOrder + 1,
          parentId: anchor.parentId,
          createdBy: this.userId,
        },
        select: this.getSelect(),
      });

      await updateOrder({
        query: baseId,
        position: 'after',
        item: entry,
        anchorItem: anchor,
        getNextItem: async (whereOrder, align) => {
          return prisma.baseNode.findFirst({
            where: {
              baseId,
              parentId: anchor.parentId,
              order: whereOrder,
              id: { not: newNodeId },
            },
            select: { order: true, id: true },
            orderBy: { order: align },
          });
        },
        update: async (_, id, data) => {
          await prisma.baseNode.update({
            where: { id },
            data: { parentId: anchor.parentId, order: data.newOrder },
          });
        },
        shuffle: async () => {
          await this.shuffleOrders(baseId, anchor.parentId);
        },
      });

      return {
        entry,
      };
    });

    const vo = await this.entry2vo(entry, omit(resource, 'id'));
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'create',
        data: { ...vo },
      });
    });
    return vo;
  }

  protected async duplicateResource(
    baseId: string,
    type: BaseNodeResourceType,
    id: string,
    duplicateRo: IDuplicateBaseNodeRo
  ): Promise<IBaseNodeResourceMetaWithId> {
    switch (type) {
      case BaseNodeResourceType.Table: {
        const table = await this.tableDuplicateService.duplicateTable(
          baseId,
          id,
          duplicateRo as IDuplicateTableRo
        );

        return {
          id: table.id,
          name: table.name,
          icon: table.icon ?? undefined,
          defaultViewId: table.defaultViewId,
        };
      }
      case BaseNodeResourceType.Dashboard: {
        const dashboard = await this.dashboardService.duplicateDashboard(
          baseId,
          id,
          duplicateRo as IDuplicateDashboardRo
        );
        return { id: dashboard.id, name: dashboard.name };
      }
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.invalidResourceType',
            },
          }
        );
    }
  }

  async update(baseId: string, nodeId: string, ro: IUpdateBaseNodeRo) {
    this.setIgnoreBaseNodeListener();

    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });

    await this.updateResource(
      baseId,
      node.resourceType as BaseNodeResourceType,
      node.resourceId,
      ro
    );

    const vo = await this.entry2vo(node);
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'update',
        data: { ...vo },
      });
    });
    return vo;
  }

  protected async updateResource(
    baseId: string,
    type: BaseNodeResourceType,
    id: string,
    updateRo: IUpdateBaseNodeRo
  ): Promise<void> {
    const { name, icon } = updateRo;
    switch (type) {
      case BaseNodeResourceType.Folder:
        if (name) {
          await this.baseNodeFolderService.renameFolder(baseId, id, { name });
        }
        break;
      case BaseNodeResourceType.Table:
        if (name) {
          await this.tableOpenApiService.updateName(baseId, id, name);
        }
        if (icon) {
          await this.tableOpenApiService.updateIcon(baseId, id, icon);
        }
        break;
      case BaseNodeResourceType.Dashboard:
        if (name) {
          await this.dashboardService.renameDashboard(baseId, id, name);
        }
        break;
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.invalidResourceType',
            },
          }
        );
    }
  }

  async delete(baseId: string, nodeId: string, permanent?: boolean) {
    this.setIgnoreBaseNodeListener();

    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: { resourceType: true, resourceId: true },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });
    if (node.resourceType === BaseNodeResourceType.Folder) {
      const children = await this.prismaService.baseNode.findMany({
        where: { baseId, parentId: nodeId },
      });
      if (children.length > 0) {
        throw new CustomHttpException(
          'Cannot delete folder because it is not empty',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.cannotDeleteEmptyFolder',
            },
          }
        );
      }
    }

    await this.deleteResource(
      baseId,
      node.resourceType as BaseNodeResourceType,
      node.resourceId,
      permanent
    );
    await this.prismaService.baseNode.delete({
      where: { id: nodeId },
    });

    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'delete',
        data: { id: nodeId },
      });
    });
    return node;
  }

  protected async deleteResource(
    baseId: string,
    type: BaseNodeResourceType,
    id: string,
    permanent?: boolean
  ) {
    switch (type) {
      case BaseNodeResourceType.Folder:
        await this.baseNodeFolderService.deleteFolder(baseId, id);
        break;
      case BaseNodeResourceType.Table:
        if (permanent) {
          await this.tableOpenApiService.permanentDeleteTables(baseId, [id]);
        } else {
          await this.tableOpenApiService.deleteTable(baseId, id);
        }
        break;
      case BaseNodeResourceType.Dashboard:
        await this.dashboardService.deleteDashboard(baseId, id);
        break;
      default:
        throw new CustomHttpException(
          `Invalid resource type ${type}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.invalidResourceType',
            },
          }
        );
    }
  }

  async move(baseId: string, nodeId: string, ro: IMoveBaseNodeRo): Promise<IBaseNodeVo> {
    this.setIgnoreBaseNodeListener();

    const { parentId, anchorId, position } = ro;

    const node = await this.prismaService.baseNode
      .findFirstOrThrow({
        where: { baseId, id: nodeId },
      })
      .catch(() => {
        throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.notFound',
          },
        });
      });

    if (isString(parentId) && isString(anchorId)) {
      throw new CustomHttpException(
        'Only one of parentId or anchorId must be provided',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.onlyOneOfParentIdOrAnchorIdRequired',
          },
        }
      );
    }

    if (parentId === nodeId) {
      throw new CustomHttpException('Cannot move node to itself', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.cannotMoveToItself',
        },
      });
    }

    if (anchorId === nodeId) {
      throw new CustomHttpException(
        'Cannot move node to its own child (circular reference)',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.cannotMoveToCircularReference',
          },
        }
      );
    }

    let newNode: IBaseNodeEntry;
    if (anchorId) {
      newNode = await this.moveNodeTo(baseId, node.id, { anchorId, position });
    } else if (parentId === null) {
      newNode = await this.moveNodeToRoot(baseId, node.id);
    } else if (parentId) {
      newNode = await this.moveNodeToFolder(baseId, node.id, parentId);
    } else {
      throw new CustomHttpException(
        'At least one of parentId or anchorId must be provided',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseNode.anchorIdOrParentIdRequired',
          },
        }
      );
    }

    const vo = await this.entry2vo(newNode);
    this.presenceHandler(baseId, (presence) => {
      presence.submit({
        event: 'update',
        data: { ...vo },
      });
    });

    return vo;
  }

  private async moveNodeToRoot(baseId: string, nodeId: string) {
    return this.prismaService.$tx(async (prisma) => {
      const maxOrder = await this.getMaxOrder(baseId);
      return prisma.baseNode.update({
        where: { id: nodeId },
        select: this.getSelect(),
        data: {
          parentId: null,
          order: maxOrder + 1,
          lastModifiedBy: this.userId,
        },
      });
    });
  }

  private async moveNodeToFolder(baseId: string, nodeId: string, parentId: string) {
    return this.prismaService.$tx(async (prisma) => {
      const node = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: nodeId },
        })
        .catch(() => {
          throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.notFound',
            },
          });
        });

      const parentNode = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: parentId },
        })
        .catch(() => {
          throw new CustomHttpException(`Parent ${parentId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.parentNotFound',
            },
          });
        });

      if (parentNode.resourceType !== BaseNodeResourceType.Folder) {
        throw new CustomHttpException(
          `Parent ${parentId} is not a folder`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.parentIsNotFolder',
            },
          }
        );
      }

      if (node.resourceType === BaseNodeResourceType.Folder && parentId) {
        await this.assertFolderDepth(baseId, parentId);
      }

      // Check for circular reference
      const isCircular = await this.isCircularReference(baseId, nodeId, parentId);
      if (isCircular) {
        throw new CustomHttpException(
          'Cannot move node to its own child (circular reference)',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.circularReference',
            },
          }
        );
      }

      const maxOrder = await this.getMaxOrder(baseId);
      return prisma.baseNode.update({
        where: { id: nodeId },
        select: this.getSelect(),
        data: {
          parentId,
          order: maxOrder + 1,
          lastModifiedBy: this.userId,
        },
      });
    });
  }

  private async moveNodeTo(
    baseId: string,
    nodeId: string,
    ro: Pick<IMoveBaseNodeRo, 'anchorId' | 'position'>
  ): Promise<IBaseNodeEntry> {
    const { anchorId, position } = ro;
    return this.prismaService.$tx(async (prisma) => {
      const node = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: nodeId },
        })
        .catch(() => {
          throw new CustomHttpException(`Node ${nodeId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.notFound',
            },
          });
        });

      const anchor = await prisma.baseNode
        .findFirstOrThrow({
          where: { baseId, id: anchorId },
        })
        .catch(() => {
          throw new CustomHttpException(`Anchor ${anchorId} not found`, HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.baseNode.anchorNotFound',
            },
          });
        });

      if (node.resourceType === BaseNodeResourceType.Folder && anchor.parentId) {
        await this.assertFolderDepth(baseId, anchor.parentId);
      }

      await updateOrder({
        query: baseId,
        position: position ?? 'after',
        item: node,
        anchorItem: anchor,
        getNextItem: async (whereOrder, align) => {
          return prisma.baseNode.findFirst({
            where: {
              baseId,
              parentId: anchor.parentId,
              order: whereOrder,
            },
            select: { order: true, id: true },
            orderBy: { order: align },
          });
        },
        update: async (_, id, data) => {
          await prisma.baseNode.update({
            where: { id },
            data: { parentId: anchor.parentId, order: data.newOrder },
          });
        },
        shuffle: async () => {
          await this.shuffleOrders(baseId, anchor.parentId);
        },
      });

      return prisma.baseNode.findFirstOrThrow({
        where: { baseId, id: nodeId },
        select: this.getSelect(),
      });
    });
  }

  async getMaxOrder(baseId: string, parentId?: string | null) {
    const prisma = this.prismaService.txClient();
    const aggregate = await prisma.baseNode.aggregate({
      where: { baseId, parentId },
      _max: { order: true },
    });

    return aggregate._max.order ?? 0;
  }

  private async shuffleOrders(baseId: string, parentId: string | null) {
    const prisma = this.prismaService.txClient();
    const siblings = await prisma.baseNode.findMany({
      where: { baseId, parentId },
      orderBy: { order: 'asc' },
    });

    for (const [index, sibling] of siblings.entries()) {
      await prisma.baseNode.update({
        where: { id: sibling.id },
        data: { order: index + 10, lastModifiedBy: this.userId },
      });
    }
  }

  private async getParentNodeOrThrow(id: string) {
    const entry = await this.prismaService.baseNode.findFirst({
      where: { id },
      select: {
        id: true,
        parentId: true,
        resourceType: true,
        resourceId: true,
      },
    });
    if (!entry) {
      throw new CustomHttpException('Base node not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.baseNode.notFound',
        },
      });
    }
    return entry;
  }

  private async assertFolderDepth(baseId: string, id: string) {
    const folderDepth = await this.getFolderDepth(baseId, id);
    if (folderDepth >= maxFolderDepth) {
      throw new CustomHttpException('Folder depth limit exceeded', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.baseNode.folderDepthLimitExceeded',
        },
      });
    }
  }

  private async getFolderDepth(baseId: string, id: string) {
    const prisma = this.prismaService.txClient();
    const allFolders = await prisma.baseNode.findMany({
      where: { baseId, resourceType: BaseNodeResourceType.Folder },
      select: { id: true, parentId: true },
    });

    let depth = 0;
    if (allFolders.length === 0) {
      return depth;
    }

    const folderMap = keyBy(allFolders, 'id');
    let current = id;
    while (current) {
      depth++;
      const folder = folderMap[current];
      if (!folder) {
        throw new CustomHttpException('Folder not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.baseNode.folderNotFound',
          },
        });
      }
      if (folder.parentId === id) {
        throw new CustomHttpException(
          'A folder cannot be its own parent',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseNode.circularReference',
            },
          }
        );
      }
      current = folder.parentId ?? '';
    }
    return depth;
  }

  private async isCircularReference(
    baseId: string,
    nodeId: string,
    parentId: string
  ): Promise<boolean> {
    const knex = this.knex;

    // Non-recursive query: Start with the parent node
    const nonRecursiveQuery = knex
      .select('id', 'parent_id', 'base_id')
      .from('base_node')
      .where('id', parentId)
      .andWhere('base_id', baseId);

    // Recursive query: Traverse up the parent chain
    const recursiveQuery = knex
      .select('bn.id', 'bn.parent_id', 'bn.base_id')
      .from('base_node as bn')
      .innerJoin('ancestors as a', function () {
        // Join condition: bn.id = a.parent_id (get parent of current ancestor)
        this.on('bn.id', '=', 'a.parent_id').andOn('bn.base_id', '=', knex.raw('?', [baseId]));
      });

    // Combine non-recursive and recursive queries
    const cteQuery = nonRecursiveQuery.union(recursiveQuery);

    // Build final query with recursive CTE
    const finalQuery = knex
      .withRecursive('ancestors', ['id', 'parent_id', 'base_id'], cteQuery)
      .select('id')
      .from('ancestors')
      .where('id', nodeId)
      .limit(1)
      .toQuery();

    // Execute query
    const result = await this.prismaService
      .txClient()
      .$queryRawUnsafe<Array<{ id: string }>>(finalQuery);

    return result.length > 0;
  }

  async batchUpdateBaseNodes(data: { id: string; values: { [key: string]: unknown } }[]) {
    const sql = buildBatchUpdateSql(this.knex, data);
    if (!sql) {
      return;
    }
    await this.prismaService.txClient().$executeRawUnsafe(sql);
  }

  private presenceHandler<
    T =
      | IBaseNodePresenceCreatePayload
      | IBaseNodePresenceUpdatePayload
      | IBaseNodePresenceDeletePayload,
  >(baseId: string, handler: (presence: LocalPresence<T>) => void) {
    this.performanceCacheService.del(generateBaseNodeListCacheKey(baseId));
    // Skip if ShareDB connection is already closed (e.g., during shutdown)
    if (this.shareDbService.shareDbAdapter.closed) {
      this.logger.error('ShareDB connection is already closed, presence handler skipped');
      return;
    }
    presenceHandler(baseId, this.shareDbService, handler);
  }
}
