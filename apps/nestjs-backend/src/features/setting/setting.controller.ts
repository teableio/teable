import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { IPublicSettingVo, ISettingVo } from '@teable/openapi';
import { IUpdateSettingRo, updateSettingRoSchema } from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { SettingService } from './setting.service';

@Controller('api/admin/setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  /**
   * Get the instance settings, now we have config for AI, there are some sensitive fields, we need check the permission before return.
   */
  @Permissions('instance|read')
  @Get()
  async getSetting(): Promise<ISettingVo> {
    return await this.settingService.getSetting();
  }

  /**
   * Public endpoint for getting public settings without authentication
   */
  @Public()
  @Get('public')
  async getPublicSetting(): Promise<IPublicSettingVo> {
    const setting = await this.settingService.getSetting();
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
      },
    };
  }

  @Patch()
  @Permissions('instance|update')
  async updateSetting(
    @Body(new ZodValidationPipe(updateSettingRoSchema))
    updateSettingRo: IUpdateSettingRo
  ): Promise<ISettingVo> {
    const res = await this.settingService.updateSetting(updateSettingRo);
    return {
      ...res,
      aiConfig: res.aiConfig ? JSON.parse(res.aiConfig) : null,
    };
  }
}
