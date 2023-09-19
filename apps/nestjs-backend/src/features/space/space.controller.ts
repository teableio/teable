import { Body, Controller, Param, Patch, Post, Get, Delete } from '@nestjs/common';
import { SpaceSchema } from '@teable-group/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { SpaceService } from './space.service';

@Controller('api/space')
export class SpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  @Post()
  async createSpace(
    @Body(new ZodValidationPipe(SpaceSchema.createSpaceRoSchema))
    createSpaceRo: SpaceSchema.ICreateSpaceRo
  ): Promise<SpaceSchema.ICreateSpaceVo> {
    return await this.spaceService.createSpace(createSpaceRo);
  }

  @Patch(':spaceId')
  async updateSpace(
    @Param('spaceId') spaceId: string,
    @Body(new ZodValidationPipe(SpaceSchema.updateSpaceRoSchema))
    updateSpaceRo: SpaceSchema.IUpdateSpaceRo
  ): Promise<SpaceSchema.IUpdateSpaceVo> {
    return await this.spaceService.updateSpace(spaceId, updateSpaceRo);
  }

  @Get(':spaceId')
  async getSpaceById(@Param('spaceId') spaceId: string): Promise<SpaceSchema.IGetSpaceVo> {
    return await this.spaceService.getSpaceById(spaceId);
  }

  @Get()
  async getSpaceList(): Promise<SpaceSchema.IGetSpaceVo[]> {
    return await this.spaceService.getSpaceList();
  }

  @Delete(':spaceId')
  async deleteSpace(@Param('spaceId') spaceId: string) {
    await this.spaceService.deleteSpace(spaceId);
    return null;
  }
}
