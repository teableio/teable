import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IUpdateSettingRo, updateSettingRoSchema } from '@teable/openapi';
import type { ISettingVo } from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { AdminGuard } from './admin.guard';
import { SettingService } from './setting.service';

@Controller('api/admin/setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Public()
  @Get()
  async getSetting(): Promise<ISettingVo> {
    return await this.settingService.getSetting();
  }

  @UseGuards(AdminGuard)
  @Patch()
  async updateSetting(
    @Body(new ZodValidationPipe(updateSettingRoSchema))
    updateSettingRo: IUpdateSettingRo
  ): Promise<ISettingVo> {
    return await this.settingService.updateSetting(updateSettingRo);
  }
}
