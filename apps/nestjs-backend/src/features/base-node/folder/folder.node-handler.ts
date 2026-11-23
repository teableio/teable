import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { BaseNodeResourceType } from '@teable/openapi';
import type { ICreateFolderNodeRo, IUpdateBaseNodeRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import type { IMoveNodeContext } from '../base-node-move.service';
import type {
  IBaseNodeResourceCreateRo,
  IBaseNodeResourceHandler,
} from '../resource/base-node-resource-handler';
import { BaseNodeFolderService } from './base-node-folder.service';

@Injectable()
export class FolderNodeHandler implements IBaseNodeResourceHandler {
  readonly type = BaseNodeResourceType.Folder;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseNodeFolderService: BaseNodeFolderService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async list(baseId: string, ids?: string[]) {
    return await this.prismaService.baseNodeFolder.findMany({
      where: { baseId, id: { in: ids || undefined }, deletedTime: null },
      select: {
        id: true,
        name: true,
        createdBy: true,
        createdTime: true,
        lastModifiedBy: true,
        lastModifiedTime: true,
      },
    });
  }

  async create(baseId: string, ro: IBaseNodeResourceCreateRo) {
    const folder = await this.baseNodeFolderService.createFolder(baseId, ro as ICreateFolderNodeRo);
    return { id: folder.id, name: folder.name };
  }

  async update(baseId: string, id: string, { name }: IUpdateBaseNodeRo) {
    if (name) {
      await this.baseNodeFolderService.renameFolder(baseId, id, { name });
    }
  }

  async delete(baseId: string, id: string) {
    await this.baseNodeFolderService.deleteFolder(baseId, id);
  }

  async getNames(baseId: string, ids: string[]) {
    const rows = await this.prismaService.txClient().baseNodeFolder.findMany({
      where: { baseId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async moveResources(ctx: IMoveNodeContext) {
    const folderIds = ctx.resourceIds.get(BaseNodeResourceType.Folder) ?? [];
    if (folderIds.length > 0) {
      await this.prismaService.txClient().baseNodeFolder.updateMany({
        where: { id: { in: folderIds }, baseId: ctx.sourceBaseId },
        data: { baseId: ctx.targetBaseId, lastModifiedBy: this.cls.get('user.id') },
      });
    }
  }
}
