import { Body, Controller, Post } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { ITestMailTransportConfigRo, testMailTransportConfigRoSchema } from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { MailSenderOpenApiService } from './mail-sender-open-api.service';

@Controller('api/mail-sender')
export class MailSenderOpenApiController {
  constructor(private readonly mailSenderOpenApiService: MailSenderOpenApiService) {}

  @Post('/test-transport-config')
  async testTransportConfig(
    @Body(new ZodValidationPipe(testMailTransportConfigRoSchema))
    testMailTransportConfigRo: ITestMailTransportConfigRo
  ): Promise<void> {
    try {
      await this.mailSenderOpenApiService.testTransportConfig(testMailTransportConfigRo);
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
}
