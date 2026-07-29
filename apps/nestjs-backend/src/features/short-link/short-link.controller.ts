import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { IShortLinkVo } from '@teable/openapi';
import { createShortLinkRoSchema, ICreateShortLinkRo } from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { ShortLinkService } from './short-link.service';

@Controller('api/short-link')
export class ShortLinkController {
  constructor(private readonly shortLinkService: ShortLinkService) {}

  @Post()
  async createShortLink(
    @Body(new ZodValidationPipe(createShortLinkRoSchema)) createShortLinkRo: ICreateShortLinkRo
  ): Promise<IShortLinkVo> {
    return this.shortLinkService.createShortLink(createShortLinkRo);
  }

  @Public()
  @Get(':code')
  async getShortLink(@Param('code') code: string): Promise<IShortLinkVo> {
    return this.shortLinkService.getShortLink(code);
  }
}
