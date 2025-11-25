/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { IBaseNodeTreeVo, IBaseNodeVo } from '@teable/openapi';
import {
  moveBaseNodeRoSchema,
  createBaseNodeRoSchema,
  duplicateBaseNodeRoSchema,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IMoveBaseNodeRo,
  updateBaseNodeRoSchema,
  IUpdateBaseNodeRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BaseNodeService } from './base-node.service';

@Controller('api/base/:baseId/node')
export class BaseNodeController {
  constructor(private readonly baseNodeService: BaseNodeService) {}

  @Get('tree')
  @Permissions('base|read')
  async getTree(@Param('baseId') baseId: string): Promise<IBaseNodeTreeVo> {
    return this.baseNodeService.getTree(baseId);
  }

  @Get(':nodeId')
  @Permissions('base|read')
  async get(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.getNode(baseId, nodeId);
  }

  @Post()
  @Permissions('base|update')
  async create(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createBaseNodeRoSchema)) ro: ICreateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.create(baseId, ro);
  }

  @Post(':nodeId/duplicate')
  @Permissions('base|update')
  async duplicate(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(duplicateBaseNodeRoSchema)) ro: IDuplicateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.duplicate(baseId, nodeId, ro);
  }

  @Delete(':nodeId')
  @Permissions('base|update')
  async delete(@Param('baseId') baseId: string, @Param('nodeId') nodeId: string): Promise<void> {
    return this.baseNodeService.delete(baseId, nodeId);
  }

  @Put(':nodeId')
  @Permissions('base|update')
  async update(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(updateBaseNodeRoSchema)) ro: IUpdateBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.update(baseId, nodeId, ro);
  }

  @Put(':nodeId/move')
  @Permissions('base|update')
  async move(
    @Param('baseId') baseId: string,
    @Param('nodeId') nodeId: string,
    @Body(new ZodValidationPipe(moveBaseNodeRoSchema)) ro: IMoveBaseNodeRo
  ): Promise<IBaseNodeVo> {
    return this.baseNodeService.move(baseId, nodeId, ro);
  }
}
