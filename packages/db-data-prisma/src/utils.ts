import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Budget for one interactive transaction on the data database. Anything that
 * arms a database-side guard inside such a transaction has to stay under this,
 * otherwise Prisma abandons the transaction first and the statement keeps
 * running on the server with nobody waiting for its result.
 *
 * Read on every call rather than once at import: `.env` files only reach
 * `process.env` when ConfigModule boots, which is after this module is loaded,
 * so a snapshot taken here would silently ignore them.
 */
export const getDataTransactionTimeout = () =>
  Number(process.env.PRISMA_TRANSACTION_TIMEOUT ?? 5000);

/** How long a transaction may wait for a pool connection before it is opened. */
export const getDataTransactionMaxWait = () =>
  Number(process.env.PRISMA_TRANSACTION_MAX_WAIT ?? 2000);

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
