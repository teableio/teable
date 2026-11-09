import { Body, Controller, Param, Post } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import type { ISendEmailRo, ISendEmailVo } from '@teable/openapi';
import {
  ITestMailTransportConfigRo,
  sendEmailRoSchema,
  testMailTransportConfigRoSchema,
} from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { SettingOpenApiService } from '../../setting/open-api/setting-open-api.service';
import { MailSenderOpenApiService } from './mail-sender-open-api.service';

@Controller('api/mail-sender')
export class MailSenderOpenApiController {
  constructor(
    private readonly mailSenderOpenApiService: MailSenderOpenApiService,
    private readonly settingOpenApiService: SettingOpenApiService
  ) {}

  // Connects to the SMTP server given in the body, so only instance admins (the mail settings page) may call it.
  @Post('/test-transport-config')
  @Permissions('instance|update')
  async testTransportConfig(
    @Body(new ZodValidationPipe(testMailTransportConfigRoSchema))
    testMailTransportConfigRo: ITestMailTransportConfigRo
  ): Promise<void> {
    const { transportConfig } = testMailTransportConfigRo;
    // The settings pages test the SMTP config they show, its password masked.
    const pass = await this.settingOpenApiService.unmaskSmtpPassword(transportConfig);
    try {
      await this.mailSenderOpenApiService.testTransportConfig({
        ...testMailTransportConfigRo,
        transportConfig: { ...transportConfig, auth: { ...transportConfig.auth, pass } },
      });
    } catch (error) {
      throw new CustomHttpException(
        error instanceof Error ? error.message : 'Mail config error',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.email.testEmailError',
            context: {
              message: error instanceof Error ? error.message : 'Mail config error',
            },
          },
        }
      );
    }
  }

  @Post(':baseId/send')
  @Permissions('base|update')
  async sendEmail(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(sendEmailRoSchema))
    sendEmailRo: ISendEmailRo
  ): Promise<ISendEmailVo> {
    return this.mailSenderOpenApiService.sendEmail(baseId, sendEmailRo);
  }
}
