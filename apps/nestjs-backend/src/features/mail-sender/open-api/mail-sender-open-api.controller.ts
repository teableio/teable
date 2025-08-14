import { Body, Controller, Post } from '@nestjs/common';
import { ITestMailTransportConfigRo, testMailTransportConfigRoSchema } from '@teable/openapi';
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
    return await this.mailSenderOpenApiService.testTransportConfig(testMailTransportConfigRo);
  }
}
