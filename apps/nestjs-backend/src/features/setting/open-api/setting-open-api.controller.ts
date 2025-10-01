/* eslint-disable sonarjs/no-duplicate-string */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  IPublicSettingVo,
  ISetSettingMailTransportConfigVo,
  ISettingVo,
  ITestLLMVo,
  IUploadLogoVo,
} from '@teable/openapi';
import {
  IUpdateSettingRo,
  testLLMRoSchema,
  updateSettingRoSchema,
  ITestLLMRo,
  setSettingMailTransportConfigRoSchema,
  ISetSettingMailTransportConfigRo,
  SettingKey,
} from '@teable/openapi';
import { AuthConfig, type IAuthConfig } from '../../../configs/auth.config';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { TurnstileService } from '../../auth/turnstile/turnstile.service';
import { SettingOpenApiService } from './setting-open-api.service';

@Controller('api/admin/setting')
export class SettingOpenApiController {
  constructor(
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly turnstileService: TurnstileService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {}

  /**
   * Get the instance settings, now we have config for AI, there are some sensitive fields, we need check the permission before return.
   */
  @Permissions('instance|read')
  @Get()
  async getSetting(): Promise<ISettingVo> {
    return await this.settingOpenApiService.getSetting();
  }

  /**
   * Public endpoint for getting public settings without authentication
   */
  @Public()
  @Get('public')
  async getPublicSetting(): Promise<IPublicSettingVo> {
    const setting = await this.settingOpenApiService.getSetting([
      SettingKey.INSTANCE_ID,
      SettingKey.BRAND_NAME,
      SettingKey.BRAND_LOGO,
      SettingKey.DISALLOW_SIGN_UP,
      SettingKey.DISALLOW_SPACE_CREATION,
      SettingKey.DISALLOW_SPACE_INVITATION,
      SettingKey.ENABLE_EMAIL_VERIFICATION,
      SettingKey.ENABLE_WAITLIST,
      SettingKey.AI_CONFIG,
      SettingKey.APP_CONFIG,
      SettingKey.WEB_SEARCH_CONFIG,
    ]);
    const { aiConfig, appConfig, webSearchConfig, ...rest } = setting;
    return {
      ...rest,
      aiConfig: {
        enable: aiConfig?.enable ?? false,
        llmProviders:
          aiConfig?.llmProviders?.map((provider) => ({
            type: provider.type,
            name: provider.name,
            models: provider.models,
          })) ?? [],
        chatModel: aiConfig?.chatModel,
        capabilities: aiConfig?.capabilities,
      },
      appGenerationEnabled: Boolean(appConfig?.apiKey),
      webSearchEnabled: Boolean(webSearchConfig?.apiKey),
      turnstileSiteKey: this.turnstileService.getTurnstileSiteKey(),
      signupVerificationCodeRateLimitSeconds:
        this.authConfig.signupVerificationCodeRateLimitSeconds,
    };
  }

  @Patch()
  @Permissions('instance|update')
  async updateSetting(
    @Body(new ZodValidationPipe(updateSettingRoSchema))
    updateSettingRo: IUpdateSettingRo
  ): Promise<ISettingVo> {
    return await this.settingOpenApiService.updateSetting(updateSettingRo);
  }

  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req, file, callback) => {
        if (file.mimetype.startsWith('image/')) {
          callback(null, true);
        } else {
          callback(new BadRequestException('Invalid file type'), false);
        }
      },
      limits: {
        fileSize: 500 * 1024, // limit file size is 500KB
      },
    })
  )
  @Patch('logo')
  @Permissions('instance|update')
  async uploadLogo(@UploadedFile() file: Express.Multer.File): Promise<IUploadLogoVo> {
    return this.settingOpenApiService.uploadLogo(file);
  }

  @Permissions('instance|update')
  @Post('test-llm')
  async testLLM(
    @Body(new ZodValidationPipe(testLLMRoSchema)) testLLMRo: ITestLLMRo
  ): Promise<ITestLLMVo> {
    return await this.settingOpenApiService.testLLM(testLLMRo);
  }

  @Permissions('instance|update')
  @Put('set-mail-transport-config')
  async setMailTransportConfig(
    @Body(new ZodValidationPipe(setSettingMailTransportConfigRoSchema))
    setMailTransportConfigRo: ISetSettingMailTransportConfigRo
  ): Promise<ISetSettingMailTransportConfigVo> {
    await this.settingOpenApiService.setMailTransportConfig(setMailTransportConfigRo);

    return {
      ...setMailTransportConfigRo,
      transportConfig: {
        ...setMailTransportConfigRo.transportConfig,
        auth: {
          user: setMailTransportConfigRo.transportConfig.auth.user,
          pass: '',
        },
      },
    };
  }
}
