import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  OAuthCreateRo,
  OAuthUpdateRo,
  oauthCreateRoSchema,
  oauthUpdateRoSchema,
} from '@teable/openapi';
import type {
  GenerateOAuthSecretVo,
  OAuthCreateVo,
  OAuthGetListVo,
  OAuthGetVo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { OAuthService } from './oauth.service';

@Controller('/api/oauth/client')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Get(':clientId')
  async getOAuth(@Param('clientId') clientId: string): Promise<OAuthGetVo> {
    return this.oauthService.getOAuth(clientId);
  }

  @Get()
  async getOAuthList(): Promise<OAuthGetListVo> {
    return this.oauthService.getOAuthList();
  }

  @Post()
  async createOAuth(
    @Body(new ZodValidationPipe(oauthCreateRoSchema)) oauthCreateRo: OAuthCreateRo
  ): Promise<OAuthCreateVo> {
    return this.oauthService.createOAuth(oauthCreateRo);
  }

  @Put(':clientId')
  async updateOAuth(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(oauthUpdateRoSchema)) oauthUpdateRo: OAuthUpdateRo
  ): Promise<OAuthCreateVo> {
    return this.oauthService.updateOAuth(clientId, oauthUpdateRo);
  }

  @Delete(':clientId')
  async deleteOAuth(@Param('clientId') clientId: string): Promise<void> {
    return this.oauthService.deleteOAuth(clientId);
  }

  @Post(':clientId/secret')
  async generateOAuthSecret(@Param('clientId') clientId: string): Promise<GenerateOAuthSecretVo> {
    return this.oauthService.generateSecret(clientId);
  }

  @Delete(':clientId/secret')
  async deleteOAuthSecret(@Param('clientId') clientId: string): Promise<void> {
    return this.oauthService.deleteSecret(clientId);
  }
}
