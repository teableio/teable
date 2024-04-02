/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type {
  CreateAccessTokenVo,
  GetAccessTokenVo,
  ListAccessTokenVo,
  RefreshAccessTokenVo,
  UpdateAccessTokenVo,
} from '@teable/openapi';
import {
  CreateAccessTokenRo,
  createAccessTokenRoSchema,
  refreshAccessTokenRoSchema,
  UpdateAccessTokenRo,
  updateAccessTokenRoSchema,
  RefreshAccessTokenRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AccessTokenService } from './access-token.service';

@Controller('api/access-token')
export class AccessTokenController {
  constructor(private readonly accessTokenService: AccessTokenService) {}

  @Post()
  async createAccessToken(
    @Body(new ZodValidationPipe(createAccessTokenRoSchema)) body: CreateAccessTokenRo
  ): Promise<CreateAccessTokenVo> {
    return await this.accessTokenService.createAccessToken(body);
  }

  @Put(':accessTokenId')
  async updateAccessToken(
    @Param('accessTokenId') accessTokenId: string,
    @Body(new ZodValidationPipe(updateAccessTokenRoSchema)) body: UpdateAccessTokenRo
  ): Promise<UpdateAccessTokenVo> {
    return await this.accessTokenService.updateAccessToken(accessTokenId, body);
  }

  @Delete(':accessTokenId')
  async deleteAccessToken(@Param('accessTokenId') accessTokenId: string) {
    return await this.accessTokenService.deleteAccessToken(accessTokenId);
  }

  @Post('/:accessTokenId/refresh')
  @HttpCode(200)
  async refreshAccessToken(
    @Param('accessTokenId') accessTokenId: string,
    @Body(new ZodValidationPipe(refreshAccessTokenRoSchema)) body: RefreshAccessTokenRo
  ): Promise<RefreshAccessTokenVo> {
    return await this.accessTokenService.refreshAccessToken(accessTokenId, body);
  }

  @Get()
  async getAccessTokens(): Promise<ListAccessTokenVo> {
    return await this.accessTokenService.listAccessToken();
  }

  @Get(':accessTokenId')
  async getAccessToken(@Param('accessTokenId') accessTokenId: string): Promise<GetAccessTokenVo> {
    return await this.accessTokenService.getAccessToken(accessTokenId);
  }
}
