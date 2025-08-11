/* eslint-disable sonarjs/no-duplicate-string */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { IPublicSettingVo, ISettingVo, ITestLLMVo, IUploadLogoVo } from '@teable/openapi';
import {
  IUpdateSettingRo,
  testLLMRoSchema,
  updateSettingRoSchema,
  ITestLLMRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { SettingOpenApiService } from './setting-open-api.service';

@Controller('api/admin/setting')
export class SettingOpenApiController {
  constructor(private readonly settingOpenApiService: SettingOpenApiService) {}

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
    const setting = await this.settingOpenApiService.getSetting();
    const { aiConfig, ...rest } = setting;
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
        codingModels: aiConfig?.codingModels,
      },
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
}
