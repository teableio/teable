import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { IBaseShareByNodeIdVo, IBaseShareVo } from '@teable/openapi';
import {
  createBaseShareRoSchema,
  updateBaseShareRoSchema,
  ICreateBaseShareRo,
  IUpdateBaseShareRo,
} from '@teable/openapi';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { filterVisibleNodes } from '../base-node/base-node.permission.helper';
import type { IBaseNodeVisibilityContext } from '../base-node/types';
import { BaseShareService } from './base-share.service';

@Controller('api/base/:baseId/share')
@UseGuards(PermissionGuard)
export class BaseShareController {
  constructor(
    private readonly baseShareService: BaseShareService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Post()
  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Permissions('base|update')
  async create(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createBaseShareRoSchema)) data: ICreateBaseShareRo
  ): Promise<IBaseShareVo> {
    return this.baseShareService.createBaseShare(baseId, data);
  }

  @Get()
  @Permissions('base|read')
  async list(@Param('baseId') baseId: string): Promise<{ nodeId: string | null }[]> {
    const [shares, visibleNodeIds] = await Promise.all([
      this.baseShareService.getBaseShareList(baseId),
      this.getVisibleNodeIds(baseId),
    ]);
    return shares.filter(({ nodeId }) =>
      nodeId === null ? !this.isInNodeShare() : visibleNodeIds.has(nodeId)
    );
  }

  @Get('node')
  @Permissions('base|read')
  async getBaseShare(@Param('baseId') baseId: string): Promise<IBaseShareByNodeIdVo | null> {
    // The whole base lies outside a node share, and so does its share
    if (this.isInNodeShare()) {
      return null;
    }
    return this.presentShare(await this.baseShareService.getBaseShare(baseId));
  }

  @Get('node/:nodeId')
  @Permissions('base|read')
  async getByNodeId(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IBaseShareByNodeIdVo | null> {
    // A node the member cannot see answers as one nobody shared: whether it is shared, and how,
    // is not theirs to learn either
    if (!(await this.getVisibleNodeIds(baseId)).has(nodeId)) {
      return null;
    }
    return this.presentShare(await this.baseShareService.getBaseShareByNodeId(baseId, nodeId));
  }

  /** The nodes the member sees in the sidebar; only their shares are anything to them. */
  private async getVisibleNodeIds(baseId: string): Promise<Set<string>> {
    const [nodes, permissionContext] = await Promise.all([
      this.baseShareService.getNodeVisibilityEntries(baseId),
      this.getPermissionContext(baseId),
    ]);
    return new Set(filterVisibleNodes(nodes, permissionContext).map((node) => node.id));
  }

  private isInNodeShare(): boolean {
    return Boolean(this.cls.get('baseShare')?.nodeId);
  }

  protected async getPermissionContext(_baseId: string): Promise<IBaseNodeVisibilityContext> {
    return {
      permissionSet: new Set(this.cls.get('permissions')),
      shareNodeId: this.cls.get('baseShare')?.nodeId ?? undefined,
    };
  }

  /**
   * The share id is the link itself: whoever holds it gets in, past the authority matrix and
   * with the share's own edit rights, and the share's settings say how. Reading the base
   * (base|read) is not enough to be handed either; only members who manage shares (base|update)
   * are. Anyone else learns whether the node is shared, nothing more.
   */
  private presentShare(share: IBaseShareVo | null): IBaseShareByNodeIdVo | null {
    if (!share || this.cls.get('permissions')?.includes('base|update')) {
      return share;
    }
    return pick(share, ['baseId', 'nodeId', 'enabled']);
  }

  @Patch(':shareId')
  @Permissions('base|update')
  async update(
    @Param('baseId') baseId: string,
    @Param('shareId') shareId: string,
    @Body(new ZodValidationPipe(updateBaseShareRoSchema)) data: IUpdateBaseShareRo
  ): Promise<IBaseShareVo> {
    return this.baseShareService.updateBaseShare(baseId, shareId, data);
  }

  @Delete(':shareId')
  @Permissions('base|update')
  async delete(@Param('baseId') baseId: string, @Param('shareId') shareId: string): Promise<void> {
    return this.baseShareService.deleteBaseShare(baseId, shareId);
  }

  @Post(':shareId/refresh')
  @Permissions('base|update')
  async refresh(
    @Param('baseId') baseId: string,
    @Param('shareId') shareId: string
  ): Promise<IBaseShareVo> {
    return this.baseShareService.refreshBaseShareId(baseId, shareId);
  }
}
