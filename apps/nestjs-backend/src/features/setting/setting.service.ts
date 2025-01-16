import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ISettingVo, IUpdateSettingRo } from '@teable/openapi';

@Injectable()
export class SettingService {
  constructor(private readonly prismaService: PrismaService) {}

  async getSetting(): Promise<ISettingVo> {
    return await this.prismaService.setting
      .findFirstOrThrow({
        select: {
          instanceId: true,
          disallowSignUp: true,
          disallowSpaceCreation: true,
          disallowSpaceInvitation: true,
          enableEmailVerification: true,
          aiConfig: true,
        },
      })
      .then((setting) => ({
        ...setting,
        aiConfig: setting.aiConfig ? JSON.parse(setting.aiConfig as string) : null,
      }))
      .catch(() => {
        throw new NotFoundException('Setting not found');
      });
  }

  async updateSetting(updateSettingRo: IUpdateSettingRo) {
    const setting = await this.getSetting();

    const data: object = updateSettingRo;
    if ('aiConfig' in data) {
      // if statement to prevent "aiConfig" removal in case that field is not provided
      data['aiConfig'] = updateSettingRo.aiConfig ? JSON.stringify(updateSettingRo.aiConfig) : null;
    }

    return await this.prismaService.setting.update({
      where: { instanceId: setting.instanceId },
      data,
    });
  }
}
