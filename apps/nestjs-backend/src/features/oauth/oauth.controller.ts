import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  OAuthCreateRo,
  OAuthUpdateRo,
  oauthCreateRoSchema,
  oauthUpdateRoSchema,
} from '@teable/openapi';
import type {
  AuthorizedVo,
  GenerateOAuthSecretVo,
  OAuthCreateVo,
  OAuthGetListVo,
  OAuthGetVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { OAuthService } from './oauth.service';

@Controller('/api/oauth/client')
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly cls: ClsService<IClsStore>
  ) {}

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

  @Delete(':clientId/secret/:secretId')
  async deleteOAuthSecret(
    @Param('clientId') clientId: string,
    @Param('secretId') secretId: string
  ): Promise<void> {
    return this.oauthService.deleteSecret(clientId, secretId);
  }

  @Post(':clientId/revoke-access')
  @HttpCode(200)
  async revokeToken(@Param('clientId') clientId: string) {
    return this.oauthService.revokeAccess(clientId);
  }

  @Get(':clientId/revoke-token')
  @TokenAccess()
  async revokeTokenGet(@Param('clientId') clientId: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) {
      throw new BadRequestException('only access token request can use this endpoint');
    }
    return this.oauthService.revokeAccess(clientId);
  }

  @Get('authorized/list')
  async getAuthorizedList(): Promise<AuthorizedVo[]> {
    return this.oauthService.getAuthorizedList();
  }
}
