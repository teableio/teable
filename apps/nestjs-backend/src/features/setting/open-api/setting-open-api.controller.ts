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
  IBatchTestLLMVo,
  ITestApiKeyVo,
  ITestPublicAccessVo,
  IUpdateAiConfigRo,
  IUpdateAiConfigVo,
  IUpdateAppConfigRo,
  IUpdateAppConfigVo,
} from '@teable/openapi';
import {
  IUpdateSettingRo,
  testLLMRoSchema,
  updateSettingRoSchema,
  ITestLLMRo,
  setSettingMailTransportConfigRoSchema,
  ISetSettingMailTransportConfigRo,
  batchTestLLMRoSchema,
  IBatchTestLLMRo,
  testApiKeyRoSchema,
  ITestApiKeyRo,
  updateAiConfigRoSchema,
  updateAppConfigRoSchema,
} from '@teable/openapi';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
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
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
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
    const setting = await this.settingOpenApiService.getPublicSetting();
    return {
      ...setting,
      turnstileSiteKey: this.turnstileService.getTurnstileSiteKey(),
      changeEmailSendCodeMailRate: this.thresholdConfig.changeEmailSendCodeMailRate,
      resetPasswordSendMailRate: this.thresholdConfig.resetPasswordSendMailRate,
      signupVerificationSendCodeMailRate: this.thresholdConfig.signupVerificationSendCodeMailRate,
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

  @Patch('ai-config')
  @Permissions('instance|update')
  async updateAiConfig(
    @Body(new ZodValidationPipe(updateAiConfigRoSchema))
    updateAiConfigRo: IUpdateAiConfigRo
  ): Promise<IUpdateAiConfigVo> {
    return await this.settingOpenApiService.updateAiConfig(updateAiConfigRo);
  }

  @Patch('app-config')
  @Permissions('instance|update')
  async updateAppConfig(
    @Body(new ZodValidationPipe(updateAppConfigRoSchema))
    updateAppConfigRo: IUpdateAppConfigRo
  ): Promise<IUpdateAppConfigVo> {
    return await this.settingOpenApiService.updateAppConfig(updateAppConfigRo);
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
    return await this.settingOpenApiService.uploadLogo(file);
  }

  @Permissions('instance|update')
  @Post('test-llm')
  async testLLM(
    @Body(new ZodValidationPipe(testLLMRoSchema)) testLLMRo: ITestLLMRo
  ): Promise<ITestLLMVo> {
    return await this.settingOpenApiService.testLLM(testLLMRo);
  }

  @Permissions('instance|update')
  @Post('batch-test-llm')
  async batchTestLLM(
    @Body(new ZodValidationPipe(batchTestLLMRoSchema.optional())) batchTestLLMRo?: IBatchTestLLMRo
  ): Promise<IBatchTestLLMVo> {
    return await this.settingOpenApiService.batchTestLLM(batchTestLLMRo);
  }

  @Permissions('instance|update')
  @Post('test-api-key')
  async testApiKey(
    @Body(new ZodValidationPipe(testApiKeyRoSchema)) testApiKeyRo: ITestApiKeyRo
  ): Promise<ITestApiKeyVo> {
    return await this.settingOpenApiService.testApiKey(testApiKeyRo);
  }

  @Permissions('instance|update')
  @Get('test-public-access')
  async testPublicAccess(): Promise<ITestPublicAccessVo> {
    return await this.settingOpenApiService.testPublicAccess();
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
