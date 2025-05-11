import { HttpException, HttpStatus } from '@nestjs/common';

export class TimeoutHttpException extends HttpException {
  code: string;
  data?: { localization?: { i18nKey: string; context?: Record<string, unknown> } };

  constructor() {
    super('Request timeout', HttpStatus.REQUEST_TIMEOUT);
    this.code = 'request_timeout';
    this.data = {
      localization: {
        i18nKey: 'httpErrors.custom.requestTimeout',
        context: {},
      },
    };
  }
}
