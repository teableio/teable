import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IUpdateSettingRo, updateSettingRoSchema } from '@teable/openapi';
import type { ISettingVo } from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { SettingService } from './setting.service';

@Controller('api/admin/setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Public()
  @Get()
  async getSetting(): Promise<ISettingVo> {
    return await this.settingService.getSetting();
  }

  @Patch()
  @Permissions('instance|update')
  async updateSetting(
    @Body(new ZodValidationPipe(updateSettingRoSchema))
    updateSettingRo: IUpdateSettingRo
  ): Promise<ISettingVo> {
    return await this.settingService.updateSetting(updateSettingRo);
  }
}
