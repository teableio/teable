import { Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { thresholdConfig } from '../configs/threshold.config';
import { CustomHttpException } from '../custom.exception';

interface IRetryOptions {
  maxRetries?: number;
  initialBackoff?: number;
  jitter?: number;
}

interface IRetryConfig {
  errorCodes: string[];
  errorMessage: string;
  errorCode: HttpErrorCode;
  loggerName: string;
}

function createRetryDecorator(config: IRetryConfig) {
  const logger = new Logger(config.loggerName);

  return function (opt?: IRetryOptions) {
    const { dbDeadlock } = thresholdConfig();
    const {
      maxRetries = dbDeadlock.maxRetries,
      initialBackoff = dbDeadlock.initialBackoff,
      jitter = dbDeadlock.jitter,
    } = opt ?? {};

    return function (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) {
      const originalMethod = descriptor.value;

      descriptor.value = async function (...args: unknown[]) {
        let retries = 0;
        let backoff = initialBackoff + Math.random() * jitter;

        while (retries <= maxRetries) {
          try {
            return await originalMethod.apply(this, args);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (error: any) {
            const { errorCodes, errorMessage, errorCode } = config;
            if (
              errorCodes.includes(error.code) ||
              (error.meta?.code && errorCodes.includes(error.meta.code as string))
            ) {
              if (retries === maxRetries) {
                logger.error(`${errorMessage} after ${retries} retries`, error.stack);
                throw new CustomHttpException(errorMessage, errorCode);
              }
              await new Promise((resolve) => setTimeout(resolve, backoff));
              backoff *= 1.5 + Math.random() * jitter;
            } else {
              throw error;
            }
          }
          retries++;
        }
      };

      return descriptor;
    };
  };
}

export const retryOnDeadlock = createRetryDecorator({
  errorCodes: ['40P01', 'P2034'],
  errorMessage: 'Database deadlock detected',
  errorCode: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
  loggerName: 'DeadlockRetryDecorator',
});

export const retryOnUniqueViolation = createRetryDecorator({
  errorCodes: ['23505'],
  errorMessage: 'Database unique violation detected',
  errorCode: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
  loggerName: 'UniqueViolationRetryDecorator',
});
